import type { Fragment, Item, Lifeline, MessageSort, Operator, SequenceDiagram } from '../../kinds/sequence/model.js';
import { isMessage } from '../../kinds/sequence/model.js';
import { IdMaker, compact, splitTopLevel } from '../common.js';
import type { KindFormat, Losses, Problems, SourceLine } from '../types.js';
import { PRESENTATION, decode, document, encode, entity, mermaidAliases, titleOf } from './text.js';

/**
 * Sequence diagram <-> Mermaid sequenceDiagram. Lifelines keep their ID;
 * messages use Mermaid's arrows (`->>` synchronous, `-)` asynchronous, `-->>`
 * reply) and its activation marks (`+` activates the receiver, `-` deactivates
 * the sender). A created lifeline is declared with `create` right before its
 * create message, a deleting message follows `destroy`.
 */

const ARROW: Record<'synchronous' | 'asynchronous' | 'reply', string> = { synchronous: '->>', asynchronous: '-)', reply: '-->>' };
const NATIVE = new Set<Operator>(['alt', 'opt', 'loop', 'par', 'break', 'critical']);
/** The keyword that separates operands, per operator. */
const SEPARATOR: Partial<Record<Operator, string>> = { alt: 'else', par: 'and', critical: 'option' };

const lifelineLabel = (l: Lifeline): string => {
  const name = l.name === undefined ? '' : encode(l.name, ':');
  return l.classifier === undefined ? name : `${name}${name ? ' ' : ''}: ${encode(l.classifier, ':')}`;
};
const call = (name: string, args: readonly string[] | undefined): string =>
  `${encode(name, '():=,')}${args === undefined ? '' : `(${args.map(a => encode(a, '(),:=')).join(', ')})`}`;

