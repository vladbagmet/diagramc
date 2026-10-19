import type { Model } from './model.js';

// Encode EVERY UTF-16 code unit, including punctuation, spaces, quotes and backslashes.
// PlantUML expands these tokens as display glyphs, after parsing its source grammar.
// User input can never become a directive, Creole/HTML markup, alias or source line.
export function displayText(text: string): string {
  // Four-digit tokens also cover supplementary planes via paired surrogate tokens.
  // PlantUML does not recognize six-digit code-point tokens (U+100000 and above).
  const encoded = text.split('').map(c => `<U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}>`).join('');
  // Fixed zero-width boundaries preserve whitespace and defeat trailing <generic> parsing.
  return `\u200b${encoded}\u200b`;
}

export function toPlantUml(model: Model): string {
  const aliases = new Map(model.classes.map((c, i) => [c.id, `uml_c${i}`]));
  const lines = [
    '@startuml', '!pragma layout smetana', 'left to right direction',
    'skinparam backgroundColor #FFFFFF',
    'skinparam defaultFontName SansSerif',
    'skinparam defaultFontSize 13',
    'skinparam shadowing false',
    'skinparam roundcorner 8',
    'skinparam classAttributeIconSize 0',
    'skinparam classBackgroundColor #F8FAFC',
    'skinparam classHeaderBackgroundColor #E6EEF5',
    'skinparam classBorderColor #64748B',
    'skinparam classFontColor #15263B',
    'skinparam classFontSize 15',
    'skinparam classFontStyle bold',
    'skinparam classAttributeFontColor #334155',
    'skinparam classAttributeFontSize 13',
    'skinparam arrowColor #64748B',
    'skinparam arrowFontColor #475569',
    'skinparam arrowFontSize 12',
    'skinparam padding 4',
    'skinparam nodesep 55',
    'skinparam ranksep 45',
    'hide circle',
  ];
  for (const c of model.classes) {
    lines.push(`class "${displayText(c.name)}" as ${aliases.get(c.id)} {`);
    for (const member of c.attributes ?? []) lines.push(`  {field} ${displayText(member)}`);
    for (const member of c.methods ?? []) lines.push(`  {method} ${displayText(member)}`);
    lines.push('}');
  }
  for (const r of model.relationships) {
    lines.push(`${aliases.get(r.from)} ${r.type === 'inheritance' ? '--|>' : '--'} ${aliases.get(r.to)}${r.label === undefined ? '' : ` : ${displayText(r.label)}`}`);
  }
  return lines.concat('@enduml', '').join('\n');
}
