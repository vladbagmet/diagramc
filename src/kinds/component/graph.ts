import { formatOperation } from '../class/format.js';
import { BODY_STYLE, headerLines, type StructEdge, type StructGraph, type StructNode, type StructPort, type StructStub } from '../structure/graph.js';
import type { ComponentDiagram, Element, Interface, Nested, Port } from './model.js';

/** Port label: `name`, `name : Type` or `: Type`. */
export function portLabel(port: { name?: string; type?: string }): string | undefined {
  if (port.name !== undefined && port.type !== undefined) return `${port.name} : ${port.type}`;
  if (port.type !== undefined) return `: ${port.type}`;
  return port.name;
}

/** Maps a validated component diagram to the shared structure graph. */
export function componentGraph(model: ComponentDiagram): StructGraph {
  const relationships = model.relationships ?? [];
  const interfaces = new Map<string, Interface>();
  for (const e of model.elements) if (e.type === 'interface') interfaces.set(e.id, e);
  const name = (id: string): string => interfaces.get(id)?.name ?? id;

  // Interfaces an assembly already draws as a joint get no separate lollipop or socket.
  const joined = new Set<string>();
  for (const r of relationships) {
    if (r.type !== 'assembly') continue;
    joined.add(`${r.from}\u0000requires\u0000${r.interface}`);
    joined.add(`${r.to}\u0000provides\u0000${r.interface}`);
  }
  // A delegation passes an interface through: draw it once, at the outer end.
  const parentOf = new Map<string, string>(), portOf = new Map<string, string>();
  const walk = (e: Element | Nested, parent: string | undefined): void => {
    if (parent !== undefined) parentOf.set(e.id, parent);
    if (e.type === 'component' || e.type === 'class') for (const p of e.ports ?? []) portOf.set(p.id, e.id);
    if (e.type === 'component') for (const c of e.elements ?? []) walk(c, e.id);
  };
  model.elements.forEach(e => walk(e, undefined));
  const values = new Map<string, { provides?: string[]; requires?: string[] }>();
  const collectValues = (e: Element | Nested): void => {
    if (e.type !== 'component' && e.type !== 'class') return;
    values.set(e.id, e);
    for (const p of e.ports ?? []) values.set(p.id, p);
    if (e.type === 'component') (e.elements ?? []).forEach(collectValues);
  };
  model.elements.forEach(collectValues);
  for (const r of relationships) {
    if (r.type !== 'delegation') continue;
    const owner = (id: string) => portOf.get(id) ?? id;
    const inner = parentOf.get(owner(r.to)) === owner(r.from) ? r.to : r.from;
    const outer = inner === r.to ? r.from : r.to;
    for (const which of ['provides', 'requires'] as const) {
      for (const id of values.get(inner)?.[which] ?? []) if (values.get(outer)?.[which]?.includes(id)) joined.add(`${inner}\u0000${which}\u0000${id}`);
    }
  }
  const stubs = (owner: string, value: { provides?: string[]; requires?: string[] }): StructStub[] => {
    const out: StructStub[] = [];
    for (const which of ['provides', 'requires'] as const) {
      for (const id of value[which] ?? []) {
        if (joined.has(`${owner}\u0000${which}\u0000${id}`)) continue;
        out.push({ id: `${owner}::${which}::${id}`, kind: which === 'provides' ? 'provided' : 'required', name: name(id) });
      }
    }
    return out;
  };
  const ports = (ps: readonly Port[] | undefined): StructPort[] => (ps ?? []).map(p => {
    const label = portLabel(p);
    return { id: p.id, ...(label !== undefined ? { label } : {}), stubs: stubs(p.id, p) };
  });

  // Interfaces are boxes when a relationship touches them or nothing provides or requires them.
  const referenced = new Set<string>();
  const collect = (e: Element | Nested): void => {
    if (e.type !== 'component' && e.type !== 'class') return;
    for (const v of [e, ...(e.ports ?? [])]) for (const id of [...v.provides ?? [], ...v.requires ?? []]) referenced.add(id);
    if (e.type === 'component') (e.elements ?? []).forEach(collect);
  };
  model.elements.forEach(collect);
  const touched = new Set(relationships.flatMap(r => r.type === 'assembly' || r.type === 'delegation' ? [] : [r.from, r.to]));
  for (const e of model.elements) if (e.type === 'note') for (const id of e.attachedTo ?? []) touched.add(id);

  const node = (e: Element | Nested): StructNode | undefined => {
    switch (e.type) {
      case 'component':
        return {
          id: e.id, type: 'component', shape: 'box', icon: 'component',
          header: headerLines({ keyword: 'component', stereotypes: e.stereotypes, name: e.name }),
          ports: ports(e.ports), stubs: stubs(e.id, e),
          children: (e.elements ?? []).map(child => node(child)!),
        };
      case 'class':
        return { id: e.id, type: 'class', shape: 'box', header: headerLines({ stereotypes: e.stereotypes, name: e.name }), ports: ports(e.ports), stubs: stubs(e.id, e) };
      case 'interface':
        if (referenced.has(e.id) && !touched.has(e.id)) return undefined;
        return {
          id: e.id, type: 'interface', shape: 'box',
          header: headerLines({ keyword: 'interface', stereotypes: e.stereotypes, name: e.name }),
          ...(e.operations?.length ? { compartments: [e.operations.map(o => ({ text: formatOperation(o), style: { ...BODY_STYLE, italic: !!o.abstract }, align: 'left' as const, underline: !!o.static }))] } : {}),
        };
      case 'artifact':
        return { id: e.id, type: 'artifact', shape: 'box', icon: 'artifact', header: headerLines({ keyword: 'artifact', stereotypes: e.stereotypes, name: e.name }) };
      case 'note':
        return { id: e.id, type: 'note', shape: 'note', header: [], noteText: e.text };
    }
  };

  const edges: StructEdge[] = [];
  const assemblies: StructGraph['assemblies'] = [];
  relationships.forEach((r, i) => {
    const id = r.id ?? `relationships/${i}`;
    const base = { id, type: r.type, source: r.from, target: r.to };
    switch (r.type) {
      case 'assembly': assemblies.push({ id, requirer: r.from, provider: r.to, name: name(r.interface) }); break;
      case 'delegation': edges.push({ ...base, style: 'solid', sourceMarker: 'none', targetMarker: 'open-arrow', keyword: 'delegate', ...(r.name !== undefined ? { name: r.name } : {}) }); break;
      case 'realization': edges.push({ ...base, style: 'dashed', sourceMarker: 'none', targetMarker: 'hollow-triangle' }); break;
      case 'usage': edges.push({ ...base, style: 'dashed', sourceMarker: 'none', targetMarker: 'open-arrow', keyword: 'use' }); break;
      case 'manifest': edges.push({ ...base, style: 'dashed', sourceMarker: 'none', targetMarker: 'open-arrow', keyword: 'manifest' }); break;
      case 'dependency': edges.push({ ...base, style: 'dashed', sourceMarker: 'none', targetMarker: 'open-arrow', ...(r.keyword !== undefined ? { keyword: r.keyword } : {}), ...(r.name !== undefined ? { name: r.name } : {}) }); break;
    }
  });

  return {
    kind: 'component', frameKeyword: 'cmp', title: model.title, directions: ['RIGHT', 'DOWN'],
    nodes: model.elements.flatMap(e => node(e) ?? []),
    edges, assemblies,
    anchors: model.elements.flatMap(e => e.type === 'note' ? (e.attachedTo ?? []).map(target => ({ note: e.id, target })) : []),
  };
}
