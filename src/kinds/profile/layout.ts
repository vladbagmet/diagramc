import { theme } from '../../core/theme.js';
import { guillemets, nameCompartment, nestElements, type DiagramEdgeSpec, type DiagramNodeSpec, type DiagramSpec } from '../../engine/diagram.js';
import type { Compartment } from '../../engine/shapes.js';
import { isContainer, isNote, type Element, type ProfileDiagram, type TaggedValue } from './model.js';

/** `name : Type [multiplicity] = default` (UML 2.5.1 9.5.4, used for tag definitions). */
export function formatTaggedValue(t: TaggedValue): string {
  let text = t.name;
  if (t.type !== undefined) text += ` : ${t.type}`;
  if (t.multiplicity !== undefined) text += ` [${t.multiplicity}]`;
  if (t.default !== undefined) text += ` = ${t.default}`;
  return text;
}

const body = { size: theme.font.size.body };

function node(e: Element): Omit<DiagramNodeSpec, 'children'> {
  const box = (compartments: Compartment[]): Omit<DiagramNodeSpec, 'children'> => ({ id: e.id, type: e.type, shape: { kind: 'box', compartments } });
  switch (e.type) {
    case 'note': return { id: e.id, type: 'note', shape: { kind: 'note', text: e.text } };
    case 'profile': return { id: e.id, type: 'profile', shape: { kind: 'package', header: { name: e.name, keywords: ['profile'] } } };
    case 'package': return { id: e.id, type: 'package', shape: { kind: 'package', header: { name: e.name } } };
    case 'stereotype': {
      const compartments = [nameCompartment(['stereotype'], undefined, e.name, { italic: !!e.abstract })];
      if (e.attributes?.length) compartments.push({ lines: e.attributes.map(a => ({ text: formatTaggedValue(a), style: body, align: 'left' as const })) });
      return box(compartments);
    }
    case 'metaclass': return box([nameCompartment(['metaclass'], undefined, e.name)]);
    case 'enumeration': {
      const compartments = [nameCompartment(['enumeration'], undefined, e.name)];
      if (e.literals?.length) compartments.push({ lines: e.literals.map(text => ({ text, style: body, align: 'left' as const })) });
      return box(compartments);
    }
    case 'class': return box([nameCompartment([], e.stereotypes, e.name)]);
  }
}

/** Maps a validated profile diagram to the generic diagram pipeline. */
export function profileDiagramSpec(model: ProfileDiagram): DiagramSpec {
  const edges: DiagramEdgeSpec[] = (model.relationships ?? []).map((r, i) => {
    const base = { id: r.id ?? `relationships/${i}`, type: r.type, source: r.from, target: r.to };
    switch (r.type) {
      case 'extension':
        return { ...base, style: 'solid', sourceMarker: 'none', targetMarker: 'filled-triangle', reversed: true, ends: r.required ? [{ end: 'source', text: '{required}', kind: 'role' }] : [] };
      case 'generalization':
        return { ...base, style: 'solid', sourceMarker: 'none', targetMarker: 'hollow-triangle', tree: true };
      default:
        return { ...base, style: 'dashed', sourceMarker: 'none', targetMarker: 'open-arrow', center: [{ text: guillemets([r.type]) }] };
    }
  });
  for (const e of model.elements) {
    if (!isNote(e)) continue;
    for (const target of e.attachedTo ?? []) edges.push({ id: `${e.id}->${target}`, type: 'note-anchor', source: e.id, target, style: 'dashed', sourceMarker: 'none', targetMarker: 'none' });
  }
  return {
    kind: 'profile', frameKeyword: 'profile', title: model.title,
    nodes: nestElements(model.elements, e => isContainer(e) ? e.members : undefined, node),
    edges,
    // Metaclasses and general stereotypes above, as in UML 2.5.1 figures.
    directions: ['DOWN'], wrap: true,
  };
}
