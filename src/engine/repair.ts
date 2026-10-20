import { theme } from '../core/theme.js';
import { markerHalf, markerLength, type Marker } from './edges.js';
import { contains, distance, inflate, segmentIntersectsRect, union, type Point, type Rect } from './geometry.js';
import { routeOrthogonal } from './router.js';
export { markerHalf, markerLength } from './edges.js';
import { countCrossings, isDetour } from './aspect.js';

/**
 * Route repair for node-and-edge diagrams, shared by the own-engine kinds. After
 * the layered layout, each route is checked against the rules the QA gates
 * enforce; a route that breaks one is rerouted with `routeOrthogonal`:
 *
 * - it runs through a node that is not one of its ends (a note, a class), through a
 *   container that encloses neither end, or over a container's texts (a package
 *   tab, a component's name);
 * - it is a detour: much longer than the gap between its nodes (ELK routes an edge
 *   whose target ended up above its source around the whole drawing);
 * - one of its ends lies closer than the minimum spacing to another line's end on
 *   the same side of a node;
 * - an end with a marker sits on a segment shorter than the marker plus a bend.
 *
 * Self-loops and edges listed in `keep` are never rerouted. Tree edges (sharing one
 * arrowhead) keep their tip and its direction.
 */

export interface RepairNode {
  id: string;
  /** Outline the lines attach to (a package: its body; the tab goes into `texts`). */
  rect: Rect;
  parent?: string | undefined;
  /** True when other nodes are drawn inside it. */
  container?: boolean;
  /** Areas no line may cross: a container's name, keywords or tab. */
  texts?: readonly Rect[];
  /** Whole drawn extent when larger than `rect` (a package with its tab row): an obstacle for unrelated lines. */
  bounds?: Rect;
}

export interface RepairEdge {
  id: string;
  source: string;
  target: string;
  route: Point[];
  sourceMarker: Marker;
  targetMarker: Marker;
  /** Edges with one group share their target tip (a generalization tree): it stays fixed. */
  group?: string | undefined;
  /** Keep this end's point and direction (an end on a port, a symbol or an ellipse). */
  fixedSource?: boolean;
  fixedTarget?: boolean;
}


/** Routes may be this factor longer than the gap between their nodes plus SLACK before they count as detours (stricter than the gate). */
const DETOUR_FACTOR = 2.5;
const DETOUR_SLACK = 140;
/** Routes within this many px of the route-length gate's limit (ROUTE_LIMIT in aspect.ts) count as detours too. */
const DETOUR_MARGIN = 20;
/** Routes longer than this (factor of the gap plus slack) are worth trying to shorten. */
const SHORTEN_FACTOR = 1.4;
const SHORTEN_SLACK = 120;

export const routeLength = (route: readonly Point[]): number => route.slice(1).reduce((sum, p, k) => sum + distance(route[k]!, p), 0);

/** Manhattan gap between two rectangles (0 when they overlap on both axes). */
export function rectGap(a: Rect, b: Rect): number {
  return Math.max(0, b.x - a.x - a.width, a.x - b.x - b.width) + Math.max(0, b.y - a.y - a.height, a.y - b.y - b.height);
}

/** Index of the side of `r` a border point lies on: 0 right, 1 bottom, 2 left, 3 top. */
function sideOf(r: Rect, p: Point): number {
  const d = [Math.abs(p.x - r.x - r.width), Math.abs(p.y - r.y - r.height), Math.abs(p.x - r.x), Math.abs(p.y - r.y)];
  return d.indexOf(Math.min(...d));
}

/** How bad a broken rule is; a reroute must lower it. */
function severity(problem: string | undefined): number {
  if (!problem) return 0;
  if (problem === 'forced') return 6;
  if (problem === 'crosses') return 5;
  if (problem === 'detour') return 4;
  if (problem.startsWith('short')) return 3;
  if (problem.startsWith('crowded')) return 2;
  return 1;
}

