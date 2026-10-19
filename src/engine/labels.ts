import { direction, distance, distanceToRect, inflate, overlapArea, segmentIntersectsRect, union, type Point, type Rect } from './geometry.js';

/**
 * Edge label placement with collision avoidance. End labels (role names,
 * multiplicities) are kept next to their end of the route, center labels
 * (names, keywords) next to a segment. Each label tries an ordered list of
 * candidate boxes and takes the first one that touches no node, marker, other
 * label or edge segment; if none is free, the least-overlapping one.
 */

export interface LabelRequest {
  id: string;
  width: number;
  height: number;
  /** Route of the edge the label belongs to, source border to target border. */
  route: readonly Point[];
  /** 'source'/'target' for end labels, 'center' for the middle. */
  at: 'source' | 'target' | 'center';
  /** Preferred side of the line: 1 or -1 (relative to the direction into the node for end labels). */
  side?: 1 | -1;
  /** Restrict end labels to one side (e.g. the inside of a self-loop). */
  onlySide?: 1 | -1;
  /** Minimum distance from the line, e.g. to clear an arrowhead or diamond. */
  clearance?: number;
  /** A position suggested by the layout engine (tried first for center labels, early for end labels). */
  suggestion?: Rect | undefined;
  /**
   * Explicit candidate boxes, best first, replacing the generated ones (labels
   * that belong to a point rather than a line, e.g. a port name). `route` and
   * `at` then only matter for the anchor check of end labels.
   */
  candidates?: readonly Rect[];
}

export interface Obstacles {
  rects: Rect[];
  segments: [Point, Point][];
  /** Edge ends that carry end labels; an end label must be nearer its own end than any of these. */
  ends?: Point[];
}

const GAP = 4;

function endCandidates(request: LabelRequest): Rect[] {
  const route = request.at === 'source' ? [...request.route].reverse() : request.route;
  const p = route.at(-1)!, q = route.at(-2)!;
  const u = direction(q, p), n = { x: -u.y, y: u.x };
  const segment = distance(q, p);
  const vertical = Math.abs(u.y) > Math.abs(u.x);
  const { width: w, height: h } = request;
  // Extent along the segment and across it (labels are axis-aligned boxes).
  const along = vertical ? h : w, across = vertical ? w : h;
  const clearance = Math.max(GAP + 1, request.clearance ?? 0);
  const box = (t0: number, a0: number, side: number): Rect => {
    const corners = [
      { x: p.x - u.x * t0 + n.x * side * a0, y: p.y - u.y * t0 + n.y * side * a0 },
      { x: p.x - u.x * (t0 + along) + n.x * side * (a0 + across), y: p.y - u.y * (t0 + along) + n.y * side * (a0 + across) },
    ];
    return union(corners.map(c => ({ x: c.x, y: c.y, width: 0, height: 0 })));
  };
  const preferred = request.side ?? 1;
  // A grid of boxes beside the end segment, nearest to the end point first. Steps
  // move by a label height along vertical lines and by a short hop across them,
  // so crowded ends still keep their labels close.
  const stepAlong = vertical ? h + 2 : 10, stepAcross = vertical ? 10 : h + 2;
  const candidates: { rect: Rect; score: number }[] = [];
  for (let j = 0; j < 6; j++) {
    const t = GAP - 1 + j * stepAlong;
    if (j > 0 && t + along > Math.max(segment, 3 * along)) break;
    for (let m = 0; m < 6; m++) {
      for (const side of request.onlySide ? [request.onlySide] : [preferred, -preferred]) {
        const rect = box(t, clearance + m * stepAcross, side);
        const near = Math.hypot(Math.max(rect.x - p.x, 0, p.x - (rect.x + rect.width)), Math.max(rect.y - p.y, 0, p.y - (rect.y + rect.height)));
        candidates.push({ rect, score: near + (side === preferred ? 0 : 0.5) });
      }
    }
  }
  const sorted = candidates.sort((a, b) => a.score - b.score).map(c => c.rect);
  // The layout engine reserved room for its own end-label position: try it early.
  if (request.suggestion) sorted.splice(Math.min(2, sorted.length), 0, request.suggestion);
  return sorted;
}

function centerCandidates(request: LabelRequest): Rect[] {
  const out: Rect[] = [];
  if (request.suggestion) out.push(request.suggestion);
  const segments = request.route.slice(1).map((p, i) => [request.route[i]!, p] as const)
    .map(([a, b], index) => ({ a, b, index, length: distance(a, b) }));
  const middle = (segments.length - 1) / 2;
  segments.sort((s, t) => (t.length - s.length) || (Math.abs(s.index - middle) - Math.abs(t.index - middle)));
  const { width: w, height: h } = request;
  for (const { a, b, length } of segments) {
    const vertical = Math.abs(b.x - a.x) < Math.abs(b.y - a.y);
    for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      const m = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      if (length < 2 && f !== 0.5) continue;
      if (vertical) {
        out.push({ x: m.x + GAP + 2, y: m.y - h / 2, width: w, height: h });
        out.push({ x: m.x - GAP - 2 - w, y: m.y - h / 2, width: w, height: h });
      } else {
        out.push({ x: m.x - w / 2, y: m.y - GAP - 1 - h, width: w, height: h });
        out.push({ x: m.x - w / 2, y: m.y + GAP + 1, width: w, height: h });
      }
    }
  }
  return out;
}

function cost(rect: Rect, obstacles: Obstacles, placed: readonly Rect[], anchor?: Point): number {
  let total = 0;
  if (anchor && obstacles.ends) {
    const own = distanceToRect(anchor, rect);
    for (const end of obstacles.ends) if (distance(end, anchor) > 1 && distanceToRect(end, rect) < own - 2) total += 300;
  }
  const padded = inflate(rect, 2);
  for (const r of obstacles.rects) total += overlapArea(padded, r) * 10;
  for (const r of placed) total += overlapArea(padded, r) * 10;
  const thin = inflate(rect, 1);
  for (const [a, b] of obstacles.segments) if (segmentIntersectsRect(a, b, thin)) total += 400;
  return total;
}

/** Places labels in order; earlier labels get the better spots. */
export function placeLabels(requests: readonly LabelRequest[], obstacles: Obstacles): Map<string, Rect> {
  const placed = new Map<string, Rect>();
  for (const request of requests) {
    const candidates = request.candidates ?? (request.at === 'center' ? centerCandidates(request) : endCandidates(request));
    let best: Rect | undefined, bestCost = Infinity;
    candidates.forEach((candidate, index) => {
      if (bestCost === 0) return;
      const anchor = request.at === 'source' ? request.route[0] : request.at === 'target' ? request.route.at(-1) : undefined;
      const base = cost(candidate, obstacles, [...placed.values()], anchor);
      const c = base ? base + index * 0.01 : 0;
      if (c < bestCost) { best = candidate; bestCost = c; }
    });
    if (best) placed.set(request.id, best);
  }
  return placed;
}
