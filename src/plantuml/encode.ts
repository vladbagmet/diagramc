/**
 * Encodes EVERY UTF-16 code unit of display text, including punctuation, spaces,
 * quotes and backslashes, as a PlantUML `<U+XXXX>` token. PlantUML expands these
 * tokens as display glyphs after parsing its source grammar, so user input can
 * never become a directive, Creole/HTML markup, alias or source line.
 * Every display string a PlantUML kind emits MUST go through this function.
 */
export function displayText(text: string): string {
  // Four-digit tokens also cover supplementary planes via paired surrogate tokens.
  // PlantUML does not recognize six-digit code-point tokens (U+100000 and above).
  // eslint-disable-next-line unicorn/prefer-spread, unicorn/prefer-code-point -- UTF-16 code units on purpose, see above.
  const encoded = text.split('').map(c => `<U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}>`).join('');
  // Fixed zero-width boundaries preserve whitespace and defeat trailing <generic> parsing.
  return `\u200B${encoded}\u200B`;
}

/**
 * Private, deterministic PlantUML aliases for user IDs (`uml_<prefix><index>`).
 * User IDs never appear in generated source.
 */
export function aliases(ids: readonly string[], prefix = 'e'): Map<string, string> {
  return new Map(ids.map((id, i) => [id, `uml_${prefix}${i}`]));
}
