import { direction, distance, distanceToRect, inflate, overlapArea, segmentDistance, segmentIntersectsRect, union, type Point, type Rect } from './geometry.js';

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
  /**
   * Center labels: positions along each segment (0 to 1) tried after the default
   * ones, for crowded drawings where the default spots are all taken.
   */
  fractions?: readonly number[];
  /**
   * The edge the label belongs to. With `Obstacles.lines`, a spot where another
   * line is less than twice as far as this one is avoided (the reader could not
   * tell which line the label names); center labels also avoid spots far from
   * their line.
   */
  owner?: string;
}

export interface Obstacles {
  rects: Rect[];
  segments: [Point, Point][];
  /** Edge ends that carry end labels; an end label must be nearer its own end than any of these. */
  ends?: Point[];
  /** Every line by owner, for the ambiguity check of center labels (see LabelRequest.owner). */
  lines?: readonly { owner: string; points: readonly Point[] }[];
}

/** Gap kept between a label and any node or marker (the QA gate's clearance). */
export const LABEL_CLEARANCE = 3;
/** Another line must be at least this many times as far from a label as its own line (the gate's LABEL_RIVAL_FACTOR). */
const RIVAL_FACTOR = 2;
/** Extra room for the difference between a label's box and its drawn glyphs, which the gate measures. */
const RIVAL_MARGIN = 9;
/** Cost of a spot that is acceptable but not clean (below 1: labelFits still accepts it). */
const SOFT = 0.5;
/** A center label farther than this from its line starts to read as loose. */
const CENTER_NEAR = 10;

/** Distance between a rectangle and a segment (0 when they touch). */
export function rectSegmentDistance(r: Rect, a: Point, b: Point): number {
  if (segmentIntersectsRect(a, b, r)) return 0;
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
  return Math.min(distanceToRect(a, r), distanceToRect(b, r), ...corners.map((c, k) => segmentDistance(a, b, c, corners[(k + 1) % 4]!)));
}

/** True when segments a-b and c-d lie on one line and overlap. */
export function collinearOverlap(a: Point, b: Point, c: Point, d: Point): boolean {
  const horizontal = (p: Point, q: Point) => Math.abs(p.y - q.y) < 0.5,
    vertical = (p: Point, q: Point) => Math.abs(p.x - q.x) < 0.5;
  const overlap = (p0: number, p1: number, q0: number, q1: number) =>
    Math.min(Math.max(p0, p1), Math.max(q0, q1)) - Math.max(Math.min(p0, p1), Math.min(q0, q1)) > 0.5;
  if (horizontal(a, b) && horizontal(c, d) && Math.abs(a.y - c.y) < 0.5) return overlap(a.x, b.x, c.x, d.x);
  return vertical(a, b) && vertical(c, d) && Math.abs(a.x - c.x) < 0.5 ? overlap(a.y, b.y, c.y, d.y) : false;
}

const segmentsOf = (points: readonly Point[]): [Point, Point][] => points.slice(1).map((q, k) => [points[k]!, q]);

/**
 * Distance from a label box to its own line and to the nearest other line
 * (ignoring segments shared with its own line, and lines ending on it).
 */
export function labelLineDistances(rect: Rect, own: readonly Point[], others: readonly (readonly Point[])[]): { own: number; other: number } {
  const ownSegments = segmentsOf(own);
  const near = Math.min(...ownSegments.map(([a, b]) => rectSegmentDistance(rect, a, b)));
  let other = Infinity;
  for (const line of others)
    for (const [a, b] of segmentsOf(line)) {
      if (ownSegments.some(([c, d]) => collinearOverlap(a, b, c, d))) continue;
      other = Math.min(other, rectSegmentDistance(rect, a, b));
    }
  return { own: near, other };
}

const GAP = 4;

