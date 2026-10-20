import { wrapsAround } from '../../engine/aspect.js';
import { outlineHit } from '../../engine/clip.js';
import { center, distance, distanceToSegment, inflate, segmentIntersectsRect, type Point, type Rect } from '../../engine/geometry.js';

/**
 * Line routing for use case diagrams. Use case diagrams are drawn with straight
 * lines: an actor's associations fan out from one point on the side of the figure,
 * lines meet a use case's ellipse aiming at its center. A line that would pass
 * through another element (a use case, a note, an actor or its name, a subject's
 * name) bends around it: the shortest path through the corners of the obstacles in
 * the way (a visibility graph searched with A*), with a cost per bend and per
 * crossing with lines routed before, so a straight line wins whenever it is clear.
 */

export type EndShape = 'ellipse' | 'rect' | 'actor';
export interface RouteEnd {
  id: string;
  rect: Rect;
  shape: EndShape;
  /** Length of straight line the end needs before a bend (arrowheads). */
  straight?: number;
  /** Actors only: where on the chosen side the line attaches (default its middle). */
  attach?: (side: Point, toward: Point) => Point;
  /** Ellipses only: the end carries a label (a multiplicity). */
  labelled?: boolean;
}
/** How far from the major axis a labelled end may meet an ellipse (sine of the angle). */
const SIDE_SIN = 0.3;
export interface Obstacle { id: string; rect: Rect }

/** Clearance between a line and an element it passes. */
const MARGIN = 5;
/** Distance of a bend point from the corner of the element it goes around. */
const CORNER = 12;
/** Distances of bend points from a corner: one lane per line going around it (four round a subject, two round smaller elements). */
const LANES = [CORNER, 2 * CORNER + 2, 3 * CORNER + 4, 4 * CORNER + 6];
const WIDE = 300;
const BEND_COST = 36;
const CROSS_COST = 28;
/** Lines nearer than this to each other run "along" each other... */
const NEAR = 4;
/** Length at a shared end over which lines may run close (they fan out from one point). */
const FAN = 12;
/** ...which costs this much per 8 px. */
const ALONG_COST = 6;
/**
 * Running within SHARED_BAND of a line for more than this (a shallow crossing
 * counts too) reads as one line (gate shared-segments: 10 px within 2 px): it costs
 * SHARED_COST on top.
 */
const SHARED_ALONG = 9;
/** Tolerance of that check (the gate's 2 px; the length keeps a margin below its 10 px). */
const SHARED_BAND = 2;
const SHARED_COST = 400;
/** See the gate: slanted lines from one shared point are not judged within this distance of it. */
const SHARED_FAN = 60;
/** A bend this close to another line (or another line's bend this close to a segment) reads as a junction. */
const ON_LINE = 3;

/** The middle of the side of `r` facing `q`; actors never use their bottom (their name is there). */
export function sidePoint(r: Rect, q: Point, actor: boolean): Point {
  const c = center(r);
  const horizontal = Math.abs(q.x - c.x) * r.height >= Math.abs(q.y - c.y) * r.width;
  if (horizontal || (actor && q.y > c.y)) return { x: q.x < c.x ? r.x : r.x + r.width, y: c.y };
  return { x: c.x, y: q.y < c.y ? r.y : r.y + r.height };
}

/** Where a line coming from `toward` meets the end. */
export function attachPoint(end: RouteEnd, toward: Point): Point {
  if (end.shape === 'ellipse') {
    const c = center(end.rect), hit = outlineHit(toward, c, end.rect, 'ellipse');
    const a = end.rect.width / 2, b = end.rect.height / 2;
    // A labelled end stays near the left or right vertex: deep in a corner of the
    // bounding box, its label could only sit far away.
    if (!end.labelled || Math.abs(hit.y - c.y) <= SIDE_SIN * b) return hit;
    return { x: c.x + Math.sign(hit.x - c.x || 1) * a * Math.sqrt(1 - SIDE_SIN ** 2), y: c.y + Math.sign(hit.y - c.y) * SIDE_SIN * b };
  }
  const side = sidePoint(end.rect, toward, end.shape === 'actor');
  return end.attach ? end.attach(side, toward) : side;
}

export class Router {
  private readonly segments: [Point, Point, string | undefined][] = [];
  /** Bend points of the routes added so far. */
  private readonly bends: { p: Point; group: string | undefined }[] = [];
  /** Group of the route being searched: lines of one group (a generalization tree) merge on purpose and do not count. */
  private group: string | undefined;
  private readonly inflated: Obstacle[];
  constructor(private readonly obstacles: readonly Obstacle[]) { this.inflated = obstacles.map(o => ({ id: o.id, rect: inflate(o.rect, MARGIN) })); }

