import type { FontMetrics, TextStyle } from '../engine/fonts.js';
import { wrapText } from '../engine/text.js';
import { displayText } from './encode.js';

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** Text "metrics" that count graphemes, so the shared wrapper can wrap to a number of characters. */
const COUNT: FontMetrics = {
  measure: text => [...graphemes.segment(text)].length,
  ascent: () => 0,
  descent: () => 0,
  lineHeight: () => 1,
  runs: text => [{ text, covered: true }],
};

/**
 * Splits display text into lines of at most `max` graphemes with the shared
 * wrapper (src/engine/text.ts): breaks after spaces first, then at identifier
 * punctuation and camelCase boundaries, inside a word only as a last resort.
 * `lines.join('') === text`, so the QA reader can rebuild the literal input.
 */
export function wrapLines(text: string, max: number): string[] {
  return wrapText(COUNT, text, { size: 1 }, max, { maxTokenWidth: max });
}

/** Splits display text into lines at most `maxWidth` px wide in `style` (the shared wrapper). */
export function wrapMeasured(metrics: FontMetrics, text: string, style: TextStyle, maxWidth: number): string[] {
  return wrapText(metrics, text, style, maxWidth);
}

/**
 * Encodes display text as PlantUML display tokens (displayText) with a fixed
 * `\n` line break between wrapped lines. The break is generated, never taken
 * from the input, and every line is encoded separately.
 */
export function wrappedDisplayText(text: string, max: number): string {
  return wrapLines(text, max)
    .map(displayText)
    .join(String.raw`\n`);
}
