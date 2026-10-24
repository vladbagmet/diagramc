import { commonDefinitions } from '../core/text.js';
import type { Attribute, Operation, Parameter, Visibility } from '../kinds/class/model.js';
import { compact, splitTopLevel } from './common.js';

/**
 * UML member notation shared by the PlantUML and Mermaid class mappings:
 * `-/name : Type [m] = default {readOnly}` and
 * `+name(in p : T [m] = d) : R {query}`. The separators of this notation are
 * encoded (with the format's own escape) wherever they occur inside a name,
 * type or default, so a member reads back exactly. Static and abstract marks
 * are format-specific and added by the caller.
 */

/** The format's escaping: `encode` escapes `special` characters (and its own), `token` one character, `decode` all. */
export interface Codec {
  encode(text: string, special?: string): string;
  token(c: string): string;
  decode(text: string): string;
}

const VIS: Record<Visibility, string> = { public: '+', private: '-', protected: '#', package: '~' };
const VIS_BACK: Record<string, Visibility> = { '+': 'public', '-': 'private', '#': 'protected', '~': 'package' };
export const MULTIPLICITY = new RegExp(commonDefinitions.multiplicity.pattern, 'u');

/** The visibility mark a member starts with; a Mermaid entity code (`#34;`) is not the protected mark. */
export const visibilityOf = (text: string): Visibility | undefined =>
  /^[-+#~]/u.test(text) && !/^#(?:\d{1,7}|[a-z]+);/u.test(text) ? VIS_BACK[text[0]!] : undefined;

/** Encodes `text`, and its first character too when it would read as a mark (visibility, derived, modifier). */
const lead = (text: string, special: string, codec: Codec): string =>
  text && '+-#~/{'.includes(text[0]!) ? codec.token(text[0]!) + codec.encode(text.slice(1), special) : codec.encode(text, special);

export function attributeText(a: Attribute, codec: Codec): string {
  let text = `${a.visibility ? VIS[a.visibility] : ''}${a.derived ? '/' : ''}`;
  text += a.visibility || a.derived ? codec.encode(a.name, ':[]={}(),') : lead(a.name, ':[]={}(),', codec);
  if (a.type !== undefined) text += ` : ${codec.encode(a.type, '[]={}()')}`;
  if (a.multiplicity !== undefined) text += ` [${a.multiplicity}]`;
  if (a.default !== undefined) text += ` = ${codec.encode(a.default, '{}()')}`;
  if (a.readOnly) text += ' {readOnly}';
  return text;
}

export function operationText(o: Operation, codec: Codec): string {
  const parameters = (o.parameters ?? []).map(p => {
    let text = p.direction ? `${p.direction} ` : '';
    // A name that starts like a direction keyword has its first character encoded.
    text += /^(?:in|out|inout)\s/u.test(p.name) ? codec.token(p.name[0]!) + codec.encode(p.name.slice(1), ':,()[]={}') : codec.encode(p.name, ':,()[]={}');
    if (p.type !== undefined) text += ` : ${codec.encode(p.type, ',()[]={}')}`;
    if (p.multiplicity !== undefined) text += ` [${p.multiplicity}]`;
    if (p.default !== undefined) text += ` = ${codec.encode(p.default, ',(){}')}`;
    return text;
  });
  let text = o.visibility ? `${VIS[o.visibility]}${codec.encode(o.name, ':(){}[]=')}` : lead(o.name, ':(){}[]=', codec);
  text += `(${parameters.join(', ')})`;
  if (o.returnType !== undefined) text += ` : ${codec.encode(o.returnType, '{}()[]=')}`;
  if (o.query) text += ' {query}';
  return text;
}

/** An enumeration literal, encoded so it never reads as a member. */
export const literalText = (literal: string, codec: Codec): string => lead(literal, '(){}[]:', codec);

/** Inverse of attributeText (no static mark). A string is the reason it does not parse. */
export function parseAttribute(text: string, codec: Codec): Attribute | string {
  let t = text.trim();
  const vis = visibilityOf(t);
  if (vis) t = t.slice(1).trim();
  const derived = t.startsWith('/');
  if (derived) t = t.slice(1);
  const m = /^([^:[\]={}]+?)\s*(?::\s*([^[\]={}]+?))?\s*(?:\[([^\]]*)\])?\s*(?:=\s*([^{}]+?))?\s*(\{readOnly\})?$/u.exec(t);
  if (!m) return `expected an attribute "name : Type [multiplicity] = default {readOnly}", got ${JSON.stringify(text)}`;
  if (m[3] !== undefined && !MULTIPLICITY.test(m[3])) return `invalid multiplicity [${m[3]}]`;
  return compact({
    name: codec.decode(m[1]!),
    type: m[2] === undefined ? undefined : codec.decode(m[2]),
    visibility: vis,
    multiplicity: m[3],
    default: m[4] === undefined ? undefined : codec.decode(m[4]),
    derived: derived || undefined,
    readOnly: m[5] ? true : undefined,
  });
}

