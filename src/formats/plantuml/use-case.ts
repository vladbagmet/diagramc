import { commonDefinitions } from '../../core/text.js';
import type { Element, End, Relationship, UseCase, UseCaseDiagram } from '../../kinds/use-case/model.js';
import { IdMaker } from '../common.js';
import type { KindFormat, Losses, Problems, SourceLine } from '../types.js';
import { STEREOTYPE, decode, document, encode, plantumlAliases, quoted, stereotypeText, stereotypes, titleOf } from './text.js';

/**
 * Use case diagram <-> PlantUML use case diagram. Actors, use cases and
 * subjects (`rectangle`) keep their ID as the alias; use cases of a subject sit
 * in its block. Extension points follow the use case name below a `--` line,
 * and an extend carries its condition and extension point in its label, as the
 * note UML attaches to it.
 */

const MULTIPLICITY = new RegExp(commonDefinitions.multiplicity.pattern, 'u');

/** `"Name\n--\nextension points\npoint"`, one display line per `\n`. */
function useCaseLabel(u: UseCase): string {
  const name = encode(u.name, '"');
  return u.extensionPoints?.length ? `"${[name, '--', 'extension points', ...u.extensionPoints.map(p => encode(p, '"'))].join(String.raw`\n`)}"` : `"${name}"`;
}

export function exportUseCase(model: UseCaseDiagram, losses: Losses): string {
  const ids = plantumlAliases();
  const lines: string[] = [];
  const useCase = (u: UseCase, pad: string): void => {
    const alias = ids.get(u.id);
    lines.push(`${pad}usecase ${useCaseLabel(u)} as ${alias}`);
  };
  const inSubject = new Map<string, UseCase[]>();
  for (const e of model.elements) if (e.type === 'useCase' && e.subject !== undefined) inSubject.set(e.subject, [...(inSubject.get(e.subject) ?? []), e]);
  for (const e of model.elements) {
    const alias = ids.get(e.id);
    switch (e.type) {
      case 'actor':
        lines.push(`actor ${quoted(e.name)} as ${alias}${stereotypeText(e.stereotypes)}`);
        break;
      case 'subject': {
        const members = inSubject.get(e.id) ?? [];
        lines.push(`rectangle ${quoted(e.name)} as ${alias}${stereotypeText(e.stereotypes)}${members.length > 0 ? ' {' : ''}`);
        if (members.length > 0) {
          for (const u of members) useCase(u, '  ');
          lines.push('}');
        }
        break;
      }
      case 'useCase':
        if (e.subject === undefined) useCase(e, '');
        break;
      case 'note':
        lines.push(`note ${quoted(e.text)} as ${alias}`);
        break;
    }
  }
  const end = (e: End | undefined): string => (e?.multiplicity === undefined ? '' : ` "${e.multiplicity}"`);
  for (const [i, r] of (model.relationships ?? []).entries()) {
    if (r.id !== undefined) losses.add(`/relationships/${i}/id`, 'Relationship IDs are not kept');
    const from = ids.get(r.from),
      to = ids.get(r.to);
    switch (r.type) {
      case 'association':
        lines.push(`${from}${end(r.fromEnd)} --${end(r.toEnd)} ${to}${r.name === undefined ? '' : ` : ${encode(r.name, '<>')}`}`);
        break;
      case 'generalization':
        lines.push(`${from} --|> ${to}`);
        break;
      case 'include':
        lines.push(`${from} ..> ${to} : <<include>>`);
        break;
      case 'extend':
        lines.push(
          String.raw`${from} ..> ${to} : <<extend>>${r.condition === undefined ? '' : String.raw`\ncondition: {${encode(r.condition, '{}')}}`}\nextension point: ${encode(r.extensionPoint)}`,
        );
        break;
    }
  }
  for (const e of model.elements) if (e.type === 'note') for (const t of e.attachedTo ?? []) lines.push(`${ids.get(e.id)} .. ${ids.get(t)}`);
  return document(model.title, lines);
}

