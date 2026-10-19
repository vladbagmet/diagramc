import { theme } from '../../core/theme.js';
import type { Marker } from '../../engine/edges.js';
import type { CenterLine, DiagramEdgeSpec, DiagramNodeSpec, DiagramSpec } from '../../engine/diagram.js';
import type { Compartment } from '../../engine/shapes.js';
import type { TextStyle } from '../../engine/fonts.js';
import { classifierKeyword, formatAttribute, formatOperation, guillemets, isAbstractOperation, isStatic } from './format.js';
import { isNote, type ClassDiagram, type Classifier, type Element } from './model.js';

const LABEL: TextStyle = { size: theme.font.size.label };

/**
 * Compartments of a classifier box. UML 2.5.1 (9.2.4) lets a diagram suppress
 * compartments; the rule here: a classifier without attributes and operations
 * shows only its name compartment; a classifier with any attribute or operation
 * shows both the attribute and the operation compartment, so the reader always
 * knows which compartment is which. Enumerations always show their literal
 * compartment, and further compartments only when they have members.
 */
function compartments(c: Classifier): Compartment[] {
  const header: Compartment = { header: true, lines: [] };
  const keyword = classifierKeyword(c.type);
  const muted = theme.color.mutedText;
  if (keyword) header.lines.push({ text: guillemets([keyword]), style: LABEL, align: 'center', fill: muted });
  if (c.stereotypes?.length) header.lines.push({ text: guillemets(c.stereotypes), style: LABEL, align: 'center', fill: muted });
  header.lines.push({ text: c.name, style: { size: theme.font.size.name, bold: true, italic: c.type === 'class' && !!c.abstract }, align: 'center', wrap: theme.size.maxNameWidth });
  const body: TextStyle = { size: theme.font.size.body };
  const attributes: Compartment = { lines: (c.attributes ?? []).map(a => ({ text: formatAttribute(a), style: body, align: 'left', underline: isStatic(a) })) };
  const operations: Compartment = { lines: (c.operations ?? []).map(o => ({ text: formatOperation(o), style: { ...body, italic: isAbstractOperation(o) }, align: 'left', underline: isStatic(o) })) };
  const result = [header];
  if (c.type === 'enumeration') {
    result.push({ lines: (c.literals ?? []).map(text => ({ text, style: body, align: 'left' })) });
    if (attributes.lines.length) result.push(attributes);
    if (operations.lines.length) result.push(operations);
  } else if (attributes.lines.length || operations.lines.length) {
    result.push(attributes, operations);
  }
  return result;
}

const navigability = (navigable: boolean | undefined): Marker => navigable === undefined ? 'none' : navigable ? 'open-arrow' : 'cross';

function node(e: Element): DiagramNodeSpec {
  if (isNote(e)) return { id: e.id, type: 'note', shape: { kind: 'note', text: e.text } };
  return { id: e.id, type: e.type, shape: { kind: 'box', compartments: compartments(e) } };
}

/** Maps a validated class diagram to the generic diagram pipeline (src/engine/diagram.ts). */
export function classDiagramSpec(model: ClassDiagram): DiagramSpec {
  const edges: DiagramEdgeSpec[] = (model.relationships ?? []).map((r, i) => {
    const base = { id: r.id ?? `relationships/${i}`, type: r.type, source: r.from, target: r.to };
    const center: CenterLine[] = [];
    if (r.keyword !== undefined) center.push({ text: guillemets([r.keyword]) });
    if (r.name !== undefined) center.push({ text: r.name });
    const ends: NonNullable<DiagramEdgeSpec['ends']> = [];
    for (const [end, data] of [['source', r.fromEnd], ['target', r.toEnd]] as const) {
      if (data?.multiplicity !== undefined) ends.push({ end, text: data.multiplicity, kind: 'multiplicity' });
      if (data?.role !== undefined) ends.push({ end, text: data.role, kind: 'role' });
    }
    const extra = { ...(center.length ? { center } : {}), ends };
    switch (r.type) {
      case 'generalization': case 'realization':
        return { ...base, ...extra, style: r.type === 'realization' ? 'dashed' : 'solid', sourceMarker: 'none', targetMarker: 'hollow-triangle', tree: true };
      case 'dependency':
        return { ...base, ...extra, style: 'dashed', sourceMarker: 'none', targetMarker: 'open-arrow' };
      case 'containment':
        return { ...base, ...extra, style: 'solid', sourceMarker: 'circle-plus', targetMarker: 'none', priority: 4 };
      default: {
        const whole: Marker = r.type === 'composition' ? 'filled-diamond' : r.type === 'aggregation' ? 'hollow-diamond' : navigability(r.fromEnd?.navigable);
        return { ...base, ...extra, style: 'solid', sourceMarker: whole, targetMarker: navigability(r.toEnd?.navigable), ...(r.type === 'association' ? {} : { priority: 4 }) };
      }
    }
  });
  for (const e of model.elements) {
    if (!isNote(e)) continue;
    for (const target of e.attachedTo ?? []) edges.push({ id: `${e.id}->${target}`, type: 'note-anchor', source: e.id, target, style: 'dashed', sourceMarker: 'none', targetMarker: 'none' });
  }
  return { kind: 'class', frameKeyword: 'class', title: model.title, nodes: model.elements.map(node), edges, directions: ['DOWN', 'RIGHT'] };
}
