import type { Direction } from './elk.js';
import type { Point } from './geometry.js';

/**
 * Choosing between layout candidates (directions, wrapped or unwrapped, packed or
 * not) by readability. Every own-engine kind that can lay itself out in more than
 * one way runs each candidate and keeps the one with the lowest `layoutScore`:
 *
 * - size: the square root of the area (a smaller drawing reads at a larger scale);
 * - aspect: a page or screen reads best between 4:3 and 16:9 landscape; outside that
 *   band the score grows with the logarithmic distance to it, so 1:3 portrait and 5:1
 *   panoramas lose against a compact alternative of similar size;
 * - crossings and total line length: each crossing costs, and so do long lines;
 * - detours: every pixel a route runs beyond the route-length limit (ROUTE_LIMIT,
 *   the same rule the route-length gate applies) costs as much as a pixel of size,
 *   so a compact candidate whose lines loop around the drawing loses against a
 *   longer one whose lines are short and direct;
 * - preference: a kind's conventional direction (superclasses above) gets a bonus
 *   over the alternatives, so the convention wins unless it is clearly worse.
 */

export interface LayoutMeasure {
  width: number;
  height: number;
  /** Number of line crossings. */
  crossings?: number;
  /** Sum of all route lengths. */
  edgeLength?: number;
  /** Sum of route lengths beyond ROUTE_LIMIT (see `routesDetour`). */
  detour?: number;
  /** Added to the score as a factor of the size term (0 = preferred, 0.1 = 10 % worse). */
  penalty?: number;
}

/** Landscape band considered ideal (width / height). */
export const ASPECT_BAND = { min: 4 / 3, max: 16 / 9 } as const;

/** Logarithmic distance of an aspect ratio to the ideal band (0 inside it). */
export function aspectPenalty(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;
  const r = width / height;
  if (r < ASPECT_BAND.min) return Math.log(ASPECT_BAND.min / r);
  if (r > ASPECT_BAND.max) return Math.log(r / ASPECT_BAND.max);
  return 0;
}

/** Lower is better. See the module comment for the terms. */
export function layoutScore(m: LayoutMeasure): number {
  const size = Math.sqrt(m.width * m.height);
  return size * (1 + 0.9 * aspectPenalty(m.width, m.height) + (m.penalty ?? 0)) + 40 * (m.crossings ?? 0) + 0.04 * (m.edgeLength ?? 0) + (m.detour ?? 0);
}

/**
 * A route may be at most `factor` times the Manhattan distance between its two
 * ends plus `slack` px long, and it may run at most `wander` px (plus `wanderShare`
 * of that distance) longer than the distance itself. Longer routes are detours: a
 * line leaving a node on the far side and running around the drawing. Shared by
 * layout scoring and the route-length gate (src/qa/gates.ts).
 */
export const ROUTE_LIMIT = { factor: 2.5, slack: 80, wander: 320, wanderShare: 0.05 } as const;

export const routeLength = (r: readonly Point[]): number => r.slice(1).reduce((s, p, k) => s + Math.hypot(p.x - r[k]!.x, p.y - r[k]!.y), 0);

/** The length limit of a route between two end points. */
export function routeLimit(a: Point, b: Point): number {
  const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  return Math.min(ROUTE_LIMIT.factor * d + ROUTE_LIMIT.slack, d * (1 + ROUTE_LIMIT.wanderShare) + ROUTE_LIMIT.wander);
}

/** Segments shorter than this do not count as a leg of a wrap-around (small jogs). */
const WRAP_LEG = 20;
/** Length a wrapping route must run beyond the distance between its ends to count. */
const WRAP_EXCESS = 60;

/**
 * Whether a route wraps around: it turns the same way three times in a row (its
 * heading rotates by 270 degrees, as when a line leaves the bottom of a node and
 * climbs round the drawing to enter its target from above) over legs of at least
 * WRAP_LEG px, and is at least WRAP_EXCESS px longer than the Manhattan distance
 * between its ends. A direct orthogonal route never rotates more than 180 degrees.
 */
export function wrapsAround(route: readonly Point[]): boolean {
  if (route.length < 5) return false;
  const a = route[0]!,
    b = route.at(-1)!;
  if (routeLength(route) - (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) < WRAP_EXCESS) return false;
  const turn = (k: number): number => {
    const p = route[k - 1]!,
      q = route[k]!,
      r = route[k + 1]!;
    return Math.sign((q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x));
  };
  const leg = (k: number): number => Math.hypot(route[k + 1]!.x - route[k]!.x, route[k + 1]!.y - route[k]!.y);
  for (let k = 1; k + 3 < route.length; k++) {
    const t = turn(k);
    if (t !== 0 && turn(k + 1) === t && turn(k + 2) === t && leg(k) >= WRAP_LEG && leg(k + 1) >= WRAP_LEG) return true;
  }
  return false;
}

