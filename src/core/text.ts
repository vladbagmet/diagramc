/**
 * Shared rules for identifiers and display text, used by every diagram kind.
 *
 * IDs are stable ASCII handles that relationships use to refer to elements;
 * they are never drawn. Display text is Unicode shown literally in the diagram;
 * it is never parsed as markup or as code by either backend.
 */

/** IDs: an ASCII letter, then letters, digits, `_` or `-`; at most 64 characters. */
export const ID_PATTERN = '^[A-Za-z][A-Za-z0-9_-]{0,63}(?![\\s\\S])';

/**
 * Display text is a single line without C0/C1 controls, line/paragraph separators
 * or the XML-forbidden U+FFFE/U+FFFF. Violations are schema errors (SCHEMA_INVALID).
 */
export const TEXT_PATTERN = '^[^\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\ufffe\\uffff]+(?![\\s\\S])';

/** Bidirectional overrides and isolates could visually reorder text; they are rejected. */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/u;

/**
 * Rules JSON Schema cannot express: well-formed UTF-16 (no unpaired surrogates),
 * not blank, no bidi controls. Violations are reported as INVALID_TEXT.
 */
export function displayTextProblem(text: string): string | undefined {
  if (!text.isWellFormed()) return 'contains an unpaired UTF-16 surrogate';
  if (!text.trim()) return 'is blank';
  if (BIDI_CONTROLS.test(text)) return 'contains a bidirectional control character';
  return undefined;
}

/** Name of the JSON Schema extension keyword that marks a string as display text. */
export const TEXT_KEYWORD = 'x-uml-text';

/**
 * Name of the JSON Schema extension keyword for text the renderer wraps in
 * delimiters itself: its value names them. "«»": keywords and stereotypes (no
 * guillemets or << >> anywhere); "[]": guards (no outer brackets); "{}":
 * constraints and conditions (no outer braces). Violations are reported with the
 * corrected text, never silently stripped.
 */
export const UNWRAPPED_KEYWORD = 'x-uml-unwrapped';

export function unwrappedProblem(text: string, delimiters: string): { message: string; suggestion: string } | undefined {
  const t = text.trim();
  if (delimiters === '«»') {
    if (!/[«»]|<<|>>/u.test(text)) return undefined;
    const parts = text.split(/[«»]|<<|>>/u).map(s => s.replace(/^[\s,]+|[\s,]+$/gu, '')).filter(Boolean);
    const suggestion = parts[0] ?? '';
    return {
      message: `${JSON.stringify(text)} contains guillemets or << >>; write the name only, the diagram adds the guillemets (${JSON.stringify(suggestion)} is drawn «${suggestion}»)${parts.length > 1 ? `; give several stereotypes as separate list items: ${JSON.stringify(parts)}` : ''}`,
      suggestion,
    };
  }
  const [open, close] = [...delimiters] as [string, string];
  if (!(t.startsWith(open) && t.endsWith(close)) || t.length < 2) return undefined;
  const suggestion = t.slice(1, -1).trim();
  const what = open === '[' ? 'a guard' : 'a constraint';
  return { message: `${JSON.stringify(text)} is ${what} written with its ${open}${close}; write it without them, the diagram adds them (${JSON.stringify(suggestion)} is drawn ${open}${suggestion}${close})`, suggestion };
}

/**
 * Definitions every kind schema embeds under `definitions`. Kinds reference them
 * with `{ "$ref": "#/definitions/name" }` and so on. Every string that is drawn MUST
 * use one of the text definitions: the `x-uml-text` marker applies the INVALID_TEXT
 * rules and registers the string for the QA gate that checks it is drawn literally.
 */
export const commonDefinitions = {
  id: {
    type: 'string', pattern: ID_PATTERN,
    description: 'Stable identifier: an ASCII letter, then ASCII letters, digits, "_" or "-" (no spaces, dots or other characters), at most 64 characters, for example "order", "order-item" or "OrderItem_2". Unique per document. Never drawn.',
  },
  name: {
    type: 'string', minLength: 1, maxLength: 100, pattern: TEXT_PATTERN, [TEXT_KEYWORD]: true,
    description: 'Display name: 1 to 100 code points, single line, shown literally.',
  },
  text: {
    type: 'string', minLength: 1, maxLength: 180, pattern: TEXT_PATTERN, [TEXT_KEYWORD]: true,
    description: 'Display text: 1 to 180 code points, single line, shown literally.',
  },
  longText: {
    type: 'string', minLength: 1, maxLength: 1000, pattern: TEXT_PATTERN, [TEXT_KEYWORD]: true,
    description: 'Paragraph text (notes): 1 to 1000 code points, single line, wrapped automatically, shown literally.',
  },
  keyword: {
    type: 'string', minLength: 1, maxLength: 100, pattern: TEXT_PATTERN, [TEXT_KEYWORD]: true, [UNWRAPPED_KEYWORD]: '«»',
    description: 'Keyword or stereotype name WITHOUT guillemets, e.g. "use" is drawn as «use».',
  },
  guard: {
    type: 'string', minLength: 1, maxLength: 180, pattern: TEXT_PATTERN, [TEXT_KEYWORD]: true, [UNWRAPPED_KEYWORD]: '[]',
    description: 'Guard condition WITHOUT brackets, e.g. "x > 0" is drawn [x > 0].',
  },
  constraint: {
    type: 'string', minLength: 1, maxLength: 180, pattern: TEXT_PATTERN, [TEXT_KEYWORD]: true, [UNWRAPPED_KEYWORD]: '{}',
    description: 'Constraint or condition WITHOUT braces, e.g. "x > 0" is drawn {x > 0}.',
  },
  multiplicity: {
    type: 'string', maxLength: 40, pattern: '^(?:\\*|[0-9]+)(?:\\.\\.(?:\\*|[0-9]+))?(?![\\s\\S])', [TEXT_KEYWORD]: true,
    description: 'Multiplicity: "*" (many), a number such as "1" or "3", or a range "n..m" where m may be "*", for example "0..1", "1..*", "2..5". Words such as "many" or "0..n" are not allowed.',
  },
} as const;
