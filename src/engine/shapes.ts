import { theme } from '../core/theme.js';
import type { FontMetrics, TextStyle } from './fonts.js';
import { Canvas, el, num, pointsAttr } from './svg.js';
import { wrapText } from './text.js';
import type { Rect } from './geometry.js';

/**
 * Shared UML shapes: compartment boxes (classifiers), notes with a folded corner,
 * package tab frames and the diagram frame with its pentagon heading. Each shape
 * has a measure step (size from text) and a draw step (at a position).
 * Every node group carries data-uml-role="node", data-uml-id, data-uml-type and
 * data-uml-bounds="x y w h" so the QA gates can check geometry exactly.
 */

export interface BoxLine {
  text: string;
  style: TextStyle;
  align: 'center' | 'left';
  underline?: boolean;
  fill?: string;
  /** Wrap to this many px (names); members are never wrapped. */
  wrap?: number;
}
export interface Compartment {
  lines: BoxLine[];
  /** The name compartment: tinted background and more padding. */
  header?: boolean;
}
interface MeasuredLine extends BoxLine {
  rows: string[];
  widths: number[];
  lineHeight: number;
}
export interface MeasuredBox {
  width: number;
  height: number;
  compartments: { height: number; header: boolean; lines: MeasuredLine[] }[];
}

const EMPTY_COMPARTMENT = 10;

export function measureBox(metrics: FontMetrics, compartments: readonly Compartment[], minWidth: number = theme.size.minNodeWidth): MeasuredBox {
  const { padX, padY, headerPadY } = theme.spacing;
  let width = minWidth;
  // Lines that are never wrapped (members) set the box width first; wrapped lines
  // (names) then use all of it, so a name only wraps when the box is narrower.
  for (const c of compartments)
    for (const line of c.lines) if (!line.wrap) width = Math.max(width, Math.ceil(metrics.measure(line.text, line.style) + 2 * padX));
  const measured = compartments.map(c => {
    const lines = c.lines.map((line): MeasuredLine => {
      const rows = line.wrap ? wrapText(metrics, line.text, line.style, Math.max(line.wrap, width - 2 * padX)) : [line.text];
      const widths = rows.map(r => metrics.measure(r.trimEnd(), line.style));
      for (const w of widths) width = Math.max(width, Math.ceil(w + 2 * padX));
      return { ...line, rows, widths, lineHeight: metrics.lineHeight(line.style.size) };
    });
    const content = lines.reduce((sum, l) => sum + l.rows.length * l.lineHeight, 0);
    const pad = c.header ? headerPadY : padY;
    return { header: !!c.header, lines, height: lines.length > 0 ? content + 2 * pad : EMPTY_COMPARTMENT };
  });
  return { width, height: measured.reduce((sum, c) => sum + c.height, 0), compartments: measured };
}

/**
 * `data-uml-starts`: for one <text> holding several logical lines (a keyword and a
 * name, a condition and an extension point), the indices of the rows that begin a
 * logical line. The QA wrap check then judges only the breaks inside a logical line.
 */
export function startsData(starts: readonly number[] | undefined): Record<string, string> {
  return starts && starts.length > 1 ? { 'data-uml-starts': starts.join(' ') } : {};
}

/** Baseline offset of a text row inside a line box of `lineHeight`. */
export function baselineOffset(metrics: FontMetrics, size: number, lineHeight: number): number {
  const ascent = metrics.ascent(size),
    descent = metrics.descent(size);
  return (lineHeight - ascent - descent) / 2 + ascent;
}

export interface NodeData {
  id: string;
  type: string;
  parent?: string | undefined;
  /** Outline for the edge-endpoint gate when it is not the bounding rectangle. */
  shape?: 'ellipse' | 'diamond' | undefined;
  /** ID of the node on whose border this one sits (entry/exit points); overlapping it is intended. */
  borderOf?: string | undefined;
  /** Extra data-uml-* attributes for QA (e.g. data-uml-shape="ellipse"). */
  extra?: Record<string, string> | undefined;
}

/** The mandatory data-uml-* attributes of a node group (shapes and kinds with their own node drawings). */
export function nodeAttributes(data: NodeData, bounds: Rect): Record<string, string> {
  return {
    'data-uml-role': 'node',
    'data-uml-id': data.id,
    'data-uml-type': data.type,
    ...(data.parent ? { 'data-uml-parent': data.parent } : {}),
    ...(data.shape ? { 'data-uml-shape': data.shape } : {}),
    ...(data.borderOf ? { 'data-uml-border-of': data.borderOf } : {}),
    'data-uml-bounds': `${num(bounds.x)} ${num(bounds.y)} ${num(bounds.width)} ${num(bounds.height)}`,
    ...data.extra,
  };
}