export function exportSequence(model: SequenceDiagram, losses: Losses): string {
  const ids = mermaidAliases();
  const order = new Map(model.lifelines.map((l, i) => [l.id, i]));
  const lines: string[] = [];
  const declare = (l: Lifeline): string => {
    const id = ids.get(l.id);
    if (l.symbol !== undefined && l.symbol !== 'rectangle' && l.symbol !== 'actor')
      losses.add(`/lifelines/${order.get(l.id)}/symbol`, `Mermaid has no ${l.symbol} symbol; the lifeline is a plain participant`);
    const label = lifelineLabel(l);
    return `${l.symbol === 'actor' ? 'actor' : 'participant'} ${id}${label === id ? '' : ` as ${label}`}`;
  };
  const created = new Set<string>();
  const walk = (items: readonly Item[]): void => {
    for (const i of items) {
      if (i.type === 'message' && i.sort === 'create') created.add(i.to);
      if (i.type === 'fragment') for (const o of i.operands) walk(o.items);
    }
  };
  walk(model.items);
  if (created.size > 0) losses.add('/lifelines', 'A created lifeline is declared at its create message, so it moves after the other lifelines');
  if (model.autonumber) lines.push('autonumber');
  for (const l of model.lifelines) if (!created.has(l.id)) lines.push(declare(l));
  const a = (id: string): string => ids.get(id);
  const span = (list: readonly string[], path: string): string => {
    if (list.length <= 2) return list.map(a).join(',');
    losses.add(path, `A note over ${list.length} lifelines is written over the outermost two`);
    const sorted = [...list].sort((x, y) => order.get(x)! - order.get(y)!);
    return `${a(sorted[0]!)},${a(sorted.at(-1)!)}`;
  };
  const emit = (items: readonly Item[], depth: number, base: string): void => {
    const pad = '  '.repeat(depth);
    for (const [index, item] of items.entries()) {
      const path = `${base}/${index}`;
      if ((item as { id?: string }).id !== undefined) losses.add(`${path}/id`, `The ID of a ${item.type} item is not kept`);
      if (isMessage(item)) {
        if (item.type !== 'message') {
          // Mermaid has no gates: a found or lost message is kept as a note beside its lifeline.
          losses.add(path, `Mermaid has no ${item.type} messages; it is written as a note "${item.type}: name(args)" beside the lifeline`);
          const text = `${item.type}: ${item.name === undefined ? '' : call(item.name, item.arguments)}`.trimEnd();
          lines.push(`${pad}Note ${item.type === 'found' ? `left of ${a(item.to)}` : `right of ${a(item.from)}`}: ${text}`);
          continue;
        }
        const label =
          item.name === undefined
            ? ''
            : item.sort === 'reply'
              ? `${item.assignment === undefined ? '' : `${encode(item.assignment, '=():,')} = `}${call(item.name, item.arguments)}${item.returnValue === undefined ? '' : ` : ${encode(item.returnValue)}`}`
              : call(item.name, item.arguments);
        if (item.sort === 'create') {
          const l = model.lifelines.find(x => x.id === item.to)!;
          if (created.has(l.id)) {
            lines.push(`${pad}create ${declare(l)}`);
            created.delete(l.id);
          } else losses.add(path, 'A second create message to one lifeline is written as a reply-style message');
        }
        if (item.sort === 'delete') lines.push(`${pad}destroy ${a(item.to)}`);
        const arrow = item.sort === 'create' ? '-->>' : item.sort === 'delete' ? '->>' : ARROW[item.sort];
        // Mermaid takes one activation mark per message: activating the receiver wins, deactivating the sender follows.
        const mark = item.activate ? '+' : item.deactivate ? '-' : '';
        lines.push(`${pad}${a(item.from)}${arrow}${mark}${a(item.to)}: ${label}`.trimEnd());
        if (item.activate && item.deactivate) {
          lines.push(`${pad}deactivate ${a(item.from)}`);
          losses.add(`${path}/deactivate`, 'A message that both activates and deactivates is written with a separate deactivate line');
        }
        continue;
      }
      switch (item.type) {
        case 'activate':
        case 'deactivate':
          lines.push(`${pad}${item.type} ${a(item.lifeline)}`);
          break;
        case 'destroy':
          losses.add(path, 'Mermaid destroys a lifeline only together with a message; the destruction is left out');
          break;
        case 'stateInvariant':
          losses.add(path, 'Mermaid has no state invariants; it is written as a note over the lifeline');
          lines.push(`${pad}Note over ${a(item.lifeline)}: {${encode(item.constraint)}}`);
          break;
        case 'note':
          lines.push(
            `${pad}Note ${item.position === 'over' ? `over ${span(item.lifelines, `${path}/lifelines`)}` : `${item.position} of ${a(item.lifelines[0]!)}`}: ${encode(item.text)}`,
          );
          break;
        case 'ref':
          losses.add(path, 'Mermaid has no interaction uses; it is written as a note "ref Name(args)"');
          lines.push(`${pad}Note over ${span(item.covered, `${path}/covered`)}: ref ${call(item.name, item.arguments)}`);
          break;
        case 'fragment':
          fragment(item, depth, path);
          break;
      }
    }
  };
  const fragment = (f: Fragment, depth: number, path: string): void => {
    const pad = '  '.repeat(depth);
    if (!NATIVE.has(f.operator)) {
      losses.add(path, `Mermaid has no ${f.operator} fragment; its operands are written without the frame`);
      for (const [i, o] of f.operands.entries()) emit(o.items, depth, `${path}/operands/${i}/items`);
      return;
    }
    if (f.operands.length > 1 && !SEPARATOR[f.operator])
      losses.add(path, `Mermaid's ${f.operator} has one operand; the operands are written one after the other`);
    for (const [i, o] of f.operands.entries()) {
      // A guard that starts like loop bounds has its parenthesis encoded.
      const guard = o.guard === undefined ? '' : o.guard.startsWith('(') ? entity('(') + encode(o.guard.slice(1)) : encode(o.guard);
      const bounds = i === 0 && f.min !== undefined ? `(${f.min}${f.max === undefined ? '' : `,${f.max}`})` : '';
      const head = i === 0 ? f.operator : SEPARATOR[f.operator];
      if (head === undefined) {
        if (o.guard !== undefined) losses.add(`${path}/operands/${i}/guard`, 'The guard of a second operand is not kept');
      } else lines.push(`${pad}${head}${[bounds, guard].some(Boolean) ? ` ${[bounds, guard].filter(Boolean).join(' ')}` : ''}`);
      emit(o.items, depth + 1, `${path}/operands/${i}/items`);
    }
    lines.push(`${pad}end`);
  };
  emit(model.items, 0, '/items');
  return document(model.title, 'sequenceDiagram', lines);
}

// ---------------------------------------------------------------- import

const ID = '[A-Za-z0-9_]+';
const MESSAGE = new RegExp(String.raw`^(${ID})\s*(<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\)|-\))\s*([+-]?)\s*(${ID})\s*:(.*)$`, 'u');
interface Frame {
  fragment: Fragment | undefined;
  line: SourceLine;
  items: Item[];
  parent: Item[];
}

