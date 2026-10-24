import type { Attribute, ClassDiagram, ClassifierType, End, Operation, Relationship } from '../../kinds/class/model.js';
import { isLegacy, isNote } from '../../kinds/class/model.js';
import { attributeText, endText, literalText, operationText, parseAttribute, parseEnd, parseOperation, visibilityOf, type Codec } from '../class-members.js';
import { IdMaker } from '../common.js';
import type { KindFormat, Losses, Problems, SourceLine } from '../types.js';
import { PRESENTATION, decode, document, encode, entity, mermaidAliases, titleOf } from './text.js';

/**
 * Class diagram <-> Mermaid classDiagram. Classifiers keep their ID; the
 * classifier type is an annotation (`<<interface>>`, `<<enumeration>>`,
 * `<<dataType>>`, `<<primitive>>`, `<<abstract>>` for an abstract class).
 * Members use the same UML notation as the PlantUML mapping, with Mermaid's
 * `$` (static) and `*` (abstract) suffixes; braces are entity codes, because
 * Mermaid closes a class body at a brace.
 */

/** `~` is Mermaid's generic delimiter in class diagrams: model text never contains a raw one. */
const codec: Codec = { encode: (text, special = '') => encode(text, `${special}~`), token: entity, decode };
const TYPE_ANNOTATION: Partial<Record<ClassifierType, string>> = {
  interface: 'interface',
  enumeration: 'enumeration',
  datatype: 'dataType',
  primitive: 'primitive',
};
const BY_ANNOTATION = new Map<string, ClassifierType>([
  ['interface', 'interface'],
  ['enumeration', 'enumeration'],
  ['enum', 'enumeration'],
  ['dataType', 'datatype'],
  ['datatype', 'datatype'],
  ['primitive', 'primitive'],
]);

/** Braces of the notation's own markers as entity codes; a trailing `$` or `*` of model text encoded so it is not a suffix. */
function memberLine(text: string, suffix: string): string {
  let t = text.replaceAll('{', () => entity('{')).replaceAll('}', () => entity('}'));
  if (/[$*]$/u.test(t)) t = t.slice(0, -1) + entity(t.at(-1)!);
  return t + suffix;
}

