import type { Attribute, ClassDiagram, ClassifierType, End, Operation, Relationship } from '../../kinds/class/model.js';
import { isLegacy, isNote } from '../../kinds/class/model.js';
import { attributeText, endText, literalText, operationText, parseAttribute, parseEnd, parseOperation, type Codec } from '../class-members.js';
import { IdMaker, compact } from '../common.js';
import type { KindFormat, Losses, Problems, SourceLine } from '../types.js';
import { STEREOTYPE, decode, document, encode, nameAndAlias, plantumlAliases, quoted, stereotypeText, stereotypes, titleOf, token } from './text.js';

/**
 * Class diagram <-> PlantUML class diagram. Classifiers keep their ID as the
 * alias; members are written in UML notation (`-vin : String [1] = x {readOnly}`)
 * with the separators of that notation encoded wherever they occur inside a
 * name, type or default, so every member reads back exactly.
 */

/** Keyword stereotypes that stand for a classifier type PlantUML has no declaration for. */
const TYPE_STEREOTYPE: Partial<Record<ClassifierType, string>> = { datatype: 'dataType', primitive: 'primitive' };
const codec: Codec = { encode, token, decode };

/** End label ` "role multiplicity"`, or "" without one. */
function endLabel(end: End | undefined): string {
  const text = endText(end, codec);
  return text === undefined ? '' : ` "${text}"`;
}

export function exportClass(model: ClassDiagram, losses: Losses): string {
  const ids = plantumlAliases();
  const lines: string[] = [];
  model.elements.forEach((e, i) => {
    const alias = ids.get(e.id);
    if (isNote(e)) { lines.push(`note ${quoted(e.text)} as ${alias}`); return; }
    const keyword = e.type === 'interface' ? 'interface' : e.type === 'enumeration' ? 'enum' : e.abstract ? 'abstract class' : 'class';
    const typeStereotype = TYPE_STEREOTYPE[e.type];
    const head = `${keyword} ${e.name === alias ? alias : `${quoted(e.name)} as ${alias}`}${stereotypeText([...(typeStereotype ? [typeStereotype] : []), ...(e.stereotypes ?? [])])}`;
    if (e.type === 'interface' && e.abstract) losses.add(`/elements/${i}/abstract`, 'An interface marked abstract is exported as a plain interface');
    const body: string[] = [];
    for (const literal of e.literals ?? []) body.push(literalText(literal, codec));
    // In an enumeration, a bare attribute would read back as a literal: {field} marks it.
    (e.attributes ?? []).forEach(a => body.push(isLegacy(a) ? `{field} ${encode(a.text, '{}')}` : `${e.type === 'enumeration' ? '{field} ' : ''}${a.static ? '{static} ' : ''}${attributeText(a, codec)}`));
    (e.operations ?? []).forEach(o => body.push(isLegacy(o) ? `{method} ${encode(o.text, '{}')}` : `${o.static ? '{static} ' : ''}${o.abstract ? '{abstract} ' : ''}${operationText(o, codec)}`));
    if (!body.length) { lines.push(head); return; }
    lines.push(`${head} {`, ...body.map(b => `  ${b}`), '}');
  });
  for (const r of model.relationships ?? []) {
    const from = ids.get(r.from), to = ids.get(r.to);
    const nav = (n: boolean | undefined, yes: string): string => n === undefined ? '' : n ? yes : 'x';
    let arrow: string;
    switch (r.type) {
      case 'generalization': arrow = '--|>'; break;
      case 'realization': arrow = '..|>'; break;
      case 'dependency': arrow = '..>'; break;
      case 'containment': arrow = '+--'; break;
      case 'aggregation': arrow = `o--${nav(r.toEnd?.navigable, '>')}`; break;
      case 'composition': arrow = `*--${nav(r.toEnd?.navigable, '>')}`; break;
      default: arrow = `${nav(r.fromEnd?.navigable, '<')}--${nav(r.toEnd?.navigable, '>')}`;
    }
    const label = [r.keyword === undefined ? undefined : `<<${encode(r.keyword, '<>,')}>>`, r.name === undefined ? undefined : encode(r.name, '<>«»')].filter(t => t !== undefined).join(' ');
    lines.push(`${from}${endLabel(r.fromEnd)} ${arrow}${endLabel(r.toEnd)} ${to}${label ? ` : ${label}` : ''}`);
  }
  for (const e of model.elements) if (isNote(e)) for (const target of e.attachedTo ?? []) lines.push(`${ids.get(e.id)} .. ${ids.get(target)}`);
  return document(model.title, lines);
}

// ---------------------------------------------------------------- import

