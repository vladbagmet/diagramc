import { theme } from '../../core/theme.js';
import { layout, type LayoutEdge, type LayoutNode, type LayoutPort, type LayoutResult } from '../../engine/elk.js';
import type { FontMetrics, TextStyle } from '../../engine/fonts.js';
import { union, type Point, type Rect } from '../../engine/geometry.js';
import { placeLabels, type LabelRequest } from '../../engine/labels.js';
import { measureFrameHeading } from '../../engine/shapes.js';
import { wrapText } from '../../engine/text.js';
import { layoutFragment, type FragmentLayout } from './fragment.js';
import { isInline, isUse, type InteractionOverviewDiagram, type OverviewNode } from './model.js';

/**
 * Layout of an interaction overview diagram: ELK Layered, top-down, orthogonal
 * routing, like an activity diagram. Control nodes get fixed ports where the
 * shape meets its bounding box (the bottom of the initial dot, the top of the
 * final circles, the four vertices of a diamond), so flows end on the drawn
 * outline. Diamond ports are chosen in a second pass from where the first pass
 * put the neighbours (straight down when aligned, left and right otherwise).
 */

export const NAME: TextStyle = { size: theme.font.size.name };
export const GUARD: TextStyle = { size: theme.font.size.label };
export const SIZE = {
  initial: 22, final: 26, diamond: 32, barHeight: 6,
};
const REF_PAD_Y = 10, REF_PAD_X = 24, MIN_REF = 150, MAX_REF_NAME = 260;

export interface OverviewSceneNode {
  node: OverviewNode;
  bounds: Rect;
  /** Interaction use: wrapped name rows. */
  rows?: string[];
  widths?: number[];
  headingHeight?: number;
  fragment?: FragmentLayout;
}
export interface OverviewScene {
  width: number;
  height: number;
  frame?: { bounds: Rect; title: string };
  nodes: OverviewSceneNode[];
  edges: { id: string; source: string; target: string; points: Point[] }[];
  labels: { id: string; owner: string; rect: Rect; text: string; end: 'source' | 'target'; anchor: Point }[];
}

/** Heading text of the diagram frame: title and the optional lifelines list. */
export function frameName(model: InteractionOverviewDiagram): string | undefined {
  const parts = [model.title, model.lifelines && `lifelines ${model.lifelines.join(', ')}`].filter((p): p is string => !!p);
  return parts.length ? parts.join(' ') : undefined;
}

type Vertex = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';