  /** Records a route so that later routes avoid crossing it. */
  add(route: readonly Point[], group?: string): void {
    for (let k = 1; k < route.length; k++) this.segments.push([route[k - 1]!, route[k]!, group]);
    this.bends.push(...route.slice(1, -1).map(p => ({ p, group })));
  }
  /** Cost of a junction look: the bend `p` (if any) on a routed line, or a routed bend on a-b. */
  private junctions(a: Point, b: Point, p?: Point): number {
    let cost = 0;
    if (p && this.near(p, p, ON_LINE).some(([c, d]) => distanceToSegment(p, c, d) < ON_LINE)) cost += SHARED_COST;
    if (this.bends.some(q => (q.group === undefined || q.group !== this.group) && distanceToSegment(q.p, a, b) < ON_LINE)) cost += SHARED_COST;
    return cost;
  }

  private blocked(a: Point, b: Point, ignore: ReadonlySet<string>): boolean {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    for (const o of this.inflated) {
      const r = o.rect;
      if (x1 < r.x || x0 > r.x + r.width || y1 < r.y || y0 > r.y + r.height) continue;
      if (!ignore.has(o.id) && segmentIntersectsRect(a, b, r)) return true;
    }
    return false;
  }
  /** Routed segments near the box of a-b. */
  private near(a: Point, b: Point, by: number): [Point, Point, string | undefined][] {
    const x0 = Math.min(a.x, b.x) - by, x1 = Math.max(a.x, b.x) + by, y0 = Math.min(a.y, b.y) - by, y1 = Math.max(a.y, b.y) + by;
    return this.segments.filter(([c, d, g]) => (g === undefined || g !== this.group) && Math.max(c.x, d.x) >= x0 && Math.min(c.x, d.x) <= x1 && Math.max(c.y, d.y) >= y0 && Math.min(c.y, d.y) <= y1);
  }
  private crossings(a: Point, b: Point): number {
    let n = 0;
    for (const [c, d] of this.near(a, b, 0)) if (properCross(a, b, c, d)) n++;
    return n;
  }
  /**
   * Cost of running along lines routed before (lines on top of each other read as
   * one): the length over which a routed segment stays within NEAR of this one, at
   * any angle, so two lines leaving one point in nearly the same direction count
   * too. Only the first few px at a shared end (an actor's fan point) are free.
   */
  private along(a: Point, b: Point, fromEnd: boolean, toEnd: boolean): number {
    const length = distance(a, b);
    if (length < 1) return 0;
    const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const lo = fromEnd ? FAN : 0, hi = toEnd ? length - FAN : length;
    if (hi <= lo) return 0;
    // Lines leaving one end are judged by the gate only beyond SHARED_FAN of it.
    const farLo = fromEnd ? SHARED_FAN : 0, farHi = toEnd ? length - SHARED_FAN : length;
    const off = (q: Point) => (q.x - a.x) * u.y - (q.y - a.y) * u.x;
    const t = (q: Point) => (q.x - a.x) * u.x + (q.y - a.y) * u.y;
    /** The part of c-d within `band` of the line through a-b, projected onto a-b (from, to), or undefined. */
    const run = (c: Point, d: Point, band: number): [number, number] | undefined => {
      const oc = off(c), od = off(d);
      let s0 = 0, s1 = 1;
      if (Math.abs(od - oc) < 1e-9) { if (Math.abs(oc) >= band) return undefined; }
      else {
        const k0 = (-band - oc) / (od - oc), k1 = (band - oc) / (od - oc);
        s0 = Math.max(0, Math.min(k0, k1)); s1 = Math.min(1, Math.max(k0, k1));
        if (s1 <= s0) return undefined;
      }
      const p0 = t({ x: c.x + (d.x - c.x) * s0, y: c.y + (d.y - c.y) * s0 }), p1 = t({ x: c.x + (d.x - c.x) * s1, y: c.y + (d.y - c.y) * s1 });
      return [Math.min(p0, p1), Math.max(p0, p1)];
    };
    let close = 0, shared = false;
    for (const [c, d] of this.near(a, b, NEAR)) {
      const r = run(c, d, NEAR);
      if (!r) continue;
      const overlap = Math.min(hi, r[1]) - Math.max(lo, r[0]);
      if (overlap > 0) close += overlap;
      // What the gate sees (src/qa/gates.ts nearRun): the stretch of c-d within its
      // tolerance of the segment a-b, beyond the fan.
      const g = run(c, d, SHARED_BAND + 1);
      if (!shared && g && Math.min(farHi, g[1]) - Math.max(farLo, g[0]) > SHARED_ALONG / 2) {
        const cd = distance(c, d), steps = Math.ceil(cd / 1);
        let first = -1, last = -1;
        for (let k = 0; k <= steps; k++) {
          const q = { x: c.x + (d.x - c.x) * k / steps, y: c.y + (d.y - c.y) * k / steps }, along = t(q);
          if (along < farLo || along > farHi) continue;
          if (distanceToSegment(q, a, b) <= SHARED_BAND) { if (first < 0) first = k; last = k; }
        }
        if (first >= 0 && (last - first) / steps * cd > SHARED_ALONG) shared = true;
      }
    }
    return close / 8 * ALONG_COST + (shared ? SHARED_COST : 0);
  }

