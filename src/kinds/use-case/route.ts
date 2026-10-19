import { outlineHit } from '../../engine/clip.js';
import { center, distance, inflate, segmentIntersectsRect, type Point, type Rect } from '../../engine/geometry.js';

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
const BEND_COST = 36;
const CROSS_COST = 28;
/** Lines nearer than this to each other run "along" each other... */
const NEAR = 3;
/** ...which costs this much per 8 px. */
const ALONG_COST = 6;

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
  private readonly segments: [Point, Point][] = [];
  private readonly inflated: Obstacle[];
  constructor(private readonly obstacles: readonly Obstacle[]) { this.inflated = obstacles.map(o => ({ id: o.id, rect: inflate(o.rect, MARGIN) })); }

  /** Records a route so that later routes avoid crossing it. */
  add(route: readonly Point[]): void { for (let k = 1; k < route.length; k++) this.segments.push([route[k - 1]!, route[k]!]); }

  private blocked(a: Point, b: Point, ignore: ReadonlySet<string>): boolean {
    for (const o of this.inflated) if (!ignore.has(o.id) && segmentIntersectsRect(a, b, o.rect)) return true;
    return false;
  }
  /** Routed segments near the box of a-b. */
  private near(a: Point, b: Point, by: number): [Point, Point][] {
    const x0 = Math.min(a.x, b.x) - by, x1 = Math.max(a.x, b.x) + by, y0 = Math.min(a.y, b.y) - by, y1 = Math.max(a.y, b.y) + by;
    return this.segments.filter(([c, d]) => Math.max(c.x, d.x) >= x0 && Math.min(c.x, d.x) <= x1 && Math.max(c.y, d.y) >= y0 && Math.min(c.y, d.y) <= y1);
  }
  private crossings(a: Point, b: Point): number {
    let n = 0;
    for (const [c, d] of this.near(a, b, 0)) if (properCross(a, b, c, d)) n++;
    return n;
  }
  /** Cost of running along lines routed before (lines on top of each other read as one). */
  private along(a: Point, b: Point, fromEnd: boolean, toEnd: boolean): number {
    const length = distance(a, b);
    if (length < 1) return 0;
    const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    // Lines leaving one point (an actor's side) are close there by design.
    const lo = fromEnd ? 30 : 0, hi = toEnd ? length - 30 : length;
    if (hi <= lo) return 0;
    let close = 0;
    for (const [c, d] of this.near(a, b, NEAR)) {
      // Nearly parallel segments within NEAR of this one: the length they share.
      const off = (q: Point) => (q.x - a.x) * u.y - (q.y - a.y) * u.x;
      if (Math.abs(off(c)) >= NEAR || Math.abs(off(d)) >= NEAR) continue;
      const t = (q: Point) => (q.x - a.x) * u.x + (q.y - a.y) * u.y;
      const overlap = Math.min(hi, Math.max(t(c), t(d))) - Math.max(lo, Math.min(t(c), t(d)));
      if (overlap > 0) close += overlap;
    }
    return close / 8 * ALONG_COST;
  }

  /** A route from `source` to `target`, first point on the source, last on the target. */
  route(source: RouteEnd, target: RouteEnd, ignoreExtra: readonly string[] = []): Point[] {
    const ignore = new Set([source.id, target.id, ...ignoreExtra]);
    const direct = (): Point[] => {
      let a = attachPoint(source, center(target.rect));
      const b = attachPoint(target, a);
      a = attachPoint(source, b);
      return [a, b];
    };
    const straight = direct();
    const clear = !this.blocked(straight[0]!, straight[1]!, ignore);
    if (clear && this.along(straight[0]!, straight[1]!, true, true) === 0) return straight;

    // Bend points: around the corners of the elements near the two ends' box.
    const box = inflate(union2(source.rect, target.rect), 260);
    const corners: Point[] = [];
    for (const o of this.obstacles) {
      if (ignore.has(o.id) || !overlapsRect(o.rect, box)) continue;
      for (const by of [CORNER, 2 * CORNER + 4]) for (const p of cornersOf(inflate(o.rect, by))) {
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
      if (i < 0 && j === goal) return clear ? distance(straight[0]!, straight[1]!) + CROSS_COST * this.crossings(straight[0]!, straight[1]!) + this.along(straight[0]!, straight[1]!, true, true) : Infinity;
      if (i < 0 && distance(from, to) < (source.straight ?? 0)) return Infinity;
      if (j === goal && distance(from, to) < (target.straight ?? 0)) return Infinity;
      if (this.blocked(from, to, ignore)) return Infinity;
      return distance(from, to) + BEND_COST + CROSS_COST * this.crossings(from, to) + this.along(from, to, i < 0, j === goal);
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
    const first = attachPoint(source, via[0]!), last = attachPoint(target, via.at(-1)!);
    return [first, ...via, last];
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
