import { center, distance, type Point, type Rect } from './geometry.js';

/**
 * Outline shapes of nodes that are not rectangles. Edge routes from the layout
 * end on the node's bounding box; `clipRoute` moves the end onto the outline, so
 * lines touch ellipses (use cases, circles of pseudostates) and diamonds exactly.
 * The QA gates read the same shape from `data-uml-shape`.
 */
export type NodeShape = 'rect' | 'ellipse' | 'diamond';

/** Where the ray from `from` towards `to` first meets the outline of `shape` in `rect`. */
export function outlineHit(from: Point, to: Point, rect: Rect, shape: NodeShape): Point {
  const c = center(rect),
    a = rect.width / 2,
    b = rect.height / 2;
  const d = { x: to.x - from.x, y: to.y - from.y };
  const o = { x: from.x - c.x, y: from.y - c.y };
  let t: number | undefined;
  if (shape === 'ellipse') {
    // ((ox + t dx) / a)^2 + ((oy + t dy) / b)^2 = 1
    const A = (d.x / a) ** 2 + (d.y / b) ** 2,
      B = 2 * ((o.x * d.x) / a ** 2 + (o.y * d.y) / b ** 2),
      C = (o.x / a) ** 2 + (o.y / b) ** 2 - 1;
    const disc = B * B - 4 * A * C;
    if (A > 0 && disc >= 0) t = (-B - Math.sqrt(disc)) / (2 * A);
  } else if (shape === 'diamond') {
    // |ox + t dx| / a + |oy + t dy| / b = 1, smallest t >= 0 over the four sides.
    for (const [sx, sy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const den = (sx * d.x) / a + (sy * d.y) / b;
      if (Math.abs(den) < 1e-12) continue;
      const k = (1 - (sx * o.x) / a - (sy * o.y) / b) / den;
      const p = { x: o.x + k * d.x, y: o.y + k * d.y };
      if (k >= -1e-9 && Math.sign(p.x) !== -sx && Math.sign(p.y) !== -sy && (t === undefined || k < t)) t = k;
    }
  } else {
    return to;
  }
  return t === undefined ? to : { x: from.x + t * d.x, y: from.y + t * d.y };
}

/**
 * Moves the end of a route (`end` = 'source' for the first point, 'target' for
 * the last) from the bounding box onto the node outline. Axis-parallel end
 * segments keep their direction when the ray meets the outline; otherwise the
 * end aims at the node's center.
 */
export function clipRoute(points: readonly Point[], end: 'source' | 'target', rect: Rect, shape: NodeShape): Point[] {
  if (shape === 'rect' || points.length < 2) return [...points];
  const route = end === 'target' ? [...points] : [...points].reverse();
  const tip = route.at(-1)!,
    prev = route.at(-2)!;
  const c = center(rect);
  // Continue the last segment into the box; if it would only graze the outline, aim at the center.
  const far = {
    x: tip.x + ((tip.x - prev.x) / (distance(prev, tip) || 1)) * (rect.width + rect.height),
    y: tip.y + ((tip.y - prev.y) / (distance(prev, tip) || 1)) * (rect.width + rect.height),
  };
  const straight = outlineHit(prev, far, rect, shape);
  const along = distance(straight, far) < rect.width + rect.height && Math.abs(lateral(prev, tip, c)) < 0.35 * Math.min(rect.width, rect.height);
  const hit = along ? straight : outlineHit(prev, c, rect, shape);
  route[route.length - 1] = { x: hit.x, y: hit.y };
  if (!along && route.length > 2 && distance(prev, hit) < 1) route.pop();
  return end === 'target' ? route : route.reverse();
}

/** Signed distance of `c` from the line through a and b. */
function lateral(a: Point, b: Point, c: Point): number {
  const len = distance(a, b) || 1;
  return ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / len;
}

/**
 * Spreads line ends around an ellipse so that no two ends are closer than the
 * larger of their `min` px (polyline routes only: the end segments change their
 * slant). Ends keep their order around the outline and move in small steps along
 * it until they are far enough apart. `routes` is updated in place.
 */
export function spreadEllipseEnds(routes: Map<string, Point[]>, rect: Rect, ends: readonly { edge: string; end: 'source' | 'target'; min: number }[]): void {
  const c = center(rect),
    a = rect.width / 2,
    b = rect.height / 2;
  const pointAt = (t: number): Point => ({ x: c.x + a * Math.cos(t), y: c.y + b * Math.sin(t) });
  const items = ends
    .map(e => {
      const route = routes.get(e.edge)!;
      const p = e.end === 'source' ? route[0]! : route.at(-1)!;
      return { ...e, t: Math.atan2((p.y - c.y) / b, (p.x - c.x) / a) };
    })
    .sort((x, y) => x.t - y.t);
  if (items.length < 2) return;
  const step = 1 / Math.max(a, b);
  for (let pass = 0; pass < 400; pass++) {
    let moved = false;
    const pairs = items.length === 2 ? 1 : items.length;
    for (let i = 0; i < pairs; i++) {
      const x = items[i]!,
        y = items[(i + 1) % items.length]!;
      if (distance(pointAt(x.t), pointAt(y.t)) >= Math.max(x.min, y.min)) continue;
      x.t -= step;
      y.t += step;
      moved = true;
    }
    if (!moved) break;
  }
  for (const item of items) {
    const route = routes.get(item.edge)!;
    if (item.end === 'source') route[0] = pointAt(item.t);
    else route[route.length - 1] = pointAt(item.t);
  }
}

/** Distance from p to the outline of `shape` in `rect` (0 on the outline). */
export function distanceToOutline(p: Point, rect: Rect, shape: NodeShape): number {
  const c = center(rect);
  if (shape === 'rect') {
    const dx = Math.max(rect.x - p.x, 0, p.x - rect.x - rect.width),
      dy = Math.max(rect.y - p.y, 0, p.y - rect.y - rect.height);
    const outside = Math.hypot(dx, dy);
    return outside > 0 ? outside : Math.min(p.x - rect.x, rect.x + rect.width - p.x, p.y - rect.y, rect.y + rect.height - p.y);
  }
  if (distance(p, c) < 1e-9) return Math.min(rect.width, rect.height) / 2;
  // Distance along the ray from the center through p to the outline: exact on the
  // outline, a close upper bound near it (all the gate needs).
  const far = { x: c.x + (p.x - c.x) * 1e3, y: c.y + (p.y - c.y) * 1e3 };
  const hit = outlineHit(far, c, rect, shape);
  return distance(p, hit);
}
