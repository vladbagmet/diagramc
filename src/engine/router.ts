import { theme } from '../core/theme.js';
import { distance, simplify, type Point, type Rect } from './geometry.js';

/**
 * Orthogonal obstacle-avoiding router, used to repair routes the layered layout
 * gets wrong: lines through a container's name or tab, detours around the whole
 * diagram (an edge whose target ended up above its source), lines ending almost
 * on top of each other, end segments too short for their arrowhead.
 *
 * It searches a sparse grid (the lines along every obstacle's sides, offset by a
 * margin, plus candidate attachment points) with Dijkstra over (point, heading)
 * states. Cost: length, a penalty per bend, a penalty per crossing of an existing
 * line (much more near that line's end, where a crossing looks like a junction
 * at the node), and a heavy penalty for running along an existing line. Both ends leave
 * their node perpendicular to its border with a straight stub at least `stub`
 * long, so an arrowhead never sits on a bend. Deterministic for equal input.
 */

export interface RouteEnd {
  /** Outline of the node the route starts or ends at. */
  rect: Rect;
  /** A fixed attachment point and the outward direction there (a shared arrowhead). */
  fixed?: { point: Point; out: Point };
  /** Straight length required next to the node (marker length plus room for a bend). */
  stub: number;
  /** Other lines' end points on this node, kept at least `spacing` away. */
  occupied?: readonly Point[];
  spacing?: number;
}

export interface RouteRequest {
  source: RouteEnd;
  target: RouteEnd;
  /** Rectangles the route must not enter (other nodes, container headers, notes). */
  obstacles: readonly Rect[];
  /** Existing routes to avoid running along (and, less, crossing). */
  lines: readonly (readonly Point[])[];
  /** Search area; the grid extends a margin beyond it. */
  area: Rect;
  /** Gap kept between the route and obstacles (default 12). */
  margin?: number;
  /** Lines closer than this to existing lines count as running along them (default: line spacing). */
  spacing?: number;
  /** Cost of crossing an existing line, in px of length (default 30). Lower it to prefer a direct route over a detour. */
  crossCost?: number;
}