/**
 * Draws a compartment box at `bounds` (width from `measureBox`; height may be
 * larger, the last compartment absorbs the extra space). `behind` is drawn first
 * inside the node group (e.g. the back rectangle of a multi-object) and `outline`
 * replaces `bounds` as the node's QA bounds when the shape is larger than the box.
 */
export interface BoxOptions {
  dashed?: boolean;
  /** QA bounds when the shape is larger than the box (e.g. a multi-object's back rectangle). */
  outline?: Rect;
  /** Drawn first, under the box (e.g. the back rectangle of a multi-object). */
  behind?: readonly string[];
  /** Drawn last, over the box (e.g. a component or artifact icon). */
  above?: readonly string[];
  /** A box that is only a name compartment centers its lines vertically. */
  middle?: boolean;
}
export function drawBox(canvas: Canvas, box: MeasuredBox, bounds: Rect, data: NodeData, options: BoxOptions = {}): string {
  const { padX, padY, headerPadY } = theme.spacing;
  const parts: string[] = [
    ...(options.behind ?? []),
    el('rect', {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      fill: theme.color.nodeFill,
      stroke: theme.color.nodeStroke,
      'stroke-width': theme.stroke.node,
      'stroke-dasharray': options.dashed ? theme.stroke.dash : undefined,
    }),
  ];
  let y = bounds.y;
  for (const [index, c] of box.compartments.entries()) {
    const height = index === box.compartments.length - 1 ? bounds.y + bounds.height - y : c.height;
    if (c.header) {
      const inset = theme.stroke.node / 2;
      parts.push(el('rect', { x: bounds.x + inset, y: y + inset, width: bounds.width - 2 * inset, height: height - inset, fill: theme.color.nodeHeaderFill }));
    }
    if (index > 0)
      parts.push(
        el('line', { x1: bounds.x, y1: y, x2: bounds.x + bounds.width, y2: y, stroke: theme.color.nodeStroke, 'stroke-width': theme.stroke.compartment }),
      );
    const slack = options.middle && box.compartments.length === 1 ? Math.max(0, (height - c.height) / 2) : 0;
    let rowTop = y + (c.header ? headerPadY : padY) + slack;
    for (const line of c.lines) {
      // One <text> per logical line (wrapped rows become <tspan>s), so the
      // element's text content is the input string itself.
      const xs = line.widths.map(w => (line.align === 'center' ? bounds.x + (bounds.width - w) / 2 : bounds.x + padX));
      const first = rowTop + baselineOffset(canvas.metrics, line.style.size, line.lineHeight);
      parts.push(canvas.lines(line.rows, xs, first, line.lineHeight, { ...line.style, fill: line.fill, role: 'text', owner: data.id }));
      if (line.underline) {
        for (const [i] of line.rows.entries()) {
          const uy = first + i * line.lineHeight + Math.max(1.5, line.style.size * 0.12);
          parts.push(el('line', { x1: xs[i]!, y1: uy, x2: xs[i]! + line.widths[i]!, y2: uy, stroke: line.fill ?? theme.color.text, 'stroke-width': 0.9 }));
        }
      }
      rowTop += line.rows.length * line.lineHeight;
    }
    y += height;
  }
  parts.push(...(options.above ?? []));
  return el('g', nodeAttributes(data, options.outline ?? bounds), parts);
}

/** Size of a note holding `text`, wrapped to the theme's note width. */
export function measureNote(metrics: FontMetrics, text: string): { width: number; height: number; rows: string[] } {
  const style = { size: theme.font.size.body };
  const pad = 10,
    fold = theme.size.noteFold;
  let rows = wrapText(metrics, text, style, theme.size.maxNoteWidth);
  // A last row of one word ("one / shown.") looks orphaned: wrap narrower, with the
  // same number of rows, so the words spread evenly.
  const single = (r: readonly string[]): boolean => r.length >= 2 && !/\s/.test(r.at(-1)!.trim());
  if (single(rows)) {
    let lo: number = theme.size.maxNoteWidth / 2,
      hi: number = theme.size.maxNoteWidth;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      if (wrapText(metrics, text, style, mid).length === rows.length) hi = mid;
      else lo = mid;
    }
    const balanced = wrapText(metrics, text, style, hi);
    if (balanced.length === rows.length) rows = balanced;
  }
  const width = Math.max(60, Math.ceil(Math.max(...rows.map(r => metrics.measure(r.trimEnd(), style))) + 2 * pad + fold / 2));
  return { width, height: rows.length * metrics.lineHeight(style.size) + 2 * pad - 2, rows };
}

