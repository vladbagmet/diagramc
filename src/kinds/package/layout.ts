import { guillemets, nameCompartment, nestElements, type DiagramEdgeSpec, type DiagramNodeSpec, type DiagramSpec } from '../../engine/diagram.js';
import { isNote, isPackage, type Element, type PackageDiagram } from './model.js';

const KEYWORD: Record<string, string | undefined> = { interface: 'interface', enumeration: 'enumeration', datatype: 'dataType' };

function node(e: Element): Omit<DiagramNodeSpec, 'children'> {
  if (isNote(e)) return { id: e.id, type: 'note', shape: { kind: 'note', text: e.text } };
  if (isPackage(e)) return { id: e.id, type: 'package', shape: { kind: 'package', header: { name: e.name, keywords: e.stereotypes } } };
  const keyword = KEYWORD[e.type];
  return { id: e.id, type: e.type, shape: { kind: 'box', compartments: [nameCompartment(keyword ? [keyword] : [], e.stereotypes, e.name, { italic: e.type === 'class' && !!e.abstract })] } };
}

/** Maps a validated package diagram to the generic diagram pipeline. */
export function packageDiagramSpec(model: PackageDiagram): DiagramSpec {
  const edges: DiagramEdgeSpec[] = (model.relationships ?? []).map((r, i) => {
    const base = { id: r.id ?? `relationships/${i}`, type: r.type, source: r.from, target: r.to };
    switch (r.type) {
      case 'containment':
        return { ...base, style: 'solid', sourceMarker: 'circle-plus', targetMarker: 'none', priority: 4 };
      case 'dependency': {
        const center = [...(r.keyword === undefined ? [] : [{ text: guillemets([r.keyword]) }]), ...(r.name === undefined ? [] : [{ text: r.name }])];
        return { ...base, style: 'dashed', sourceMarker: 'none', targetMarker: 'open-arrow', ...(center.length ? { center } : {}) };
      }
      default:
        return { ...base, style: 'dashed', sourceMarker: 'none', targetMarker: 'open-arrow', center: [{ text: guillemets([r.type]) }] };
    }
  });
  for (const e of model.elements) {
    if (!isNote(e)) continue;
    for (const target of e.attachedTo ?? []) edges.push({ id: `${e.id}->${target}`, type: 'note-anchor', source: e.id, target, style: 'dashed', sourceMarker: 'none', targetMarker: 'none' });
  }
  return {
    kind: 'package', frameKeyword: 'package', title: model.title,
    nodes: nestElements(model.elements, e => isPackage(e) ? e.members : undefined, node),
    edges,
    directions: ['DOWN', 'RIGHT'], wrap: true,
  };
}
