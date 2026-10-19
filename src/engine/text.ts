import type { FontMetrics, TextStyle } from './fonts.js';

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * Greedy word wrapping to `maxWidth` px. Spaces stay at the end of the line they
 * follow, so `lines.join('') === text` always holds: wrapped text still contains
 * the input literally (the QA literal-text gate relies on this). Words wider than
 * `maxWidth` are broken between graphemes.
 */
export function wrapText(metrics: FontMetrics, text: string, style: TextStyle, maxWidth: number): string[] {
  const width = (s: string): number => metrics.measure(s.trimEnd(), style);
  if (width(text) <= maxWidth) return [text];
  const tokens = text.match(/\s+|\S+\s*/gu) ?? [text];
  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    if (width(current + token) <= maxWidth) { current += token; continue; }
    if (current.trim()) { lines.push(current); current = ''; }
    if (width(token) <= maxWidth) { current += token; continue; }
    // A single overlong word: break it between graphemes.
    for (const { segment } of graphemes.segment(token)) {
      if (current && current.trim() && width(current + segment) > maxWidth) { lines.push(current); current = ''; }
      current += segment;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Width of the widest line, ignoring trailing spaces. */
export function linesWidth(metrics: FontMetrics, lines: readonly string[], style: TextStyle): number {
  return Math.max(0, ...lines.map(line => metrics.measure(line.trimEnd(), style)));
}
