import { theme } from '../core/theme.js';
import type { Point, Rect } from './geometry.js';
import { baselineOffset, nodeAttributes, type MeasuredBox, type NodeData } from './shapes.js';
import { Canvas, el, num, pointsAttr } from './svg.js';

/**
 * UML symbols of the structural kinds (component, deployment, composite
 * structure): port squares, provided-interface balls (lollipops),
 * required-interface sockets, assembly ball-and-socket joints, the component and
 * artifact icons, the 3D deployment node box and ellipses (collaborations).
 * Every symbol that edges attach to is a node group with the data-uml-*
 * attributes the QA gates read (see the `ports` gate in src/qa/gates.ts).
 */

const stroke = { stroke: theme.color.nodeStroke, 'stroke-width': theme.stroke.node };
const pt = (p: Point): string => `${num(p.x)},${num(p.y)}`;

/** The component icon (UML 2.5.1 11.6.4): a box with two small tabs on its left side. Top-left at (x, y). */
export function componentIcon(x: number, y: number): string {
  const { width: w, height: h } = theme.size.componentIcon;
  const tab = { width: 7, height: 3.5 };
  const bodyX = x + tab.width / 2;
  const line = { fill: theme.color.nodeFill, stroke: theme.color.nodeStroke, 'stroke-width': 1 };
  return el('g', { 'data-uml-role': 'icon', 'data-uml-icon': 'component' }, [
    el('rect', { x: bodyX, y, width: w - tab.width / 2, height: h, ...line }),
    el('rect', { x, y: y + h * 0.22, width: tab.width, height: tab.height, ...line }),
    el('rect', { x, y: y + h * 0.58, width: tab.width, height: tab.height, ...line }),
  ]);
}

/** The artifact icon (UML 2.5.1 19.3.4): a document with a folded top-right corner. Top-left at (x, y). */
export function artifactIcon(x: number, y: number): string {
  const { width: w, height: h } = theme.size.artifactIcon;
  const f = 4;
  const line = { fill: theme.color.nodeFill, stroke: theme.color.nodeStroke, 'stroke-width': 1, 'stroke-linejoin': 'round' };
  return el('g', { 'data-uml-role': 'icon', 'data-uml-icon': 'artifact' }, [
    el('path', { d: `M${num(x)},${num(y)} H${num(x + w - f)} L${num(x + w)},${num(y + f)} V${num(y + h)} H${num(x)} Z`, ...line }),
    el('path', { d: `M${num(x + w - f)},${num(y)} V${num(y + f)} H${num(x + w)}`, ...line, fill: 'none' }),
  ]);
}

/** A port: small square centered on its owner's border (`data.parent` = owner). */
export function drawPort(bounds: Rect, data: NodeData): string {
  return el('g', nodeAttributes(data, bounds), [
    el('rect', { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, fill: theme.color.nodeFill, ...stroke }),
  ]);
}

/** Bounds of a ball of radius r centered at c. */
export const ballBounds = (c: Point, r: number = theme.size.ball): Rect => ({ x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r });

/** A provided interface ball (the head of a lollipop); its stem is an edge ending on the circle. */
export function drawBall(c: Point, data: NodeData, r: number = theme.size.ball): string {
  return el('g', nodeAttributes({ ...data, extra: { ...data.extra, 'data-uml-ball': `${num(c.x)},${num(c.y)},${num(r)}` } }, ballBounds(c, r)), [
    el('circle', { cx: c.x, cy: c.y, r, fill: theme.color.background, ...stroke }),
  ]);
}

/** Half circle of radius r around c whose opening faces direction u. */
function socketArc(c: Point, u: Point, r: number): string {
  const n = { x: -u.y, y: u.x };
  const a = { x: c.x + n.x * r, y: c.y + n.y * r }, b = { x: c.x - n.x * r, y: c.y - n.y * r };
  return `M${pt(a)} A${num(r)},${num(r)} 0 0 1 ${pt(b)}`;
}