const DECLARATION = /^(abstract\s+class|abstract|class|interface|enum)\s+(.+)$/u;
const OTHER_DECLARATION = /^(annotation|circle|diamond|entity|exception|metaclass|protocol|stereotype|struct|record|dataclass|object|package|namespace|together|map|json|usecase|actor|component|node|rectangle)\b/u;
/** `A "x" --|> "y" B : label`: ends, arrow and label. Directions (`-up->`) are accepted and dropped. */
const RELATION = /^("[^"]*"|[\p{L}\p{N}_.]+)\s*(?:"([^"]*)"\s*)?((?:<\||<|\*|o|\+|x|#|\})?(?:-+|\.+)(?:(?:up|down|left|right|u|d|l|r)(?:-+|\.+))?(?:\|>|>|\*|o|\+|x|#|\{)?)\s*(?:"([^"]*)"\s*)?("[^"]*"|[\p{L}\p{N}_.]+)\s*(?::\s*(.*))?$/u;

interface Classifier { id: string; type: ClassifierType; name: string; abstract?: boolean; stereotypes?: string[]; attributes?: Attribute[]; operations?: Operation[]; literals?: string[] }

export function importClass(lines: readonly SourceLine[], problems: Problems): Record<string, unknown> {
  const ids = new IdMaker();
  const byKey = new Map<string, { id: string; element: Classifier | NoteElement }>();
  interface NoteElement { id: string; type: 'note'; text: string; attachedTo?: string[] }
  const elements: (Classifier | NoteElement)[] = [];
  const relationships: Relationship[] = [];
  let title: string | undefined;

  /** The element a name or alias refers to, created as a class when unknown (as PlantUML does). */
  const resolve = (written: string): Classifier | NoteElement => {
    const key = written.startsWith('"') ? decode(written.slice(1, -1)) : written;
    const found = byKey.get(key);
    if (found) return found.element;
    const id = ids.claim(key) ?? ids.fresh(key);
    const element: Classifier = { id, type: 'class', name: key };
    byKey.set(key, { id, element });
    elements.push(element);
    return element;
  };
  const declare = (line: SourceLine, name: string, alias: string | undefined, type: ClassifierType, abstract: boolean, list: string[]): Classifier | undefined => {
    const key = alias ?? name;
    const existing = byKey.get(key)?.element ?? byKey.get(name)?.element;
    if (existing && existing.type === 'note') { problems.malformed(line, `"${key}" is already a note`); return undefined; }
    let element = existing as Classifier | undefined;
    if (!element) {
      const id = (alias === undefined ? undefined : ids.claim(alias)) ?? ids.fresh(name);
      element = { id, type, name };
      elements.push(element);
    } else {
      element.type = type;
      element.name = name;
    }
    byKey.set(key, { id: element.id, element });
    if (alias !== undefined) byKey.set(name, { id: element.id, element });
    if (abstract) element.abstract = true;
    for (const s of list) {
      const typeFor = s === 'dataType' || s === 'datatype' ? 'datatype' : s === 'primitive' ? 'primitive' : undefined;
      if (typeFor && type === 'class') element.type = typeFor;
      else (element.stereotypes ??= []).push(s);
    }
    return element;
  };

  let body: { element: Classifier; line: SourceLine } | undefined;
  let note: { element: NoteElement; line: SourceLine; text: string[]; target?: string } | undefined;
  for (const line of lines) {
    const t = line.text;
    if (note) {
      if (/^end\s?note$/u.test(t)) {
        note.element.text = note.text.join(' ');
        if (note.target !== undefined) (note.element.attachedTo ??= []).push(resolve(note.target).id);
        note = undefined;
      } else note.text.push(decode(t));
      continue;
    }
    if (body) {
      if (t === '}') { body = undefined; continue; }
      member(body.element, t, line, problems);
      continue;
    }
    const heading = titleOf(line);
    if (heading !== undefined) { title = heading; continue; }
    let m = DECLARATION.exec(t);
    if (m) {
      const keyword = m[1]!.replace(/\s+/gu, ' ');
      const named = nameAndAlias(m[2]!);
      if (!named) { problems.malformed(line, 'expected a class name, optionally quoted and followed by "as <alias>"'); continue; }
      if (/^<[^<]/u.test(named.rest)) { problems.unsupported(line, 'template parameters (<T>) are not part of the class model'); continue; }
      const st = stereotypes(named.rest);
      let rest = st.rest;
      const opens = rest.endsWith('{');
      if (opens) rest = rest.slice(0, -1).trim();
      const closes = /^\{\s*\}$/u.test(rest);
      if (closes) rest = '';
      if (rest) { problems.unsupported(line, `unexpected text after the declaration: ${JSON.stringify(rest)} (colors, links and generic parameters are not imported)`); continue; }
      const type: ClassifierType = keyword === 'interface' ? 'interface' : keyword === 'enum' ? 'enumeration' : 'class';
      const element = declare(line, named.name, named.alias, type, keyword.startsWith('abstract'), st.list);
      if (element && opens) body = { element, line };
      continue;
    }
    if (OTHER_DECLARATION.test(t)) { problems.unsupported(line, `"${t.split(/\s/u)[0]}" declarations have no place in a class model (classes, abstract classes, interfaces and enums only)`); continue; }
    m = /^note\s+"([^"]*)"\s+as\s+([\p{L}\p{N}_.]+)$/u.exec(t);
    if (m) {
      const id = ids.claim(m[2]!) ?? ids.fresh('note');
      const element: NoteElement = { id, type: 'note', text: decode(m[1]!) };
      byKey.set(m[2]!, { id, element });
      elements.push(element);
      continue;
    }
    m = /^note\s+as\s+([\p{L}\p{N}_.]+)$/u.exec(t);
    if (m) {
      const id = ids.claim(m[1]!) ?? ids.fresh('note');
      const element: NoteElement = { id, type: 'note', text: '' };
      byKey.set(m[1]!, { id, element });
      elements.push(element);
      note = { element, line, text: [] };
      continue;
    }
    m = /^note\s+(?:left|right|top|bottom)\s+of\s+("[^"]*"|[\p{L}\p{N}_.]+)\s*(?::\s*(.*))?$/u.exec(t);
    if (m) {
      const element: NoteElement = { id: ids.fresh('note'), type: 'note', text: '' };
      elements.push(element);
      if (m[2] !== undefined) { element.text = decode(m[2].trim()); element.attachedTo = [resolve(m[1]!).id]; }
      else note = { element, line, text: [], target: m[1]! };
      continue;
    }
    if (/^note\b/u.test(t)) { problems.unsupported(line, 'notes on links and notes on members are not supported; attach the note to a classifier'); continue; }
    m = /^("[^"]*"|[\p{L}\p{N}_.]+)\s*:\s*(.*)$/u.exec(t);
    if (m && !RELATION.test(t)) {
      const target = resolve(m[1]!);
      if (target.type === 'note') problems.malformed(line, 'members cannot be added to a note');
      else member(target, m[2]!, line, problems);
      continue;
    }
    m = RELATION.exec(t);
    if (m) { relation(m, line); continue; }
    if (t === '}') { problems.malformed(line, 'unmatched "}"'); continue; }
    problems.unsupported(line, 'not a class diagram statement this importer understands (classes, members, relationships, notes and title)');
  }
  if (body) problems.malformed(body.line, 'the class body is not closed with "}"');
  if (note) problems.malformed(note.line, 'the note is not closed with "end note"');

  function relation(m: RegExpExecArray, line: SourceLine): void {
    const a = m[1]!, b = m[5]!;
    const arrow = m[3]!.replace(/(?:up|down|left|right|u|d|l|r)(?=[-.])/u, '');
    const parts = /^(<\||<|\*|o|\+|x|#|\})?(-+|\.+)(\|>|>|\*|o|\+|x|#|\{)?$/u.exec(arrow);
    if (!parts) { problems.malformed(line, `unrecognised arrow ${JSON.stringify(m[3])}`); return; }
    const [, left = '', style, right = ''] = parts;
    const dashed = style!.startsWith('.');
    const ea = parseEnd(m[2], codec), eb = parseEnd(m[4], codec);
    const left2 = resolve(a), right2 = resolve(b);
    if (left2.type === 'note' || right2.type === 'note') {
      if (dashed && !left && !right) {
        const [n, target] = left2.type === 'note' ? [left2, right2] : [right2, left2];
        if (target.type === 'note') { problems.malformed(line, 'a note cannot be attached to another note'); return; }
        ((n as NoteElement).attachedTo ??= []).push(target.id);
        return;
      }
      problems.malformed(line, 'notes are attached with a plain dotted line (note .. class)');
      return;
    }
    const label = parseLabel(m[6]);
    const push = (type: Relationship['type'], from: string, to: string, fromEnd: End | undefined, toEnd: End | undefined): void => {
      const r: Relationship = { type, from, to };
      if (label.name !== undefined) r.name = label.name;
      if (label.keyword !== undefined) r.keyword = label.keyword;
      if (fromEnd && Object.keys(fromEnd).length) r.fromEnd = fromEnd;
      if (toEnd && Object.keys(toEnd).length) r.toEnd = toEnd;
      relationships.push(r);
    };
    const withNav = (end: End | undefined, head: string): End | undefined => {
      if (head === '>' || head === '<') return { ...end, navigable: true };
      if (head === 'x') return { ...end, navigable: false };
      return end;
    };
    const navHead = (h: string): boolean => h === '' || h === '>' || h === '<' || h === 'x';
    if (dashed) {
      if (right === '|>' && !left) return push('realization', left2.id, right2.id, ea, eb);
      if (left === '<|' && !right) return push('realization', right2.id, left2.id, eb, ea);
      if (right === '>' && !left) return push('dependency', left2.id, right2.id, ea, eb);
      if (left === '<' && !right) return push('dependency', right2.id, left2.id, eb, ea);
      problems.unsupported(line, `the dotted arrow ${JSON.stringify(m[3])} has no class relationship (use ..|> for a realization, ..> for a dependency)`);
      return;
    }
    if (right === '|>' && !left) return push('generalization', left2.id, right2.id, ea, eb);
    if (left === '<|' && !right) return push('generalization', right2.id, left2.id, eb, ea);
    if (left === '+' && !right) return push('containment', left2.id, right2.id, ea, eb);
    if (right === '+' && !left) return push('containment', right2.id, left2.id, eb, ea);
    for (const [head, type] of [['*', 'composition'], ['o', 'aggregation']] as const) {
      if (left === head && navHead(right) && right !== '<') return push(type, left2.id, right2.id, ea, withNav(eb, right));
      if (right === head && navHead(left) && left !== '>') return push(type, right2.id, left2.id, eb, withNav(ea, left === '<' ? '>' : left));
    }
    if (navHead(left) && navHead(right) && left !== '>' && right !== '<') return push('association', left2.id, right2.id, withNav(ea, left), withNav(eb, right));
    problems.unsupported(line, `the arrow ${JSON.stringify(m[3])} has no class relationship in the model`);
  }

  const model: Record<string, unknown> = { kind: 'class' };
  if (title !== undefined) model.title = title;
  model.elements = elements;
  if (relationships.length) model.relationships = relationships;
  return model;
}

/** `<<use>> name >` -> keyword and name; a trailing reading direction mark is dropped. */
function parseLabel(text: string | undefined): { keyword?: string; name?: string } {
  if (text === undefined) return {};
  // A reading direction mark (`: owns >`) is presentation and dropped.
  let t = text.trim().replace(/(?:^|\s+)(?<![<>])[<>]$/u, '').replace(/^[<>](?![<>])\s*/u, '');
  let keyword: string | undefined;
  const m = new RegExp(`^(?:${STEREOTYPE}|«(.*?)»)\\s*`, 'u').exec(t);
  if (m) { keyword = decode((m[1] ?? m[2]!).trim()); t = t.slice(m[0].length); }
  return compact({ keyword, name: t ? decode(t) : undefined });
}

/** Adds one body line (attribute, operation or enum literal) to a classifier. */
function member(element: Classifier, text: string, line: SourceLine, problems: Problems): void {
  let t = text.trim();
  if (!t || /^(?:--|\.\.|==|__)/u.test(t)) {
    if (t) problems.unsupported(line, 'member separators are not part of the class model');
    return;
  }
  const modifiers = new Set<string>();
  for (let m = /^\{(static|classifier|abstract|field|method)\}\s*/u.exec(t); m; m = /^\{(static|classifier|abstract|field|method)\}\s*/u.exec(t)) {
    modifiers.add(m[1] === 'classifier' ? 'static' : m[1]!);
    t = t.slice(m[0].length);
  }
  if (element.type === 'enumeration' && !t.includes('(') && !modifiers.size && !/^[-+#~]/u.test(t) && !t.includes(':')) {
    (element.literals ??= []).push(decode(t));
    return;
  }
  if (modifiers.has('method') || (!modifiers.has('field') && t.includes('('))) {
    const operation = parseOperation(t, codec);
    if (typeof operation === 'string') { problems.malformed(line, operation); return; }
    if (modifiers.has('static')) operation.static = true;
    if (modifiers.has('abstract')) operation.abstract = true;
    (element.operations ??= []).push(operation);
    return;
  }
  if (modifiers.has('abstract')) { problems.unsupported(line, 'abstract attributes are not part of the class model'); return; }
  const attribute = parseAttribute(t, codec);
  if (typeof attribute === 'string') { problems.malformed(line, attribute); return; }
  if (modifiers.has('static')) attribute.static = true;
  (element.attributes ??= []).push(attribute);
}

export function detectClass(lines: readonly SourceLine[]): number {
  let score = 0;
  for (const { text } of lines) {
    if (DECLARATION.test(text)) score += 3;
    else if (/(?:<\|--|--\|>|\.\.\|>|<\|\.\.|\*--|--\*|o--|--o)/u.test(text)) score += 2;
  }
  return score;
}

export const plantumlClass: KindFormat<ClassDiagram> = { kind: 'class', export: exportClass, import: importClass, detect: detectClass };
