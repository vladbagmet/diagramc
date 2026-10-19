import { displayText } from './encode.js';

/**
 * Splits display text into lines of at most `max` code points, breaking after
 * spaces where possible and inside long words otherwise. Spaces stay at the end
 * of their line, so `lines.join('') === text` and the QA reader can rebuild the
 * literal input from the drawn lines.
 */
export function wrapLines(text: string, max: number): string[] {
  const chars = [...text];
  if (chars.length <= max) return [text];
  const lines: string[] = [];
  let start = 0;
  while (chars.length - start > max) {
    let end = start + max;
    // Break after the last space within the window (keep the space on this line).
    let space = -1;
    for (let i = end; i > start; i--) if (chars[i - 1] === ' ' && chars[i] !== ' ') { space = i; break; }
    if (space > start + Math.floor(max / 3)) end = space;
    // Let a run of spaces finish on this line rather than start the next one.
    while (end < chars.length && chars[end] === ' ') end++;
    lines.push(chars.slice(start, end).join(''));
    start = end;
  }
  if (start < chars.length) lines.push(chars.slice(start).join(''));
  return lines;
}

/**
 * Encodes display text as PlantUML display tokens (displayText) with a fixed
 * `\n` line break between wrapped lines. The break is generated, never taken
 * from the input, and every line is encoded separately.
 */
export function wrappedDisplayText(text: string, max: number): string {
  return wrapLines(text, max).map(displayText).join('\\n');
}