export async function layoutInteractionOverview(model: InteractionOverviewDiagram, metrics: FontMetrics): Promise<OverviewScene> {
  const lh = metrics.lineHeight(NAME.size), guardHeight = metrics.lineHeight(GUARD.size);
  const flows = (model.flows ?? []).map((f, i) => ({ ...f, id: f.id ?? `flows/${i}` }));
  const nodeById = new Map(model.nodes.map(n => [n.id, n]));
  const ins = (id: string) => flows.filter(f => f.to === id), outs = (id: string) => flows.filter(f => f.from === id);

  // Loop-back flows: edges to a node on the depth-first stack from the initial
  // node. ELK gets them reversed, so its layering follows the flow and loops
  // come back up beside it instead of turning the diagram upside down.
  const back = new Set<string>();
  {
    const state = new Map<string, 'active' | 'done'>();
    const visit = (id: string): void => {
      state.set(id, 'active');
      for (const f of outs(id)) {
        const s = state.get(f.to);
        if (s === 'active') back.add(f.id);
        else if (s === undefined) visit(f.to);
      }
      state.set(id, 'done');
    };
    for (const n of model.nodes) if (n.type === 'initial' && !state.has(n.id)) visit(n.id);
    for (const n of model.nodes) if (!state.has(n.id)) visit(n.id);
  }

  // Sizes.
  const measured = new Map<string, OverviewSceneNode & { width: number; height: number }>();
  for (const n of model.nodes) {
    let width: number, height: number;
    const entry: OverviewSceneNode = { node: n, bounds: { x: 0, y: 0, width: 0, height: 0 } };
    if (isUse(n)) {
      const heading = measureFrameHeading(metrics, 'ref', '');
      const text = `${n.name}${n.arguments === undefined ? '' : `(${n.arguments.join(', ')})`}`;
      const rows = wrapText(metrics, text, NAME, MAX_REF_NAME);
      const widths = rows.map(r => Math.ceil(metrics.measure(r.trimEnd(), NAME)));
      width = Math.max(MIN_REF, Math.max(...widths) + 2 * REF_PAD_X, heading.width + 24);
      height = heading.height + rows.length * lh + REF_PAD_Y + 6;
      Object.assign(entry, { rows, widths, headingHeight: heading.height });
    } else if (isInline(n)) {
      const fragment = layoutFragment(metrics, n);
      ({ width, height } = fragment);
      entry.fragment = fragment;
    } else {
      switch (n.type) {
        case 'initial': width = height = SIZE.initial; break;
        case 'final': case 'flow-final': width = height = SIZE.final; break;
        case 'decision': case 'merge': width = height = SIZE.diamond; break;
        default: width = Math.max(72, 44 * Math.max(ins(n.id).length, outs(n.id).length)); height = SIZE.barHeight;
      }
    }
    measured.set(n.id, { ...entry, width, height });
  }

  const ports = (n: OverviewNode, vertices?: Map<string, Vertex>): LayoutPort[] => {
    const m = measured.get(n.id)!;
    const at = (v: Vertex): Point => v === 'NORTH' ? { x: m.width / 2, y: 0 } : v === 'SOUTH' ? { x: m.width / 2, y: m.height } : v === 'WEST' ? { x: 0, y: m.height / 2 } : { x: m.width, y: m.height / 2 };
    switch (n.type) {
      case 'initial': return [{ id: `${n.id}::SOUTH`, side: 'SOUTH', position: at('SOUTH') }];
      case 'final': case 'flow-final': return [{ id: `${n.id}::NORTH`, side: 'NORTH', position: at('NORTH') }];
      case 'decision': case 'merge':
        if (!vertices) return [];
        return [...new Set([...vertices.entries()].filter(([key]) => key.startsWith(`${n.id}\u0000`)).map(([, v]) => v))]
          .map(v => ({ id: `${n.id}::${v}`, side: v, position: at(v) }));
      case 'fork': case 'join':
        return [...ins(n.id).map(f => ({ id: `${f.id}::in`, side: 'NORTH' as const })), ...outs(n.id).map(f => ({ id: `${f.id}::out`, side: 'SOUTH' as const }))];
      default: return [];
    }
  };
  const run = (vertices?: Map<string, Vertex>): Promise<LayoutResult> => {
    const nodes: LayoutNode[] = model.nodes.map(n => {
      const m = measured.get(n.id)!, p = ports(n, vertices);
      return { id: n.id, width: m.width, height: m.height, ...(p.length ? { ports: p } : {}) };
    });
    const end = (f: typeof flows[number], which: 'from' | 'to'): string => {
      const id = f[which], n = nodeById.get(id)!;
      switch (n.type) {
        case 'initial': return `${id}::SOUTH`;
        case 'final': case 'flow-final': return `${id}::NORTH`;
        case 'fork': case 'join': return `${f.id}::${which === 'from' ? 'out' : 'in'}`;
        case 'decision': case 'merge': {
          const v = vertices?.get(`${id}\u0000${f.id}`);
          return v ? `${id}::${v}` : id;
        }
        default: return id;
      }
    };
    const edges: LayoutEdge[] = flows.map(f => ({
      id: f.id, source: back.has(f.id) ? end(f, 'to') : end(f, 'from'), target: back.has(f.id) ? end(f, 'from') : end(f, 'to'),
      ...(f.guard !== undefined ? { labels: [{ id: `${f.id}::guard`, width: Math.ceil(metrics.measure(`[${f.guard}]`, GUARD)) + 4, height: guardHeight, placement: back.has(f.id) ? 'head' as const : 'tail' as const }] } : {}),
    }));
    return layout(nodes, edges, { direction: 'DOWN' });
  };

  // Pass 1 without diamond ports; then choose diamond vertices from where the
  // previous pass put the neighbours, and repeat until the choice is stable.
  const assign = (previous: LayoutResult): Map<string, Vertex> => {
    const vertices = new Map<string, Vertex>();
    const center = (id: string): Point => { const r = previous.nodes.get(id)!; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    for (const n of model.nodes) {
      if (n.type !== 'decision' && n.type !== 'merge') continue;
      const c = center(n.id);
      const fanIn = n.type === 'merge';
      const many = (fanIn ? ins(n.id) : outs(n.id)).map(f => ({ f, p: center(fanIn ? f.from : f.to) }));
      for (const f of fanIn ? outs(n.id) : ins(n.id)) vertices.set(`${n.id}\u0000${f.id}`, fanIn ? 'SOUTH' : 'NORTH');
      // Loops (back flows) run on the east side, leaving the decision and entering
      // the merge there, so they never cross the main flow. Other branches,
      // ordered left to right, get distinct vertices where possible, so every
      // guard sits on its own line: one goes straight (down from a decision, up
      // into a merge), the leftmost west, the rightmost east.
      const straight: Vertex = fanIn ? 'NORTH' : 'SOUTH';
      const set = (f: { id: string }, v: Vertex) => vertices.set(`${n.id}\u0000${f.id}`, v);
      const loops = many.filter(({ f }) => back.has(f.id));
      for (const { f } of loops) set(f, 'EAST');
      const available: Vertex[] = loops.length ? ['WEST', straight] : ['WEST', straight, 'EAST'];
      const sorted = many.filter(({ f }) => !back.has(f.id)).sort((x, y) => x.p.x - y.p.x || many.indexOf(x) - many.indexOf(y));
      const aligned = [...sorted].sort((x, y) => Math.abs(x.p.x - c.x) - Math.abs(y.p.x - c.x))[0];
      if (sorted.length === 1) set(sorted[0]!.f, straight);
      else if (sorted.length === available.length) sorted.forEach(({ f }, k) => set(f, available[k]!));
      else if (sorted.length === 2) {
        // Three vertices for two branches: straight for an aligned one, else west and east.
        if (aligned && Math.abs(aligned.p.x - c.x) < 40) {
          const other = sorted.find(o => o !== aligned)!;
          set(aligned.f, straight);
          set(other.f, other.p.x < c.x ? 'WEST' : 'EAST');
        } else { set(sorted[0]!.f, 'WEST'); set(sorted[1]!.f, 'EAST'); }
      } else {
        // More branches than vertices: the middle ones share the straight vertex.
        sorted.forEach(({ f }, k) => set(f, k === 0 ? 'WEST' : k === sorted.length - 1 && available.includes('EAST') ? 'EAST' : straight));
      }
    }
    return vertices;
  };
  let result = await run();
  let vertices = assign(result);
  // `result` is always the layout of `vertices`.
  result = await run(vertices);
  for (let pass = 0; pass < 3; pass++) {
    const next = assign(result);
    if ([...next].every(([k, v]) => vertices.get(k) === v)) break;
    vertices = next;
    result = await run(vertices);
  }

  // Guards next to the start of their flow.
  const rects = new Map(model.nodes.map(n => [n.id, result.nodes.get(n.id)!]));
  const routes = new Map(flows.map(f => {
    const points = result.edges.get(f.id)!.points;
    return [f.id, back.has(f.id) ? [...points].reverse() : points];
  }));
  const requests: LabelRequest[] = [];
  const guards = new Map<string, { owner: string; text: string; end: 'source' | 'target'; anchor: Point }>();
  for (const f of flows) {
    if (f.guard === undefined) continue;
    const id = `${f.id}::guard`, text = `[${f.guard}]`;
    const width = Math.ceil(metrics.measure(text, GUARD));
    const route = routes.get(f.id)!;
    const suggested = result.edges.get(f.id)!.labels.get(id);
    // A guard belongs next to the decision, unless several branches leave the
    // same vertex: then it goes next to the branch's target, where it is unique.
    const vertex = vertices.get(`${f.from}\u0000${f.id}`);
    const shared = vertex !== undefined && flows.some(g => g !== f && g.from === f.from && vertices.get(`${g.from}\u0000${g.id}`) === vertex);
    const at = shared ? 'target' as const : 'source' as const;
    requests.push({ id, width, height: guardHeight, route, at, side: 1, clearance: shared ? theme.size.arrow.halfWidth + 3 : 4, ...(shared ? {} : { suggestion: suggested && { x: suggested.x + 2, y: suggested.y, width, height: guardHeight } }) });
    guards.set(id, { owner: f.id, text, end: at, anchor: at === 'source' ? route[0]! : route.at(-1)! });
  }
  const segments: [Point, Point][] = [];
  const markerBoxes: Rect[] = [];
  for (const route of routes.values()) {
    route.slice(1).forEach((p, k) => segments.push([route[k]!, p]));
    const tip = route.at(-1)!, half = theme.size.arrow.halfWidth + 2;
    markerBoxes.push({ x: tip.x - half - 4, y: tip.y - half - 4, width: 2 * half + 8, height: 2 * half + 8 });
  }
  const placed = placeLabels(requests, { rects: [...rects.values(), ...markerBoxes], segments, ends: [...guards.values()].map(g => g.anchor) });
  const labels = [...placed].map(([id, rect]) => ({ id, rect, ...guards.get(id)! }));

  // Translate into the canvas (inside the frame, if any).
  const content = union([...rects.values(), ...labels.map(l => l.rect), ...[...routes.values()].flatMap(r => r.map(p => ({ ...p, width: 0, height: 0 })))]);
  const margin = theme.spacing.canvas, pad = theme.spacing.frame;
  const title = frameName(model);
  const heading = title === undefined ? undefined : measureFrameHeading(metrics, 'sd', title);
  const originX = margin + (heading ? pad : 0), originY = margin + (heading ? heading.height + pad : 0);
  const dx = originX - content.x, dy = originY - content.y;
  const mr = (r: Rect): Rect => ({ x: r.x + dx, y: r.y + dy, width: r.width, height: r.height });
  const mp = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  let width = originX + content.width + (heading ? pad : 0);
  const height = originY + content.height + (heading ? pad : 0);
  let frame: OverviewScene['frame'];
  if (heading) {
    const frameWidth = Math.max(width - margin, heading.width + pad);
    frame = { bounds: { x: margin, y: margin, width: frameWidth, height: height - margin }, title: title! };
    width = margin + frameWidth;
  }
  return {
    width: width + margin, height: height + margin, ...(frame ? { frame } : {}),
    nodes: model.nodes.map(n => {
      const { width: _w, height: _h, ...entry } = measured.get(n.id)!;
      return { ...entry, bounds: mr(rects.get(n.id)!) };
    }),
    edges: flows.map(f => ({ id: f.id, source: f.from, target: f.to, points: routes.get(f.id)!.map(mp) })),
    labels: labels.map(l => ({ ...l, rect: mr(l.rect), anchor: mp(l.anchor) })),
  };
}
