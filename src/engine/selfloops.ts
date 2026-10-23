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

type Slot = 'top' | 'bottom' | 'top-left' | 'bottom-left' | 'side';
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
  /** With `leftCorners`: room left of the node and above and below its left end. */
  reserveLeft?: number;
  reserveAboveLeft?: { width: number; height: number } | undefined;
  reserveBelowLeft?: { width: number; height: number } | undefined;
  /** Minimum node height so all loops fit on the right border. */
  minHeight: number;
  loops: PlannedLoop[];
}

/**
 * `leftCorners`: the third and fourth loops sit on the top-left and bottom-left
 * corners (mirrored), so a node with up to four loops keeps its natural size;
 * further loops nest on the right side.
 */
export function planSelfLoops(loops: readonly SelfLoopSpec[], options: { leftCorners?: boolean } = {}): SelfLoopPlan {
  const rows = (l: SelfLoopSpec) => Math.max(1, l.endLabelRows) * (l.labelHeight + 2);
  const planned: PlannedLoop[] = [];
  let right = 0,
    above: SelfLoopPlan['reserveAbove'],
    below: SelfLoopPlan['reserveBelow'];
  let left = 0,
    aboveLeft: SelfLoopPlan['reserveAbove'],
    belowLeft: SelfLoopPlan['reserveBelow'];
  let cornerDepth = 0,
    leftDepth = 0;
  const corners = options.leftCorners ? 4 : 2;
  for (const [i, loop] of loops.slice(0, corners).entries()) {
    const source = loop.sourceLabelWidth ?? loop.endLabelWidth,
      target = loop.targetLabelWidth ?? loop.endLabelWidth;
    // The leg on the right border sits below the target labels' band; the far leg
    // leaves room for the target labels and the loop's top for the source labels.
    const depth = (loop.endLabelRows ? rows(loop) : 0) + 10;
    const inset = 16;
    const extent = Math.max(26, target + 20, source + 24 - inset);
    const rise = (loop.endLabelRows ? rows(loop) : 0) + 14;
    const slot: Slot = (['top', 'bottom', 'top-left', 'bottom-left'] as const)[i]!;
    planned.push({ slot, extent, halfSpan: depth, inset, rise });
    const center = loop.centerLabel ? loop.centerLabel.width + 12 : 0;
    const reserve = { width: inset + extent + center + 10, height: rise + 8 };
    if (i < 2) right = Math.max(right, extent + center + 10);
    else left = Math.max(left, extent + center + 10);
    switch (slot) {
      case 'top': {
        above = reserve;
        break;
      }
      case 'bottom': {
        below = reserve;
        break;
      }
      case 'top-left': {
        aboveLeft = reserve;
        break;
      }
      default:
        belowLeft = reserve;
    }
    if (i < 2) cornerDepth += depth;
    else leftDepth += depth;
  }
  // Further loops nest on the right side, between the corner loops' legs.
  let extent = 0,
    halfSpan = 4,
    previousCenter = 0;
  for (const [i, loop] of loops.slice(corners).entries()) {
    // Legs of nested loops keep two arrowheads apart (the end-spacing gate).
    const band = Math.max(loop.endLabelRows ? loop.endLabelRows * (loop.labelHeight + 2) + 6 : 0, MIN_BAND);
    halfSpan += band;
    extent = Math.max(i === 0 ? 26 : extent + 16 + previousCenter, loop.endLabelWidth + 14);
    previousCenter = loop.centerLabel ? loop.centerLabel.width + 12 : 0;
    planned.push({ slot: 'side', extent, halfSpan });
  }
  const sides = loops.length > corners;
  if (sides) right = Math.max(right, extent + previousCenter + 10);
  const side = sides ? 2 * halfSpan + 12 : 0;
  const rightHeight = cornerDepth + side + (sides ? 2 * GROUP_GAP : loops.length >= 2 ? MIN_BAND : 4);
  const leftHeight = leftDepth + (loops.length >= 4 ? MIN_BAND : 4);
  return {
    reserveRight: loops.length > 0 ? right : 0,
    reserveAbove: above,
    reserveBelow: below,
    ...(left ? { reserveLeft: left, reserveAboveLeft: aboveLeft, reserveBelowLeft: belowLeft } : {}),
    minHeight: loops.length > 0 ? Math.max(rightHeight, left ? leftHeight : 0) : 0,
    loops: planned,
  };
}

/** Route of loop `index` around node `rect`, from its source end back to its target end. */
export function selfLoopRoute(rect: Rect, plan: SelfLoopPlan, index: number): Point[] {
  const loop = plan.loops[index]!;
  const x = rect.x + rect.width,
    top = rect.y,
    bottom = rect.y + rect.height;
  const out = x + loop.extent;
  if (loop.slot === 'top') {
    const x0 = x - Math.min(loop.inset!, rect.width / 3),
      y = top + loop.halfSpan,
      up = top - loop.rise!;
    return [
      { x: x0, y: top },
      { x: x0, y: up },
      { x: out, y: up },
      { x: out, y },
      { x, y },
    ];
  }
  if (loop.slot === 'bottom') {
    const x0 = x - Math.min(loop.inset!, rect.width / 3),
      y = bottom - loop.halfSpan,
      down = bottom + loop.rise!;
    return [
      { x, y },
      { x: out, y },
      { x: out, y: down },
      { x: x0, y: down },
      { x: x0, y: bottom },
    ];
  }
  // Left corners mirror the right ones.
  const xl = rect.x,
    outLeft = xl - loop.extent;
  if (loop.slot === 'top-left') {
    const x0 = xl + Math.min(loop.inset!, rect.width / 3),
      y = top + loop.halfSpan,
      up = top - loop.rise!;
    return [
      { x: x0, y: top },
      { x: x0, y: up },
      { x: outLeft, y: up },
      { x: outLeft, y },
      { x: xl, y },
    ];
  }
  if (loop.slot === 'bottom-left') {
    const x0 = xl + Math.min(loop.inset!, rect.width / 3),
      y = bottom - loop.halfSpan,
      down = bottom + loop.rise!;
    return [
      { x: xl, y },
      { x: outLeft, y },
      { x: outLeft, y: down },
      { x: x0, y: down },
      { x: x0, y: bottom },
    ];
  }
  // Side loops are centered between the corner loops' legs.
  const corners = plan.loops.filter(l => l.slot === 'top' || l.slot === 'bottom');
  const lo = top + (corners[0]?.halfSpan ?? 0) + GROUP_GAP,
    hi = bottom - (corners[1]?.halfSpan ?? 0) - GROUP_GAP;
  const cy = (lo + hi) / 2;
  return [
    { x, y: cy - loop.halfSpan },
    { x: out, y: cy - loop.halfSpan },
    { x: out, y: cy + loop.halfSpan },
    { x, y: cy + loop.halfSpan },
  ];
}

/** Side of an end label inside loop `index` (the `onlySide` of src/engine/labels.ts): left-corner loops are mirrored. */
export function selfLoopLabelSide(plan: SelfLoopPlan, index: number, end: 'source' | 'target'): 1 | -1 {
  const mirrored = plan.loops[index]?.slot === 'top-left' || plan.loops[index]?.slot === 'bottom-left';
  return (end === 'source') === mirrored ? 1 : -1;
}