/** Bounds of a socket centered at c opening toward u (axis-aligned u). */
export function socketBounds(c: Point, u: Point, r: number = theme.size.socket): Rect {
  const back = { x: c.x - u.x * r, y: c.y - u.y * r };
  const xs = [c.x, back.x], ys = [c.y, back.y];
  if (u.x === 0) { xs.push(c.x - r, c.x + r); } else { ys.push(c.y - r, c.y + r); }
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/**
 * A required interface socket: a half circle centered at c that opens toward u
 * (away from its owner). Its stem is an edge ending on the back, at c - u * r.
 */
export function drawSocket(c: Point, u: Point, data: NodeData, r: number = theme.size.socket): string {
  return el('g', nodeAttributes({ ...data, extra: { ...data.extra, 'data-uml-socket': `${num(c.x)},${num(c.y)},${num(r)},${num(u.x)},${num(u.y)}` } }, socketBounds(c, u, r)), [
    el('path', { d: socketArc(c, u, r), fill: 'none', ...stroke, 'stroke-linecap': 'round' }),
  ]);
}

/**
 * An assembly connector's ball-and-socket joint (UML 2.5.1 11.6.4): the providing
 * side's ball sits in the requiring side's socket. The socket opens toward u (the
 * provider); the requiring line ends at the socket's back (c - u * R), the
 * providing line at c + u * R, and a stem continues from there to the ball.
 */
export function drawJoint(c: Point, u: Point, data: NodeData): string {
  const R = theme.size.socket, r = theme.size.ball;
  const bounds = { x: c.x - R, y: c.y - R, width: 2 * R, height: 2 * R };
  const extra = {
    ...data.extra,
    'data-uml-ball': `${num(c.x)},${num(c.y)},${num(r)}`,
    'data-uml-socket': `${num(c.x)},${num(c.y)},${num(R)},${num(u.x)},${num(u.y)}`,
  };
  return el('g', nodeAttributes({ ...data, extra }, bounds), [
    el('path', { d: `M${pt({ x: c.x + u.x * R, y: c.y + u.y * R })} L${pt({ x: c.x + u.x * r, y: c.y + u.y * r })}`, fill: 'none', stroke: theme.color.edge, 'stroke-width': theme.stroke.edge }),
    el('circle', { cx: c.x, cy: c.y, r, fill: theme.color.background, ...stroke }),
    el('path', { d: socketArc(c, u, R), fill: 'none', ...stroke, 'stroke-linecap': 'round' }),
  ]);
}

/** Draws the lines of measured compartments top-down inside `rect`, centered or left-aligned. */
export function drawCompartmentText(canvas: Canvas, compartments: MeasuredBox['compartments'], rect: Rect, owner: string): string[] {
  const { padX, padY, headerPadY } = theme.spacing;
  const parts: string[] = [];
  let y = rect.y;
  for (const c of compartments) {
    let rowTop = y + (c.header ? headerPadY : padY);
    for (const line of c.lines) {
      const xs = line.widths.map(w => line.align === 'center' ? rect.x + (rect.width - w) / 2 : rect.x + padX);
      const first = rowTop + baselineOffset(canvas.metrics, line.style.size, line.lineHeight);
      parts.push(canvas.lines(line.rows, xs, first, line.lineHeight, { ...line.style, fill: line.fill, role: 'text', owner }));
      if (line.underline) {
        line.rows.forEach((_, i) => {
          const uy = first + i * line.lineHeight + Math.max(1.5, line.style.size * 0.12);
          parts.push(el('line', { x1: xs[i]!, y1: uy, x2: xs[i]! + line.widths[i]!, y2: uy, stroke: line.fill ?? theme.color.text, 'stroke-width': 0.9 }));
        });
      }
      rowTop += line.rows.length * line.lineHeight;
    }
    y += c.height;
  }
  return parts;
}

/**
 * A deployment node (UML 2.5.1 19.4.4): a 3D box. `bounds` covers the whole
 * shape; the front face is `bounds` minus `depth` at the top and right. The
 * header (keyword, name) is drawn at the top of the front face, the remaining
 * compartments (if any) below it, separated by lines.
 */
export function drawNode3d(canvas: Canvas, box: MeasuredBox, bounds: Rect, data: NodeData, options: { above?: readonly string[]; middle?: boolean } = {}): string {
  const d = theme.size.nodeDepth;
  const { x, y, width: w, height: h } = bounds;
  const front = { x, y: y + d, width: w - d, height: h - d };
  const parts = [
    el('polygon', { points: pointsAttr([{ x, y: y + d }, { x: x + d, y }, { x: x + w, y }, { x: x + w - d, y: y + d }]), fill: theme.color.nodeDepthFill, ...stroke, 'stroke-linejoin': 'round' }),
    el('polygon', { points: pointsAttr([{ x: x + w - d, y: y + d }, { x: x + w, y }, { x: x + w, y: y + h - d }, { x: x + w - d, y: y + h }]), fill: theme.color.nodeDepthFill, ...stroke, 'stroke-linejoin': 'round' }),
    el('rect', { ...front, fill: theme.color.nodeFill, ...stroke }),
  ];
  let cy = front.y;
  box.compartments.forEach((c, i) => {
    if (i > 0) parts.push(el('line', { x1: front.x, y1: cy, x2: front.x + front.width, y2: cy, stroke: theme.color.nodeStroke, 'stroke-width': theme.stroke.compartment }));
    cy += c.height;
  });
  // `middle`: a node that only shows its name centers it vertically on the front face.
  const slack = options.middle && box.compartments.length === 1 ? Math.max(0, (front.height - box.height) / 2) : 0;
  parts.push(...drawCompartmentText(canvas, box.compartments, { ...front, y: front.y + slack }, data.id), ...options.above ?? []);
  return el('g', nodeAttributes(data, bounds), parts);
}

/**
 * An ellipse node (collaboration, collaboration use: UML 2.5.1 11.7.4), dashed.
 * `rows` are drawn centered from `top`; with `separatorY` a dashed chord
 * separates the name from the roles drawn below it.
 */
export function drawEllipse(canvas: Canvas, box: MeasuredBox, bounds: Rect, data: NodeData, options: { textTop: number; separatorY?: number; dashed?: boolean }): string {
  const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2, rx = bounds.width / 2, ry = bounds.height / 2;
  const parts = [el('ellipse', { cx, cy, rx, ry, fill: theme.color.nodeFill, ...stroke, 'stroke-dasharray': options.dashed === false ? undefined : theme.stroke.dash })];
  if (options.separatorY !== undefined) {
    const t = (options.separatorY - cy) / ry;
    const half = rx * Math.sqrt(Math.max(0, 1 - t * t));
    parts.push(el('line', { x1: cx - half, y1: options.separatorY, x2: cx + half, y2: options.separatorY, stroke: theme.color.nodeStroke, 'stroke-width': theme.stroke.compartment, 'stroke-dasharray': theme.stroke.dash }));
  }
  const textRect = { x: bounds.x, y: options.textTop, width: bounds.width, height: box.height };
  parts.push(...drawCompartmentText(canvas, box.compartments, textRect, data.id));
  return el('g', nodeAttributes({ ...data, extra: { ...data.extra, 'data-uml-shape': 'ellipse' } }, bounds), parts);
}
