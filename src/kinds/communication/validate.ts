import { pointer, type Diagnostic } from '../../core/errors.js';
import { reference, uniqueIds } from '../../model/rules.js';
import { parseSequence, type SequenceTerm } from './format.js';
import type { CommunicationDiagram, Lifeline, Message } from './model.js';

/**
 * Semantic rules of communication diagrams (UML 2.5.1 clause 17.9). Each rule has
 * a stable code; docs/kinds/communication.md lists them with their fixtures.
 */
export function validateCommunicationDiagram(model: CommunicationDiagram): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const links = model.links ?? [], messages = model.messages ?? [];
  uniqueIds([
    ...model.lifelines.map((l, i) => ({ id: l.id, path: pointer('', 'lifelines', i) })),
    ...links.flatMap((l, i) => l.id === undefined ? [] : [{ id: l.id, path: pointer('', 'links', i) }]),
    ...messages.flatMap((m, i) => m.id === undefined ? [] : [{ id: m.id, path: pointer('', 'messages', i) }]),
  ], diagnostics);
  const lifelines = new Map<string, Lifeline>(model.lifelines.map(l => [l.id, l]));

  for (const [i, l] of model.lifelines.entries()) {
    const at = pointer('', 'lifelines', i);
    if (l.name === undefined && l.type === undefined) diagnostics.push({ code: 'LIFELINE_WITHOUT_NAME', path: at, message: `Lifeline "${l.id}" needs a name, a type, or both` });
    if (l.selector !== undefined && l.name === undefined) diagnostics.push({ code: 'SELECTOR_WITHOUT_NAME', path: pointer(at, 'selector'), message: `Lifeline "${l.id}" has a selector but no name; the selector qualifies the name (name[selector])` });
  }

  const pair = (a: string, b: string): string => a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
  const linked = new Map<string, string>();
  for (const [i, link] of links.entries()) {
    const at = pointer('', 'links', i);
    const ok = [reference(link.from, pointer(at, 'from'), lifelines, diagnostics, 'lifeline'), reference(link.to, pointer(at, 'to'), lifelines, diagnostics, 'lifeline')].every(Boolean);
    if (!ok) continue;
    const key = pair(link.from, link.to), first = linked.get(key);
    if (first === undefined) {linked.set(key, at);}
    else {diagnostics.push({ code: 'DUPLICATE_LINK', path: at, message: `Lifelines "${link.from}" and "${link.to}" are already linked (${first}); list all their messages on one link` });}
  }

  const bySequence = new Map<string, { message: Message; index: number; terms: SequenceTerm[] }>();
  const parsed: ({ terms: SequenceTerm[] } | undefined)[] = [];
  for (const [i, m] of messages.entries()) {
    const at = pointer('', 'messages', i);
    const ok = [reference(m.from, pointer(at, 'from'), lifelines, diagnostics, 'lifeline'), reference(m.to, pointer(at, 'to'), lifelines, diagnostics, 'lifeline')].every(Boolean);
    if (ok && !linked.has(pair(m.from, m.to))) {
      diagnostics.push({ code: 'MESSAGE_WITHOUT_LINK', path: pointer(at, 'to'), message: m.from === m.to
        ? `Message ${m.sequence} goes from "${m.from}" to itself, but "${m.from}" has no self-link`
        : `Message ${m.sequence} travels from "${m.from}" to "${m.to}", but no link connects them`, details: { from: m.from, to: m.to } });
    }
    const sort = m.sort ?? 'synchronous';
    if (m.returnValue !== undefined && sort !== 'reply') diagnostics.push({ code: 'INVALID_RETURN_VALUE', path: pointer(at, 'returnValue'), message: `Only reply messages carry a return value; message ${m.sequence} is ${sort}` });
    if (m.assignTo !== undefined && sort === 'asynchronous') diagnostics.push({ code: 'INVALID_ASSIGNMENT', path: pointer(at, 'assignTo'), message: `Asynchronous message ${m.sequence} returns nothing to assign` });
    if (m.guard !== undefined && m.iteration !== undefined) diagnostics.push({ code: 'GUARD_WITH_ITERATION', path: pointer(at, 'iteration'), message: `Message ${m.sequence} has both a guard and an iteration; a sequence term has one recurrence (branch or loop)` });
    const terms = parseSequence(m.sequence);
    parsed.push(terms && { terms });
    if (!terms) {
      diagnostics.push({ code: 'INVALID_SEQUENCE_NUMBER', path: pointer(at, 'sequence'), message: `"${m.sequence}" is not a sequence number like 1, 1.2, 2a or 2b.1 (positive integers, optional lowercase thread letter, joined by ".")` });
      continue;
    }
    const key = terms.map(t => `${t.number}${t.thread}`).join('.');
    const first = bySequence.get(key);
    if (first === undefined) {bySequence.set(key, { message: m, index: i, terms });}
    else {diagnostics.push({ code: 'DUPLICATE_SEQUENCE_NUMBER', path: pointer(at, 'sequence'), message: `Sequence number ${m.sequence} is already used at ${pointer('', 'messages', first.index)}` });}
  }

  // Nesting: "1.2" is sent while "1" is handled, so by the receiver of "1".
  const siblings = new Map<string, { terms: SequenceTerm[]; index: number }[]>();
  for (const [key, { message, index, terms }] of bySequence) {
    const at = pointer('', 'messages', index);
    const parentKey = key.split('.').slice(0, -1).join('.');
    if (parentKey) {
      const parent = bySequence.get(parentKey);
      if (!parent) {
        diagnostics.push({ code: 'MISSING_PARENT_MESSAGE', path: pointer(at, 'sequence'), message: `Message ${message.sequence} is nested in ${parentKey}, but there is no message ${parentKey}` });
        continue;
      }
      if (parent.message.to !== message.from) {
        diagnostics.push({ code: 'NESTED_SENDER_MISMATCH', path: pointer(at, 'from'), message: `Message ${message.sequence} is sent while ${parentKey} is handled, so its sender must be "${parent.message.to}" (the receiver of ${parentKey}), not "${message.from}"` });
      }
    }
    if ((message.sort ?? 'synchronous') === 'reply') {
      const parent = parentKey ? bySequence.get(parentKey) : undefined;
      const parentSort = parent?.message.sort ?? 'synchronous';
      if (!parent || parentSort !== 'synchronous' || parent.message.from !== message.to) {
        diagnostics.push({ code: 'INVALID_REPLY', path: pointer(at, 'sort'), message: parent
          ? `Reply ${message.sequence} must answer synchronous call ${parentKey}, going back to its sender "${parent.message.from}"`
          : `Reply ${message.sequence} must be nested in the synchronous call it answers (e.g. 1.3 answers 1)` });
      }
    }
    siblings.set(parentKey, [...(siblings.get(parentKey) ?? []), { terms, index }]);
  }

  // Siblings are numbered 1, 2, 3 ... and concurrent threads a, b, c ...
  for (const group of siblings.values()) {
    const byNumber = new Map<number, { thread: string; index: number }[]>();
    for (const { terms, index } of group) {
      const last = terms.at(-1)!;
      byNumber.set(last.number, [...(byNumber.get(last.number) ?? []), { thread: last.thread, index }]);
    }
    const numbers = [...byNumber.keys()].sort((a, b) => a - b);
    for (const [k, n] of numbers.entries()) {
      const entries = byNumber.get(n)!.sort((a, b) => a.thread.localeCompare(b.thread));
      const seqOf = (index: number) => messages[index]!.sequence;
      if (n !== k + 1) {
        const index = entries[0]!.index;
        diagnostics.push({ code: 'SEQUENCE_GAP', path: pointer('', 'messages', index, 'sequence'), message: `Message ${seqOf(index)} skips a number: siblings are numbered 1, 2, 3 ... and ${k + 1} is missing` });
        continue;
      }
      const plain = entries.find(e => e.thread === '');
      if (plain && entries.length > 1) {
        diagnostics.push({ code: 'AMBIGUOUS_THREAD', path: pointer('', 'messages', plain.index, 'sequence'), message: `Message ${seqOf(plain.index)} has no thread letter, but concurrent threads of the same step exist (${seqOf(entries.find(e => e.thread)!.index)})` });
        continue;
      }
      const skipped = entries.find((e, j) => e.thread && e.thread !== String.fromCodePoint(97 + j));
      if (skipped) {
        diagnostics.push({ code: 'SEQUENCE_GAP', path: pointer('', 'messages', skipped.index, 'sequence'), message: `Message ${seqOf(skipped.index)} skips a thread letter: concurrent threads are lettered a, b, c ...` });
      }
    }
  }
  return diagnostics;
}
