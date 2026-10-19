import type { FontMetrics, TextStyle } from '../engine/fonts.js';
import { displayText } from './encode.js';

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * Quality of a line break between `before` and `after` (higher is better, 0 means
 * "only if nothing else fits"): after a space, after punctuation that separates
 * parts of identifiers and paths (`. _ - / : , ( ) ;`), at a camelCase boundary
 * or between a letter and a digit.
 */
function breakRank(before: string, after: string): number {
  if (before === ' ' && after !== ' ') return 4;
  if (/[._\-/:,;()=]/u.test(before) && after !== ' ') return 3;
  if (/\p{Ll}/u.test(before) && /\p{Lu}/u.test(after)) return 2;
  if (/\p{L}/u.test(before) && /\p{Nd}/u.test(after)) return 1;
  return 0;
}

/**
 * Greedy wrapping that prefers natural break points: spaces first, then
 * identifier punctuation, then camelCase boundaries, and only then any grapheme
 * boundary. A break point is used when it keeps at least a third of the line.
 * Spaces stay at the end of their line, so `lines.join('') === text` and the QA
 * reader can rebuild the literal input from the drawn lines.
 */
export function wrapBy(text: string, fits: (line: string) => boolean): string[] {
  const units = [...graphemes.segment(text)].map(s => s.segment);
  const lines: string[] = [];
  let start = 0;
  while (start < units.length) {
    // Longest prefix from `start` that fits (at least one grapheme).
    let end = start + 1;
    while (end < units.length && fits(units.slice(start, end + 1).join('').trimEnd())) end++;
    if (end >= units.length) { lines.push(units.slice(start).join('')); break; }
    let best = -1, bestRank = 0;
    const floor = start + Math.max(1, Math.floor((end - start) / 3));
    for (let i = end; i >= floor; i--) {
      const rank = breakRank(units[i - 1]!, units[i]!);
      if (rank > bestRank) { best = i; bestRank = rank; if (rank === 4) break; }
    }
    let cut = best > start ? best : end;
    // A run of spaces finishes on this line rather than starting the next one.
    while (cut < units.length && units[cut] === ' ') cut++;
    lines.push(units.slice(start, cut).join(''));
    start = cut;
  }
  return lines;
}

/** Splits display text into lines of at most `max` graphemes (see wrapBy). */
export function wrapLines(text: string, max: number): string[] {
  return wrapBy(text, line => [...graphemes.segment(line)].length <= max);
}

/** Splits display text into lines at most `maxWidth` px wide in the given style (see wrapBy). */
export function wrapMeasured(metrics: FontMetrics, text: string, style: TextStyle, maxWidth: number): string[] {
  return wrapBy(text, line => metrics.measure(line, style) <= maxWidth);
}

/**
 * Encodes display text as PlantUML display tokens (displayText) with a fixed
 * `\n` line break between wrapped lines. The break is generated, never taken
 * from the input, and every line is encoded separately.
 */
export function wrappedDisplayText(text: string, max: number): string {
  return wrapLines(text, max).map(displayText).join('\\n');
}