/** Inverse of operationText (no static or abstract mark). A string is the reason it does not parse. */
export function parseOperation(text: string, codec: Codec): Operation | string {
  let t = text.trim();
  const vis = visibilityOf(t);
  if (vis) t = t.slice(1).trim();
  const m = /^([^():{}[\]=]+)\(([^()]*)\)\s*(?::\s*([^{}]+?))?\s*(\{query\})?$/u.exec(t);
  if (!m) return `expected an operation "name(parameters) : ReturnType", got ${JSON.stringify(text)}`;
  const operation: Operation = { name: codec.decode(m[1]!.trim()) };
  if (m[2]!.trim()) {
    const parameters: Parameter[] = [];
    for (const p of splitTopLevel(m[2]!)) {
      const pm = /^(?:(in|out|inout)\s+)?([^:[\]=]+?)\s*(?::\s*([^[\]=]+?))?\s*(?:\[([^\]]*)\])?\s*(?:=\s*(.+))?$/u.exec(p);
      if (!pm) return `expected a parameter "[in|out|inout] name : Type [multiplicity] = default", got ${JSON.stringify(p)}`;
      if (pm[4] !== undefined && !MULTIPLICITY.test(pm[4])) return `invalid multiplicity [${pm[4]}]`;
      parameters.push(
        compact({
          name: codec.decode(pm[2]!),
          type: pm[3] === undefined ? undefined : codec.decode(pm[3]),
          direction: pm[1] as Parameter['direction'],
          multiplicity: pm[4],
          default: pm[5] === undefined ? undefined : codec.decode(pm[5].trim()),
        }),
      );
    }
    operation.parameters = parameters;
  }
  if (m[3] !== undefined) operation.returnType = codec.decode(m[3].trim());
  if (vis) operation.visibility = vis;
  if (m[4]) operation.query = true;
  return operation;
}

/** `"role 1..*"` -> { role, multiplicity }. */
export function parseEnd(text: string | undefined, codec: Codec): { role?: string; multiplicity?: string } | undefined {
  if (text === undefined) return undefined;
  const t = text.trim();
  if (!t) return undefined;
  if (MULTIPLICITY.test(t)) return { multiplicity: t };
  const space = t.lastIndexOf(' ');
  return space > 0 && MULTIPLICITY.test(t.slice(space + 1))
    ? { role: codec.decode(t.slice(0, space).trim()), multiplicity: t.slice(space + 1) }
    : { role: codec.decode(t) };
}

/** End label text `role multiplicity`; a role that would read as ending in a multiplicity has its last character encoded. */
export function endText(end: { role?: string; multiplicity?: string } | undefined, codec: Codec): string | undefined {
  if (end?.role === undefined && end?.multiplicity === undefined) return undefined;
  let role = end.role === undefined ? undefined : codec.encode(end.role, '"');
  if (role !== undefined && end.multiplicity === undefined && MULTIPLICITY.test(role.split(' ').at(-1)!)) role = role.slice(0, -1) + codec.token(role.at(-1)!);
  return [role, end.multiplicity].filter(t => t !== undefined).join(' ');
}