  /** A route from `source` to `target`, first point on the source, last on the target. */
  route(source: RouteEnd, target: RouteEnd, ignoreExtra: readonly string[] = [], group?: string): Point[] {
    this.group = group;
    try { return this.search(source, target, ignoreExtra); } finally { this.group = undefined; }
  }

  private search(source: RouteEnd, target: RouteEnd, ignoreExtra: readonly string[]): Point[] {
    const ignore = new Set([source.id, target.id, ...ignoreExtra]);
    const direct = (): Point[] => {
      let a = attachPoint(source, center(target.rect));
      const b = attachPoint(target, a);
      a = attachPoint(source, b);
      return [a, b];
    };
    const straight = direct();
    const clear = !this.blocked(straight[0]!, straight[1]!, ignore);
    if (clear && this.along(straight[0]!, straight[1]!, true, true) === 0 && this.junctions(straight[0]!, straight[1]!) === 0) return straight;

    // Bend points: around the corners of the elements near the two ends' box.
    const box = inflate(union2(source.rect, target.rect), 260);
    const corners: Point[] = [];
    for (const o of this.obstacles) {
      if (ignore.has(o.id) || !overlapsRect(o.rect, box)) continue;
      for (const by of o.rect.width > WIDE || o.rect.height > WIDE ? LANES : LANES.slice(0, 2)) for (const p of cornersOf(inflate(o.rect, by))) {
        if (this.obstacles.some(x => !ignore.has(x.id) && inside(p, inflate(x.rect, MARGIN)))) continue;
        if (inside(p, inflate(source.rect, 2)) || inside(p, inflate(target.rect, 2))) continue;
        corners.push(p);
      }
    }
    const n = corners.length, goal = n;
    const goalCenter = center(target.rect);
    /** Cost of the leg from vertex i (or the source when i < 0) to vertex j (or the target when j === goal). */
    const leg = (i: number, j: number): number => {
      const from = i < 0 ? attachPoint(source, corners[j] ?? goalCenter) : corners[i]!;
      const to = j === goal ? attachPoint(target, from) : corners[j]!;
      if (i < 0 && j === goal) return clear ? distance(straight[0]!, straight[1]!) + CROSS_COST * this.crossings(straight[0]!, straight[1]!) + this.along(straight[0]!, straight[1]!, true, true) + this.junctions(straight[0]!, straight[1]!) : Infinity;
      if (i < 0 && distance(from, to) < (source.straight ?? 0)) return Infinity;
      if (j === goal && distance(from, to) < (target.straight ?? 0)) return Infinity;
      if (this.blocked(from, to, ignore)) return Infinity;
      return distance(from, to) + BEND_COST + CROSS_COST * this.crossings(from, to) + this.along(from, to, i < 0, j === goal) + this.junctions(from, to, j === goal ? undefined : to);
    };
    // A* over the corners (index -1 is the source, `goal` the target).
    const best = new Map<number, number>([[-1, 0]]), prev = new Map<number, number>();
    const done = new Set<number>();
    const h = (j: number): number => j === goal ? 0 : distance(corners[j]!, goalCenter);
    const open: number[] = [-1];
    while (open.length) {
      open.sort((x, y) => (best.get(x)! + (x < 0 ? 0 : h(x))) - (best.get(y)! + (y < 0 ? 0 : h(y))));
      const i = open.shift()!;
      if (i === goal) break;
      if (done.has(i)) continue;
      done.add(i);
      for (let j = 0; j <= n; j++) {
        if (j === i || done.has(j)) continue;
        const c = leg(i, j);
        if (!Number.isFinite(c)) continue;
        const total = best.get(i)! + c;
        if (total < (best.get(j) ?? Infinity)) { best.set(j, total); prev.set(j, i); if (!open.includes(j)) open.push(j); }
      }
    }
    if (!prev.has(goal)) return straight;
    if (prev.get(goal) === -1) return straight;
    const via: Point[] = [];
    for (let k = prev.get(goal)!; k >= 0; k = prev.get(k)!) via.unshift(corners[k]!);
    const path = (ks: readonly number[]): Point[] => [attachPoint(source, corners[ks[0]!]!), ...ks.map(k => corners[k]!), attachPoint(target, corners[ks.at(-1)!]!)];
    const found = [attachPoint(source, via[0]!), ...via, attachPoint(target, via.at(-1)!)];
    if (!wrapsAround(found)) return found;
    // The cheapest route wraps round an element (it turns the same way three times):
    // the cheapest one with one or two bends that does not, if any.
    let bestRoute: Point[] | undefined, bestCost = Infinity;
    const consider = (ks: number[], cost: number): void => {
      if (!Number.isFinite(cost) || cost >= bestCost) return;
      const r = path(ks);
      if (!wrapsAround(r)) { bestRoute = r; bestCost = cost; }
    };
    const fromSource = corners.map((_, j) => leg(-1, j)), toGoal = corners.map((_, i) => leg(i, goal));
    for (let i = 0; i < n; i++) consider([i], fromSource[i]! + toGoal[i]!);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(fromSource[i]!)) continue;
      for (let j = 0; j < n; j++) if (j !== i && Number.isFinite(toGoal[j]!) && fromSource[i]! + toGoal[j]! < bestCost) consider([i, j], fromSource[i]! + leg(i, j) + toGoal[j]!);
    }
    return bestRoute ?? found;
  }
}

