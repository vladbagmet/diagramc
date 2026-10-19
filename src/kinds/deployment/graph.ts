import { BODY_STYLE, headerLines, type StructEdge, type StructGraph, type StructNode } from '../structure/graph.js';
import type { DeploymentDiagram, Element, Property } from './model.js';

const NODE_KEYWORD = { node: undefined, device: 'device', executionEnvironment: 'executionEnvironment' } as const;

/** `name : type = value` (UML 2.5.1 19.4.4, deployment specification properties). */
export function formatProperty(p: Property): string {
  return `${p.name}${p.type !== undefined ? ` : ${p.type}` : ''}${p.value !== undefined ? ` = ${p.value}` : ''}`;
}

/** Maps a validated deployment diagram to the shared structure graph. */
export function deploymentGraph(model: DeploymentDiagram): StructGraph {
  const node = (e: Element): StructNode => {
    switch (e.type) {
      case 'node': case 'device': case 'executionEnvironment':
        return {
          id: e.id, type: e.type, shape: 'node3d',
          header: headerLines({ keyword: NODE_KEYWORD[e.type], stereotypes: e.stereotypes, name: e.name }),
          children: (e.elements ?? []).map(node),
        };
      case 'artifact':
        return { id: e.id, type: 'artifact', shape: 'box', icon: 'artifact', header: headerLines({ keyword: 'artifact', stereotypes: e.stereotypes, name: e.name }) };
      case 'deploymentSpecification':
        return {
          id: e.id, type: 'deploymentSpecification', shape: 'box', icon: 'artifact',
          header: headerLines({ keyword: 'deployment spec', name: e.name }),
          ...(e.properties?.length ? { compartments: [e.properties.map(p => ({ text: formatProperty(p), style: BODY_STYLE, align: 'left' as const }))] } : {}),
        };
      case 'component':
        return { id: e.id, type: 'component', shape: 'box', icon: 'component', header: headerLines({ keyword: 'component', stereotypes: e.stereotypes, name: e.name }) };
      case 'note':
        return { id: e.id, type: 'note', shape: 'note', header: [], noteText: e.text };
    }
  };
  const edges: StructEdge[] = (model.relationships ?? []).map((r, i) => {
    const base = { id: r.id ?? `relationships/${i}`, type: r.type, source: r.from, target: r.to };
    switch (r.type) {
      case 'communicationPath': {
        const ends: NonNullable<StructEdge['ends']> = [];
        if (r.fromEnd?.multiplicity !== undefined) ends.push({ end: 'source', text: r.fromEnd.multiplicity, kind: 'multiplicity' });
        if (r.toEnd?.multiplicity !== undefined) ends.push({ end: 'target', text: r.toEnd.multiplicity, kind: 'multiplicity' });
        return { ...base, style: 'solid', sourceMarker: 'none', targetMarker: 'none', ...(r.protocol !== undefined ? { keyword: r.protocol } : {}), ...(r.name !== undefined ? { name: r.name } : {}), ends };
      }
      case 'deploy': return { ...base, style: 'dashed', sourceMarker: 'none', targetMarker: 'open-arrow', keyword: 'deploy' };
      case 'manifest': return { ...base, style: 'dashed', sourceMarker: 'none', targetMarker: 'open-arrow', keyword: 'manifest' };
      case 'dependency': return { ...base, style: 'dashed', sourceMarker: 'none', targetMarker: 'open-arrow', ...(r.keyword !== undefined ? { keyword: r.keyword } : {}), ...(r.name !== undefined ? { name: r.name } : {}) };
    }
  });
  return {
    kind: 'deployment', frameKeyword: 'dep', title: model.title,
    nodes: model.elements.map(node), edges, assemblies: [],
    anchors: model.elements.flatMap(e => e.type === 'note' ? (e.attachedTo ?? []).map(target => ({ note: e.id, target })) : []),
  };
}
