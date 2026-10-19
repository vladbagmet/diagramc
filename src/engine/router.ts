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
 * line, and a heavy penalty for running along an existing line. Both ends leave
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
}

const BEND = 24;
const CROSS = 30;
const ALONG = 6;
const DIRS: Point[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
const dirIndex = (d: Point): number => DIRS.findIndex(e => Math.abs(e.x - d.x) < 1e-6 && Math.abs(e.y - d.y) < 1e-6);

interface Attach { border: Point; stub: Point; dir: number; cost: number }

/** Candidate attachment points on a node's sides (or the fixed one), with their stub ends. */
function attachments(end: RouteEnd, toward: Rect, margin: number): Attach[] {
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
      if ((end.occupied ?? []).some(p => distance(p, border) < spacing - 0.01)) continue;
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
    if (a.length) {
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
  const starts = attachments(request.source, request.target.rect, margin);
  const goals = attachments(request.target, request.source.rect, margin);
  const inside = (p: Point, rects: readonly Rect[]): boolean => rects.some(r => p.x > r.x + 0.01 && p.x < r.x + r.width - 0.01 && p.y > r.y + 0.01 && p.y < r.y + r.height - 0.01);
  // Stubs must be clear of other obstacles.
  const stubClear = (a: Attach, own: Rect): boolean => {
    const others = request.obstacles.map(r => ({ x: r.x - margin / 2, y: r.y - margin / 2, width: r.width + margin, height: r.height + margin })).filter(r => r !== own);
    for (let t = 0.25; t <= 1; t += 0.25) if (inside({ x: a.border.x + (a.stub.x - a.border.x) * t, y: a.border.y + (a.stub.y - a.border.y) * t }, others)) return false;
    return true;
  };
  const okStarts = starts.filter(a => stubClear(a, request.source.rect));
  const okGoals = goals.filter(a => stubClear(a, request.target.rect));
  if (!okStarts.length || !okGoals.length) return undefined;

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
  const xi = new Map(xs.map((x, i) => [x, i])), yi = new Map(ys.map((y, i) => [y, i]));
  const W = xs.length, H = ys.length;
  const key = (i: number, j: number, d: number): number => ((j * W + i) << 2) | d;

  // Existing lines, split into horizontal and vertical segments.
  const horizontal: { y: number; x0: number; x1: number }[] = [], vertical: { x: number; y0: number; y1: number }[] = [];
  for (const line of request.lines) for (let k = 1; k < line.length; k++) {
    const a = line[k - 1]!, b = line[k]!;
    if (Math.abs(a.y - b.y) < 0.5) horizontal.push({ y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) });
    else if (Math.abs(a.x - b.x) < 0.5) vertical.push({ x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) });
  }
  const near = theme.spacing.edgeEdge - 1;
  /** Extra cost of a grid move from a to b (crossings and running along lines). */
  const moveCost = (a: Point, b: Point): number => {
    let cost = 0;
    if (Math.abs(a.y - b.y) < 0.01) {
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
      for (const s of horizontal) if (Math.abs(s.y - a.y) < near) cost += Math.max(0, Math.min(x1, s.x1) - Math.max(x0, s.x0)) * ALONG;
      for (const s of vertical) if (s.x > x0 && s.x < x1 && a.y > s.y0 && a.y < s.y1) cost += CROSS;
    } else {
      const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      for (const s of vertical) if (Math.abs(s.x - a.x) < near) cost += Math.max(0, Math.min(y1, s.y1) - Math.max(y0, s.y0)) * ALONG;
      for (const s of horizontal) if (s.y > y0 && s.y < y1 && a.x > s.x0 && a.x < s.x1) cost += CROSS;
    }
    return cost;
  };

  const best = new Map<number, number>(), from = new Map<number, number>();
  const heap = new Heap();
  const startAttach = new Map<number, Attach>();
  for (const a of okStarts) {
    const i = xi.get(Math.round(a.stub.x * 2) / 2), j = yi.get(Math.round(a.stub.y * 2) / 2);
    if (i === undefined || j === undefined || inside(a.stub, blocked)) continue;
    const k = key(i, j, a.dir), c = distance(a.border, a.stub) + a.cost + moveCost(a.border, a.stub);
    if (c < (best.get(k) ?? Infinity)) { best.set(k, c); startAttach.set(k, a); heap.push([c, k]); }
  }
  const goalAt = new Map<number, Attach[]>();
  for (const g of okGoals) {
    const i = xi.get(Math.round(g.stub.x * 2) / 2), j = yi.get(Math.round(g.stub.y * 2) / 2);
    if (i === undefined || j === undefined || inside(g.stub, blocked)) continue;
    const at = j * W + i;
    goalAt.set(at, [...(goalAt.get(at) ?? []), g]);
  }
  let found: { state: number; goal: Attach; cost: number } | undefined;
  while (heap.size) {
    const [c, k] = heap.pop();
    if (c > (best.get(k) ?? Infinity)) continue;
    if (found && c >= found.cost) break;
    const at = k >> 2, d = k & 3, i = at % W, j = (at - i) / W;
    const p = { x: xs[i]!, y: ys[j]! };
    for (const g of goalAt.get(at) ?? []) {
      // Arrive heading into the target: opposite of the goal's outward direction.
      const into = (g.dir + 2) % 4;
      const total = c + (d === into ? 0 : BEND) + distance(g.stub, g.border) + g.cost + moveCost(g.stub, g.border);
      if (d !== (g.dir) && (!found || total < found.cost)) found = { state: k, goal: g, cost: total };
    }
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4) continue;
      const u = DIRS[nd]!;
      const ni = i + u.x, nj = j + u.y;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const q = { x: xs[ni]!, y: ys[nj]! };
      if (inside({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, blocked) || inside(q, blocked)) continue;
      const nk = key(ni, nj, nd);
      const nc = c + distance(p, q) + (nd === d ? 0 : BEND) + moveCost(p, q);
      if (nc < (best.get(nk) ?? Infinity) - 1e-9) { best.set(nk, nc); from.set(nk, k); heap.push([nc, nk]); }
    }
  }
  if (!found) return undefined;
  const path: Point[] = [found.goal.border, found.goal.stub];
  let k: number | undefined = found.state;
  let first = k;
  while (k !== undefined) {
    const at = k >> 2, i = at % W, j = (at - i) / W;
    path.push({ x: xs[i]!, y: ys[j]! });
    first = k;
    k = from.get(k);
  }
  path.push(startAttach.get(first)!.border);
  return simplify(path.reverse());
}
