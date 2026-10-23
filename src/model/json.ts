import { UmlError } from '../core/errors.js';

/**
 * JSON.parse with an INVALID_JSON error that says where the problem is (line
 * and column, 1-based, and the text around it) and, for the mistakes people and
 * models make most, what to change: trailing commas, comments, single quotes,
 * unquoted property names, missing commas.
 */
export function parseJson(text: string): unknown {
  try { return JSON.parse(text); }
  catch (error) {
    const reason = String((error as Error)?.message ?? 'invalid JSON');
    const match = /position (\d+)/u.exec(reason);
    const position = match ? Number(match[1]) : reason.includes('end of JSON') ? text.length : errorPosition(text);
    if (position === undefined) throw new UmlError('INVALID_JSON', `Input is not valid JSON: ${clean(reason)}`);
    const before = text.slice(0, position);
    const line = before.split('\n').length, column = position - before.lastIndexOf('\n');
    const lineText = text.split('\n')[line - 1] ?? '';
    const hint = hintAt(text, position);
    throw new UmlError('INVALID_JSON', `Input is not valid JSON at line ${line}, column ${column}: ${clean(reason)}${hint ? `. ${hint}` : ''}`, 2, {
      line, column, position, near: lineText.length > 120 ? lineText.slice(Math.max(0, column - 60), column + 60) : lineText, ...(hint ? { hint } : {}),
    });
  }
}

/** V8's message without its own position suffix or a copy of the input. */
const clean = (reason: string): string => reason
  .replace(/\s*(?:in JSON\s*)?at position \d+(?: \(line \d+ column \d+\))?/u, '')
  // V8 quotes the input around the error, cut with "..." at either end: never repeated.
  .replace(/, (?:\.\.\.)?"[\s\S]*"(?:\.\.\.)? is not valid JSON$/u, '')
  .replace(/^Unexpected token/u, 'Unexpected character');

/**
 * Offset of the first character a strict JSON reader rejects, for the parse
 * errors whose message has no position. A small recursive-descent scan; only
 * runs after JSON.parse failed.
 */
function errorPosition(text: string): number {
  let i = 0;
  const fail = (): never => { throw i; };
  const space = (): void => { while (i < text.length && ' \t\n\r'.includes(text[i]!)) i++; };
  const literal = (word: string): void => { if (text.startsWith(word, i)) i += word.length; else fail(); };
  const string = (): void => {
    if (text[i] !== '"') fail();
    for (i++; i < text.length; i++) {
      const c = text[i]!;
      if (c === '"') { i++; return; }
      if (c === '\\') { i++; continue; }
      if (c < ' ') fail();
    }
    fail();
  };
  const number = (): void => {
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(i));
    if (!m) fail();
    i += m![0].length;
  };
  const value = (): void => {
    space();
    const c = text[i];
    switch (c) {
    case '{': {
      i++; space();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        space(); string(); space();
        if (text[i] !== ':') fail();
        i++; value(); space();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return; }
        fail();
      }
    
    break;
    }
    case '[': {
      i++; space();
      if (text[i] === ']') { i++; return; }
      for (;;) {
        value(); space();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return; }
        fail();
      }
    
    break;
    }
    case '"': {
    string();
    break;
    }
    case 't': {
    literal('true');
    break;
    }
    case 'f': {
    literal('false');
    break;
    }
    case 'n': {
    literal('null');
    break;
    }
    default: number();
    }
  };
  try { value(); space(); return Math.min(i, text.length); }
  catch (error) { return typeof error === 'number' ? Math.min(error, text.length) : 0; }
}

function hintAt(text: string, position: number): string | undefined {
  const at = text[position] ?? '';
  const previous = text.slice(0, position).trimEnd().at(-1) ?? '';
  if ((at === '}' || at === ']') && previous === ',') return 'Remove the trailing comma before it; JSON does not allow trailing commas';
  if (at === '/' && (text[position + 1] === '/' || text[position + 1] === '*')) return 'Remove the comment; JSON does not allow comments';
  if (at === '\'') return 'Use double quotes ("...") for strings and property names';
  if (/[A-Za-z_$]/u.test(at) && (previous === '{' || previous === ',')) return 'Put property names in double quotes, for example {"kind": "class"}';
  if (at === '"' && (previous === '"' || previous === '}' || previous === ']' || /[\d]/u.test(previous) || previous === 'e' || previous === 'l')) return 'A comma is missing between two values or properties';
  if (position >= text.trimEnd().length) return 'The document ends early: a closing bracket, brace or quote is missing';
  return undefined;
}