// ---------------------------------------------------------------- import

const NAME = String.raw`"[^"]*"|\([^()]*\)|:[^:]+:|[\p{L}\p{N}_.]+`;
const RELATION = new RegExp(
  String.raw`^(${NAME})\s*(?:"([^"]*)"\s*)?(<\|?|<)?(-+|\.+)(?:(?:up|down|left|right|u|d|l|r)(?:-+|\.+))?(\|?>)?\s*(?:"([^"]*)"\s*)?(${NAME})\s*(?::\s*(.*))?$`,
  'u',
);

export function importUseCase(lines: readonly SourceLine[], problems: Problems): Record<string, unknown> {
  const ids = new IdMaker();
  const elements: Element[] = [];
  const byKey = new Map<string, Element>();
  const relationships: Relationship[] = [];
  let title: string | undefined;
  let subject: { id: string; line: SourceLine } | undefined;

  /** A written reference: `(Use case)`, `:Actor:`, `"Name"` or an alias; unknown ones are created as PlantUML does. */
  const resolve = (written: string, line: SourceLine): Element | undefined => {
    const shape = written.startsWith('(') ? 'useCase' : written.startsWith(':') ? 'actor' : undefined;
    const key = written.startsWith('"') || shape ? decode(written.slice(1, -1).trim()) : written;
    const found = byKey.get(key);
    if (found) return found;
    if (!shape) {
      problems.malformed(line, `"${key}" is not declared; declare it as an actor or use case first`);
      return undefined;
    }
    return add(shape, key, undefined, [], line);
  };
  const add = (type: 'actor' | 'useCase' | 'subject', label: string, alias: string | undefined, list: string[], line: SourceLine): Element | undefined => {
    const key = alias ?? label;
    if (byKey.has(key)) {
      problems.malformed(line, `"${key}" is declared twice`);
      return undefined;
    }
    const id = (alias === undefined ? undefined : ids.claim(alias)) ?? ids.fresh(label);
    let element: Element;
    if (type === 'useCase') {
      const parts = label.split(String.raw`\n`);
      const u: UseCase = { id, type: 'useCase', name: decode(parts[0]!.trim()) };
      if (parts.length > 1) {
        if (parts[1] !== '--' || parts[2] !== 'extension points' || parts.length < 4) {
          problems.unsupported(line, String.raw`a multi-line use case is read only as "Name\n--\nextension points\npoint\n..."`);
          return undefined;
        }
        u.extensionPoints = parts.slice(3).map(p => decode(p.trim()));
      }
      if (subject) u.subject = subject.id;
      if (list.length > 0) {
        problems.unsupported(line, 'stereotypes on use cases are not part of the model');
        return undefined;
      }
      element = u;
    } else {
      if (type === 'actor' && subject) {
        problems.unsupported(line, 'actors are outside the subject; declare them at the top level');
        return undefined;
      }
      element = { id, type, name: decode(label), ...(list.length > 0 ? { stereotypes: list } : {}) };
    }
    elements.push(element);
    byKey.set(key, element);
    if (alias !== undefined) byKey.set(decode(label), element);
    return element;
  };

  for (const line of lines) {
    const t = line.text;
    const heading = titleOf(line);
    if (heading !== undefined) {
      title = heading;
      continue;
    }
    if (t === '}') {
      if (!subject) problems.malformed(line, 'unmatched "}"');
      subject = undefined;
      continue;
    }
    // Declarations: `actor "Name" as a <<s>>`, `actor :Name: as a`, `usecase (Name) as u`, `(Name) as u`, `:Name: as a`.
    let m = new RegExp(
      String.raw`^(?:(actor|usecase|rectangle)\s+)?("[^"]*"|\([^()]*\)|:[^:]+:|[\p{L}\p{N}_.]+)(?:\s+as\s+("[^"]*"|\([^()]*\)|[\p{L}\p{N}_.]+))?\s*((?:${STEREOTYPE}\s*)*)(\{)?$`,
      'u',
    ).exec(t);
    if (m && (m[1] !== undefined || m[2]!.startsWith('(') || m[2]!.startsWith(':'))) {
      let type: 'actor' | 'useCase' | 'subject' = m[1] === 'actor' ? 'actor' : m[1] === 'rectangle' ? 'subject' : 'useCase';
      if (m[1] === undefined) type = m[2]!.startsWith(':') ? 'actor' : 'useCase';
      let label = m[2]!,
        alias = m[3];
      // `usecase U1 as "Name"`: the quoted part is the display name.
      if (alias !== undefined && (alias.startsWith('"') || alias.startsWith('('))) [label, alias] = [alias, label];
      const display = /^["(:]/u.test(label) ? label.slice(1, -1).trim() : label;
      if (alias !== undefined && !/^[\p{L}\p{N}_.]+$/u.test(alias)) {
        problems.malformed(line, `invalid alias ${JSON.stringify(alias)}`);
        continue;
      }
      const st = stereotypes(m[4] ?? '');
      if (type === 'subject') {
        if (subject) {
          problems.unsupported(line, 'subjects cannot be nested');
          continue;
        }
        const element = add('subject', display, alias ?? (/^[\p{L}\p{N}_.]+$/u.test(label) ? label : undefined), st.list, line);
        if (element && m[6]) subject = { id: element.id, line };
        continue;
      }
      if (m[6]) {
        problems.malformed(line, `only a subject (rectangle) has a body`);
        continue;
      }
      add(type, display, alias ?? (/^[\p{L}\p{N}_.]+$/u.test(label) ? label : undefined), st.list, line);
      continue;
    }
    if (/^(?:package|node|folder|frame|cloud|database|component|usecase|actor|rectangle|class)\b/u.test(t)) {
      problems.unsupported(line, 'expected an actor, a use case or a subject (rectangle) declaration; packages and other containers are not part of the model');
      continue;
    }
    m = /^note\s+"([^"]*)"\s+as\s+([\p{L}\p{N}_.]+)$/u.exec(t);
    if (m) {
      const element: Element = { id: ids.claim(m[2]!) ?? ids.fresh('note'), type: 'note', text: decode(m[1]!) };
      elements.push(element);
      byKey.set(m[2]!, element);
      continue;
    }
    m = new RegExp(String.raw`^note\s+(?:left|right|top|bottom)\s+of\s+(${NAME})\s*:\s*(.+)$`, 'u').exec(t);
    if (m) {
      const target = resolve(m[1]!, line);
      if (target) elements.push({ id: ids.fresh('note'), type: 'note', text: decode(m[2]!.trim()), attachedTo: [target.id] });
      continue;
    }
    if (/^note\b/u.test(t)) {
      problems.unsupported(line, String.raw`only one-line notes are read: "note \"text\" as N" (attached with "N .. target") or "note right of X : text"`);
      continue;
    }
    m = RELATION.exec(t);
    if (m) {
      relation(m, line);
      continue;
    }
    problems.unsupported(line, 'not a use case diagram statement this importer understands (actors, use cases, subjects, relationships, notes)');
  }
  if (subject) problems.malformed(subject.line, 'the subject is not closed with "}"');

  function relation(m: RegExpExecArray, line: SourceLine): void {
    const [, a, endA, leftHead = '', style, rightHead = '', endB, b, label] = m as unknown as string[];
    const from = resolve(a!, line),
      to = resolve(b!, line);
    if (!from || !to) return;
    const dashed = style!.startsWith('.');
    if (from.type === 'note' || to.type === 'note') {
      if (!dashed || leftHead || rightHead || label !== undefined) {
        problems.malformed(line, 'notes are attached with a plain dotted line (note .. element)');
        return;
      }
      const [note, target] = from.type === 'note' ? [from, to] : [to, from];
      if (target.type === 'note') {
        problems.malformed(line, 'a note cannot be attached to a note');
        return;
      }
      ((note as { attachedTo?: string[] }).attachedTo ??= []).push(target.id);
      return;
    }
    const reversed = leftHead.startsWith('<');
    const [src, dst, srcEnd, dstEnd] = reversed ? [to, from, endB, endA] : [from, to, endA, endB];
    if ((leftHead === '<|' && !rightHead) || (rightHead === '|>' && !leftHead)) {
      if (dashed) {
        problems.unsupported(line, 'a dotted line with a triangle (realization) is not part of the use case model');
        return;
      }
      relationships.push({ type: 'generalization', from: src.id, to: dst.id });
      return;
    }
    if (leftHead && rightHead) {
      problems.unsupported(line, 'arrowheads at both ends are not part of the use case model');
      return;
    }
    if (dashed) {
      const text = (label ?? '').trim();
      const parts = text.split(String.raw`\n`).map(p => p.trim());
      const keyword = new RegExp(`^(?:${STEREOTYPE}|«(.*?)»)$`, 'u').exec(parts[0] ?? '');
      const kind = keyword ? decode((keyword[1] ?? keyword[2]!).trim()) : undefined;
      if (kind === 'include' && parts.length === 1) {
        relationships.push({ type: 'include', from: src.id, to: dst.id });
        return;
      }
      if (kind === 'extend') {
        let condition: string | undefined,
          point: string | undefined,
          bad = false;
        for (const p of parts.slice(1)) {
          const c = /^condition:\s*\{(.*)\}$/u.exec(p),
            e = /^extension point:\s*(.+)$/u.exec(p);
          if (c && condition === undefined) condition = decode(c[1]!.trim());
          else if (e && point === undefined) point = decode(e[1]!.trim());
          else bad = true;
        }
        if (bad || point === undefined) {
          problems.unsupported(
            line,
            String.raw`an extend needs its extension point in the label: "<<extend>>\ncondition: {c}\nextension point: name" (the condition is optional)`,
          );
          return;
        }
        relationships.push({ type: 'extend', from: src.id, to: dst.id, extensionPoint: point, ...(condition === undefined ? {} : { condition }) });
        return;
      }
      problems.unsupported(
        line,
        'a dotted arrow is read as <<include>> or <<extend>> (with "extension point: name"); other dependencies are not part of the use case model',
      );
      return;
    }
    // A solid line is an association; an arrowhead on it (navigability) is not kept.
    const end = (text: string | undefined): End | undefined => {
      if (!text?.trim()) return undefined;
      if (!MULTIPLICITY.test(text.trim())) {
        problems.unsupported(line, `association ends carry only a multiplicity, not ${JSON.stringify(text)}`);
        return undefined;
      }
      return { multiplicity: text.trim() };
    };
    const fromEnd = end(srcEnd),
      toEnd = end(dstEnd);
    const r: Relationship = { type: 'association', from: src.id, to: dst.id };
    if (fromEnd) r.fromEnd = fromEnd;
    if (toEnd) r.toEnd = toEnd;
    if (label?.trim()) r.name = decode(label.trim());
    relationships.push(r);
  }

  const model: Record<string, unknown> = { kind: 'use-case' };
  if (title !== undefined) model.title = title;
  model.elements = elements;
  if (relationships.length > 0) model.relationships = relationships;
  return model;
}

export function detectUseCase(lines: readonly SourceLine[]): number {
  let score = 0;
  for (const { text } of lines) {
    if (/^usecase\b|^\([^()]+\)|\s\([^()]+\)\s*$|<<(?:include|extend)>>/u.test(text)) score += 3;
    else if (/^actor\b|^:[^:]+:/u.test(text)) score += 1;
  }
  return score;
}

export const plantumlUseCase: KindFormat<UseCaseDiagram> = { kind: 'use-case', export: exportUseCase, import: importUseCase, detect: detectUseCase };
