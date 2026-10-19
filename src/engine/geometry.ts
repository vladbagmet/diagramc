export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

export const right = (r: Rect): number => r.x + r.width;
export const bottom = (r: Rect): number => r.y + r.height;
export const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by };
}

/** True when the interiors intersect (touching edges do not count). */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
}

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
  const h = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** True when `inner` lies within `outer`, allowing `tolerance` px. */
export function contains(outer: Rect, inner: Rect, tolerance = 0): boolean {
  return inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance &&
    right(inner) <= right(outer) + tolerance && bottom(inner) <= bottom(outer) + tolerance;
}

export function union(rects: readonly Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
  return { x, y, width: Math.max(...rects.map(right)) - x, height: Math.max(...rects.map(bottom)) - y };
}

export function boundsOfPoints(points: readonly Point[]): Rect {
  return union(points.map(p => ({ x: p.x, y: p.y, width: 0, height: 0 })));
}

/** True when the segment a-b passes through the interior of `r` (Liang-Barsky clipping). */
export function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const checks: [number, number][] = [[-dx, a.x - r.x], [dx, right(r) - a.x], [-dy, a.y - r.y], [dy, bottom(r) - a.y]];
  for (const [p, q] of checks) {
    if (p === 0) { if (q <= 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t1 - t0 > 1e-9;
}

/** Distance from point p to the segment a-b. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance between segments a-b and c-d (0 when they intersect or touch). */
export function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const cross = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b));
}

export function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }

/** Unit vector from a to b (zero vector when a equals b). */
export function direction(a: Point, b: Point): Point {
  const d = distance(a, b);
  return d === 0 ? { x: 0, y: 0 } : { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

/** Distance from point p to rectangle r (0 inside). */
export function distanceToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - right(r));
  const dy = Math.max(r.y - p.y, 0, p.y - bottom(r));
  return Math.hypot(dx, dy);
}

/** Distance from point p to the border of rectangle r. */
export function distanceToBorder(p: Point, r: Rect): number {
  const outside = distanceToRect(p, r);
  if (outside > 0) return outside;
  return Math.min(p.x - r.x, right(r) - p.x, p.y - r.y, bottom(r) - p.y);
}

/** Distance from point p to the ellipse inscribed in rectangle r (radial approximation, exact on the axes). */
export function distanceToEllipse(p: Point, r: Rect): number {
  const a = r.width / 2, b = r.height / 2, c = center(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  const t = Math.hypot(dx / a, dy / b);
  if (t === 0) return Math.min(a, b);
  return Math.hypot(dx - dx / t, dy - dy / t);
}

/** Removes consecutive duplicates and collinear interior points of a polyline. */
export function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    const prev = out.at(-2);
    if (prev && last && Math.abs((last.x - prev.x) * (p.y - last.y) - (last.y - prev.y) * (p.x - last.x)) < 0.01) out.pop();
    out.push({ ...p });
  }
  return out;
}

export function round2(n: number): number {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}