/** A UML note: rectangle with a folded top-right corner, left-aligned wrapped text. */
export function drawNote(canvas: Canvas, rows: readonly string[], bounds: Rect, data: NodeData, starts?: readonly number[]): string {
  const { x, y, width: w, height: h } = bounds;
  const f = theme.size.noteFold,
    size = theme.font.size.body,
    lh = canvas.metrics.lineHeight(size);
  const outline = `M${num(x)},${num(y)} H${num(x + w - f)} L${num(x + w)},${num(y + f)} V${num(y + h)} H${num(x)} Z`;
  const fold = `M${num(x + w - f)},${num(y)} V${num(y + f)} H${num(x + w)}`;
  const first = y + 9 + baselineOffset(canvas.metrics, size, lh);
  return el('g', nodeAttributes(data, bounds), [
    el('path', { d: outline, fill: theme.color.noteFill, stroke: theme.color.noteStroke, 'stroke-width': theme.stroke.note, 'stroke-linejoin': 'round' }),
    el('path', { d: fold, fill: 'none', stroke: theme.color.noteStroke, 'stroke-width': theme.stroke.note, 'stroke-linejoin': 'round' }),
    canvas.lines(
      rows,
      rows.map(() => x + 10),
      first,
      lh,
      { size, role: 'text', owner: data.id, data: startsData(starts) },
    ),
  ]);
}

/** Tab size for a package named `name` (the name sits in the tab). */
export function measurePackageTab(metrics: FontMetrics, name: string): { width: number; height: number } {
  const style = { size: theme.font.size.body, bold: true };
  return {
    width: Math.max(theme.size.packageTab.minWidth, Math.ceil(metrics.measure(name, style) + 2 * theme.spacing.padX)),
    height: metrics.lineHeight(style.size) + 6,
  };
}

/**
 * A UML package: a tab with the name on top of a body rectangle. `bounds` covers
 * tab and body; nested elements are drawn by the caller inside the body.
 */
export function drawPackage(canvas: Canvas, name: string, bounds: Rect, data: NodeData): string {
  const tab = measurePackageTab(canvas.metrics, name);
  const style = { size: theme.font.size.body, bold: true };
  const stroke = { fill: theme.color.nodeFill, stroke: theme.color.nodeStroke, 'stroke-width': theme.stroke.node };
  const baseline = bounds.y + baselineOffset(canvas.metrics, style.size, tab.height);
  return el('g', nodeAttributes(data, bounds), [
    el('rect', { x: bounds.x, y: bounds.y, width: tab.width, height: tab.height, ...stroke }),
    el('rect', { x: bounds.x, y: bounds.y + tab.height, width: bounds.width, height: bounds.height - tab.height, ...stroke }),
    canvas.text(name, bounds.x + theme.spacing.padX, baseline, { ...style, role: 'text', owner: data.id }),
  ]);
}

/** Size of the pentagon heading `<keyword> <name>` of a diagram frame. */
export function measureFrameHeading(metrics: FontMetrics, keyword: string, name: string): { width: number; height: number; keywordWidth: number } {
  const size = theme.font.size.body;
  const keywordWidth = metrics.measure(`${keyword} `, { size, bold: true });
  const width = Math.ceil(keywordWidth + metrics.measure(name, { size }) + 2 * theme.spacing.padX + 8);
  return { width, height: metrics.lineHeight(size) + 8, keywordWidth };
}

/**
 * The UML diagram frame (UML 2.5.1 Annex A): a rectangle around the diagram with a
 * heading in a pentagon (rectangle with the bottom-right corner cut) at top left,
 * e.g. **class** Ordering.
 */
export function drawFrame(canvas: Canvas, keyword: string, name: string, bounds: Rect): string {
  const heading = measureFrameHeading(canvas.metrics, keyword, name);
  const size = theme.font.size.body,
    cut = 8;
  const { x, y } = bounds,
    w = heading.width,
    h = heading.height;
  const baseline = y + baselineOffset(canvas.metrics, size, h);
  const tx = x + theme.spacing.padX;
  return el(
    'g',
    {
      'data-uml-role': 'frame',
      'data-uml-bounds': `${num(bounds.x)} ${num(bounds.y)} ${num(bounds.width)} ${num(bounds.height)}`,
      'data-uml-heading': `${num(x)} ${num(y)} ${num(w)} ${num(h)}`,
    },
    [
      el('rect', { x, y, width: bounds.width, height: bounds.height, fill: 'none', stroke: theme.color.frameStroke, 'stroke-width': theme.stroke.frame }),
      el('polygon', {
        points: pointsAttr([
          { x, y },
          { x: x + w, y },
          { x: x + w, y: y + h - cut },
          { x: x + w - cut, y: y + h },
          { x, y: y + h },
        ]),
        fill: theme.color.frameHeadingFill,
        stroke: theme.color.frameStroke,
        'stroke-width': theme.stroke.frame,
      }),
      canvas.text(`${keyword} `, tx, baseline, { size, bold: true, role: 'frame-label' }),
      canvas.text(name, tx + heading.keywordWidth, baseline, { size, role: 'frame-label' }),
    ],
  );
}