/** Whether a route is a detour: longer than its routeLimit, or wrapping around. */
export function isDetour(route: readonly Point[], margin = 0): boolean {
  return route.length >= 2 && (routeLength(route) > routeLimit(route[0]!, route.at(-1)!) - margin || wrapsAround(route));
}

/**
 * Detour cost of routes: the length by which each exceeds its limit (or, for a
 * route that wraps around, its whole excess over the distance between its ends),
 * plus a fixed DETOUR_COST per such route (0 when every route is direct enough).
 */
export function routesDetour(routes: readonly (readonly Point[])[]): number {
  return routes.reduce((sum, r) => {
    if (r.length < 2) return sum;
    const length = routeLength(r),
      a = r[0]!,
      b = r.at(-1)!;
    const over = wrapsAround(r) ? length - (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) : length - routeLimit(a, b);
    return over > 0 ? sum + over + DETOUR_COST : sum;
  }, 0);
}
const DETOUR_COST = 200;

/** Proper crossings between orthogonal or straight routes (shared end points and overlaps do not count). */
export function countCrossings(routes: readonly (readonly Point[])[]): number {
  const segments: [Point, Point, number][] = [];
  for (const [i, r] of routes.entries()) {
    for (let k = 1; k < r.length; k++) segments.push([r[k - 1]!, r[k]!, i]);
  }
  const cross = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  let count = 0;
  for (let i = 0; i < segments.length; i++) {
    const [a, b, ra] = segments[i]!;
    for (let j = i + 1; j < segments.length; j++) {
      const [c, d, rb] = segments[j]!;
      if (ra === rb) continue;
      if (
        Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
        Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
        Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
        Math.max(c.y, d.y) < Math.min(a.y, b.y)
      )
        continue;
      const d1 = cross(c, d, a),
        d2 = cross(c, d, b),
        d3 = cross(a, b, c),
        d4 = cross(a, b, d);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) count++;
    }
  }
  return count;
}

export const routesLength = (routes: readonly (readonly Point[])[]): number => routes.reduce((sum, r) => sum + routeLength(r), 0);

/**
 * Runs the candidates in order and returns the best one by `layoutScore` (the
 * first wins ties, so list the conventional layout first). `measure` turns a
 * candidate's result into a LayoutMeasure.
 */
export async function pickLayout<T>(candidates: readonly { penalty?: number; run: () => Promise<T> }[], measure: (result: T) => LayoutMeasure): Promise<T> {
  let best: T | undefined,
    bestScore = Infinity;
  for (const candidate of candidates) {
    const result = await candidate.run();
    const score = layoutScore({ ...measure(result), penalty: candidate.penalty ?? 0 });
    if (score < bestScore - 1e-6) {
      best = result;
      bestScore = score;
    }
  }
  if (best === undefined) throw new Error('pickLayout needs at least one candidate');
  return best;
}

/**
 * ELK option sets for layered layout variants:
 * - plain: the default layering (shortest lines);
 * - narrow: MIN_WIDTH layering, more layers with fewer nodes each, for drawings
 *   that spread too far across the layout direction;
 * - wrap: graph wrapping, a long sequence of layers folded into rows (opt-in, see
 *   chooseLayout).
 */
export type LayoutVariant = 'plain' | 'narrow' | 'wrap';
export const LAYOUT_VARIANTS: Record<LayoutVariant, Record<string, string>> = {
  plain: {},
  narrow: { 'elk.layered.layering.strategy': 'MIN_WIDTH' },
  wrap: { 'elk.layered.wrapping.strategy': 'MULTI_EDGE', 'elk.aspectRatio': '1.6' },
};

/** Extent across and along the layout direction. */
function extents(dir: Direction, m: LayoutMeasure): { across: number; along: number } {
  return dir === 'DOWN' || dir === 'UP' ? { across: m.width, along: m.height } : { across: m.height, along: m.width };
}

export interface ChooseOptions {
  /** Penalty of the n-th direction (0 for the first, the kind's convention). */
  penalty?: (index: number) => number;
  /** Also try graph wrapping when a layout runs too far along its direction. */
  wrap?: boolean;
  /**
   * Opt-in: the longer side may be at most this many times the shorter one. A
   * candidate within the limit beats every candidate outside it, unless its score
   * is more than MAX_ASPECT_TOLERANCE times the best score.
   */
  maxAspect?: number;
}