export function exportClass(model: ClassDiagram, losses: Losses): string {
  const ids = mermaidAliases();
  const lines: string[] = [];
  const notes: string[] = [];
  for (const [i, e] of model.elements.entries()) {
    const id = ids.get(e.id);
    if (isNote(e)) {
      if (e.attachedTo?.length) {
        for (const t of e.attachedTo) notes.push(`note for ${ids.get(t)} "${encode(e.text)}"`);
      } else {
        notes.push(`note "${encode(e.text)}"`);
      }
      losses.add(`/elements/${i}/id`, 'Notes have no IDs; imported notes get new ones');
      if ((e.attachedTo?.length ?? 0) > 1) losses.add(`/elements/${i}/attachedTo`, 'A note attached to several classifiers is written once per classifier');
      continue;
    }
    const head = `class ${id}${e.name === id ? '' : `["${encode(e.name)}"]`}`;
    const body: string[] = [];
    const typeAnnotation = TYPE_ANNOTATION[e.type];
    if (typeAnnotation) body.push(`<<${typeAnnotation}>>`);
    if (e.abstract && e.type === 'class') body.push('<<abstract>>');
    if (e.abstract && e.type !== 'class') losses.add(`/elements/${i}/abstract`, `An abstract ${e.type} is written without the abstract mark`);
    for (const s of e.stereotypes ?? []) body.push(`<<${encode(s)}>>`);
    if ((e.stereotypes ?? []).some(s => BY_ANNOTATION.has(s) || s === 'abstract'))
      losses.add(`/elements/${i}/stereotypes`, 'A stereotype named like a classifier type or "abstract" reads back as that type');
    for (const literal of e.literals ?? [])
      body.push(
        memberLine(
          literalText(literal, codec).replace(/^([^\s:()[\]={}]+)\s(?=[^\s:()[\]={}]+$)/u, (_match: string, g1: string) => `${g1}${entity(' ')}`),
          '',
        ),
      );
    for (const [j, a] of (e.attributes ?? []).entries()) {
      if (isLegacy(a)) {
        losses.add(`/elements/${i}/attributes/${j}`, 'A v1 member text is written as it is');
        body.push(memberLine(encode(a.text), ''));
        continue;
      }
      // In an enumeration, a bare attribute would read back as a literal: a visibility-less one gets ": " typing or is reported.
      if (e.type === 'enumeration' && a.visibility === undefined && a.type === undefined)
        losses.add(`/elements/${i}/attributes/${j}`, 'An enumeration attribute without visibility or type reads back as a literal');
      // `+two words` would read as Mermaid's type-first `+Type name`: the space is encoded.
      const text = attributeText(a, codec).replace(
        /^([-+#~]?\/?[^\s:()[\]={}]+)\s(?=[^\s:()[\]={}]+$)/u,
        (_match: string, g1: string) => `${g1}${entity(' ')}`,
      );
      body.push(memberLine(text, a.static ? '$' : ''));
    }
    for (const [j, o] of (e.operations ?? []).entries()) {
      if (isLegacy(o)) {
        losses.add(`/elements/${i}/operations/${j}`, 'A v1 member text is written as it is');
        body.push(memberLine(encode(o.text), ''));
        continue;
      }
      if (o.static && o.abstract) losses.add(`/elements/${i}/operations/${j}/static`, 'An operation both static and abstract is written as abstract only');
      body.push(memberLine(operationText(o, codec), o.abstract ? '*' : o.static ? '$' : ''));
    }
    if (body.length === 0) {
      lines.push(head);
      continue;
    }
    lines.push(`${head} {`, ...body.map(b => `  ${b}`), '}');
  }
  for (const [i, r] of (model.relationships ?? []).entries()) {
    if (r.id !== undefined) losses.add(`/relationships/${i}/id`, 'Relationship IDs are not kept');
    const nav = (n: boolean | undefined, head: string, at: string): string => {
      if (n === false) losses.add(`/relationships/${i}/${at}/navigable`, 'Mermaid has no cross for a non-navigable end; the end is written plain');
      return n ? head : '';
    };
    let arrow: string;
    switch (r.type) {
      case 'generalization':
        arrow = '--|>';
        break;
      case 'realization':
        arrow = '..|>';
        break;
      case 'dependency':
        arrow = '..>';
        break;
      case 'containment':
        arrow = '--';
        losses.add(`/relationships/${i}`, 'Mermaid has no containment line (circle-plus); it is written as a plain association');
        break;
      case 'aggregation':
        arrow = `o--${nav(r.toEnd?.navigable, '>', 'toEnd')}`;
        break;
      case 'composition':
        arrow = `*--${nav(r.toEnd?.navigable, '>', 'toEnd')}`;
        break;
      default:
        arrow = `${nav(r.fromEnd?.navigable, '<', 'fromEnd')}--${nav(r.toEnd?.navigable, '>', 'toEnd')}`;
    }
    const end = (e: End | undefined): string => {
      const t = endText(e, codec);
      return t === undefined ? '' : ` "${t}"`;
    };
    const label = [r.keyword === undefined ? undefined : `«${encode(r.keyword)}»`, r.name === undefined ? undefined : encode(r.name, '«»')]
      .filter(t => t !== undefined)
      .join(' ');
    lines.push(`${ids.get(r.from)}${end(r.fromEnd)} ${arrow}${end(r.toEnd)} ${ids.get(r.to)}${label ? ` : ${label}` : ''}`);
  }
  return document(model.title, 'classDiagram', [...lines, ...notes]);
}

// ---------------------------------------------------------------- import

const ID = '[A-Za-z0-9_]+';
const RELATION = new RegExp(
  String.raw`^(${ID})\s*(?:"([^"]*)"\s*)?(<\||\*|o|<|\(\))?(--|\.\.)(\|>|\*|o|>|\(\))?\s*(?:"([^"]*)"\s*)?(${ID})\s*(?::\s*(.*))?$`,
  'u',
);

interface Classifier {
  id: string;
  type: ClassifierType;
  name: string;
  abstract?: boolean;
  stereotypes?: string[];
  attributes?: Attribute[];
  operations?: Operation[];
  literals?: string[];
}
interface NoteElement {
  id: string;
  type: 'note';
  text: string;
  attachedTo?: string[];
}

export function importClass(lines: readonly SourceLine[], problems: Problems): Record<string, unknown> {
  const ids = new IdMaker();
  const classes = new Map<string, Classifier>();
  const elements: (Classifier | NoteElement)[] = [];
  const relationships: Relationship[] = [];
  let title: string | undefined;
  let body: { element: Classifier; line: SourceLine } | undefined;

  /** The classifier with this Mermaid ID, created as a class when first named (as Mermaid does). */
  const get = (key: string): Classifier => {
    const known = classes.get(key);
    if (known) return known;
    const element: Classifier = { id: ids.claim(key) ?? ids.fresh(key), type: 'class', name: key };
    classes.set(key, element);
    elements.push(element);
    return element;
  };
  const annotate = (element: Classifier, name: string): void => {
    const type = BY_ANNOTATION.get(name);
    if (type && element.type === 'class') element.type = type;
    else if (name === 'abstract' && !element.abstract) element.abstract = true;
    else (element.stereotypes ??= []).push(name);
  };

  for (const line of lines.slice(1)) {
    const t = line.text;
    if (body) {
      if (t === '}') {
        body = undefined;
        continue;
      }
      const a = /^<<(.+)>>$/u.exec(t);
      if (a) annotate(body.element, decode(a[1]!.trim()));
      else member(body.element, t, line);
      continue;
    }
    const heading = titleOf(line);
    if (heading !== undefined) {
      title = heading;
      continue;
    }
    if (PRESENTATION.test(t) || /^(?:cssClass|direction)\b/u.test(t)) continue;
    let m = new RegExp(String.raw`^class\s+(${ID})(?:\["([^"]*)"\])?(?::::\w+)?\s*(\{)?\s*(\})?$`, 'u').exec(t);
    if (m) {
      const element = get(m[1]!);
      if (m[2] !== undefined) element.name = decode(m[2]);
      if (m[3] && !m[4]) body = { element, line };
      continue;
    }
    if (/^class\b/u.test(t)) {
      problems.unsupported(
        line,
        String.raw`expected "class Id" or "class Id[\"Label\"]", optionally with "{"; generic classes (~T~) are not part of the model`,
      );
      continue;
    }
    m = new RegExp(String.raw`^<<(.+)>>\s+(${ID})$`, 'u').exec(t);
    if (m) {
      annotate(get(m[2]!), decode(m[1]!.trim()));
      continue;
    }
    m = /^note\s+(?:for\s+([A-Za-z0-9_]+)\s+)?"([^"]*)"$/u.exec(t);
    if (m) {
      const note: NoteElement = { id: ids.fresh('note'), type: 'note', text: decode(m[2]!) };
      if (m[1] !== undefined) note.attachedTo = [get(m[1]).id];
      elements.push(note);
      continue;
    }
    m = RELATION.exec(t);
    if (m) {
      relation(m, line);
      continue;
    }
    m = new RegExp(String.raw`^(${ID})\s*:\s*(.+)$`, 'u').exec(t);
    if (m) {
      member(get(m[1]!), m[2]!, line);
      continue;
    }
    if (/^namespace\b/u.test(t)) {
      problems.unsupported(line, 'namespaces are not part of the class model');
      continue;
    }
    problems.unsupported(line, 'not a classDiagram statement this importer understands (classes, members, annotations, relationships, notes)');
  }
  if (body) problems.malformed(body.line, 'the class body is not closed with "}"');

  function member(element: Classifier, text: string, line: SourceLine): void {
    let t = text
      .trim()
      .replaceAll(`${entity('{')}readOnly${entity('}')}`, '{readOnly}')
      .replaceAll(`${entity('{')}query${entity('}')}`, '{query}');
    // Mermaid's own conventions: `$`/`*` right after the parentheses, `~T~` generics,
    // a return type after a space (`+speak() String`), type-first attributes (`+String name`).
    let suffix = /[$*]$/u.exec(t)?.[0];
    if (suffix) t = t.slice(0, -1).trimEnd();
    const after = /\)([$*])/u.exec(t);
    if (after && !suffix) {
      suffix = after[1];
      t = t.replace(/\)[$*]/u, ')');
    }
    t = t.replaceAll(/~([^~]*)~/gu, '<$1>');
    t = t.replace(/\)\s+([^\s:{][^{]*?)\s*$/u, ') : $1');
    const typeFirst = /^([-+#~]?)([^\s:()[\]={}]+)\s+([^\s:()[\]={}]+)$/u.exec(t);
    if (typeFirst && (element.type !== 'enumeration' || typeFirst[1])) t = `${typeFirst[1]}${typeFirst[3]} : ${typeFirst[2]}`;
    if (element.type === 'enumeration' && !suffix && !t.includes('(') && !visibilityOf(t) && !t.includes(':')) {
      (element.literals ??= []).push(decode(t));
      return;
    }
    if (t.includes('(')) {
      const operation = parseOperation(t, codec);
      if (typeof operation === 'string') {
        problems.malformed(line, operation);
        return;
      }
      if (suffix === '*') operation.abstract = true;
      else if (suffix === '$') operation.static = true;
      (element.operations ??= []).push(operation);
      return;
    }
    if (suffix === '*') {
      problems.unsupported(line, 'abstract attributes are not part of the class model');
      return;
    }
    const attribute = parseAttribute(t, codec);
    if (typeof attribute === 'string') {
      problems.malformed(line, attribute);
      return;
    }
    if (suffix === '$') attribute.static = true;
    (element.attributes ??= []).push(attribute);
  }

  function relation(m: RegExpExecArray, line: SourceLine): void {
    // Optional groups of the pattern are undefined when absent.
    const [, a, endA, left = '', style, right = '', endB, b, label] = m as unknown as [
      string,
      string,
      string | undefined,
      string | undefined,
      string,
      string | undefined,
      string | undefined,
      string,
      string | undefined,
    ];
    if (left === '()' || right === '()') {
      problems.unsupported(line, 'lollipop interfaces are not part of the class model; declare the interface and draw a realization (..|>)');
      return;
    }
    const from = get(a),
      to = get(b);
    const ea = parseEnd(endA, codec),
      eb = parseEnd(endB, codec);
    const r = (type: Relationship['type'], f: Classifier, t: Classifier, fe: End | undefined, te: End | undefined): Relationship => {
      const rel: Relationship = { type, from: f.id, to: t.id };
      const parsed = parseLabel(label);
      if (parsed.keyword !== undefined) rel.keyword = parsed.keyword;
      if (parsed.name !== undefined) rel.name = parsed.name;
      if (fe && Object.keys(fe).length > 0) rel.fromEnd = fe;
      if (te && Object.keys(te).length > 0) rel.toEnd = te;
      return rel;
    };
    const nav = (end: End | undefined, head: boolean): End | undefined => (head ? { ...end, navigable: true } : end);
    const dashed = style === '..';
    if (dashed) {
      if (right === '|>' && !left) {
        relationships.push(r('realization', from, to, ea, eb));
        return;
      }
      if (left === '<|' && !right) {
        relationships.push(r('realization', to, from, eb, ea));
        return;
      }
      if (right === '>' && !left) {
        relationships.push(r('dependency', from, to, ea, eb));
        return;
      }
      if (left === '<' && !right) {
        relationships.push(r('dependency', to, from, eb, ea));
        return;
      }
      problems.unsupported(line, 'a dashed link without an arrowhead has no class relationship (use ..> or ..|>)');
      return;
    }
    if (right === '|>' && !left) {
      relationships.push(r('generalization', from, to, ea, eb));
      return;
    }
    if (left === '<|' && !right) {
      relationships.push(r('generalization', to, from, eb, ea));
      return;
    }
    for (const [head, type] of [
      ['*', 'composition'],
      ['o', 'aggregation'],
    ] as const) {
      if (left === head && (right === '' || right === '>')) {
        relationships.push(r(type, from, to, ea, nav(eb, right === '>')));
        return;
      }
      if (right === head && (left === '' || left === '<')) {
        relationships.push(r(type, to, from, eb, nav(ea, left === '<')));
        return;
      }
    }
    if ((left === '' || left === '<') && (right === '' || right === '>')) {
      relationships.push(r('association', from, to, nav(ea, left === '<'), nav(eb, right === '>')));
      return;
    }
    problems.unsupported(line, `the link ${JSON.stringify(`${left}${style}${right}`)} has no class relationship in the model`);
  }

  const model: Record<string, unknown> = { kind: 'class' };
  if (title !== undefined) model.title = title;
  model.elements = elements;
  if (relationships.length > 0) model.relationships = relationships;
  return model;
}

/** `«use» name` -> keyword and name. */
function parseLabel(text: string | undefined): { keyword?: string; name?: string } {
  if (!text?.trim()) return {};
  const m = /^«([^»]*)»\s*(.*)$/u.exec(text.trim());
  if (!m) return { name: decode(text.trim()) };
  return { keyword: decode(m[1]!.trim()), ...(m[2] ? { name: decode(m[2]) } : {}) };
}

export const detectClass = (lines: readonly SourceLine[]): number => (/^classDiagram(?:-v2)?$/u.test(lines[0]?.text ?? '') ? 1 : 0);

export const mermaidClass: KindFormat<ClassDiagram> = { kind: 'class', export: exportClass, import: importClass, detect: detectClass };
