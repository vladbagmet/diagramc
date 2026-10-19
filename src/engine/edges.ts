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
}

/** How far the line must stop short of the end point so it does not show through the marker. */
function inset(marker: Marker): number {
  switch (marker) {
    case 'hollow-triangle': case 'filled-triangle': return theme.size.triangle.length;
    case 'hollow-diamond': case 'filled-diamond': return theme.size.diamond.length;
    case 'circle-plus': return theme.size.circlePlus.radius * 2;
    default: return 0;
  }
}

function markerShape(marker: Marker, tip: Point, u: Point, end: 'source' | 'target'): string {
  if (marker === 'none') return '';
  const n = { x: -u.y, y: u.x };
  const at = (along: number, across: number): Point => ({ x: tip.x - u.x * along + n.x * across, y: tip.y - u.y * along + n.y * across });
  const color = theme.color.edge, width = theme.stroke.edge;
  const data = { 'data-uml-role': 'marker', 'data-uml-marker': marker, 'data-uml-end': end, 'data-uml-tip': `${num(tip.x)},${num(tip.y)}`, 'data-uml-direction': `${num(u.x)},${num(u.y)}` };
  const closed = (points: Point[], fill: string) => el('polygon', { points: pointsAttr(points), fill, stroke: color, 'stroke-width': width, 'stroke-linejoin': 'miter', ...data });
  switch (marker) {
    case 'hollow-triangle': case 'filled-triangle': {
      const { length, halfWidth } = theme.size.triangle;
      return closed([tip, at(length, halfWidth), at(length, -halfWidth)], marker === 'filled-triangle' ? color : theme.color.background);
    }
    case 'hollow-diamond': case 'filled-diamond': {
      const { length, halfWidth } = theme.size.diamond;
      return closed([tip, at(length / 2, halfWidth), at(length, 0), at(length / 2, -halfWidth)], marker === 'filled-diamond' ? color : theme.color.background);
    }
    case 'open-arrow': {
      const { length, halfWidth } = theme.size.arrow;
      return el('polyline', { points: pointsAttr([at(length, halfWidth), tip, at(length, -halfWidth)]), fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linejoin': 'miter', 'stroke-linecap': 'round', ...data });
    }
    case 'cross': {
      const { offset, half } = theme.size.cross;
      const d = `M${pt(at(offset - half, half))} L${pt(at(offset + half, -half))} M${pt(at(offset - half, -half))} L${pt(at(offset + half, half))}`;
      return el('path', { d, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', ...data });
    }
    case 'circle-plus': {
      const r = theme.size.circlePlus.radius, c = at(r, 0);
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
export function roundedPath(points: readonly Point[], radius: number = theme.spacing.bendRadius): string {
  let d = `M${pt(points[0]!)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!, p = points[i]!, next = points[i + 1]!;
    const r = Math.min(radius, distance(prev, p) / 2, distance(p, next) / 2);
    const a = direction(p, prev), b = direction(p, next);
    if (r < 0.5) { d += ` L${pt(p)}`; continue; }
    d += ` L${pt({ x: p.x + a.x * r, y: p.y + a.y * r })} Q${pt(p)} ${pt({ x: p.x + b.x * r, y: p.y + b.y * r })}`;
  }
  return d + ` L${pt(points.at(-1)!)}`;
}

/** Moves the end point of a polyline back by `by` px along its last segment. */
function trimEnd(points: Point[], by: number): Point[] {
  if (by <= 0 || points.length < 2) return points;
  const last = points.at(-1)!, prev = points.at(-2)!;
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
  const sourceDir = direction(points[1]!, points[0]!), targetDir = direction(points.at(-2)!, points.at(-1)!);
  let line = trimEnd(points, inset(spec.targetMarker));
  line = [...trimEnd([...line].reverse(), inset(spec.sourceMarker))].reverse();
  return el('g', {
    'data-uml-role': 'edge', 'data-uml-id': spec.id, 'data-uml-type': spec.type,
    'data-uml-source': spec.source, 'data-uml-target': spec.target,
    'data-uml-source-marker': spec.sourceMarker, 'data-uml-target-marker': spec.targetMarker, 'data-uml-points': pointsAttr(points),
  }, [
    el('path', {
      d: roundedPath(line), fill: 'none', stroke: theme.color.edge, 'stroke-width': theme.stroke.edge,
      'stroke-dasharray': spec.style === 'dashed' ? theme.stroke.dash : undefined, 'stroke-linejoin': 'round',
    }),
    spec.drawSourceMarker === false ? '' : markerShape(spec.sourceMarker, points[0]!, sourceDir, 'source'),
    spec.drawTargetMarker === false ? '' : markerShape(spec.targetMarker, points.at(-1)!, targetDir, 'target'),
  ].filter(Boolean));
}
