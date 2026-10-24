import { Aliases } from '../common.js';
import type { Problems, SourceLine } from '../types.js';

/**
 * Readable PlantUML text. Display strings are written as they are, except the
 * characters that would change the meaning of the line in that position: those
 * become PlantUML's `<U+XXXX>` tokens, which PlantUML draws as the character and
 * the importer decodes again. So any model text survives an export and import
 * unchanged, and no model text can become a directive, markup or a new line.
 */

/** Characters encoded everywhere: escapes, Creole's escape character and every control character. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what must be escaped.
const ALWAYS = /[\\~\u{0}-\u{1F}\u{7F}-\u{9F}]/u;
/** Creole and HTML-like markup: the second character of `**`, `//`, `""`, `--`, `__`, `^^`, `[[`, `]]`, `<<`, `>>`, `''`, `==`, `..`. */
const PAIRS = new Set(['**', '//', '""', '--', '__', '^^', '~~', '[[', ']]', '<<', '>>', "''", '==', '..', "/'", "'/"]);
/** `<` opening a Creole or HTML tag, a sprite, an icon or a Unicode token. */
const TAG = /^<(?:\/|[&$#:=]|U\+|(?:b|i|u|s|w|strike|del|color|size|back|font|img|sub|sup|code|plain|text|r|q|style|br|span|math|latex|stereo)\b)/iu;

export const token = (c: string): string => [...c].map(u => `<U+${u.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}>`).join('');

/**
 * Encodes `text` for one slot of a PlantUML line. `special` lists characters
 * with a meaning in that slot (a quote inside quotes, `:` before a type, ...).
 * Leading and trailing spaces and a leading `'`, `!` or `@` are encoded too.
 */
export function encode(text: string, special = ''): string {
  const chars = [...text];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    const prev = chars[i - 1];
    const edgeSpace = /\s/u.test(c) && (chars.slice(0, i).every(x => /\s/u.test(x)) || chars.slice(i).every(x => /\s/u.test(x)));
    const lead = i === 0 && "'!@".includes(c);
    const pair = prev !== undefined && PAIRS.has(prev + c) && !out.endsWith('>');
    const tag = c === '<' && TAG.test(chars.slice(i).join(''));
    out += ALWAYS.test(c) || special.includes(c) || edgeSpace || lead || pair || tag ? token(c) : c;
  }
  return out;
}

/** Decodes `<U+XXXX>` tokens (4 to 6 hex digits). */
export function decode(text: string): string {
  return text.replaceAll(/<U\+([0-9A-Fa-f]{4,6})>/gu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)));
}

/** A double-quoted PlantUML string. */
export const quoted = (text: string): string => `"${encode(text, '"')}"`;

/** Lines that only change presentation; they carry nothing the model stores and are skipped on import. */
const PRESENTATION =
  /^(?:skinparam\b|hide\b|show\b|scale\b|left to right direction$|top to bottom direction$|!theme\b|!pragma\b|<style>|header\b|footer\b|caption\b|legend\b|newpage\b|allowmixing$|set namespaceseparator\b|autoactivate\b|hide footbox$|skin\b)/u;

/**
 * The lines of the first diagram in a PlantUML source, without blank lines,
 * comments and presentation-only lines. Problems: no `@startuml`, text after
 * `@enduml`, preprocessor directives (`!include` and the like, never followed),
 * unterminated block comments and style blocks.
 */
export function readPlantUml(text: string, problems: Problems): SourceLine[] {
  const raw = text.replace(/^\u{FEFF}/u, '').split(/\r\n|\r|\n/u);
  const out: SourceLine[] = [];
  let started = false,
    ended = false,
    comment = false;
  /** The line that ends the presentation block being skipped (`</style>`, `endlegend`, ...). */
  let skipUntil: RegExp | undefined;
  for (const [index, line] of raw.entries()) {
    const number = index + 1;
    let t = line.trim();
    if (comment) {
      const close = t.indexOf("'/");
      if (close === -1) continue;
      comment = false;
      t = t.slice(close + 2).trim();
    }
    if (t.startsWith("/'")) {
      const close = t.indexOf("'/", 2);
      if (close === -1) {
        comment = true;
        continue;
      }
      t = t.slice(close + 2).trim();
    }
    if (!t || t.startsWith("'")) continue;
    if (skipUntil) {
      if (skipUntil.test(t)) skipUntil = undefined;
      continue;
    }
    if (!started) {
      if (/^@startuml\b/u.test(t)) {
        started = true;
        continue;
      }
      problems.malformed({ number, text: t }, 'expected @startuml before the diagram');
      started = true;
    }
    if (ended) {
      problems.unsupported({ number, text: t }, 'only the first diagram of a source is imported; remove everything after @enduml');
      continue;
    }
    if (/^@enduml\b/u.test(t)) {
      ended = true;
      continue;
    }
    if (t === '<style>') {
      skipUntil = /^<\/style>$/u;
      continue;
    }
    const block = /^(legend|header|footer)(?:\s+(?:left|right|center|top|bottom))*$/u.exec(t);
    if (block) {
      skipUntil = new RegExp(String.raw`^end\s?${block[1]}$`, 'u');
      continue;
    }
    if (PRESENTATION.test(t)) {
      if (t.endsWith('{')) skipUntil = /^\}$/u;
      continue;
    }
    if (t.startsWith('!')) {
      problems.unsupported(
        { number, text: t },
        `the preprocessor directive ${JSON.stringify(t.split(/\s/u, 1)[0])} is not supported (no includes, variables or procedures); expand it first`,
      );
      continue;
    }
    out.push({ number, text: t });
  }
  if (comment) problems.malformed({ number: raw.length, text: '' }, "unterminated block comment (/' without '/)");
  if (!started) problems.malformed({ number: 1, text: '' }, 'expected @startuml');
  return out;
}