const BEND = 24;
const CROSS = 30;
/** Crossing a line this close to where it ends at a node reads as joining that node: costs more. */
const NEAR_END = 30;
const CROSS_NEAR_END = 150;
const ALONG = 6;
const DIRS: Point[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
const dirIndex = (d: Point): number => DIRS.findIndex(e => Math.abs(e.x - d.x) < 1e-6 && Math.abs(e.y - d.y) < 1e-6);

interface Attach { border: Point; stub: Point; dir: number; cost: number }

/** Index of the side of `r` (in DIRS order: right, bottom, left, top) nearest to a point. */
function sideIndex(r: Rect, p: Point): number {
  const d = [Math.abs(p.x - r.x - r.width), Math.abs(p.y - r.y - r.height), Math.abs(p.x - r.x), Math.abs(p.y - r.y)];
  return d.indexOf(Math.min(...d));
}

/** Candidate attachment points on a node's sides (or the fixed one), with their stub ends. */
function attachments(end: RouteEnd, toward: Rect, margin: number, sameSideOnly = false): Attach[] {
  if (end.fixed) {
    const d = dirIndex(end.fixed.out);
    const u = DIRS[d]!;
    const length = Math.max(end.stub, margin + 2);
    return [{ border: end.fixed.point, stub: { x: end.fixed.point.x + u.x * length, y: end.fixed.point.y + u.y * length }, dir: d, cost: 0 }];
  }
  const r = end.rect;
  const spacing = end.spacing ?? theme.spacing.edgeEdge;
  const inset = Math.min(10, r.width / 4, r.height / 4);
  const out: Attach[] = [];
  const tc = { x: toward.x + toward.width / 2, y: toward.y + toward.height / 2 };
  for (const [d, along] of [[0, 'y'], [1, 'x'], [2, 'y'], [3, 'x']] as const) {
    const lo = along === 'x' ? r.x + inset : r.y + inset;
    const hi = along === 'x' ? r.x + r.width - inset : r.y + r.height - inset;
    if (hi < lo) continue;
    const mid = (lo + hi) / 2;
    const span = hi - lo;
    // Toward the other node: aligned with its center or the middle of the overlap.
    const tlo = along === 'x' ? toward.x : toward.y, thi = along === 'x' ? toward.x + toward.width : toward.y + toward.height;
    const values = [mid, mid - span / 4, mid + span / 4, lo + span / 8, hi - span / 8, along === 'x' ? tc.x : tc.y, (Math.max(lo, tlo) + Math.min(hi, thi)) / 2];
    // Steps away from occupied points, so a free spot exists next to a crowded one.
    for (const p of end.occupied ?? []) {
      const v = along === 'x' ? p.x : p.y;
      values.push(v - spacing - 2, v + spacing + 2, v - 2 * spacing - 4, v + 2 * spacing + 4);
    }
    const u = DIRS[d]!;
    const seen = new Set<number>();
    for (const raw of values) {
      const v = Math.round(raw * 2) / 2;
      if (v < lo || v > hi || seen.has(v)) continue;
      seen.add(v);
      const border = along === 'x' ? { x: v, y: d === 1 ? r.y + r.height : r.y } : { x: d === 0 ? r.x + r.width : r.x, y: v };
      if ((end.occupied ?? []).some(p => distance(p, border) < spacing - 0.01 && (!sameSideOnly || sideIndex(r, p) === d))) continue;
      // Prefer the middle of a side a little.
      const cost = Math.abs(v - mid) * 0.05;
      out.push({ border, stub: { x: border.x + u.x * Math.max(end.stub, margin + 2), y: border.y + u.y * Math.max(end.stub, margin + 2) }, dir: d, cost });
    }
  }
  return out;
}

/** Binary min-heap of [cost, state]. */
class Heap {
  private readonly items: [number, number][] = [];
  get size(): number { return this.items.length; }
  push(item: [number, number]): void {
    const a = this.items;
    a.push(item);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (a[p]![0] < item[0] || (a[p]![0] === item[0] && a[p]![1] <= item[1])) break;
      a[i] = a[p]!; a[p] = item; i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items, top = a[0]!, last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        const less = (x: number, y: number) => a[x]![0] < a[y]![0] || (a[x]![0] === a[y]![0] && a[x]![1] < a[y]![1]);
        if (l < a.length && less(l, m)) m = l;
        if (r < a.length && less(r, m)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}

const sortedUnique = (values: number[]): number[] => [...new Set(values.map(v => Math.round(v * 2) / 2))].sort((a, b) => a - b);

/**
 * Routes from the source's border to the target's border. Returns undefined when
 * no route exists in the area (the caller keeps the original route).
 */
export function routeOrthogonal(request: RouteRequest): Point[] | undefined {
  const margin = request.margin ?? 12;
  const { area } = request;
  const blocked = [...request.obstacles, request.source.rect, request.target.rect].map(r => ({ x: r.x - margin, y: r.y - margin, width: r.width + 2 * margin, height: r.height + 2 * margin }));
  // On a small node (a pseudostate) every point may lie within the spacing of
  // another side's end: then only ends on the same side count.
  const ends = (end: RouteEnd, toward: Rect): Attach[] => {
    const strict = attachments(end, toward, margin);
    return strict.length > 0 ? strict : attachments(end, toward, margin, true);
  };
  const starts = ends(request.source, request.target.rect);
  const goals = ends(request.target, request.source.rect);
  const inside = (p: Point, rects: readonly Rect[]): boolean => rects.some(r => p.x > r.x + 0.01 && p.x < r.x + r.width - 0.01 && p.y > r.y + 0.01 && p.y < r.y + r.height - 0.01);
  // Stubs must be clear of other obstacles.
  const stubClear = (a: Attach, own: Rect): boolean => {
    const others = request.obstacles.map(r => ({ x: r.x - margin / 2, y: r.y - margin / 2, width: r.width + margin, height: r.height + margin })).filter(r => r !== own);
    for (let t = 0.25; t <= 1; t += 0.25) if (inside({ x: a.border.x + (a.stub.x - a.border.x) * t, y: a.border.y + (a.stub.y - a.border.y) * t }, others)) return false;
    return true;
  };
  const okStarts = starts.filter(a => stubClear(a, request.source.rect));
  const okGoals = goals.filter(a => stubClear(a, request.target.rect));
  if (okStarts.length === 0 || okGoals.length === 0) return undefined;

  const xs = sortedUnique([
    area.x - 2 * margin, area.x + area.width + 2 * margin,
    ...blocked.flatMap(r => [r.x, r.x + r.width, r.x - theme.spacing.edgeEdge, r.x + r.width + theme.spacing.edgeEdge]),
    ...okStarts.map(a => a.stub.x), ...okGoals.map(a => a.stub.x),
  ]).filter(x => x >= area.x - 2 * margin - 0.5 && x <= area.x + area.width + 2 * margin + 0.5);
  const ys = sortedUnique([
    area.y - 2 * margin, area.y + area.height + 2 * margin,
    ...blocked.flatMap(r => [r.y, r.y + r.height, r.y - theme.spacing.edgeEdge, r.y + r.height + theme.spacing.edgeEdge]),
    ...okStarts.map(a => a.stub.y), ...okGoals.map(a => a.stub.y),
  ]).filter(y => y >= area.y - 2 * margin - 0.5 && y <= area.y + area.height + 2 * margin + 0.5);
  const W = xs.length, H = ys.length;
  const key = (i: number, j: number, d: number): number => ((j * W + i) << 2) | d;
  const index = (values: readonly number[], v: number): number | undefined => {
    let lo = 0, hi = values.length - 1;
    const r = Math.round(v * 2) / 2;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (values[m]! === r) return m; if (values[m]! < r) lo = m + 1; else hi = m - 1; }
    return undefined;
  };

  // Blocked grid points and grid moves: inside an inflated obstacle (strictly).
  // Grid lines lie on the obstacles' sides, so a move between neighbours is either
  // entirely inside an obstacle or entirely outside.
  const pointBlocked = new Uint8Array(W * H), hBlocked = new Uint8Array(W * H), vBlocked = new Uint8Array(W * H);
  const firstAbove = (values: readonly number[], v: number): number => { let k = 0; while (k < values.length && values[k]! <= v + 0.01) k++; return k; };
  for (const r of blocked) {
    const i0 = firstAbove(xs, r.x), j0 = firstAbove(ys, r.y);
    for (let j = j0; j < H && ys[j]! < r.y + r.height - 0.01; j++) for (let i = i0; i < W && xs[i]! < r.x + r.width - 0.01; i++) pointBlocked[j * W + i] = 1;
    // Horizontal moves (i -> i+1) on a row strictly inside, whose midpoint is inside.
    for (let j = j0; j < H && ys[j]! < r.y + r.height - 0.01; j++) for (let i = Math.max(0, i0 - 1); i + 1 < W && xs[i]! < r.x + r.width - 0.01; i++) {
      const mid = (xs[i]! + xs[i + 1]!) / 2;
      if (mid > r.x + 0.01 && mid < r.x + r.width - 0.01) hBlocked[j * W + i] = 1;
    }
    for (let i = i0; i < W && xs[i]! < r.x + r.width - 0.01; i++) for (let j = Math.max(0, j0 - 1); j + 1 < H && ys[j]! < r.y + r.height - 0.01; j++) {
      const mid = (ys[j]! + ys[j + 1]!) / 2;
      if (mid > r.y + 0.01 && mid < r.y + r.height - 0.01) vBlocked[j * W + i] = 1;
    }
  }

  // Existing lines, split into horizontal and vertical segments, indexed by grid row and column.
  // Each segment keeps its line's end points (where the line meets its nodes).
  const horizontal: { y: number; x0: number; x1: number; ends: Point[] }[] = [], vertical: { x: number; y0: number; y1: number; ends: Point[] }[] = [];
  for (const line of request.lines) for (let k = 1; k < line.length; k++) {
    const a = line[k - 1]!, b = line[k]!, ends = [line[0]!, line.at(-1)!];
    if (Math.abs(a.y - b.y) < 0.5) horizontal.push({ y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), ends });
    else if (Math.abs(a.x - b.x) < 0.5) vertical.push({ x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y), ends });
  }
  /** Cost of crossing a line at point p. */
  const crossCost = (p: Point, ends: readonly Point[]): number => (request.crossCost ?? CROSS) + (ends.some(e => distance(e, p) < NEAR_END) ? CROSS_NEAR_END : 0);
  const near = request.spacing ?? theme.spacing.edgeEdge - 1;
  const rowNear = ys.map(y => horizontal.filter(s => Math.abs(s.y - y) < near));
  const rowCross = ys.map(y => vertical.filter(s => y > s.y0 && y < s.y1));
  const colNear = xs.map(x => vertical.filter(s => Math.abs(s.x - x) < near));
  const colCross = xs.map(x => horizontal.filter(s => x > s.x0 && x < s.x1));
  /** Extra cost of a grid move (crossings and running along lines), cached per move. */
  const hCost = new Float64Array(W * H).fill(-1), vCost = new Float64Array(W * H).fill(-1);
  const horizontalCost = (i: number, j: number): number => {
    const at = j * W + i;
    if (hCost[at]! >= 0) return hCost[at]!;
    const x0 = xs[i]!, x1 = xs[i + 1]!;
    let cost = 0;
    for (const s of rowNear[j]!) cost += Math.max(0, Math.min(x1, s.x1) - Math.max(x0, s.x0)) * ALONG;
    for (const s of rowCross[j]!) if (s.x > x0 && s.x < x1) cost += crossCost({ x: s.x, y: ys[j]! }, s.ends);
    return (hCost[at] = cost);
  };
  const verticalCost = (i: number, j: number): number => {
    const at = j * W + i;
    if (vCost[at]! >= 0) return vCost[at]!;
    const y0 = ys[j]!, y1 = ys[j + 1]!;
    let cost = 0;
    for (const s of colNear[i]!) cost += Math.max(0, Math.min(y1, s.y1) - Math.max(y0, s.y0)) * ALONG;
    for (const s of colCross[i]!) if (s.y > y0 && s.y < y1) cost += crossCost({ x: xs[i]!, y: s.y }, s.ends);
    return (vCost[at] = cost);
  };
  /** Extra cost of a stub (not on the grid). */
  const stubCost = (a: Point, b: Point): number => {
    let cost = 0;
    if (Math.abs(a.y - b.y) < 0.01) {
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
      for (const s of horizontal) if (Math.abs(s.y - a.y) < near) cost += Math.max(0, Math.min(x1, s.x1) - Math.max(x0, s.x0)) * ALONG;
      for (const s of vertical) if (s.x > x0 && s.x < x1 && a.y > s.y0 && a.y < s.y1) cost += crossCost({ x: s.x, y: a.y }, s.ends);
    } else {
      const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      for (const s of vertical) if (Math.abs(s.x - a.x) < near) cost += Math.max(0, Math.min(y1, s.y1) - Math.max(y0, s.y0)) * ALONG;
      for (const s of horizontal) if (s.y > y0 && s.y < y1 && a.x > s.x0 && a.x < s.x1) cost += crossCost({ x: a.x, y: s.y }, s.ends);
    }
    return cost;
  };

  const best = new Float64Array(W * H * 4).fill(Infinity), from = new Int32Array(W * H * 4).fill(-1);
  const heap = new Heap();
  const startAttach = new Map<number, Attach>();
  const goalAt = new Map<number, Attach[]>();
  for (const g of okGoals) {
    const i = index(xs, g.stub.x), j = index(ys, g.stub.y);
    if (i === undefined || j === undefined || pointBlocked[j * W + i]) continue;
    const at = j * W + i;
    goalAt.set(at, [...(goalAt.get(at) ?? []), g]);
  }
  if (goalAt.size === 0) return undefined;
  // A*: the Manhattan distance to the nearest goal stub never overestimates.
  const goalPoints = okGoals.map(g => g.stub);
  const h = (i: number, j: number): number => Math.min(...goalPoints.map(g => Math.abs(g.x - xs[i]!) + Math.abs(g.y - ys[j]!)));
  for (const a of okStarts) {
    const i = index(xs, a.stub.x), j = index(ys, a.stub.y);
    if (i === undefined || j === undefined || pointBlocked[j * W + i]) continue;
    const k = key(i, j, a.dir), c = distance(a.border, a.stub) + a.cost + stubCost(a.border, a.stub);
    if (c < best[k]!) { best[k] = c; startAttach.set(k, a); heap.push([c + h(i, j), k]); }
  }
  let found: { state: number; goal: Attach; cost: number } | undefined;
  while (heap.size > 0) {
    const [f, k] = heap.pop();
    const c = best[k]!;
    if (found && f >= found.cost) break;
    const at = k >> 2, d = k & 3, i = at % W, j = (at - i) / W;
    if (f > c + h(i, j) + 1e-6) continue;
    for (const g of goalAt.get(at) ?? []) {
      // Arrive heading into the target: opposite of the goal's outward direction.
      const into = (g.dir + 2) % 4;
      const total = c + (d === into ? 0 : BEND) + distance(g.stub, g.border) + g.cost + stubCost(g.stub, g.border);
      if (d !== g.dir && (!found || total < found.cost)) found = { state: k, goal: g, cost: total };
    }
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4) continue;
      const u = DIRS[nd]!;
      const ni = i + u.x, nj = j + u.y;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H || pointBlocked[nj * W + ni]) continue;
      // The move's cell: the lower-left grid point of the move.
      const mi = Math.min(i, ni), mj = Math.min(j, nj);
      if (u.y === 0 ? hBlocked[mj * W + mi] : vBlocked[mj * W + mi]) continue;
      const nk = key(ni, nj, nd);
      const step = u.y === 0 ? xs[mi + 1]! - xs[mi]! : ys[mj + 1]! - ys[mj]!;
      const nc = c + step + (nd === d ? 0 : BEND) + (u.y === 0 ? horizontalCost(mi, mj) : verticalCost(mi, mj));
      if (nc < best[nk]! - 1e-9) { best[nk] = nc; from[nk] = k; heap.push([nc + h(ni, nj), nk]); }
    }
  }
  if (!found) return undefined;
  const path: Point[] = [found.goal.border, found.goal.stub];
  let k = found.state;
  let first = k;
  while (k >= 0) {
    const at = k >> 2, i = at % W, j = (at - i) / W;
    path.push({ x: xs[i]!, y: ys[j]! });
    first = k;
    k = from[k]!;
  }
  path.push(startAttach.get(first)!.border);
  return simplify(path.reverse());
}
