import { theme } from '../../core/theme.js';
import { headerLines, type StructEdge, type StructGraph, type StructNode, type StructPort } from '../structure/graph.js';
import type { CompositeStructureDiagram, Element, Part, Port, Role } from './model.js';

/** `name : Type [multiplicity]` for parts, roles and ports (UML 2.5.1 11.2.4, 11.3.4). */
export function typedName(e: { name?: string; type?: string; multiplicity?: string; conjugated?: boolean }): string | undefined {
  const type = e.type === undefined ? undefined : `${e.conjugated ? '~' : ''}${e.type}`;
  let text = e.name ?? '';
  if (type !== undefined) text += `${text ? ' ' : ''}: ${type}`;
  if (e.multiplicity !== undefined) text += `${text ? ' ' : ''}[${e.multiplicity}]`;
  return text || undefined;
}

/** Parts and roles: their typed name in regular weight, so they read as properties, not classifiers. */
const propertyHeader = (e: Part | Role) => headerLines({ name: typedName(e)!, bold: false });

/** Maps a validated composite structure diagram to the shared structure graph. */
export function compositeStructureGraph(model: CompositeStructureDiagram): StructGraph {
  const relationships = model.relationships ?? [];
  const collaborations = new Map(model.elements.flatMap(e => (e.type === 'collaboration' ? [[e.id, e] as const] : [])));
  const roleOwner = new Map(model.elements.flatMap(e => (e.type === 'collaboration' ? e.roles.map(r => [r.id, e.id] as const) : [])));
  const roleNames = new Map(model.elements.flatMap(e => (e.type === 'collaboration' ? e.roles.map(r => [r.id, r.name] as const) : [])));
  const ports = (ps: readonly Port[] | undefined): StructPort[] =>
    (ps ?? []).map(p => {
      const label = typedName(p);
      return { id: p.id, ...(label === undefined ? {} : { label }) };
    });
  const part = (p: Part): StructNode => ({
    id: p.id,
    type: 'part',
    shape: 'box',
    header: propertyHeader(p),
    ...(p.aggregation === 'shared' || p.aggregation === 'none' ? { dashed: true } : {}),
    ports: ports(p.ports),
    children: (p.parts ?? []).map(part),
  });
  const edges: StructEdge[] = [];
  const node = (e: Element): StructNode => {
    switch (e.type) {
      case 'class':
        return {
          id: e.id,
          type: 'class',
          shape: 'box',
          header: headerLines({ stereotypes: e.stereotypes, name: e.name }),
          ports: ports(e.ports),
          children: [
            ...(e.parts ?? []).map(part),
            ...(e.collaborationUses ?? []).map((u): StructNode => {
              for (const [k, b] of (u.bindings ?? []).entries())
                edges.push({
                  id: `${u.id}::binding::${k}`,
                  type: 'role-binding',
                  source: u.id,
                  target: b.part,
                  style: 'dashed',
                  sourceMarker: 'none',
                  targetMarker: 'none',
                  ends: [{ end: 'target', text: roleNames.get(b.role) ?? b.role, kind: 'role' }],
                });
              return {
                id: u.id,
                type: 'collaboration-use',
                shape: 'ellipse',
                dashed: true,
                header: [
                  {
                    text: `${u.name} : ${collaborations.get(u.collaboration)?.name ?? u.collaboration}`,
                    style: { size: theme.font.size.name },
                    align: 'center',
                  },
                ],
              };
            }),
          ],
        };
      case 'collaboration':
        return {
          id: e.id,
          type: 'collaboration',
          shape: 'ellipse',
          dashed: true,
          header: headerLines({ name: e.name }),
          children: e.roles.map(r => ({ id: r.id, type: 'role', shape: 'box', header: propertyHeader(r) })),
        };
      case 'note':
        return { id: e.id, type: 'note', shape: 'note', header: [], noteText: e.text };
    }
  };
  const nodes = model.elements.map(node);
  for (const [i, r] of relationships.entries()) {
    const id = r.id ?? `relationships/${i}`;
    if (r.type === 'dependency') {
      edges.push({
        id,
        type: 'dependency',
        source: r.from,
        target: r.to,
        style: 'dashed',
        sourceMarker: 'none',
        targetMarker: 'open-arrow',
        ...(r.keyword === undefined ? {} : { keyword: r.keyword }),
        ...(r.name === undefined ? {} : { name: r.name }),
      });
      continue;
    }
    const ends: NonNullable<StructEdge['ends']> = [];
    for (const [end, data] of [
      ['source', r.fromEnd],
      ['target', r.toEnd],
    ] as const) {
      if (data?.multiplicity !== undefined) ends.push({ end, text: data.multiplicity, kind: 'multiplicity' });
      if (data?.role !== undefined) ends.push({ end, text: data.role, kind: 'role' });
    }
    const name = r.association === undefined ? r.name : `${r.name === undefined ? '' : `${r.name} `}: ${r.association}`;
    edges.push({
      id,
      type: 'connector',
      source: r.from,
      target: r.to,
      style: 'solid',
      sourceMarker: 'none',
      targetMarker: 'none',
      ...(name === undefined ? {} : { name }),
      ends,
    });
  }
  return {
    kind: 'composite-structure',
    frameKeyword: 'class',
    title: model.title,
    nodes,
    edges,
    assemblies: [],
    directions: ['RIGHT', 'DOWN'],
    // A note on a role points at its collaboration's ellipse (roles are laid out inside it).
    anchors: model.elements.flatMap(e =>
      e.type === 'note' ? [...new Set((e.attachedTo ?? []).map(target => roleOwner.get(target) ?? target))].map(target => ({ note: e.id, target })) : [],
    ),
  };
}