function endCandidates(request: LabelRequest): Rect[] {
  const route = request.at === 'source' ? [...request.route].reverse() : request.route;
  const p = route.at(-1)!,
    q = route.at(-2)!;
  const u = direction(q, p),
    n = { x: -u.y, y: u.x };
  const segment = distance(q, p);
  const vertical = Math.abs(u.y) > Math.abs(u.x);
  const { width: w, height: h } = request;
  // Extent along the segment and across it (labels are axis-aligned boxes).
  const along = vertical ? h : w,
    across = vertical ? w : h;
  const clearance = Math.max(GAP + 1, request.clearance ?? 0);
  // Slanted end segments (polyline routing): a w x h box whose nearest corner is t0
  // along the line from the end and a0 off it.
  const slanted = Math.abs(u.x) > 0.1 && Math.abs(u.y) > 0.1;
  const box = (t0: number, a0: number, side: number): Rect => {
    if (slanted) {
      const halfAlong = (w / 2) * Math.abs(u.x) + (h / 2) * Math.abs(u.y),
        halfAcross = (w / 2) * Math.abs(n.x) + (h / 2) * Math.abs(n.y);
      const c = { x: p.x - u.x * (t0 + halfAlong) + n.x * side * (a0 + halfAcross), y: p.y - u.y * (t0 + halfAlong) + n.y * side * (a0 + halfAcross) };
      return { x: c.x - w / 2, y: c.y - h / 2, width: w, height: h };
    }
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
  const stepAlong = vertical ? h + LABEL_CLEARANCE + 1 : 10,
    stepAcross = vertical ? 10 : h + LABEL_CLEARANCE + 1;
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
  const segments = request.route
    .slice(1)
    .map((p, i) => [request.route[i]!, p] as const)
    .map(([a, b], index) => ({ a, b, index, length: distance(a, b) }));
  const middle = (segments.length - 1) / 2;
  segments.sort((s, t) => t.length - s.length || Math.abs(s.index - middle) - Math.abs(t.index - middle));
  const { width: w, height: h } = request;
  for (const { a, b, length } of segments) {
    const vertical = Math.abs(b.x - a.x) < Math.abs(b.y - a.y);
    const diagonal = Math.abs(b.x - a.x) > 1 && Math.abs(b.y - a.y) > 1;
    for (const f of [0.5, 0.3, 0.7, 0.15, 0.85, 0.4, 0.6, 0.05, 0.95, ...(request.fractions ?? [])]) {
      const m = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      if (length < 2 && f !== 0.5) continue;
      if (diagonal) {
        // Slanted segments (polyline routing): push the box off the line along its
        // normal until its nearest corner is GAP away, on either side.
        const n = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
        const reach = GAP + 2 + (w / 2) * Math.abs(n.x) + (h / 2) * Math.abs(n.y);
        for (const side of [1, -1]) out.push({ x: m.x + n.x * reach * side - w / 2, y: m.y + n.y * reach * side - h / 2, width: w, height: h });
      } else if (vertical) {
        out.push({ x: m.x + GAP + 2, y: m.y - h / 2, width: w, height: h }, { x: m.x - GAP - 2 - w, y: m.y - h / 2, width: w, height: h });
      } else {
        out.push({ x: m.x - w / 2, y: m.y - GAP - 1 - h, width: w, height: h }, { x: m.x - w / 2, y: m.y + GAP + 1, width: w, height: h });
      }
    }
  }
  return out;
}

/** Cost of a label box: 0 when it touches nothing and names its line unambiguously. */
export function labelCost(rect: Rect, obstacles: Obstacles, placed: readonly Rect[], anchor: Point | undefined, request: LabelRequest): number {
  let total = 0;
  if (anchor && obstacles.ends) {
    const own = distanceToRect(anchor, rect);
    for (const end of obstacles.ends) if (distance(end, anchor) > 1 && distanceToRect(end, rect) < own - 2) total += 300;
  }
  if (request.owner !== undefined && obstacles.lines && !request.candidates) {
    // Every other line at least twice as far as the own line (gate label-proximity);
    // at an end, lines that end at the same point do not compete.
    const end = request.at === 'source' ? request.route[0] : request.at === 'target' ? request.route.at(-1) : undefined;
    const others = obstacles.lines
      .filter(l => l.owner !== request.owner && !(end && [l.points[0]!, l.points.at(-1)!].some(p => distance(p, end) < 0.5)))
      .map(l => l.points);
    const d = labelLineDistances(rect, request.route, others);
    if (request.at === 'center' && d.own > CENTER_NEAR) total += (d.own - CENTER_NEAR) * 20;
    if (d.other < Math.max(d.own + 4, RIVAL_FACTOR * d.own + 3)) total += 250;
    // Within reach of the gate's limit once the drawn glyphs are measured: acceptable, but worse than a clear spot.
    else if (d.other < RIVAL_FACTOR * d.own + RIVAL_MARGIN) total += SOFT;
  }
  const padded = inflate(rect, LABEL_CLEARANCE);
  for (const r of obstacles.rects) total += overlapArea(padded, r) * 10;
  for (const r of placed) total += overlapArea(padded, r) * 10;
  const thin = inflate(rect, 1);
  for (const [a, b] of obstacles.segments) if (segmentIntersectsRect(a, b, thin)) total += 400;
  return total;
}

/** True when the label has a spot that touches nothing and names its line unambiguously. */
export function labelFits(request: LabelRequest, obstacles: Obstacles): boolean {
  const candidates = request.candidates ?? (request.at === 'center' ? centerCandidates(request) : endCandidates(request));
  const anchor = request.at === 'source' ? request.route[0] : request.at === 'target' ? request.route.at(-1) : undefined;
  return candidates.some(c => labelCost(c, obstacles, [], anchor, request) < 1);
}

/** Places labels in order; earlier labels get the better spots. */
export function placeLabels(requests: readonly LabelRequest[], obstacles: Obstacles): Map<string, Rect> {
  const placed = new Map<string, Rect>();
  for (const request of requests) {
    const candidates = request.candidates ?? (request.at === 'center' ? centerCandidates(request) : endCandidates(request));
    let best: Rect | undefined,
      bestCost = Infinity;
    for (const [index, candidate] of candidates.entries()) {
      if (bestCost === 0) continue;
      const anchor = request.at === 'source' ? request.route[0] : request.at === 'target' ? request.route.at(-1) : undefined;
      const base = labelCost(candidate, obstacles, [...placed.values()], anchor, request);
      const c = base ? base + index * 0.001 : 0;
      if (c < bestCost) {
        best = candidate;
        bestCost = c;
      }
    }
    if (best) placed.set(request.id, best);
  }
  return placed;
}
