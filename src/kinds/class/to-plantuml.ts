import { aliases, displayText } from '../../plantuml/encode.js';
import { plantUmlDocument } from '../../plantuml/skin.js';
import { classifierKeyword, formatAttribute, formatOperation, isAbstractOperation, isStatic } from './format.js';
import { isNote, type ClassDiagram, type End } from './model.js';

/**
 * PlantUML fallback for class diagrams (`diagramc render --backend plantuml`). The own
 * engine is the default and draws better: Smetana can place labels on nodes, so
 * this backend only guarantees the layout-independent QA gates. It is kept as the
 * reference example of a PlantUML kind and for comparison. Every display string is encoded
 * with displayText(); user IDs never reach the source.
 */
export function classToPlantUml(model: ClassDiagram): string {
  const ids = aliases(model.elements.map(e => e.id));
  const lines: string[] = ['left to right direction', 'hide circle', 'hide empty members'];
  if (model.title !== undefined) lines.push(`mainframe ${displayText(`class ${model.title}`)}`);
  for (const element of model.elements) {
    const alias = ids.get(element.id)!;
    if (isNote(element)) {
      lines.push(`note "${displayText(element.text)}" as ${alias}`);
      continue;
    }
    // interface/enum declarations would add PlantUML's own styling; the keyword is drawn as a stereotype instead.
    const keyword = element.type === 'class' && element.abstract ? 'abstract class' : 'class';
    const keywordText = classifierKeyword(element.type);
    const stereotypes = [...(keywordText ? [keywordText] : []), ...(element.stereotypes ?? [])];
    const stereo = stereotypes.length > 0 ? ` <<${displayText(stereotypes.join(', '))}>>` : '';
    lines.push(`${keyword} "${displayText(element.name)}" as ${alias}${stereo} {`);
    for (const literal of element.literals ?? []) lines.push(`  ${displayText(literal)}`);
    for (const a of element.attributes ?? []) lines.push(`  ${isStatic(a) ? '{static} ' : ''}{field} ${displayText(formatAttribute(a))}`);
    for (const o of element.operations ?? [])
      lines.push(`  ${isStatic(o) ? '{static} ' : ''}${isAbstractOperation(o) ? '{abstract} ' : ''}{method} ${displayText(formatOperation(o))}`);
    lines.push('}');
  }
  const end = (e: End | undefined): string => {
    const text = [e?.role, e?.multiplicity].filter((t): t is string => t !== undefined).join(' ');
    return text ? ` "${displayText(text)}"` : '';
  };
  for (const r of model.relationships ?? []) {
    const from = ids.get(r.from)!,
      to = ids.get(r.to)!;
    const nav = (n: boolean | undefined, arrow: string, cross: string) => (n === undefined ? '' : n ? arrow : cross);
    let arrow: string;
    switch (r.type) {
      case 'generalization':
        arrow = '--|>';
        break;
      case 'realization':
        arrow = '..|>';
        break;
      case 'dependency':
        arrow = '..>';
        break;
      case 'containment':
        arrow = '+--';
        break;
      case 'aggregation':
        arrow = `o--${nav(r.toEnd?.navigable, '>', 'x')}`;
        break;
      case 'composition':
        arrow = `*--${nav(r.toEnd?.navigable, '>', 'x')}`;
        break;
      default:
        arrow = `${nav(r.fromEnd?.navigable, '<', 'x')}--${nav(r.toEnd?.navigable, '>', 'x')}`;
    }
    const label = [r.keyword === undefined ? undefined : `«${r.keyword}»`, r.name].filter((t): t is string => t !== undefined).join(' ');
    lines.push(`${from}${end(r.fromEnd)} ${arrow}${end(r.toEnd)} ${to}${label ? ` : ${displayText(label)}` : ''}`);
  }
  for (const element of model.elements) {
    if (isNote(element)) for (const target of element.attachedTo ?? []) lines.push(`${ids.get(element.id)} .. ${ids.get(target)}`);
  }
  return plantUmlDocument(lines, { layout: 'smetana' });
}
