import { theme } from '../core/theme.js';
import { markerHalf, type Marker } from './edges.js';
import { simplify, type Point, type Rect } from './geometry.js';

/**
 * Parallel relationships between one pair of nodes (five dependencies from one
 * package to another), drawn as a tidy bundle with each label beside its own
 * line. Every member is laid out as two edges through an invisible "hub" node
 * placed between the pair: the lines reach the hub close together (the end
 * spacing), fan out inside it so that each member's label fits between its own
 * line and the next, and gather again before they leave it:
 *
 *   ||||        lines arrive close together,
 *   | \ \ \     fan out (staggered jogs, outer lines first, so none cross),
 *   |a |b |c    run parallel with their labels between them,
 *   | / / /     and gather again before the other node.
 *   ||||
 *
 * The layout engine routes the pieces outside the hub, so the bundle gets room
 * and keeps clear of other nodes like any line.
 */

export interface BundleMember {
  id: string;
  /** Size of the member's center label, if it has one. */
  label?: { width: number; height: number } | undefined;
  /** Markers at both ends of the member. */
  markers: readonly Marker[];
}

export interface BundleHub {
  width: number;
  height: number;
  /** Per member: where its lines enter and leave the hub (relative to the hub's top-left corner). */
  enter: Point[];
  exit: Point[];
  /** Per member: its path through the hub, from `enter` to `exit`. */
  paths: Point[][];
  /** Per member: its label box, if it has a label. */
  labels: (Rect | undefined)[];
}

/** Gap between a label and its own line, and between the label and the next line. */
const LABEL_GAP = 6;
const LABEL_TO_NEXT = 14;
/** Gap along the lines between the labels and the nearest jog. */
const LABEL_CLEAR = LABEL_TO_NEXT;
/** Distance between the staggered jogs where the lines fan out. */
const JOG_STEP = theme.spacing.edgeEdge;

/** Spacing of parallel lines in a bundle: the end spacing, more for wide arrowheads. */
export function bundleSpacing(members: readonly BundleMember[]): number {
  const half = Math.max(0, ...members.flatMap(m => m.markers.map(markerHalf)));
  return Math.max(theme.spacing.endEnd, 2 * half + 6);
}

/**
 * The hub of a bundle whose lines run top to bottom (`vertical`) or left to
 * right. Lines enter on the first side (top or left) and leave on the opposite
 * one, in member order.
 */
export function bundleHub(members: readonly BundleMember[], vertical: boolean): BundleHub {
  const n = members.length;
  const spacing = bundleSpacing(members);
  const acrossOf = (m: BundleMember): number => m.label ? (vertical ? m.label.width : m.label.height) : 0;
  const alongOf = (m: BundleMember): number => m.label ? (vertical ? m.label.height : m.label.width) : 0;
  // Positions across the lines: at the ends d[i], in the middle D[i] (label i between line i and i+1).
  const need = (m: BundleMember): number => m.label ? Math.max(spacing, acrossOf(m) + LABEL_GAP + LABEL_TO_NEXT) : spacing;
  const P: number[] = [];
  members.forEach((_, i) => P.push(i ? P[i - 1]! + need(members[i - 1]!) : 0));
  const extent = P[n - 1]! + (members[n - 1]!.label ? LABEL_GAP + acrossOf(members[n - 1]!) : 0);
  const D = P.map(p => Math.round(p - extent / 2));
  const d = members.map((_, i) => (i - (n - 1) / 2) * spacing);
  // Outer lines fan out first and gather last, so no two lines cross.
  const rank = new Map<number, number>();
  const movers = members.map((_, i) => i).filter(i => Math.abs(D[i]! - d[i]!) > 0.5);
  movers.filter(i => D[i]! > d[i]!).forEach((i, k) => rank.set(i, k));
  movers.filter(i => D[i]! < d[i]!).reverse().forEach((i, k) => rank.set(i, k));
  const ranks = rank.size ? Math.max(...rank.values()) + 1 : 0;
  // Jogs keep LABEL_CLEAR from the labels along the lines, so a label stays nearer its own line than any jog.
  const zone = theme.spacing.bendRadius + 2 + (ranks ? LABEL_CLEAR + (ranks - 1) * JOG_STEP : 0);
  const along = Math.max(0, ...members.map(alongOf));
  const length = Math.ceil(along + 2 * zone);
  // Whole pixels, so the lines meet the layout's ports exactly.
  const halfAcross = Math.ceil(Math.max(extent / 2, ...d.map(Math.abs)) + 2);
  const at = (t: number, a: number): Point => vertical ? { x: halfAcross + a, y: t } : { x: t, y: halfAcross + a };
  const mid = length / 2;
  const paths = members.map((_, i) => {
    if (!rank.has(i)) return [at(0, d[i]!), at(length, d[i]!)];
    const r = rank.get(i)!;
    const t1 = mid - along / 2 - LABEL_CLEAR - r * JOG_STEP, t2 = mid + along / 2 + LABEL_CLEAR + r * JOG_STEP;
    return simplify([at(0, d[i]!), at(t1, d[i]!), at(t1, D[i]!), at(t2, D[i]!), at(t2, d[i]!), at(length, d[i]!)]);
  });
  const labels = members.map((m, i) => {
    if (!m.label) return undefined;
    const p = at(mid - alongOf(m) / 2, D[i]! + LABEL_GAP);
    return { x: p.x, y: p.y, width: m.label.width, height: m.label.height };
  });
  const width = vertical ? 2 * halfAcross : length, height = vertical ? length : 2 * halfAcross;
  return { width, height, enter: paths.map(p => p[0]!), exit: paths.map(p => p.at(-1)!), paths, labels };
}
