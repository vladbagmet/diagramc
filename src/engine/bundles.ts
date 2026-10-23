import { theme } from '../core/theme.js';
import { markerHalf, type Marker } from './edges.js';
import { type Point, type Rect } from './geometry.js';

/**
 * Parallel relationships between one pair of nodes (five dependencies from one
 * package to another), drawn as a bundle of straight, evenly spaced lanes with each
 * label beside its own lane. Every member is laid out as two edges through an
 * invisible "hub" node placed between the pair; the members' ports on both nodes
 * are one lane pitch apart, so the lines run straight from node to node:
 *
 *   |  |  |      one lane per member,
 *   |a |b |c     each label right of (below) its own lane, nearer to it than to
 *   |  |  |      the next lane by at least the label-proximity factor.
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

/** Gap between a label and its own lane, and between the label and the next lane. */
const LABEL_GAP = 6;
const LABEL_TO_NEXT = 20;

/** Spacing of parallel lines without labels: the end spacing, more for wide arrowheads. */
export function bundleSpacing(members: readonly BundleMember[]): number {
  const half = Math.max(0, ...members.flatMap(m => m.markers.map(markerHalf)));
  return Math.max(theme.spacing.endEnd, 2 * half + 6);
}

/** Distance between neighbouring lanes: room for the widest label between two lanes. */
export function bundlePitch(members: readonly BundleMember[], vertical: boolean): number {
  const across = Math.max(0, ...members.map(m => m.label ? (vertical ? m.label.width : m.label.height) : 0));
  return Math.ceil(Math.max(bundleSpacing(members), across ? across + LABEL_GAP + LABEL_TO_NEXT : 0));
}

/**
 * The hub of a bundle whose lines run top to bottom (`vertical`) or left to
 * right. Lines enter on the first side (top or left) and leave on the opposite
 * one, in member order.
 */
export function bundleHub(members: readonly BundleMember[], vertical: boolean): BundleHub {
  const n = members.length;
  const pitch = bundlePitch(members, vertical);
  const acrossOf = (m: BundleMember): number => m.label ? (vertical ? m.label.width : m.label.height) : 0;
  const alongOf = (m: BundleMember): number => m.label ? (vertical ? m.label.height : m.label.width) : 0;
  // Lane positions across the bundle, centered; the last label sticks out beyond the last lane.
  const lane = members.map((_, i) => (i - (n - 1) / 2) * pitch);
  const lastLabel = members[n - 1]!.label ? LABEL_GAP + acrossOf(members[n - 1]!) : 0;
  const halfAcross = Math.ceil(Math.max(...lane.map(Math.abs)) + lastLabel + 2);
  const along = Math.max(0, ...members.map(alongOf));
  const length = Math.ceil(along + 2 * (theme.spacing.bendRadius + 2));
  const at = (t: number, a: number): Point => vertical ? { x: halfAcross + a, y: t } : { x: t, y: halfAcross + a };
  const mid = length / 2;
  const paths = members.map((_, i) => [at(0, lane[i]!), at(length, lane[i]!)]);
  const labels = members.map((m, i) => {
    if (!m.label) return;
    const p = at(mid - alongOf(m) / 2, lane[i]! + LABEL_GAP);
    return { x: p.x, y: p.y, width: m.label.width, height: m.label.height };
  });
  const width = vertical ? 2 * halfAcross : length, height = vertical ? length : 2 * halfAcross;
  return { width, height, enter: paths.map(p => p[0]!), exit: paths.map(p => p.at(-1)!), paths, labels };
}