/** Name of an element as written: a quoted string or a bare word (alias). */
export const NAME = String.raw`(?:"((?:[^"])*)"|([\p{L}\p{N}_.]+))`;

/**
 * Parses `"Display" as alias`, `alias as "Display"`, `"Display"` or `alias`
 * at the start of `text`. Returns the decoded display name, the alias (when one
 * was written or the name is a bare word) and the rest of the text.
 */
export function nameAndAlias(text: string): { name: string; alias?: string; rest: string } | undefined {
  let m = /^"([^"]*)"\s+as\s+([\p{L}\p{N}_.]+)(.*)$/u.exec(text);
  if (m) return { name: decode(m[1]!), alias: m[2]!, rest: m[3]!.trim() };
  m = /^([\p{L}\p{N}_.]+)\s+as\s+"([^"]*)"(.*)$/u.exec(text);
  if (m) return { name: decode(m[2]!), alias: m[1]!, rest: m[3]!.trim() };
  m = /^"([^"]*)"(.*)$/u.exec(text);
  if (m) return { name: decode(m[1]!), rest: m[2]!.trim() };
  m = /^([\p{L}\p{N}_.]+)(.*)$/u.exec(text);
  return m ? { name: m[1]!, alias: m[1]!, rest: m[2]!.trim() } : undefined;
}

/** `<<text>>`, where the text may hold `<U+XXXX>` tokens and single angle brackets. */
export const STEREOTYPE = String.raw`<<((?:<U\+[0-9A-Fa-f]{4,6}>|[^<>]|<(?!<)|>(?!>))*)>>`;

/** `<<a, b>> <<c>>` at the start of `text` -> ["a", "b", "c"] and the rest. */
export function stereotypes(text: string): { list: string[]; rest: string } {
  const list: string[] = [];
  let rest = text.trim();
  const pattern = new RegExp(String.raw`^${STEREOTYPE}\s*`, 'u');
  for (let m = pattern.exec(rest); m; m = pattern.exec(rest)) {
    list.push(
      ...m[1]!
        .split(',')
        .map(s => decode(s.trim()))
        .filter(Boolean),
    );
    rest = rest.slice(m[0].length);
  }
  return { list, rest };
}

/** `<<a, b>>` for a list of stereotypes, or "" when there are none. */
export const stereotypeText = (list: readonly string[] | undefined): string => (list?.length ? ` <<${list.map(s => encode(s, ',<>"')).join(', ')}>>` : '');

/** A complete PlantUML source with a title. */
export function document(title: string | undefined, body: readonly string[]): string {
  return ['@startuml', ...(title === undefined ? [] : [`title ${encode(title)}`]), ...body, '@enduml', ''].join('\n');
}

/** `title X` -> "X" (decoded); undefined for other lines. */
export function titleOf(line: SourceLine): string | undefined {
  const m = /^title\s+(.+)$/u.exec(line.text);
  return m ? decode(m[1]!.trim()) : undefined;
}

/** Words PlantUML reads as keywords at the start of a line; an ID equal to one gets a suffix. */
const RESERVED = [
  'abstract',
  'actor',
  'activate',
  'alt',
  'annotation',
  'artifact',
  'as',
  'autonumber',
  'boundary',
  'break',
  'card',
  'circle',
  'class',
  'cloud',
  'collections',
  'component',
  'control',
  'create',
  'critical',
  'database',
  'deactivate',
  'destroy',
  'diamond',
  'else',
  'end',
  'endif',
  'entity',
  'enum',
  'exception',
  'file',
  'folder',
  'fork',
  'frame',
  'group',
  'hide',
  'hnote',
  'if',
  'interface',
  'loop',
  'map',
  'metaclass',
  'namespace',
  'node',
  'note',
  'object',
  'opt',
  'package',
  'par',
  'participant',
  'partition',
  'queue',
  'rectangle',
  'ref',
  'repeat',
  'return',
  'rnote',
  'show',
  'stack',
  'start',
  'state',
  'stop',
  'storage',
  'struct',
  'switch',
  'title',
  'together',
  'usecase',
  'while',
  'robust',
  'concise',
  'clock',
  'binary',
  'highlight',
  'scale',
];

/** Model ID -> PlantUML alias ("-" becomes "_"; keywords get a suffix). */
export const plantumlAliases = (): Aliases => new Aliases(RESERVED);