export function importSequence(lines: readonly SourceLine[], problems: Problems): Record<string, unknown> {
  const ids = new IdMaker();
  const lifelines: Lifeline[] = [];
  const byKey = new Map<string, string>();
  const top: Item[] = [];
  const stack: Frame[] = [];
  let title: string | undefined,
    autonumber = false;
  let creating: string | undefined, destroying: { id: string; line: SourceLine } | undefined;
  const current = (): Item[] => stack.at(-1)?.items ?? top;

  const declare = (key: string, label: string | undefined, actor: boolean): string => {
    const id = ids.claim(key) ?? ids.fresh(key);
    const l: Lifeline = { id };
    const text = (label ?? key).trim();
    const m = /^(.*?)\s*(?:^|\s):\s(.*)$/u.exec(text);
    if (m) {
      if (m[1]!.trim()) l.name = decode(m[1]!.trim());
      l.classifier = decode(m[2]!.trim());
    } else l.name = decode(text);
    if (actor) l.symbol = 'actor';
    lifelines.push(l);
    byKey.set(key, id);
    return id;
  };
  const known = (key: string, line: SourceLine): string | undefined => {
    const id = byKey.get(key);
    if (id === undefined) problems.malformed(line, `"${key}" is not a declared participant`);
    return id;
  };
  const parseCall = (text: string): { name: string; arguments?: string[] } => {
    const m = /^([^()]*?)\s*\((.*)\)$/u.exec(text.trim());
    if (!m) return { name: decode(text.trim()) };
    return { name: decode(m[1]!), arguments: m[2]!.trim() ? splitTopLevel(m[2]!).map(decode) : [] };
  };
  const open = (fragment: Fragment | undefined, guard: string | undefined, line: SourceLine): void => {
    const items: Item[] = [];
    if (fragment) {
      fragment.operands.push({ items, ...(guard?.trim() ? { guard: decode(guard.trim()) } : {}) });
      current().push(fragment);
      stack.push({ fragment, line, items, parent: current() });
    } else stack.push({ fragment, line, items: current(), parent: current() });
  };

  for (const line of lines.slice(1)) {
    const t = line.text;
    const heading = titleOf(line);
    if (heading !== undefined) {
      title = heading;
      continue;
    }
    if (/^title\s/u.test(t)) {
      title = decode(t.slice(6).trim());
      continue;
    }
    if (t === 'autonumber') {
      autonumber = true;
      continue;
    }
    if (/^autonumber\b/u.test(t)) {
      problems.unsupported(line, 'autonumber with a start or step is not supported; write "autonumber"');
      continue;
    }
    if (PRESENTATION.test(t) || /^links?\s/u.test(t)) continue;
    let m = new RegExp(String.raw`^(create\s+)?(participant|actor)\s+(${ID})(?:\s+as\s+(.+))?$`, 'u').exec(t);
    if (m) {
      if (byKey.has(m[3]!)) {
        problems.malformed(line, `"${m[3]}" is declared twice`);
        continue;
      }
      const id = declare(m[3]!, m[4], m[2] === 'actor');
      if (m[1]) creating = id;
      continue;
    }
    if (/^(?:create\s+)?(?:participant|actor)\b/u.test(t)) {
      problems.unsupported(line, 'expected "participant Id" or "participant Id as Label" (participant types and other options are not imported)');
      continue;
    }
    m = new RegExp(String.raw`^destroy\s+(${ID})$`, 'u').exec(t);
    if (m) {
      const id = known(m[1]!, line);
      if (id) destroying = { id, line };
      continue;
    }
    m = new RegExp(String.raw`^(activate|deactivate)\s+(${ID})$`, 'u').exec(t);
    if (m) {
      const id = known(m[2]!, line);
      if (id) current().push({ type: m[1] as 'activate', lifeline: id });
      continue;
    }
    m = new RegExp(String.raw`^note\s+(over|left of|right of)\s+(${ID}(?:\s*,\s*${ID})?)\s*:(.*)$`, 'iu').exec(t);
    if (m) {
      const targets = m[2]!.split(',').map(s => known(s.trim(), line));
      if (targets.includes(undefined)) continue;
      const position = m[1]!.toLowerCase() === 'over' ? 'over' : m[1]!.toLowerCase() === 'left of' ? 'left' : 'right';
      if (position !== 'over' && targets.length > 1) {
        problems.malformed(line, `a note ${m[1]} takes one participant`);
        continue;
      }
      current().push({ type: 'note', position, lifelines: targets as string[], text: decode(m[3]!.trim()) });
      continue;
    }
    m = /^(loop|alt|opt|par|critical|break)(?:\s+(.*))?$/u.exec(t);
    if (m) {
      const operator = m[1] as Operator;
      let guard = m[2];
      const fragment: Fragment = { type: 'fragment', operator, operands: [] };
      const bounds = operator === 'loop' && guard !== undefined ? /^\((\d+)(?:,(\d+|\*))?\)(?:\s+(.*))?$/u.exec(guard) : null;
      if (bounds) {
        fragment.min = Number(bounds[1]);
        if (bounds[2] !== undefined) fragment.max = bounds[2] === '*' ? '*' : Number(bounds[2]);
        guard = bounds[3];
      }
      open(fragment, guard, line);
      continue;
    }
    if (/^rect\b/u.test(t)) {
      open(undefined, undefined, line);
      continue;
    }
    m = /^(else|and|option)(?:\s+(.*))?$/u.exec(t);
    if (m) {
      const frame = stack.at(-1);
      const expected = { else: 'alt', and: 'par', option: 'critical' }[m[1] as 'else'];
      if (frame?.fragment?.operator !== expected) {
        problems.malformed(line, `"${m[1]}" belongs inside ${expected}`);
        continue;
      }
      const items: Item[] = [];
      frame.fragment.operands.push({ items, ...(m[2]?.trim() ? { guard: decode(m[2].trim()) } : {}) });
      frame.items = items;
      continue;
    }
    if (t === 'end') {
      if (!stack.pop()) problems.malformed(line, '"end" without an open block');
      continue;
    }
    m = MESSAGE.exec(t);
    if (m) {
      message(m, line);
      continue;
    }
    if (/^box\b/u.test(t)) {
      problems.unsupported(line, 'participant boxes are not part of the sequence model');
      continue;
    }
    problems.unsupported(line, 'not a sequenceDiagram statement this importer understands (participants, messages, activations, notes, fragments)');
  }
  for (const frame of stack) problems.malformed(frame.line, 'the block is not closed with "end"');
  if (destroying) problems.malformed(destroying.line, '"destroy" must be followed by the message that destroys the participant');

  function message(m: RegExpExecArray, line: SourceLine): void {
    const [, f, arrow, mark, to2, label] = m as unknown as [string, string, string, string, string, string];
    if (!['->>', '-->>', '-)', '--)'].includes(arrow)) {
      problems.unsupported(line, `the arrow ${arrow} has no message sort in the model (->> synchronous, -) asynchronous, -->> reply)`);
      return;
    }
    const from = known(f, line),
      to = known(to2, line);
    if (!from || !to) return;
    let sort: MessageSort = arrow === '->>' ? 'synchronous' : arrow === '-->>' ? 'reply' : 'asynchronous';
    if (creating !== undefined) {
      if (creating !== to) {
        problems.malformed(line, 'the message after "create participant" must be sent to it');
        creating = undefined;
        return;
      }
      sort = 'create';
      creating = undefined;
    } else if (destroying !== undefined) {
      if (destroying.id !== to) {
        problems.unsupported(line, 'a destroyed participant must receive the next message (a deleting message)');
        destroying = undefined;
        return;
      }
      sort = 'delete';
      destroying = undefined;
    }
    const text = label.trim();
    let parsed: { name?: string; arguments?: string[]; assignment?: string; returnValue?: string } = {};
    if (text) {
      const r = sort === 'reply' ? /^(?:(.*?)\s=\s)?(.*?)(?:\s:\s(.*))?$/u.exec(text)! : undefined;
      parsed = parseCall(r ? r[2]! : text);
      if (r?.[1] !== undefined) parsed.assignment = decode(r[1].trim());
      if (r?.[3] !== undefined) parsed.returnValue = decode(r[3].trim());
    }
    current().push(
      compact({ type: 'message' as const, sort, from, to, ...parsed, activate: mark === '+' || undefined, deactivate: mark === '-' || undefined }),
    );
  }

  const model: Record<string, unknown> = { kind: 'sequence' };
  if (title !== undefined) model.title = title;
  if (autonumber) model.autonumber = true;
  model.lifelines = lifelines;
  model.items = top;
  return model;
}

export const detectSequence = (lines: readonly SourceLine[]): number => (lines[0]?.text === 'sequenceDiagram' ? 1 : 0);

export const mermaidSequence: KindFormat<SequenceDiagram> = { kind: 'sequence', export: exportSequence, import: importSequence, detect: detectSequence };
