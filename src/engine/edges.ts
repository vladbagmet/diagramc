import { theme } from '../core/theme.js';
import { direction, distance, type Point } from './geometry.js';
import { el, num, pointsAttr } from './svg.js';

/**
 * UML line styles and end markers. Every relationship in every own-engine kind is
 * drawn with `drawEdge`, so notation is identical across kinds:
 *
 * | marker            | UML use                                                    |
 * |-------------------|------------------------------------------------------------|
 * | hollow-triangle   | generalization (solid), realization (dashed)               |
 * | open-arrow        | dependency (dashed), navigable association end, messages   |
 * | filled-triangle   | filled arrowheads (e.g. synchronous messages, transitions) |
 * | hollow-diamond    | shared aggregation, at the whole                           |
 * | filled-diamond    | composite aggregation, at the whole                        |
 * | cross             | non-navigable association end                              |
 * | circle-plus       | containment (nesting), at the owner                        |
 */
export type LineStyle = 'solid' | 'dashed';
export type Marker = 'none' | 'open-arrow' | 'filled-triangle' | 'hollow-triangle' | 'hollow-diamond' | 'filled-diamond' | 'cross' | 'circle-plus';

export interface EdgeData {
  /** Stable ID for QA and agents, e.g. the relationship's id or JSON Pointer. */
  id: string;
  type: string;
  source: string;
  target: string;
}

export interface EdgeSpec extends EdgeData {
  /** Route from the source node border to the target node border. */
  points: readonly Point[];
  style: LineStyle;
  sourceMarker: Marker;
  targetMarker: Marker;
  /**
   * Set false when another edge already drew the identical marker at the same
   * point (edges sharing a port, e.g. a generalization tree). The edge still
   * declares the marker in data-uml-*-marker, so QA checks it.
   */
  drawSourceMarker?: boolean;
  drawTargetMarker?: boolean;
  /**
   * Size of triangle markers when it is not theme.size.triangle (message
   * arrows use theme.size.messageTriangle). Declared on the marker as
   * data-uml-size, so the gates judge the real footprint.
   */
  triangleSize?: TriangleSize;
}

export interface TriangleSize {
  length: number;
  halfWidth: number;
}

/** How far the line must stop short of the end point so it does not show through the marker. */
function inset(marker: Marker, triangle: TriangleSize = theme.size.triangle): number {
  switch (marker) {
    case 'hollow-triangle':
    case 'filled-triangle':
      return triangle.length;
    case 'hollow-diamond':
    case 'filled-diamond':
      return theme.size.diamond.length;
    case 'circle-plus':
      return theme.size.circlePlus.radius * 2;
    default:
      return 0;
  }
}