export interface RepairOptions {
  /** Edge IDs never to reroute. */
  keep?: ReadonlySet<string>;
  /** Minimum distance between ends on one side without markers (default: edge spacing). */
  spacing?: number;
  /** Edge IDs to reroute even if their route breaks no rule (provisional routes). */
  force?: ReadonlySet<string>;
  /**
   * Center labels: whether the edge with this route has a clean spot for its label
   * (see labelFits in labels.ts); an edge without one is rerouted with
   * `labelSpacing(id)` px of room from other lines.
   */
  labelFits?: (id: string, route: readonly Point[], routes: ReadonlyMap<string, Point[]>) => boolean;
  labelSpacing?: (id: string) => number | undefined;
  /** Also shorten long routes that break no rule (default true). */
  shorten?: boolean;
  /**
   * Size of the labels at an edge's ends (role names, multiplicities: the widest
   * label and the total height on one side). A rerouted line keeps out of the room
   * these labels need beside other lines' ends, so they still find a clean spot.
   */
  endLabels?: ReadonlyMap<string, { source?: { width: number; height: number }; target?: { width: number; height: number } }>;
  /**
   * Also reroute a line that crosses another line within JUNCTION_DISTANCE of
   * either line's end: there the crossing reads as a junction at the node.
   */
  junctions?: boolean;
}

/** Room beyond an end label's width that its end keeps from other ends (gaps on both sides of the label). */
const LABEL_END_ROOM = 30;

/** Crossing cost of the router's second try for a route that came out as a detour. */
const DIRECT_CROSS_COST = 6;

/** See RepairOptions.junctions. */
export const JUNCTION_DISTANCE = 30;

