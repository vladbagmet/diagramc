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
  return size * (1 + 0.9 * aspectPenalty(m.width, m.height) + (m.penalty ?? 0)) + 40 * (m.crossings ?? 0) + 0.04 * (m.edgeLength ?? 0);
}

/** Proper crossings between orthogonal or straight routes (shared end points and overlaps do not count). */
export function countCrossings(routes: readonly (readonly Point[])[]): number {
  const segments: [Point, Point, number][] = [];
  routes.forEach((r, i) => { for (let k = 1; k < r.length; k++) segments.push([r[k - 1]!, r[k]!, i]); });
  const cross = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  let count = 0;
  for (let i = 0; i < segments.length; i++) {
    const [a, b, ra] = segments[i]!;
    for (let j = i + 1; j < segments.length; j++) {
      const [c, d, rb] = segments[j]!;
      if (ra === rb) continue;
      if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x) || Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) continue;
      const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) count++;
    }
  }
  return count;
}

export const routesLength = (routes: readonly (readonly Point[])[]): number =>
  routes.reduce((sum, r) => sum + r.slice(1).reduce((s, p, k) => s + Math.hypot(p.x - r[k]!.x, p.y - r[k]!.y), 0), 0);

/**
 * Runs the candidates in order and returns the best one by `layoutScore` (the
 * first wins ties, so list the conventional layout first). `measure` turns a
 * candidate's result into a LayoutMeasure.
 */
export async function pickLayout<T>(candidates: readonly { penalty?: number; run: () => Promise<T> }[], measure: (result: T) => LayoutMeasure): Promise<T> {
  let best: T | undefined, bestScore = Infinity;
  for (const candidate of candidates) {
    const result = await candidate.run();
    const score = layoutScore({ ...measure(result), penalty: candidate.penalty ?? 0 });
    if (score < bestScore - 1e-6) { best = result; bestScore = score; }
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
}

/**
 * The layout chooser every layered own-engine kind uses: for each direction (the
 * conventional one first) it runs the plain layout, and adds the `narrow` variant
 * when the result is wider than 16:9 across the direction, or the `wrap` variant
 * (if allowed) when it is longer than 3:4 along it. The best by `layoutScore` wins.
 */
export async function chooseLayout<T>(directions: readonly Direction[], run: (dir: Direction, variant: LayoutVariant) => Promise<T>, measure: (result: T) => LayoutMeasure, options: ChooseOptions = {}): Promise<T> {
  let best: T | undefined, bestScore = Infinity;
  const consider = (result: T, penalty: number): void => {
    const score = layoutScore({ ...measure(result), penalty });
    if (score < bestScore - 1e-6) { best = result; bestScore = score; }
  };
  for (const [i, dir] of directions.entries()) {
    const penalty = options.penalty?.(i) ?? (i ? 0.15 : 0);
    // ELK fails on some port configurations in some directions: only the conventional layout must succeed.
    const tryRun = async (variant: LayoutVariant): Promise<T | undefined> => {
      if (i === 0 && variant === 'plain') return run(dir, variant);
      try { return await run(dir, variant); } catch { return undefined; }
    };
    const plain = await tryRun('plain');
    if (plain === undefined) continue;
    consider(plain, penalty);
    const { across, along } = extents(dir, measure(plain));
    const narrow = across > along * ASPECT_BAND.max ? await tryRun('narrow') : undefined;
    if (narrow !== undefined) consider(narrow, penalty + 0.05);
    const wrapped = options.wrap && along > across / ASPECT_BAND.min ? await tryRun('wrap') : undefined;
    if (wrapped !== undefined) consider(wrapped, penalty + 0.15);
  }
  return best!;
}
