import type { Point, Rect } from './geometry.js';

/**
 * Self-loops (an edge from a node to itself) drawn as nested rectangular loops on
 * the node's right side: out of the right border above the middle, around, and
 * back into the right border below the middle. Loops never leave the space the
 * layout reserved (`reserveRight`), so they cannot be clipped by the canvas.
 *
 * Call `planSelfLoops` before layout to size the reservation and the node's
 * minimum height, then `selfLoopRoute` after layout.
 */

export interface SelfLoopSpec {
  /** Widest label near either end (role name, multiplicity), 0 if none. */
  endLabelWidth: number;
  /** Labels stacked at the busier end (0, 1 or 2). */
  endLabelRows: number;
  /** Center label (association name, keyword) size, if any. */
  centerLabel?: { width: number; height: number } | undefined;
  labelHeight: number;
}
export interface SelfLoopPlan {
  /** Room to keep free right of the node. */
  reserveRight: number;
  /** Minimum node height so all loops fit on the right border. */
  minHeight: number;
  loops: { extent: number; halfSpan: number }[];
}

export function planSelfLoops(loops: readonly SelfLoopSpec[]): SelfLoopPlan {
  // Loop i nests around loop i-1. Its end labels sit just inside its own legs, in a
  // band between its leg and the next inner leg; its center label sits right of
  // its vertical leg, inside the next outer loop.
  let extent = 0, halfSpan = 4, previousCenter = 0;
  const planned = loops.map((loop, i) => {
    const band = loop.endLabelRows ? loop.endLabelRows * (loop.labelHeight + 2) + 6 : 10;
    halfSpan += band;
    extent = Math.max(i === 0 ? 26 : extent + 16 + previousCenter, loop.endLabelWidth + 14);
    previousCenter = loop.centerLabel ? loop.centerLabel.width + 12 : 0;
    return { extent, halfSpan };
  });
  return {
    reserveRight: loops.length ? extent + previousCenter + 10 : 0,
    minHeight: loops.length ? 2 * halfSpan + 12 : 0,
    loops: planned,
  };
}

/** Route of loop `index` around node `rect`: from the right border (source) back to it (target). */
export function selfLoopRoute(rect: Rect, plan: SelfLoopPlan, index: number): Point[] {
  const loop = plan.loops[index]!;
  const x = rect.x + rect.width, cy = rect.y + rect.height / 2;
  const top = cy - loop.halfSpan, bottom = cy + loop.halfSpan, out = x + loop.extent;
  return [{ x, y: top }, { x: out, y: top }, { x: out, y: bottom }, { x, y: bottom }];
}
