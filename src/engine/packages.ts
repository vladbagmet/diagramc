import { theme } from '../core/theme.js';
import type { FontMetrics, TextStyle } from './fonts.js';
import type { Rect } from './geometry.js';
import { baselineOffset, nodeAttributes, type NodeData } from './shapes.js';
import { Canvas, el, num } from './svg.js';
import { wrapText } from './text.js';

/**
 * UML package notation (UML 2.5.1 clause 12.2.4): a body rectangle with a tab on
 * its top-left corner. When the package shows its contents, the name (and any
 * keywords such as «profile») is drawn in the tab; when it shows no contents, the
 * tab is empty and the name sits centered in the body.
 *
 * `bounds` always covers tab and body. Package node groups carry
 * `data-uml-tab="x y w h"` so the QA gates know the outline: edges may end on the
 * tab or on the body, and labels inside a package must keep clear of its tab.
 */

export interface PackageHeader {
  /** Keyword lines without guillemets, e.g. ["profile"], drawn «profile». */
  keywords?: readonly string[] | undefined;
  name: string;
}

interface Row { text: string; rows: string[]; widths: number[]; style: TextStyle; lineHeight: number; fill?: string }

export interface MeasuredPackage {
  /** True when the package is drawn as a container (name in the tab). */
  container: boolean;
  tab: { width: number; height: number };
  /** Minimum size: for containers only the tab constrains the width. */
  width: number;
  height: number;
  rows: Row[];
}

const NAME: TextStyle = { size: theme.font.size.body, bold: true };
const KEYWORD: TextStyle = { size: theme.font.size.label };
const TAB_PAD_Y = 3;
const EMPTY_BODY_PAD = 12;

function headerRows(metrics: FontMetrics, header: PackageHeader): Row[] {
  const rows: Row[] = [];
  if (header.keywords?.length) {
    const text = `«${header.keywords.join(', ')}»`;
    rows.push({ text, rows: [text], widths: [metrics.measure(text, KEYWORD)], style: KEYWORD, lineHeight: metrics.lineHeight(KEYWORD.size), fill: theme.color.mutedText });
  }
  const name = wrapText(metrics, header.name, NAME, theme.size.maxNameWidth);
  rows.push({ text: header.name, rows: name, widths: name.map(r => metrics.measure(r.trimEnd(), NAME)), style: NAME, lineHeight: metrics.lineHeight(NAME.size) });
  return rows;
}

const contentHeight = (rows: readonly Row[]): number => rows.reduce((sum, r) => sum + r.rows.length * r.lineHeight, 0);
const contentWidth = (rows: readonly Row[]): number => Math.max(0, ...rows.flatMap(r => r.widths));

/** Measures a package drawn as a container (`container: true`) or as an empty package. */
export function measurePackage(metrics: FontMetrics, header: PackageHeader, container: boolean): MeasuredPackage {
  const rows = headerRows(metrics, header);
  const { padX } = theme.spacing;
  if (container) {
    const tab = {
      width: Math.max(theme.size.packageTab.minWidth, Math.ceil(contentWidth(rows) + 2 * padX)),
      height: Math.ceil(contentHeight(rows) + 2 * TAB_PAD_Y),
    };
    return { container, tab, width: tab.width + 2 * padX, height: tab.height + 2 * padX, rows };
  }
  const tab = { width: theme.size.packageTab.minWidth, height: theme.size.packageTab.height };
  const width = Math.max(theme.size.minNodeWidth, tab.width + padX, Math.ceil(contentWidth(rows) + 2 * padX));
  const height = tab.height + Math.ceil(contentHeight(rows) + 2 * EMPTY_BODY_PAD);
  return { container, tab, width, height, rows };
}

/** Rectangle of the tab of a package drawn at `bounds`. */
export function packageTabRect(measured: MeasuredPackage, bounds: Rect): Rect {
  return { x: bounds.x, y: bounds.y, width: Math.min(measured.tab.width, bounds.width), height: measured.tab.height };
}

/** Draws a package (tab and body) and its header text. Nested elements are drawn by the caller. */
export function drawPackageNode(canvas: Canvas, measured: MeasuredPackage, bounds: Rect, data: NodeData): string {
  const tab = packageTabRect(measured, bounds);
  const stroke = { stroke: theme.color.nodeStroke, 'stroke-width': theme.stroke.node };
  const parts = [
    el('rect', { x: tab.x, y: tab.y, width: tab.width, height: tab.height, fill: theme.color.nodeHeaderFill, ...stroke }),
    el('rect', { x: bounds.x, y: bounds.y + tab.height, width: bounds.width, height: bounds.height - tab.height, fill: measured.container ? theme.color.background : theme.color.nodeFill, ...stroke }),
  ];
  // Container: rows left-aligned in the tab. Empty package: rows centered in the body.
  const bodyTop = bounds.y + tab.height;
  let top = measured.container ? bounds.y + TAB_PAD_Y : bodyTop + (bounds.height - tab.height - contentHeight(measured.rows)) / 2;
  for (const row of measured.rows) {
    const xs = row.widths.map(w => measured.container ? bounds.x + theme.spacing.padX : bounds.x + (bounds.width - w) / 2);
    const baseline = top + baselineOffset(canvas.metrics, row.style.size, row.lineHeight);
    parts.push(canvas.lines(row.rows, xs, baseline, row.lineHeight, { ...row.style, fill: row.fill, role: 'text', owner: data.id }));
    top += row.rows.length * row.lineHeight;
  }
  return el('g', { ...nodeAttributes(data, bounds), 'data-uml-tab': `${num(tab.x)} ${num(tab.y)} ${num(tab.width)} ${num(tab.height)}` }, parts);
}