/** Crossing points of two routes' segments (proper crossings only). */
function crossingPoints(a: readonly Point[], b: readonly Point[]): Point[] {
  const out: Point[] = [];
  const cross = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    const p = a[i - 1]!, q = a[i]!, r = b[j - 1]!, t = b[j]!;
    const d1 = cross(r, t, p), d2 = cross(r, t, q), d3 = cross(p, q, r), d4 = cross(p, q, t);
    if (!(((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))) continue;
    const k = d1 / (d1 - d2);
    out.push({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
  }
  return out;
}

/** Returns the repaired routes (all edges, changed or not) and the IDs of rerouted edges. */
export function repairRoutes(nodes: readonly RepairNode[], edges: readonly RepairEdge[], options: RepairOptions = {}): { routes: Map<string, Point[]>; changed: Set<string> } {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const routes = new Map(edges.map(e => [e.id, e.route.map(p => ({ ...p }))]));
  const changed = new Set<string>();
  const ancestors = (id: string): Set<string> => {
    const out = new Set<string>();
    for (let p = byId.get(id)?.parent; p !== undefined && !out.has(p); p = byId.get(p)?.parent) out.add(p);
    return out;
  };
  const baseSpacing = options.spacing ?? theme.spacing.endEnd;
  const all = union(nodes.map(n => n.rect));
  // Container borders count as lines: routes keep a line spacing away from them instead of hugging them.
  const borders = nodes.filter(n => n.container).map(({ rect: r }) => [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }, { x: r.x, y: r.y }]);

  /** Hard obstacles for an edge: other leaves, unrelated containers, every container text. */
  const obstaclesFor = (e: RepairEdge): Rect[] => {
    const related = new Set([...ancestors(e.source), ...ancestors(e.target), e.source, e.target]);
    const out: Rect[] = [];
    for (const n of nodes) {
      out.push(...n.texts ?? []);
      if (related.has(n.id)) continue;
      // A node inside one of the ends (a port, a nested element) is not in the way of lines that end on its container border.
      if (ancestors(n.id).has(e.source) || ancestors(n.id).has(e.target)) { if (!n.container) out.push(n.bounds ?? n.rect); continue; }
      out.push(n.bounds ?? n.rect);
    }
    return out;
  };
  const crosses = (route: readonly Point[], rects: readonly Rect[]): boolean => {
    for (let k = 1; k < route.length; k++) for (const r of rects) if (segmentIntersectsRect(route[k - 1]!, route[k]!, inflate(r, -1))) return true;
    return false;
  };
  const endsOf = (exclude: string) => edges.flatMap(o => o.id === exclude ? [] : [
    { edge: o, node: o.source, p: routes.get(o.id)![0]!, marker: o.sourceMarker },
    { edge: o, node: o.target, p: routes.get(o.id)!.at(-1)!, marker: o.targetMarker },
  ]);
  const minSpacing = (a: Marker, b: Marker): number => Math.max(baseSpacing, markerHalf(a) + markerHalf(b) + 6);
  /** Which rule a route breaks, or undefined. */
  const problem = (e: RepairEdge, route: readonly Point[]): string | undefined => {
    const s = byId.get(e.source), t = byId.get(e.target);
    if (!s || !t || route.length < 2) return undefined;
    if (crosses(route, obstaclesFor(e))) return 'crosses';
    if (!contains(s.rect, t.rect) && !contains(t.rect, s.rect)) {
      const length = routeLength(route);
      // Much longer than the gap between the nodes, longer than the route-length gate allows between its ends, or wrapping around.
      if (length > DETOUR_FACTOR * rectGap(s.rect, t.rect) + DETOUR_SLACK || isDetour(route, DETOUR_MARGIN)) return 'detour';
    }
    for (const [end, marker, p, q] of [['source', e.sourceMarker, route[0]!, route[1]!], ['target', e.targetMarker, route.at(-1)!, route.at(-2)!]] as const) {
      const need = markerLength(marker) + (route.length > 2 ? theme.spacing.bendRadius : 0);
      if (marker !== 'none' && distance(p, q) < need - 0.25) return `short ${end}`;
      const node = end === 'source' ? s : t;
      for (const o of endsOf(e.id)) {
        if (o.node !== node.id || (e.group !== undefined && o.edge.group === e.group)) continue;
        const d = distance(o.p, p);
        if (d > 0.5 && d < minSpacing(marker, o.marker) - 0.25 && sideOf(node.rect, o.p) === sideOf(node.rect, p)) return `crowded ${end}`;
      }
    }
    if (options.labelFits && !options.labelFits(e.id, route, routes)) return 'label';
    if (options.junctions) {
      for (const o of edges) {
        if (o.id === e.id || o.source === e.source || o.source === e.target || o.target === e.source || o.target === e.target) continue;
        const other = routes.get(o.id)!;
        const ends = [route[0]!, route.at(-1)!, other[0]!, other.at(-1)!];
        if (crossingPoints(route, other).some(p => ends.some(q => distance(p, q) < JUNCTION_DISTANCE))) return 'junction';
      }
    }
    return undefined;
  };

  /** Room the end labels of other edges need beside their end segments (see RepairOptions.endLabels). */
  const labelRoom = (exclude: string): Rect[] => {
    const out: Rect[] = [];
    for (const [id, ends] of options.endLabels ?? []) {
      if (id === exclude) continue;
      const route = routes.get(id);
      if (!route || route.length < 2) continue;
      for (const [size, p, q] of [[ends.source, route[0]!, route[1]!], [ends.target, route.at(-1)!, route.at(-2)!]] as const) {
        if (!size) continue;
        const pad = 6, vertical = Math.abs(q.x - p.x) < Math.abs(q.y - p.y);
        const along = (vertical ? size.height : size.width) + pad, across = (vertical ? size.width : size.height) + pad;
        const dir = vertical ? Math.sign(q.y - p.y) : Math.sign(q.x - p.x);
        out.push(vertical
          ? { x: p.x - across, y: dir > 0 ? p.y : p.y - along, width: 2 * across, height: along }
          : { x: dir > 0 ? p.x : p.x - along, y: p.y - across, width: along, height: 2 * across });
      }
    }
    return out;
  };

  /** Distance a labelled end keeps from other ends: its labels beside it, and twice their gap beyond (gate label-proximity). */
  const ownLabelRoom = (id: string, end: 'source' | 'target'): number => {
    const size = options.endLabels?.get(id)?.[end];
    return size ? size.width + LABEL_END_ROOM : 0;
  };

  const reroute = (e: RepairEdge, forLabel = false): Point[] | undefined => {
    const route = routes.get(e.id)!;
    const s = byId.get(e.source)!, t = byId.get(e.target)!;
    const ends = endsOf(e.id);
    const occupied = (node: string) => ends.filter(o => o.node === node && !(e.group !== undefined && o.edge.group === e.group)).map(o => o.p);
    const lines = [...edges.filter(o => o.id !== e.id && !(e.group !== undefined && o.group === e.group)).map(o => routes.get(o.id)!), ...borders];
    const fixed = (end: Point, next: Point) => ({ fixed: { point: end, out: { x: Math.sign(Math.round(next.x - end.x)), y: Math.sign(Math.round(next.y - end.y)) } } });
    const request = {
      source: {
        rect: s.rect, stub: markerLength(e.sourceMarker) + theme.spacing.bendRadius + 6, occupied: occupied(e.source), spacing: Math.max(minSpacing(e.sourceMarker, 'open-arrow'), ownLabelRoom(e.id, 'source')),
        ...(e.fixedSource ? fixed(route[0]!, route[1]!) : {}),
      },
      target: {
        rect: t.rect, stub: markerLength(e.targetMarker) + theme.spacing.bendRadius + 6, occupied: occupied(e.target), spacing: Math.max(minSpacing(e.targetMarker, 'open-arrow'), ownLabelRoom(e.id, 'target')),
        ...(e.group !== undefined || e.fixedTarget ? fixed(route.at(-1)!, route.at(-2)!) : {}),
      },
      obstacles: [...obstaclesFor(e), ...labelRoom(e.id)], lines, ...(forLabel && options.labelSpacing?.(e.id) ? { spacing: options.labelSpacing(e.id) } : {}),
    };
    let next = routeOrthogonal({ ...request, area: inflate(union([s.rect, t.rect]), 160) });
    if (!next || problem(e, next) === 'crosses') next = routeOrthogonal({ ...request, area: inflate(all, 40) });
    // A detour avoids crossings at any length: a direct route across a few lines reads better.
    if (next && problem(e, next) === 'detour') {
      const direct = routeOrthogonal({ ...request, area: inflate(all, 40), crossCost: DIRECT_CROSS_COST });
      if (direct && severity(problem(e, direct)) < severity('detour')) next = direct;
    }
    return next && problem(e, next) !== 'crosses' ? next : undefined;
  };
  const crossingsWith = (route: readonly Point[], id: string): number =>
    countCrossings([route, ...edges.filter(o => o.id !== id).map(o => routes.get(o.id)!)]) - countCrossings(edges.filter(o => o.id !== id).map(o => routes.get(o.id)!));

  // 1. Routes that break a rule.
  for (let pass = 0; pass < 2; pass++) {
    let any = false;
    for (const e of edges) {
      if (e.source === e.target || options.keep?.has(e.id)) continue;
      const route = routes.get(e.id)!;
      const was = problem(e, route) ?? (options.force?.has(e.id) && pass === 0 ? 'forced' : undefined);
      if (!was) continue;
      const next = reroute(e, was === 'label');
      if (!next) continue;
      const now = problem(e, next);
      // Only an improvement counts: the new route breaks a less severe rule, or none.
      if (severity(now) >= severity(was)) continue;
      if (was === 'label' && routeLength(next) > 1.6 * routeLength(route) + 150) continue;
      routes.set(e.id, next);
      changed.add(e.id);
      any = true;
    }
    if (!any) break;
  }
  // 2. Needlessly long routes (loops around a node to reach a neighbour): replaced
  //    when the new route is clearly shorter, breaks no rule and crosses no more lines.
  if (options.shorten !== false) {
    for (const e of edges) {
      if (e.source === e.target || options.keep?.has(e.id)) continue;
      const route = routes.get(e.id)!;
      const s = byId.get(e.source)!, t = byId.get(e.target)!;
      if (contains(s.rect, t.rect) || contains(t.rect, s.rect)) continue;
      const length = routeLength(route);
      if (length <= SHORTEN_FACTOR * rectGap(s.rect, t.rect) + SHORTEN_SLACK) continue;
      const next = reroute(e);
      if (!next || problem(e, next) || routeLength(next) > 0.75 * length) continue;
      if (crossingsWith(next, e.id) > crossingsWith(route, e.id)) continue;
      routes.set(e.id, next);
      changed.add(e.id);
    }
  }
  return { routes, changed };
}
