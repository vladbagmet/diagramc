import { theme } from '../core/theme.js';
import type { FontMetrics, TextStyle } from './fonts.js';

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

export interface WrapOptions {
  /**
   * A word wider than `maxWidth` but at most this wide stays whole on a line of
   * its own (the box grows to fit it) instead of being broken. Default: the
   * theme's `maxTokenWidth`, never less than `maxWidth`.
   */
  maxTokenWidth?: number;
}

/** Text made only of punctuation and symbols (":", "-", "«»"), which must never stand alone on a line. */
const PUNCTUATION_ONLY = /^[\p{P}\p{S}]+$/u;

/**
 * Break opportunities inside a word, in order of preference: after ".", "_", "-",
 * "/", ",", ":" and ";", before "(" and "[", and at camelCase humps ("orderId",
 * "HTTPServer" -> "HTTP|Server"). Returns the word split into pieces whose
 * concatenation is the word.
 */
export function wordPieces(word: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  const chars = [...word];
  let offset = 0;
  const cut = (at: number) => { if (at > start) { pieces.push(word.slice(start, at)); start = at; } };
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!, next = chars[i + 1], prev = chars[i - 1];
    if (i > 0 && (c === '(' || c === '[' || c === '{' || c === '«')) cut(offset);
    else if (i > 0 && next !== undefined && /\p{Lu}/u.test(c) && (/[\p{Ll}\p{Nd}]/u.test(prev!) || (/\p{Lu}/u.test(prev!) && /\p{Ll}/u.test(next)))) cut(offset);
    offset += c.length;
    if (/[._\-/,:;»)\]}]/u.test(c) && next !== undefined && !/[._\-/,:;»)\]}]/u.test(next)) cut(offset);
  }
  cut(word.length);
  return pieces;
}

/**
 * Greedy wrapping to `maxWidth` px. Spaces stay at the end of the line they
 * follow, so `lines.join('') === text` always holds: wrapped text still contains
 * the input literally (the QA literal-text gate relies on this).
 *
 * Words are kept whole when they fit `maxTokenWidth`; longer words break at the
 * opportunities of `wordPieces` (camelCase, ".", "_", "-", "/", "(", ","), and
 * only a piece that is itself too long is broken between graphemes. A line never
 * holds punctuation alone (a lone ":" joins the word before or after it).
 */
export function wrapText(metrics: FontMetrics, text: string, style: TextStyle, maxWidth: number, options: WrapOptions = {}): string[] {
  const width = (s: string): number => metrics.measure(s.trimEnd(), style);
  if (width(text) <= maxWidth) return [text];
  const tokenMax = Math.max(maxWidth, options.maxTokenWidth ?? theme.size.maxTokenWidth);
  // Words with their trailing spaces; a punctuation-only word sticks to its neighbour.
  const raw = text.match(/\s+|\S+\s*/gu) ?? [text];
  const tokens: string[] = [];
  let pending = '';
  for (const token of raw) {
    const punctuation = PUNCTUATION_ONLY.test(token.trim());
    if (punctuation && tokens.length > 0) { tokens[tokens.length - 1] += token; continue; }
    if (punctuation || !token.trim()) { pending += token; continue; }
    tokens.push(pending + token);
    pending = '';
  }
  if (pending) { if (tokens.length > 0) tokens[tokens.length - 1] += pending; else tokens.push(pending); }
  const lines: string[] = [];
  let current = '';
  const place = (piece: string): void => {
    if (current.trim() && width(current + piece) > maxWidth) { lines.push(current); current = ''; }
    current += piece;
  };
  for (const token of tokens) {
    if (width(current + token) <= maxWidth) { current += token; continue; }
    if (width(token) <= tokenMax) {
      if (current.trim()) lines.push(current);
      current = token;
      continue;
    }
    // A long word: break at its opportunities, packing pieces greedily.
    for (const piece of wordPieces(token)) {
      if (width(piece) <= tokenMax) { place(piece); continue; }
      for (const { segment } of graphemes.segment(piece)) {
        if (current.trim() && width(current + segment) > maxWidth) { lines.push(current); current = ''; }
        current += segment;
      }
    }
  }
  if (current) lines.push(current);
  // A line holding only punctuation joins the line before it.
  for (let i = lines.length - 1; i > 0; i--) {
    if (PUNCTUATION_ONLY.test(lines[i]!.trim()) || !lines[i]!.trim()) { lines[i - 1] += lines[i]!; lines.splice(i, 1); }
  }
  if (lines.length > 1 && (PUNCTUATION_ONLY.test(lines[0]!.trim()) || !lines[0]!.trim())) { lines[1] = lines[0]! + lines[1]!; lines.shift(); }
  // A word kept whole widens the text anyway: when the whole text is not much wider
  // than that, one line reads better than a stub ("r2 :" above a long classifier name).
  const widest = Math.max(maxWidth, ...lines.map(width));
  if (lines.length > 1 && widest > maxWidth && width(text) <= widest * ONE_LINE_SLACK) return [text];
  return lines;
}

/** See wrapText: how much wider than its widest whole word a text may stay on one line. */
const ONE_LINE_SLACK = 1.25;

/** Widest line of `text` when wrapped to `maxWidth` (the width a box needs for it). */
export function wrappedWidth(metrics: FontMetrics, text: string, style: TextStyle, maxWidth: number, options: WrapOptions = {}): number {
  return linesWidth(metrics, wrapText(metrics, text, style, maxWidth, options), style);
}

/** Width of the widest line, ignoring trailing spaces. */
export function linesWidth(metrics: FontMetrics, lines: readonly string[], style: TextStyle): number {
  return Math.max(0, ...lines.map(line => metrics.measure(line.trimEnd(), style)));
}
