import { theme } from '../../core/theme.js';
import type { Marker } from '../../engine/edges.js';
import { nameCompartment, type DiagramEdgeSpec, type DiagramNodeSpec, type DiagramSpec } from '../../engine/diagram.js';
import type { Compartment } from '../../engine/shapes.js';
import { isNote, type Instance, type Link, type ObjectDiagram, type Slot } from './model.js';

/** `name : Classifier`, `: Classifier` (anonymous) or `name` (unknown classifier), UML 2.5.1 clause 9.8.4. */
export function instanceTitle(i: Pick<Instance, 'name' | 'classifier'>): string {
  if (i.classifier === undefined) return i.name!;
  return i.name === undefined ? `: ${i.classifier}` : `${i.name} : ${i.classifier}`;
}

/** `feature = value` or `feature : Type = value`. */
export const formatSlot = (s: Slot): string => `${s.feature}${s.type === undefined ? '' : ` : ${s.type}`} = ${s.value}`;

/** `name : association`, `: association` or `name` for a link label. */
function linkTitle(l: Link): string | undefined {
  if (l.name === undefined && l.association === undefined) return undefined;
  return instanceTitle({ name: l.name, classifier: l.association } as Pick<Instance, 'name' | 'classifier'>);
}

const navigability = (navigable: boolean | undefined): Marker => navigable === undefined ? 'none' : navigable ? 'open-arrow' : 'cross';

function node(e: ObjectDiagram['elements'][number]): DiagramNodeSpec {
  if (isNote(e)) return { id: e.id, type: 'note', shape: { kind: 'note', text: e.text } };
  const compartments: Compartment[] = [nameCompartment([], e.stereotypes, instanceTitle(e), { underline: true })];
  if (e.slots?.length) compartments.push({ lines: e.slots.map(s => ({ text: formatSlot(s), style: { size: theme.font.size.body }, align: 'left' })) });
  return { id: e.id, type: 'instance', shape: { kind: 'box', compartments } };
}

/** Maps a validated object diagram to the generic diagram pipeline. */
export function objectDiagramSpec(model: ObjectDiagram): DiagramSpec {
  // Links have no direction of their own: lay each one out from the instance
  // listed first to the one listed later, so document order reads top-down.
  const order = new Map(model.elements.map((e, i) => [e.id, i]));
  const edges: DiagramEdgeSpec[] = (model.relationships ?? []).map((l, i) => {
    const title = linkTitle(l);
    const ends: NonNullable<DiagramEdgeSpec['ends']> = [];
    if (l.fromEnd?.role !== undefined) ends.push({ end: 'source', text: l.fromEnd.role, kind: 'role' });
    if (l.toEnd?.role !== undefined) ends.push({ end: 'target', text: l.toEnd.role, kind: 'role' });
    return {
      id: l.id ?? `relationships/${i}`, type: 'link', source: l.from, target: l.to, style: 'solid',
      sourceMarker: navigability(l.fromEnd?.navigable), targetMarker: navigability(l.toEnd?.navigable),
      ...(title === undefined ? {} : { center: [{ text: title, underline: true }] }),
      ends,
      ...(order.get(l.from)! > order.get(l.to)! ? { reversed: true, priority: 1 } : {}),
    };
  });
  for (const e of model.elements) {
    if (!isNote(e)) continue;
    for (const target of e.attachedTo ?? []) edges.push({ id: `${e.id}->${target}`, type: 'note-anchor', source: e.id, target, style: 'dashed', sourceMarker: 'none', targetMarker: 'none' });
  }
  return { kind: 'object', frameKeyword: 'object', title: model.title, nodes: model.elements.map(node), edges, directions: ['DOWN', 'RIGHT'], wrap: true };
}
