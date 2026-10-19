import { theme } from '../core/theme.js';
import { markerHalf, markerLength, type Marker } from './edges.js';
import { contains, distance, inflate, segmentIntersectsRect, union, type Point, type Rect } from './geometry.js';
import { routeOrthogonal } from './router.js';
export { markerHalf, markerLength } from './edges.js';
import { countCrossings } from './aspect.js';

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
  const baseSpacing = options.spacing ?? theme.spacing.edgeEdge;
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
      if (ancestors(n.id).has(e.source) || ancestors(n.id).has(e.target)) { if (!n.container) out.push(n.rect); continue; }
      out.push(n.rect);
    }
    return out;
  };
  const crosses = (route: readonly Point[], rects: readonly Rect[]): boolean => {
    for (let k = 1; k < route.length; k++) for (const r of rects) if (segmentIntersectsRect(route[k - 1]!, route[k]!, inflate(r, -1))) return true;
    return false;
  };
  const endsOf = (exclude: string) => edges.flatMap(o => o.id === exclude || o.source === o.target ? [] : [
    { edge: o, node: o.source, p: routes.get(o.id)![0]!, marker: o.sourceMarker },
    { edge: o, node: o.target, p: routes.get(o.id)!.at(-1)!, marker: o.targetMarker },
  ]);
  const minSpacing = (a: Marker, b: Marker): number => Math.max(baseSpacing, markerHalf(a) + markerHalf(b) + 6);
  /** Which rule a route breaks, or undefined. */
  const problem = (e: RepairEdge, route: readonly Point[]): string | undefined => {
    const s = byId.get(e.source), t = byId.get(e.target);
    if (!s || !t || route.length < 2) return undefined;
    if (crosses(route, obstaclesFor(e))) return 'crosses';
    if (!contains(s.rect, t.rect) && !contains(t.rect, s.rect) && routeLength(route) > DETOUR_FACTOR * rectGap(s.rect, t.rect) + DETOUR_SLACK) return 'detour';
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
    return undefined;
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
        rect: s.rect, stub: markerLength(e.sourceMarker) + theme.spacing.bendRadius + 6, occupied: occupied(e.source), spacing: minSpacing(e.sourceMarker, 'open-arrow'),
        ...(e.fixedSource ? fixed(route[0]!, route[1]!) : {}),
      },
      target: {
        rect: t.rect, stub: markerLength(e.targetMarker) + theme.spacing.bendRadius + 6, occupied: occupied(e.target), spacing: minSpacing(e.targetMarker, 'open-arrow'),
        ...(e.group !== undefined || e.fixedTarget ? fixed(route.at(-1)!, route.at(-2)!) : {}),
      },
      obstacles: obstaclesFor(e), lines, ...(forLabel && options.labelSpacing?.(e.id) ? { spacing: options.labelSpacing(e.id) } : {}),
    };
    let next = routeOrthogonal({ ...request, area: inflate(union([s.rect, t.rect]), 160) });
    if (!next || problem(e, next) === 'crosses') next = routeOrthogonal({ ...request, area: inflate(all, 40) });
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
