import ElkModule from 'elkjs/lib/elk.bundled.js';
import type { ELK as ElkApi, ElkNode } from 'elkjs/lib/elk-api.js';
import type { Point } from './geometry.js';

/**
 * Balanced placement for graphs that have no natural direction (communication
 * diagrams, object graphs): ELK Stress (stress majorization, pinned elkjs 0.11.1).
 * It places nodes so that the drawn distance between linked nodes approaches a
 * desired length, which spreads cycles and stars evenly instead of stacking them
 * into layers. Deterministic: ELK Stress starts from a fixed seed.
 *
 * Returns node centers only; edges are routed by the caller (straight lines,
 * usually after snapping the centers to a grid).
 */

export interface StressNode { id: string; width: number; height: number }
export interface StressEdge { source: string; target: string; /** Desired length of this edge (px). */ length?: number }

const ElkConstructor = ((ElkModule as unknown as { default?: unknown }).default ?? ElkModule) as new () => ElkApi;
let elk: ElkApi | undefined;

export async function stressCenters(nodes: readonly StressNode[], edges: readonly StressEdge[], options: { edgeLength: number; iterations?: number }): Promise<Map<string, Point>> {
  elk ??= new ElkConstructor();
  const graph: ElkNode = {
    id: '::root',
    layoutOptions: {
      'elk.algorithm': 'stress',
      'elk.stress.desiredEdgeLength': String(options.edgeLength),
      'elk.stress.iterationLimit': String(options.iterations ?? 300),
      'elk.randomSeed': '1',
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
    },
    children: nodes.map(n => ({ id: n.id, width: n.width, height: n.height })),
    edges: edges.map((e, i) => ({
      id: `::e${i}`, sources: [e.source], targets: [e.target],
      ...(e.length ? { layoutOptions: { 'elk.stress.desiredEdgeLength': String(e.length) } } : {}),
    })),
  };
  const result = await elk.layout(graph);
  const centers = new Map<string, Point>();
  for (const child of result.children ?? []) {
    centers.set(child.id, { x: (child.x ?? 0) + (child.width ?? 0) / 2, y: (child.y ?? 0) + (child.height ?? 0) / 2 });
  }
  return centers;
}
