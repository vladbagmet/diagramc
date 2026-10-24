import { Aliases } from '../common.js';
import type { Problems, SourceLine } from '../types.js';

/**
 * Readable Mermaid text. Display strings are written as they are, except the
 * characters with a meaning in that position: those become Mermaid entity codes
 * (`#35;` for `#`), which Mermaid draws as the character and the importer
 * decodes again. Markup (`<br>`, Markdown strings) can never come from model text.
 */

/** Characters encoded everywhere: the entity escape itself, HTML, quotes, statement separators and controls. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what must be escaped.
const ALWAYS = /[#<>"&;`\\\u{0}-\u{1F}\u{7F}-\u{9F}]/u;

export const entity = (c: string): string => [...c].map(u => `#${u.codePointAt(0)!};`).join('');

/** Encodes `text` for one slot; `special` adds characters with a meaning in that slot. Edge spaces are encoded too. */
export function encode(text: string, special = ''): string {
  const chars = [...text];
  return chars
    .map((c, i) => {
      const edgeSpace = /\s/u.test(c) && (chars.slice(0, i).every(x => /\s/u.test(x)) || chars.slice(i).every(x => /\s/u.test(x)));
      const comment = c === '%' && (i === 0 || chars[i - 1] === '%' || chars[i + 1] === '%');
      return ALWAYS.test(c) || special.includes(c) || edgeSpace || comment ? entity(c) : c;
    })
    .join('');
}

const NAMED: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', nbsp: '\u{A0}', apos: "'" };

/** Decodes `#123;` and the common named entity codes (`#quot;`). */
export function decode(text: string): string {
  return text.replaceAll(/#(\d{1,7}|[a-z]+);/gu, (all, code: string) => (/^\d/u.test(code) ? String.fromCodePoint(Number(code)) : (NAMED[code] ?? all)));
}

/** Marks the title read from front matter, so importers find it among the lines. */
export const TITLE_LINE = '---title ';

/** Front matter carrying the title (YAML double-quoted string, which JSON strings are). */
export function document(title: string | undefined, header: string, body: readonly string[]): string {
  return [...(title === undefined ? [] : ['---', `title: ${JSON.stringify(title)}`, '---']), header, ...body.map(l => `  ${l}`), ''].join('\n');
}

/** The title of a `---title` marker line; undefined for other lines. */
export function titleOf(line: SourceLine): string | undefined {
  return line.text.startsWith(TITLE_LINE) ? line.text.slice(TITLE_LINE.length) : undefined;
}

/**
 * The lines of a Mermaid source without blank lines, `%%` comments and
 * directives. Front matter is read for its title (other settings are
 * presentation and skipped). The first line returned is the diagram header.
 */
export function readMermaid(text: string, problems: Problems): SourceLine[] {
  const raw = text.replace(/^\u{FEFF}/u, '').split(/\r\n|\r|\n/u);
  const out: SourceLine[] = [];
  let front = 'none' as 'none' | 'open' | 'done';
  for (const [index, line] of raw.entries()) {
    const number = index + 1;
    const t = line.trim();
    if (front === 'open') {
      if (t === '---') {
        front = 'done';
        continue;
      }
      const m = /^title:\s*(.*)$/u.exec(t);
      if (m) {
        let value = m[1]!.trim();
        if (value.startsWith('"')) {
          try {
            value = JSON.parse(value) as string;
          } catch {
            problems.malformed({ number, text: t }, 'the title is not a valid double-quoted string');
            continue;
          }
        } else if (value.startsWith("'") && value.endsWith("'") && value.length > 1) value = value.slice(1, -1).replaceAll("''", "'");
        out.push({ number, text: `${TITLE_LINE}${value}` });
      }
      continue;
    }
    if (!t || t.startsWith('%%')) continue;
    if (t === '---' && front === 'none' && out.length === 0) {
      front = 'open';
      continue;
    }
    out.push({ number, text: t });
  }
  if (front === 'open') problems.malformed({ number: raw.length, text: '' }, 'the front matter is not closed with ---');
  // The header comes first, before the front-matter title marker.
  const header = out.findIndex(l => !l.text.startsWith(TITLE_LINE));
  if (header > 0) out.unshift(...out.splice(header, 1));
  if (out.length === 0) problems.malformed({ number: 1, text: '' }, 'empty Mermaid text; expected a header such as classDiagram');
  return out;
}

/** Presentation-only statements, skipped on import (styles, classes for styling, click handlers, direction). */
export const PRESENTATION = /^(?:classDef\b|style\b|linkStyle\b|click\b|callback\b|link\b|direction\s+(?:TB|TD|BT|LR|RL)$|accTitle\b|accDescr\b)/u;

/** Words Mermaid reads as keywords; an ID equal to one gets a suffix. */
const RESERVED = [
  'end',
  'graph',
  'flowchart',
  'subgraph',
  'class',
  'classDef',
  'note',
  'state',
  'participant',
  'actor',
  'loop',
  'alt',
  'else',
  'opt',
  'par',
  'and',
  'rect',
  'critical',
  'option',
  'break',
  'activate',
  'deactivate',
  'title',
  'autonumber',
  'direction',
  'style',
  'click',
  'link',
  'links',
  'namespace',
  'create',
  'destroy',
  'box',
  'call',
  'callback',
  'default',
  'interface',
  'over',
];

/** Model ID -> Mermaid ID ("-" becomes "_"; keywords get a suffix). */
export const mermaidAliases = (): Aliases => new Aliases(RESERVED);
