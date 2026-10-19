import { theme } from '../core/theme.js';
import type { Point, Rect } from './geometry.js';

/**
 * Self-loops (an edge from a node to itself). The first loop sits on the node's
 * top-right corner (out of the top border, back into the right border), the
 * second on its bottom-right corner (out of the right border, back into the
 * bottom border); further loops nest on the right side between them. Corner
 * loops need no extra node height, so a class with one or two self-associations
 * keeps its natural size; only loops beyond the second stretch the node.
 *
 * End labels sit inside their loop: for corner loops in the quadrant the loop
 * encloses outside the node, for side loops in a band between the loop's leg and
 * the next inner leg. Both cases match the label sides `onlySide` -1 (source)
 * and 1 (target) of src/engine/labels.ts.
 *
 * Call `planSelfLoops` before layout (node `reserveRight`, `reserveAbove`,
 * `reserveBelow` and minimum height), then `selfLoopRoute` after layout.
 */

export interface SelfLoopSpec {
  /** Widest label near the source end (role name, multiplicity), 0 if none. */
  sourceLabelWidth?: number;
  /** Widest label near the target end, 0 if none. */
  targetLabelWidth?: number;
  /** Widest label near either end (used when the per-end widths are not given). */
  endLabelWidth: number;
  /** Labels stacked at the busier end (0, 1 or 2). */
  endLabelRows: number;
  /** Center label (association name, keyword) size, if any. */
  centerLabel?: { width: number; height: number } | undefined;
  labelHeight: number;
}

type Slot = 'top' | 'bottom' | 'side';
/** Gap between the corner loops' legs and the side loops (room for two arrowheads). */
const GROUP_GAP = 14;
/** Minimum distance between the legs of nested side loops: two arrowheads plus a gap. */
const MIN_BAND = 2 * theme.size.triangle.halfWidth + 6;
interface PlannedLoop {
  slot: Slot;
  /** Distance of the far leg from the right border. */
  extent: number;
  /** Side loops: half the distance between the legs. Corner loops: depth of the leg on the right border below the top (above the bottom). */
  halfSpan: number;
  /** Corner loops: distance of the leg on the top (bottom) border from the right border, and height above (below) the node. */
  inset?: number;
  rise?: number;
}

export interface SelfLoopPlan {
  /** Room to keep free right of the node. */
  reserveRight: number;
  /** Room to keep free above and below the node's right end (corner loops and their labels). */
  reserveAbove: { width: number; height: number } | undefined;
  reserveBelow: { width: number; height: number } | undefined;
  /** Minimum node height so all loops fit on the right border. */
  minHeight: number;
  loops: PlannedLoop[];
}

export function planSelfLoops(loops: readonly SelfLoopSpec[]): SelfLoopPlan {
  const rows = (l: SelfLoopSpec) => Math.max(1, l.endLabelRows) * (l.labelHeight + 2);
  const planned: PlannedLoop[] = [];
  let right = 0, above: SelfLoopPlan['reserveAbove'], below: SelfLoopPlan['reserveBelow'];
  let cornerDepth = 0;
  loops.slice(0, 2).forEach((loop, i) => {
    const source = loop.sourceLabelWidth ?? loop.endLabelWidth, target = loop.targetLabelWidth ?? loop.endLabelWidth;
    // The leg on the right border sits below the target labels' band; the far leg
    // leaves room for the target labels and the loop's top for the source labels.
    const depth = (loop.endLabelRows ? rows(loop) : 0) + 10;
    const inset = 16;
    const extent = Math.max(26, target + 14, source + 18 - inset);
    const rise = (loop.endLabelRows ? rows(loop) : 0) + 14;
    const slot: Slot = i === 0 ? 'top' : 'bottom';
    planned.push({ slot, extent, halfSpan: depth, inset, rise });
    const center = loop.centerLabel ? loop.centerLabel.width + 12 : 0;
    right = Math.max(right, extent + center + 10);
    const reserve = { width: inset + extent + center + 10, height: rise + (loop.centerLabel ? 0 : 0) + 8 };
    if (slot === 'top') above = reserve; else below = reserve;
    cornerDepth += depth;
  });
  // Further loops nest on the right side, between the corner loops' legs.
  let extent = 0, halfSpan = 4, previousCenter = 0;
  loops.slice(2).forEach((loop, i) => {
    // Legs of nested loops keep two arrowheads apart (the end-spacing gate).
    const band = Math.max(loop.endLabelRows ? loop.endLabelRows * (loop.labelHeight + 2) + 6 : 0, MIN_BAND);
    halfSpan += band;
    extent = Math.max(i === 0 ? 26 : extent + 16 + previousCenter, loop.endLabelWidth + 14);
    previousCenter = loop.centerLabel ? loop.centerLabel.width + 12 : 0;
    planned.push({ slot: 'side', extent, halfSpan });
  });
  if (loops.length > 2) right = Math.max(right, extent + previousCenter + 10);
  const side = loops.length > 2 ? 2 * halfSpan + 12 : 0;
  return {
    reserveRight: loops.length ? right : 0,
    reserveAbove: above, reserveBelow: below,
    minHeight: loops.length ? cornerDepth + side + (loops.length > 2 ? 2 * GROUP_GAP : loops.length === 2 ? MIN_BAND : 4) : 0,
    loops: planned,
  };
}

/** Route of loop `index` around node `rect`, from its source end back to its target end. */
export function selfLoopRoute(rect: Rect, plan: SelfLoopPlan, index: number): Point[] {
  const loop = plan.loops[index]!;
  const x = rect.x + rect.width, top = rect.y, bottom = rect.y + rect.height;
  const out = x + loop.extent;
  if (loop.slot === 'top') {
    const x0 = x - Math.min(loop.inset!, rect.width / 3), y = top + loop.halfSpan, up = top - loop.rise!;
    return [{ x: x0, y: top }, { x: x0, y: up }, { x: out, y: up }, { x: out, y }, { x, y }];
  }
  if (loop.slot === 'bottom') {
    const x0 = x - Math.min(loop.inset!, rect.width / 3), y = bottom - loop.halfSpan, down = bottom + loop.rise!;
    return [{ x, y }, { x: out, y }, { x: out, y: down }, { x: x0, y: down }, { x: x0, y: bottom }];
  }
  // Side loops are centered between the corner loops' legs.
  const corners = plan.loops.filter(l => l.slot !== 'side');
  const lo = top + (corners[0]?.halfSpan ?? 0) + GROUP_GAP, hi = bottom - (corners[1]?.halfSpan ?? 0) - GROUP_GAP;
  const cy = (lo + hi) / 2;
  return [{ x, y: cy - loop.halfSpan }, { x: out, y: cy - loop.halfSpan }, { x: out, y: cy + loop.halfSpan }, { x, y: cy + loop.halfSpan }];
}