function markerShape(marker: Marker, tip: Point, u: Point, end: 'source' | 'target', triangle?: TriangleSize): string {
  if (marker === 'none') return '';
  const n = { x: -u.y, y: u.x };
  const at = (along: number, across: number): Point => ({ x: tip.x - u.x * along + n.x * across, y: tip.y - u.y * along + n.y * across });
  const color = theme.color.edge,
    width = theme.stroke.edge;
  const sized = triangle !== undefined && marker.endsWith('triangle');
  const data = {
    'data-uml-role': 'marker',
    'data-uml-marker': marker,
    'data-uml-end': end,
    'data-uml-tip': `${num(tip.x)},${num(tip.y)}`,
    'data-uml-direction': `${num(u.x)},${num(u.y)}`,
    ...(sized ? { 'data-uml-size': `${num(triangle.length)},${num(triangle.halfWidth)}` } : {}),
  };
  const closed = (points: Point[], fill: string) =>
    el('polygon', { points: pointsAttr(points), fill, stroke: color, 'stroke-width': width, 'stroke-linejoin': 'miter', ...data });
  switch (marker) {
    case 'hollow-triangle':
    case 'filled-triangle': {
      const { length, halfWidth } = triangle ?? theme.size.triangle;
      return closed([tip, at(length, halfWidth), at(length, -halfWidth)], marker === 'filled-triangle' ? color : theme.color.background);
    }
    case 'hollow-diamond':
    case 'filled-diamond': {
      const { length, halfWidth } = theme.size.diamond;
      return closed([tip, at(length / 2, halfWidth), at(length, 0), at(length / 2, -halfWidth)], marker === 'filled-diamond' ? color : theme.color.background);
    }
    case 'open-arrow': {
      const { length, halfWidth } = theme.size.arrow;
      return el('polyline', {
        points: pointsAttr([at(length, halfWidth), tip, at(length, -halfWidth)]),
        fill: 'none',
        stroke: color,
        'stroke-width': width,
        'stroke-linejoin': 'miter',
        'stroke-linecap': 'round',
        ...data,
      });
    }
    case 'cross': {
      const { offset, half } = theme.size.cross;
      const d = `M${pt(at(offset - half, half))} L${pt(at(offset + half, -half))} M${pt(at(offset - half, -half))} L${pt(at(offset + half, half))}`;
      return el('path', { d, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', ...data });
    }
    case 'circle-plus': {
      const r = theme.size.circlePlus.radius,
        c = at(r, 0);
      const d = `M${pt(at(0, 0))} L${pt(at(2 * r, 0))} M${pt(at(r, r))} L${pt(at(r, -r))}`;
      return el('g', data, [
        el('circle', { cx: c.x, cy: c.y, r, fill: theme.color.background, stroke: color, 'stroke-width': width }),
        el('path', { d, fill: 'none', stroke: color, 'stroke-width': width }),
      ]);
    }
  }
}

const pt = (p: Point): string => `${num(p.x)},${num(p.y)}`;
/** Path data for an orthogonal polyline with small rounded bends. */
/**
 * Path data for an orthogonal polyline with small rounded bends. `keep` lengths at
 * the start and end stay straight (the part under an open arrowhead or a cross): a
 * bend next to them is rounded with a smaller radius, or not at all.
 */
export function roundedPath(points: readonly Point[], radius: number = theme.spacing.bendRadius, keep: { start?: number; end?: number } = {}): string {
  let d = `M${pt(points[0]!)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!,
      p = points[i]!,
      next = points[i + 1]!;
    const room = i === 1 ? distance(prev, p) - (keep.start ?? 0) : distance(prev, p) / 2;
    const after = i === points.length - 2 ? distance(p, next) - (keep.end ?? 0) : distance(p, next) / 2;
    const r = Math.min(radius, room, after, distance(prev, p) / 2, distance(p, next) / 2);
    const a = direction(p, prev),
      b = direction(p, next);
    if (r < 0.5) {
      d += ` L${pt(p)}`;
      continue;
    }
    d += ` L${pt({ x: p.x + a.x * r, y: p.y + a.y * r })} Q${pt(p)} ${pt({ x: p.x + b.x * r, y: p.y + b.y * r })}`;
  }
  return d + ` L${pt(points.at(-1)!)}`;
}

/** Moves the end point of a polyline back by `by` px along its last segment. */
function trimEnd(points: Point[], by: number): Point[] {
  if (by <= 0 || points.length < 2) return points;
  const last = points.at(-1)!,
    prev = points.at(-2)!;
  const len = distance(prev, last);
  const cut = Math.min(by, len);
  const u = direction(prev, last);
  return [...points.slice(0, -1), { x: last.x - u.x * cut, y: last.y - u.y * cut }];
}

/**
 * Draws one relationship: the line (solid or dashed, rounded orthogonal bends) and
 * both end markers. `data-uml-points` keeps the untrimmed route for QA.
 */
export function drawEdge(spec: EdgeSpec): string {
  const points = [...spec.points];
  if (points.length < 2) throw new Error(`Edge ${spec.id} has fewer than two points`);
  const sourceDir = direction(points[1]!, points[0]!),
    targetDir = direction(points.at(-2)!, points.at(-1)!);
  // Note anchors (type note-anchor) are drawn thin, dotted and lighter in every kind.
  const anchor = spec.type === 'note-anchor';
  const tri = spec.triangleSize;
  let line = trimEnd(points, inset(spec.targetMarker, tri));
  line = [...trimEnd([...line].reverse(), inset(spec.sourceMarker, tri))].reverse();
  return el(
    'g',
    {
      'data-uml-role': 'edge',
      'data-uml-id': spec.id,
      'data-uml-type': spec.type,
      'data-uml-source': spec.source,
      'data-uml-target': spec.target,
      'data-uml-source-marker': spec.sourceMarker,
      'data-uml-target-marker': spec.targetMarker,
      'data-uml-points': pointsAttr(points),
    },
    [
      el('path', {
        d: roundedPath(line, theme.spacing.bendRadius, {
          start: inset(spec.sourceMarker, tri) ? 0 : markerLength(spec.sourceMarker),
          end: inset(spec.targetMarker, tri) ? 0 : markerLength(spec.targetMarker),
        }),
        fill: 'none',
        stroke: anchor ? theme.color.anchor : theme.color.edge,
        'stroke-width': anchor ? theme.stroke.anchor : theme.stroke.edge,
        'stroke-dasharray': anchor ? theme.stroke.anchorDash : spec.style === 'dashed' ? theme.stroke.dash : undefined,
        'stroke-linejoin': 'round',
        'stroke-linecap': anchor ? 'round' : undefined,
      }),
      spec.drawSourceMarker === false ? '' : markerShape(spec.sourceMarker, points[0]!, sourceDir, 'source', tri),
      spec.drawTargetMarker === false ? '' : markerShape(spec.targetMarker, points.at(-1)!, targetDir, 'target', tri),
    ].filter(Boolean),
  );
}

export interface MessageArrowSpec {
  /** Edge (link) the arrow annotates. */
  owner: string;
  /** Groups the arrow with its labels (data-uml-group on both). */
  group: string;
  /** Sender and receiver of the messages the arrow stands for. */
  source: string;
  target: string;
  /** Tail and tip of the arrow. */
  from: Point;
  to: Point;
  style: LineStyle;
  marker: Marker;
}

/**
 * A short free-standing arrow beside a line, pointing in the direction of the
 * messages listed next to it (UML communication diagrams). It is not an edge:
 * it carries data-uml-role="message-arrow" and its owner's ID, and the QA gate
 * `message-arrows` checks that it is parallel to, and near, its owner's line.
 */
export function drawMessageArrow(spec: MessageArrowSpec): string {
  const u = direction(spec.from, spec.to);
  // Filled heads beside a line are smaller than relationship heads (theme.size.messageTriangle).
  const tri = theme.size.messageTriangle;
  const line = trimEnd([spec.from, spec.to], inset(spec.marker, tri));
  return el(
    'g',
    {
      'data-uml-role': 'message-arrow',
      'data-uml-owner': spec.owner,
      'data-uml-group': spec.group,
      'data-uml-source': spec.source,
      'data-uml-target': spec.target,
      'data-uml-marker': spec.marker,
      'data-uml-points': pointsAttr([spec.from, spec.to]),
    },
    [
      el('path', {
        d: `M${pt(line[0]!)} L${pt(line[1]!)}`,
        fill: 'none',
        stroke: theme.color.edge,
        'stroke-width': theme.stroke.edge,
        'stroke-dasharray': spec.style === 'dashed' ? theme.stroke.shortDash : undefined,
      }),
      markerShape(spec.marker, spec.to, u, 'target', tri),
    ].filter(Boolean),
  );
}
/** Length of a marker along the line. */
export function markerLength(marker: Marker): number {
  switch (marker) {
    case 'hollow-triangle':
    case 'filled-triangle':
      return theme.size.triangle.length;
    case 'hollow-diamond':
    case 'filled-diamond':
      return theme.size.diamond.length;
    case 'open-arrow':
      return theme.size.arrow.length;
    case 'cross':
      return theme.size.cross.offset + theme.size.cross.half;
    case 'circle-plus':
      return 2 * theme.size.circlePlus.radius;
    default:
      return 0;
  }
}
/** Half of a marker's width across the line. */
export function markerHalf(marker: Marker): number {
  switch (marker) {
    case 'hollow-triangle':
    case 'filled-triangle':
      return theme.size.triangle.halfWidth;
    case 'hollow-diamond':
    case 'filled-diamond':
      return theme.size.diamond.halfWidth;
    case 'open-arrow':
      return theme.size.arrow.halfWidth;
    case 'cross':
      return theme.size.cross.half;
    case 'circle-plus':
      return theme.size.circlePlus.radius;
    default:
      return 0;
  }
}