/**
 * The better of a few finished candidates by `layoutScore`, with ChooseOptions.maxAspect
 * applied as in chooseLayout (used to compare the winners of separate chooseLayout runs).
 */
export function betterLayout<T>(candidates: readonly { result: T; penalty: number }[], measure: (result: T) => LayoutMeasure, maxAspect?: number): T {
  const scored = candidates.map(c => ({
    result: c.result,
    score: layoutScore({ ...measure(c.result), penalty: c.penalty }),
    within: maxAspect === undefined || elongation(measure(c.result)) <= maxAspect,
  }));
  const best = scored.reduce((a, b) => (b.score < a.score - 1e-6 ? b : a));
  if (best.within) return best.result;
  return scored.filter(c => c.within && c.score <= best.score * MAX_ASPECT_TOLERANCE).sort((a, b) => a.score - b.score)[0]?.result ?? best.result;
}

/** See ChooseOptions.maxAspect. */
export const MAX_ASPECT_TOLERANCE = 1.6;
/** See chooseLayout: no wrapped variant once a layout is at most this elongated. */
const WRAP_UNLESS = 2;

const elongation = (m: LayoutMeasure): number => (m.width > 0 && m.height > 0 ? Math.max(m.width / m.height, m.height / m.width) : 1);

/**
 * The layout chooser every layered own-engine kind uses: for each direction (the
 * conventional one first) it runs the plain layout, and adds the `narrow` variant
 * when the result is wider than 16:9 across the direction, or the `wrap` variant
 * (if allowed) when it is longer than 3:4 along it. The best by `layoutScore` wins.
 */
export async function chooseLayout<T>(
  directions: readonly Direction[],
  run: (dir: Direction, variant: LayoutVariant) => Promise<T>,
  measure: (result: T) => LayoutMeasure,
  options: ChooseOptions = {},
): Promise<T> {
  let best: T | undefined,
    bestScore = Infinity;
  const all: { result: T; score: number; within: boolean }[] = [];
  const consider = (result: T, penalty: number): void => {
    const score = layoutScore({ ...measure(result), penalty });
    all.push({ result, score, within: options.maxAspect === undefined || elongation(measure(result)) <= options.maxAspect });
    if (score < bestScore - 1e-6) {
      best = result;
      bestScore = score;
    }
  };
  const wraps: { dir: Direction; penalty: number; tryRun: (variant: LayoutVariant) => Promise<T | undefined> }[] = [];
  for (const [i, dir] of directions.entries()) {
    const penalty = options.penalty?.(i) ?? (i ? 0.15 : 0);
    // ELK fails on some port configurations in some directions: only the conventional layout must succeed.
    const tryRun = async (variant: LayoutVariant): Promise<T | undefined> => {
      if (i === 0 && variant === 'plain') return run(dir, variant);
      try {
        return await run(dir, variant);
      } catch {
        return undefined;
      }
    };
    const plain = await tryRun('plain');
    if (plain === undefined) continue;
    consider(plain, penalty);
    const { across, along } = extents(dir, measure(plain));
    const narrow = across > along * ASPECT_BAND.max ? await tryRun('narrow') : undefined;
    if (narrow !== undefined) consider(narrow, penalty + 0.05);
    // With an aspect limit, a plain layout within it needs no wrapping.
    const inLimit = options.maxAspect !== undefined && elongation(measure(plain)) <= options.maxAspect;
    if (options.wrap && !inLimit && along > across / ASPECT_BAND.min) wraps.push({ dir, penalty, tryRun });
  }
  // Wrapping is the last resort (slow, long lines): with an aspect limit, only when no
  // layout so far comes within WRAP_UNLESS of a square at a score close to the best.
  const settled = options.maxAspect !== undefined && all.some(c => elongation(measure(c.result)) <= WRAP_UNLESS && c.score <= bestScore * 1.15);
  for (const w of settled ? [] : wraps) {
    const wrapped = await w.tryRun('wrap');
    if (wrapped !== undefined) consider(wrapped, w.penalty + 0.15);
  }
  if (options.maxAspect !== undefined && !all.find(c => c.result === best)?.within) {
    const within = all.filter(c => c.within && c.score <= bestScore * MAX_ASPECT_TOLERANCE).sort((a, b) => a.score - b.score)[0];
    if (within) return within.result;
  }
  return best!;
}
