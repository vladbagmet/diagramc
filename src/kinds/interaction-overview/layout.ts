import { theme } from '../../core/theme.js';
import { countCrossings, routesLength } from '../../engine/aspect.js';
import { layout, type LayoutEdge, type LayoutNode, type LayoutPort, type LayoutResult } from '../../engine/elk.js';
import type { FontMetrics, TextStyle } from '../../engine/fonts.js';
import { inflate, segmentIntersectsRect, simplify, straightenJogs, union, type Point, type Rect } from '../../engine/geometry.js';
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
/** Interactions wider than this take the flows of a loop near their east edge, SPINE_INSET from it. */
const WIDE = 360, SPINE_INSET = 48;
/** Length of the trunk branches that share a decision vertex run on together. */
const SPLIT = 14;

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
  /** Guards; those at the start of a branch's own line (after a shared trunk) have no end. */
  labels: { id: string; owner: string; rect: Rect; text: string; end?: 'source' | 'target'; anchor?: Point }[];
}

/** Heading text of the diagram frame: title and the optional lifelines list. */
export function frameName(model: InteractionOverviewDiagram): string | undefined {
  // An entry without a colon names the lifeline's type: drawn ":Type", as in the UML heading "lifelines :User, :Shop".
  const lifeline = (l: string): string => l.includes(':') ? l : `:${l}`;
  const parts = [model.title, model.lifelines && `lifelines ${model.lifelines.map(lifeline).join(', ')}`].filter((p): p is string => !!p);
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

  // Loop-backs leave an interaction (ref or sd frame) from its east side, never
  // through its top border into the flow that enters it.
  const loopOut = (n: OverviewNode): typeof flows => (isUse(n) || isInline(n)) ? outs(n.id).filter(f => back.has(f.id)) : [];
  // A wide interaction inside a loop takes its flows near its east edge, so the
  // spine of the loop (merge, decision) sits there and the loop-back beside it
  // stays short instead of running around the whole frame.
  const onLoop = new Set<string>();
  for (const b of flows.filter(f => back.has(f.id))) {
    const forward = (id: string) => outs(id).filter(f => !back.has(f.id)).map(f => f.to);
    const backward = (id: string) => ins(id).filter(f => !back.has(f.id)).map(f => f.from);
    const reach = (start: string, next: (id: string) => string[]): Set<string> => {
      const seen = new Set([start]), stack = [start];
      while (stack.length) for (const t of next(stack.pop()!)) if (!seen.has(t)) { seen.add(t); stack.push(t); }
      return seen;
    };
    const from = reach(b.to, forward), to = reach(b.from, backward);
    for (const id of from) if (to.has(id)) onLoop.add(id);
  }
  const eastSpine = (n: OverviewNode): number | undefined => {
    const m = measured.get(n.id)!;
    return (isUse(n) || isInline(n)) && onLoop.has(n.id) && m.width > WIDE ? m.width - SPINE_INSET : undefined;
  };
  const ports = (n: OverviewNode, vertices?: Map<string, Vertex>): LayoutPort[] => {
    const m = measured.get(n.id)!;
    if (isUse(n) || isInline(n)) {
      const spine = eastSpine(n), loops = loopOut(n);
      const east = loops.map(f => ({ id: `${f.id}::loop`, side: 'EAST' as const, ...(spine !== undefined ? { position: { x: m.width, y: m.height / 2 } } : {}) }));
      if (spine === undefined) return east;
      return [{ id: `${n.id}::in`, side: 'NORTH', position: { x: spine, y: 0 } }, { id: `${n.id}::out`, side: 'SOUTH', position: { x: spine, y: m.height } }, ...east];
    }
    const at = (v: Vertex): Point => v === 'NORTH' ? { x: m.width / 2, y: 0 } : v === 'SOUTH' ? { x: m.width / 2, y: m.height } : v === 'WEST' ? { x: 0, y: m.height / 2 } : { x: m.width, y: m.height / 2 };
    switch (n.type) {
      case 'initial': return [{ id: `${n.id}::SOUTH`, side: 'SOUTH', position: at('SOUTH') }];
      case 'final': case 'flow-final': {
        // Several flows into a final node arrive at different vertices (see assign), never on one shared segment.
        const used = vertices ? [...new Set([...vertices.entries()].filter(([key]) => key.startsWith(`${n.id}\u0000`)).map(([, v]) => v))] : [];
        return (used.length ? used : ['NORTH' as const]).map(v => ({ id: `${n.id}::${v}`, side: v, position: at(v) }));
      }
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
        case 'final': case 'flow-final': return `${id}::${vertices?.get(`${id}\u0000${f.id}`) ?? 'NORTH'}`;
        case 'fork': case 'join': return `${f.id}::${which === 'from' ? 'out' : 'in'}`;
        case 'decision': case 'merge': {
          const v = vertices?.get(`${id}\u0000${f.id}`);
          return v ? `${id}::${v}` : id;
        }
        default: {
          if (which === 'from' && back.has(f.id) && (isUse(n) || isInline(n))) return `${f.id}::loop`;
          return eastSpine(n) === undefined ? id : `${id}::${which === 'from' ? 'out' : 'in'}`;
        }
      }
    };
    const edges: LayoutEdge[] = flows.map(f => ({
      id: f.id, source: back.has(f.id) ? end(f, 'to') : end(f, 'from'), target: back.has(f.id) ? end(f, 'from') : end(f, 'to'),
      ...(f.guard !== undefined ? { labels: [{ id: `${f.id}::guard`, width: Math.ceil(metrics.measure(`[${f.guard}]`, GUARD)) + 4, height: guardHeight, placement: back.has(f.id) ? 'head' as const : 'tail' as const }] } : {}),
    }));
    return layout(nodes, edges, { direction: 'DOWN' });
  };

  /** Nodes reachable from `start` along forward (not loop-back) flows. */
  const reachable = (start: string): Set<string> => {
    const seen = new Set([start]), stack = [start];
    while (stack.length) for (const f of outs(stack.pop()!)) if (!back.has(f.id) && !seen.has(f.to)) { seen.add(f.to); stack.push(f.to); }
    return seen;
  };
  /** True when the forward path from `start` reaches a loop-back to a node at or above `decision`. */
  const loopsBack = (start: string, decision: string): boolean => {
    const ahead = reachable(start);
    return flows.some(f => back.has(f.id) && ahead.has(f.from) && reachable(f.to).has(decision));
  };
  // Pass 1 without diamond ports; then choose diamond vertices from where the
  // previous pass put the neighbours, and repeat until the choice is stable.
  const assign = (previous: LayoutResult): Map<string, Vertex> => {
    const vertices = new Map<string, Vertex>();
    const center = (id: string): Point => { const r = previous.nodes.get(id)!; return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
    for (const n of model.nodes) {
      const final = (n.type === 'final' || n.type === 'flow-final') && ins(n.id).length > 1;
      if (n.type !== 'decision' && n.type !== 'merge' && !final) continue;
      const c = center(n.id);
      const fanIn = n.type === 'merge' || final;
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
      // A branch whose path loops back (to a merge above) goes east, where loops
      // run: its loop then returns beside the other branches instead of across one.
      const looping = !fanIn && available.includes('EAST') && sorted.length >= 2 ? sorted.filter(({ f }) => loopsBack(f.to, n.id)) : [];
      if (looping.length === 1) {
        const rest = sorted.filter(o => o !== looping[0]);
        set(looping[0]!.f, 'EAST');
        if (rest.length === 1) set(rest[0]!.f, straight);
        else if (rest.length === 2) { set(rest[0]!.f, 'WEST'); set(rest[1]!.f, straight); }
        else rest.forEach(({ f }, k) => set(f, k === 0 ? 'WEST' : straight));
        continue;
      }
      if (sorted.length === 1) set(sorted[0]!.f, straight);
      else if (sorted.length === 3 && available.length === 3 && aligned && Math.abs(aligned.p.x - c.x) < 40) {
        // The branch to a node right below goes straight; the others west and east,
        // so none has to run around that node.
        const rest = sorted.filter(o => o !== aligned);
        set(aligned.f, straight); set(rest[0]!.f, 'WEST'); set(rest[1]!.f, 'EAST');
      } else if (sorted.length === available.length) sorted.forEach(({ f }, k) => set(f, available[k]!));
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
  // Every pass is a candidate; the one with the fewest crossings (then the
  // shortest lines) wins, since a later pass can trade one crossing for another.
  const quality = (r: LayoutResult): number => {
    const lines = flows.map(f => r.edges.get(f.id)!.points);
    return countCrossings(lines) * 1000 + routesLength(lines);
  };
  let result = await run();
  let vertices = assign(result);
  // `result` is always the layout of `vertices`.
  result = await run(vertices);
  let best = { result, vertices, score: quality(result) };
  for (let pass = 0; pass < 3; pass++) {
    const next = assign(result);
    if ([...next].every(([k, v]) => vertices.get(k) === v)) break;
    vertices = next;
    result = await run(vertices);
    const score = quality(result);
    if (score < best.score - 1e-6) best = { result, vertices, score };
  }
  ({ result, vertices } = best);

  const rects = new Map(model.nodes.map(n => [n.id, result.nodes.get(n.id)!]));
  const routes = new Map(flows.map(f => {
    const points = result.edges.get(f.id)!.points;
    return [f.id, back.has(f.id) ? [...points].reverse() : points];
  }));
  // Small jogs (under 8 px) become straight lines; ends slide only along the border
  // of an interaction, never off the fixed points of control nodes.
  const endRect = (id: string, p: Point): Rect => {
    const n = nodeById.get(id)!;
    return isUse(n) || isInline(n) ? rects.get(id)! : { x: p.x, y: p.y, width: 0, height: 0 };
  };
  for (const f of flows) {
    const r = routes.get(f.id)!;
    routes.set(f.id, straightenJogs(r, { source: endRect(f.from, r[0]!), target: endRect(f.to, r.at(-1)!) }));
  }
  const vectorOf = (v: Vertex): Point => v === 'SOUTH' ? { x: 0, y: 1 } : v === 'WEST' ? { x: -1, y: 0 } : v === 'EAST' ? { x: 1, y: 0 } : { x: 0, y: -1 };

  // Branches that leave a decision from one vertex split right below it (a short
  // trunk of SPLIT px), and each runs on its own line from there: ELK would let
  // them share long segments, so a reader could not tell which guard is whose.
  /** Where a branch's own line begins (its guard goes there) and its direction there. */
  const ownStart = new Map<string, { at: Point; d: Point; below?: boolean; corner?: Point; down?: Point }>();
  for (const n of model.nodes) {
    if (n.type !== 'decision') continue;
    const groups = new Map<Vertex, typeof flows>();
    for (const f of outs(n.id)) {
      if (back.has(f.id)) continue;
      const v = vertices.get(`${n.id}\u0000${f.id}`);
      if (v) groups.set(v, [...groups.get(v) ?? [], f]);
    }
    for (const [v, group] of groups) {
      if (group.length < 2) continue;
      const d = vectorOf(v), V = routes.get(group[0]!.id)![0]!;
      const along = (p: Point): number => (p.x - V.x) * d.x + (p.y - V.y) * d.y;
      const off = (p: Point): number => Math.abs((p.x - V.x) * d.y - (p.y - V.y) * d.x);
      const parallel = (a: Point, b: Point): boolean => Math.abs((b.x - a.x) * d.y - (b.y - a.y) * d.x) < 0.5 && (b.x - a.x) * d.x + (b.y - a.y) * d.y > 0.5;
      const bus = { x: V.x + d.x * SPLIT, y: V.y + d.y * SPLIT };
      const next = new Map<string, Point[]>(), starts = new Map<string, Point>(), sidewaysStart = new Map<string, { at: Point; d: Point; below: boolean; corner: Point; down: Point }>();
      // Branches turning to one side leave the trunk one below the other, the
      // farthest first, so each runs on its own line (no shared run sideways).
      const side = (p: Point): number => Math.sign((p.x - V.x) * d.y - (p.y - V.y) * d.x);
      // A vertex can send three lines apart: one straight on and one sideways to each
      // side. Branches turning to one side: the farthest leaves sideways right at the
      // vertex; one more may go straight on and turn after SPLIT px when no branch
      // continues straight. Further ones would share a line: then the group keeps
      // the trunk ELK gave it.
      const sideOf = new Map<string, number>(), depth = new Map<string, number>();
      let straightUsed = group.some(f => { const t = routes.get(f.id)![2]; return !t || side(t) === 0; });
      let fits = true;
      for (const sign of [-1, 1]) {
        const turning = group.filter(f => { const t = routes.get(f.id)![2]; return t && side(t) === sign; })
          .sort((x, y) => off(routes.get(y.id)![2]!) - off(routes.get(x.id)![2]!));
        turning.forEach((f, k) => {
          sideOf.set(f.id, sign);
          if (k === 0) depth.set(f.id, 0);
          else if (k === 1 && !straightUsed) { depth.set(f.id, SPLIT + guardHeight + 8); straightUsed = true; }
          else fits = false;
        });
      }
      if (!fits) continue;
      let ok = true, straight = 0;
      for (const f of group) {
        const r = routes.get(f.id)!;
        if (r.length < 2 || off(r[1]!) > 0.5 || along(r[1]!) < SPLIT + 0.5) { ok = false; break; }
        const turn = r[2], after = r[3];
        const own = depth.get(f.id);
        if (own !== undefined && turn && after && parallel(turn, after) && along(after) > own + 0.5) {
          const knee = { x: V.x + d.x * own, y: V.y + d.y * own };
          const corner = d.x === 0 ? { x: turn.x, y: knee.y } : { x: knee.x, y: turn.y };
          const route = own === 0 ? [V, corner, ...r.slice(3)] : [V, knee, corner, ...r.slice(3)];
          const last = route.length - 2;
          const blocked = route.slice(1).some((q, k) => [...rects].some(([id, rect]) =>
            id !== n.id && !(id === f.to && k === last) && segmentIntersectsRect(route[k]!, q, inflate(rect, 2))));
          if (blocked) { ok = false; break; }
          next.set(f.id, route);
          // A branch leaving sideways has its guard beside the vertex, above its line.
          const sign = sideOf.get(f.id)!, sideways = { x: d.y * sign, y: -d.x * sign };
          // Its guard goes below its line when the side vertex above it has a line of its own.
          const sideVertex: Vertex = sideways.x < 0 ? 'WEST' : sideways.x > 0 ? 'EAST' : sideways.y < 0 ? 'NORTH' : 'SOUTH';
          const below = outs(n.id).some(o => o.id !== f.id && vertices.get(`${n.id}\u0000${o.id}`) === sideVertex) || ins(n.id).some(o => vertices.get(`${n.id}\u0000${o.id}`) === sideVertex);
          if (own === 0) sidewaysStart.set(f.id, { at: V, d: sideways, below, corner, down: d });
          else starts.set(f.id, corner);
        } else {
          straight++;
          starts.set(f.id, bus);
        }
      }
      if (!ok || straight > 1) continue;
      for (const [id, route] of next) routes.set(id, simplify(route));
      for (const [id, at] of starts) ownStart.set(id, { at, d });
      for (const [id, own] of sidewaysStart) ownStart.set(id, own);
    }
  }

  // Guards: next to the start of their flow, always on the same side (right of a
  // line going down, above a line going sideways); a branch that shares its
  // vertex gets its guard where its own line begins.
  const requests: LabelRequest[] = [];
  const guards = new Map<string, { owner: string; text: string; end?: 'source' | 'target'; anchor?: Point }>();
  const beside = (at: Point, d: Point, width: number, gap: number): Rect[] => {
    const out: Rect[] = [];
    for (const shift of [0, 6, 14]) {
      if (d.x === 0) {
        const y = d.y > 0 ? at.y + gap + shift : at.y - gap - shift - guardHeight;
        out.push({ x: at.x + 4, y, width, height: guardHeight }, { x: at.x - 4 - width, y, width, height: guardHeight });
      } else {
        const x = d.x > 0 ? at.x + gap + shift : at.x - gap - shift - width;
        out.push({ x, y: at.y - 3 - guardHeight, width, height: guardHeight }, { x, y: at.y + 3, width, height: guardHeight });
      }
    }
    return out;
  };
  for (const f of flows) {
    if (f.guard === undefined) continue;
    const id = `${f.id}::guard`, text = `[${f.guard}]`;
    const width = Math.ceil(metrics.measure(text, GUARD));
    const route = routes.get(f.id)!;
    const own = ownStart.get(f.id);
    if (own) {
      // A branch leaving sideways at a vertex keeps its guard clear of the line going straight on from it.
      const near = beside(own.at, own.d, width, own.below === undefined ? 4 : 14);
      // Failing those (a short sideways run), beside the line where it turns on.
      const turnSpots = own.corner && own.down ? beside(own.corner, own.down, width, 4) : [];
      const candidates = [...(own.below ? [...near.filter(r => r.y >= own.at.y), ...near.filter(r => r.y < own.at.y)] : near), ...turnSpots];
      requests.push({ id, owner: f.id, width, height: guardHeight, route, at: 'center', candidates });
      guards.set(id, { owner: f.id, text });
      continue;
    }
    const vertex = vertices.get(`${f.from}\u0000${f.id}`);
    const candidates = vertex ? beside(route[0]!, vectorOf(vertex), width, 4) : undefined;
    const suggested = result.edges.get(f.id)!.labels.get(id);
    requests.push({ id, width, height: guardHeight, route, at: 'source', side: 1, clearance: 4, ...(candidates ? { candidates } : { suggestion: suggested && { x: suggested.x + 2, y: suggested.y, width, height: guardHeight } }) });
    guards.set(id, { owner: f.id, text, end: 'source', anchor: route[0]! });
  }
  const segments: [Point, Point][] = [];
  const markerBoxes: Rect[] = [];
  for (const route of routes.values()) {
    route.slice(1).forEach((p, k) => segments.push([route[k]!, p]));
    const tip = route.at(-1)!, half = theme.size.arrow.halfWidth + 2;
    markerBoxes.push({ x: tip.x - half - 4, y: tip.y - half - 4, width: 2 * half + 8, height: 2 * half + 8 });
  }
  const placed = placeLabels(requests, {
    rects: [...rects.values(), ...markerBoxes], segments, ends: [...guards.values()].flatMap(g => g.anchor ? [g.anchor] : []),
    lines: flows.map(f => ({ owner: f.id, points: routes.get(f.id)! })),
  });
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
    labels: labels.map(l => ({ ...l, rect: mr(l.rect), ...(l.anchor ? { anchor: mp(l.anchor) } : {}) })),
  };
}