const cornersOf = (r: Rect): Point[] => [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x, y: r.y + r.height }, { x: r.x + r.width, y: r.y + r.height }];

function union2(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
const overlapsRect = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const inside = (p: Point, r: Rect): boolean => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height;

/** True when segments a-b and c-d cross at a point inside both (shared ends do not count). */
export function properCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 1e-6 && d2 < -1e-6) || (d1 < -1e-6 && d2 > 1e-6)) && ((d3 > 1e-6 && d4 < -1e-6) || (d3 < -1e-6 && d4 > 1e-6));
}

/** Tolerance, length and fan radius of the shared-segments gate (src/qa/gates.ts). */
const GATE_TOLERANCE = 2, GATE_SHARED = 10, GATE_FAN = 60;

/** Length of c-d within `tol` of the segment a-b, ignoring the part within GATE_FAN of `fan` when the two are not parallel (as the gate measures it). */
function nearRun(a: Point, b: Point, c: Point, d: Point, tol: number, fan?: Point): number {
  if (Math.min(a.x, b.x) - tol > Math.max(c.x, d.x) || Math.min(c.x, d.x) - tol > Math.max(a.x, b.x)) return 0;
  if (Math.min(a.y, b.y) - tol > Math.max(c.y, d.y) || Math.min(c.y, d.y) - tol > Math.max(a.y, b.y)) return 0;
  const length = distance(c, d);
  if (length < 1) return 0;
  const steps = Math.ceil(length / 2), ab = distance(a, b);
  const fanning = !!fan && ab > 0 && Math.abs(((b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x)) / (ab * length)) > 0.005;
  let first = -1, last = -1;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps, p = { x: c.x + (d.x - c.x) * t, y: c.y + (d.y - c.y) * t };
    if (fanning && distance(p, fan!) < GATE_FAN) continue;
    if (distanceToSegment(p, a, b) <= tol) { if (first < 0) first = s; last = s; }
  }
  return first < 0 ? 0 : (last - first) / steps * length;
}

export interface CheckedLine { id: string; type: string; source: string; target: string; points: readonly Point[]; targetMarker: string }

/**
 * Pairs of lines that the shared-segments gate rejects: within its tolerance for
 * more than its length, or a bend of one on the other. Lines of one generalization
 * tree (a shared hollow triangle) and lines anchored on each other are exempt.
 */
export function sharedPairs(lines: readonly CheckedLine[]): [string, string][] {
  const out: [string, string][] = [];
  const tree = (a: CheckedLine, b: CheckedLine): boolean => a.type === b.type && a.target === b.target && a.targetMarker === 'hollow-triangle' && b.targetMarker === 'hollow-triangle' && distance(a.points.at(-1)!, b.points.at(-1)!) < 0.5;
  lines.forEach((e, i) => {
    for (const o of lines.slice(i + 1)) {
      if (tree(e, o) || e.source === o.id || e.target === o.id || o.source === e.id || o.target === e.id) continue;
      const fan = [e.points[0]!, e.points.at(-1)!].find(p => [o.points[0]!, o.points.at(-1)!].some(q => distance(p, q) < 0.5));
      let shared = 0;
      for (let k = 1; k < e.points.length; k++) for (let m = 1; m < o.points.length; m++) shared = Math.max(shared, nearRun(e.points[k - 1]!, e.points[k]!, o.points[m - 1]!, o.points[m]!, GATE_TOLERANCE, fan));
      const onLine = (p: Point, line: readonly Point[]): boolean => line.slice(1).some((q, k) => distanceToSegment(p, line[k]!, q) < 1.5);
      if (shared > GATE_SHARED - 1 || e.points.slice(1, -1).some(p => onLine(p, o.points)) || o.points.slice(1, -1).some(p => onLine(p, e.points))) out.push([e.id, o.id]);
    }
  });
  return out;
}
