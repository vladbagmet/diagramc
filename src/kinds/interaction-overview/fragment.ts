import { theme } from '../../core/theme.js';
import type { LineStyle, Marker } from '../../engine/edges.js';
import type { FontMetrics, TextStyle } from '../../engine/fonts.js';
import type { Point, Rect } from '../../engine/geometry.js';
import { measureFrameHeading } from '../../engine/shapes.js';
import { wrapText } from '../../engine/text.js';
import type { FragmentLifeline, FragmentMessage, InlineInteraction } from './model.js';

/**
 * A small sequence fragment inside an inline interaction (sd frame), laid out by
 * fixed rules instead of a graph layout: lifeline heads in one row, dashed
 * lifelines below them, messages as horizontal arrows in list order, each with
 * its label centered above it. Lifelines are spaced so every label fits between
 * the lifelines it connects. Coordinates are relative to the frame's top left.
 */

export const FRAGMENT_TEXT: TextStyle = { size: theme.font.size.label };
const PAD = 12, HEAD_PAD_X = 8, HEAD_PAD_Y = 4, MIN_HEAD = 56, MIN_GAP = 28, LABEL_ROOM = 36;
const SELF_WIDTH = 26, SELF_HEIGHT = 20, ROW_GAP = 14, MAX_LABEL = 220;

export interface FragmentHead { lifeline: FragmentLifeline; label: string; rect: Rect; width: number }
export interface FragmentLine { id: string; x: number; y1: number; y2: number }
export interface FragmentArrow { id: string; source: string; target: string; points: Point[]; style: LineStyle; marker: Marker; rows: string[]; widths: number[]; labelX: number[]; labelTop: number }
export interface FragmentLayout { width: number; height: number; headingHeight: number; heads: FragmentHead[]; lines: FragmentLine[]; arrows: FragmentArrow[] }

export const headLabel = (l: FragmentLifeline): string =>
  l.type === undefined ? l.name! : l.name === undefined ? `: ${l.type}` : `${l.name} : ${l.type}`;

export const fragmentMessageLabel = (m: FragmentMessage): string =>
  `${m.name}${m.arguments === undefined ? '' : `(${m.arguments.join(', ')})`}`;

export function layoutFragment(metrics: FontMetrics, node: InlineInteraction): FragmentLayout {
  const lh = metrics.lineHeight(FRAGMENT_TEXT.size);
  const heading = measureFrameHeading(metrics, 'sd', node.name);
  const index = new Map(node.lifelines.map((l, i) => [l.id, i]));
  const heads = node.lifelines.map(l => {
    const label = headLabel(l);
    const width = Math.ceil(metrics.measure(label, FRAGMENT_TEXT));
    return { lifeline: l, label, width, boxWidth: Math.max(MIN_HEAD, width + 2 * HEAD_PAD_X) };
  });
  const messages = node.messages.map((m, k) => {
    const rows = wrapText(metrics, fragmentMessageLabel(m), FRAGMENT_TEXT, MAX_LABEL);
    return { m, k, rows, widths: rows.map(r => Math.ceil(metrics.measure(r.trimEnd(), FRAGMENT_TEXT))), a: index.get(m.from)!, b: index.get(m.to)! };
  });

  // Horizontal: centers, widened until every label fits between its lifelines.
  const n = heads.length;
  const centers: number[] = [];
  heads.forEach((h, i) => centers.push(i === 0 ? PAD + h.boxWidth / 2 : centers[i - 1]! + heads[i - 1]!.boxWidth / 2 + MIN_GAP + h.boxWidth / 2));
  const push = (from: number, by: number) => { for (let i = from; i < n; i++) centers[i]! += by; };
  let rightEdge = 0;
  const bySpan = [...messages].sort((x, y) => Math.abs(x.a - x.b) - Math.abs(y.a - y.b));
  for (const msg of bySpan) {
    const label = Math.max(...msg.widths);
    if (msg.a === msg.b) {
      const need = SELF_WIDTH + 6 + label + 10;
      if (msg.a < n - 1) {
        const have = centers[msg.a + 1]! - heads[msg.a + 1]!.boxWidth / 2 - centers[msg.a]!;
        if (have < need) push(msg.a + 1, need - have);
      } else rightEdge = Math.max(rightEdge, centers[msg.a]! + need);
      continue;
    }
    const lo = Math.min(msg.a, msg.b), hi = Math.max(msg.a, msg.b);
    const have = centers[hi]! - centers[lo]!, need = label + LABEL_ROOM;
    if (have < need) push(hi, need - have);
  }
  let contentRight = Math.max(rightEdge, centers[n - 1]! + heads[n - 1]!.boxWidth / 2);
  let width = Math.max(contentRight + PAD, heading.width + 16);
  // Center narrow content under a wide heading.
  const extra = width - (contentRight + PAD);
  if (extra > 0) { for (let i = 0; i < n; i++) centers[i]! += extra / 2; contentRight += extra / 2; }
  width = Math.ceil(width);

  // Vertical: heads, then one row per message.
  const headTop = heading.height + 8, headHeight = lh + 2 * HEAD_PAD_Y, headBottom = headTop + headHeight;
  let y = headBottom + 8;
  const arrows: FragmentArrow[] = [];
  for (const msg of messages) {
    const id = msg.m.id ?? `${node.id}/messages/${msg.k}`;
    const sort = msg.m.sort ?? 'synchronous';
    const style: LineStyle = sort === 'reply' ? 'dashed' : 'solid';
    const marker: Marker = sort === 'synchronous' ? 'filled-triangle' : 'open-arrow';
    const xa = centers[msg.a]!, xb = centers[msg.b]!;
    const labelHeight = msg.rows.length * lh;
    const source = `${msg.m.from}::line`, target = `${msg.m.to}::line`;
    if (msg.a === msg.b) {
      const top = y + 4;
      const points = [{ x: xa, y: top }, { x: xa + SELF_WIDTH, y: top }, { x: xa + SELF_WIDTH, y: top + SELF_HEIGHT }, { x: xa, y: top + SELF_HEIGHT }];
      const labelTop = top + SELF_HEIGHT / 2 - labelHeight / 2;
      arrows.push({ id, source, target, points, style, marker, rows: msg.rows, widths: msg.widths, labelX: msg.widths.map(() => xa + SELF_WIDTH + 6), labelTop });
      y = Math.max(top + SELF_HEIGHT, labelTop + labelHeight) + ROW_GAP;
    } else {
      const arrowY = y + labelHeight + 3;
      const mid = (xa + xb) / 2;
      arrows.push({ id, source, target, points: [{ x: xa, y: arrowY }, { x: xb, y: arrowY }], style, marker, rows: msg.rows, widths: msg.widths, labelX: msg.widths.map(w => mid - w / 2), labelTop: y });
      y = arrowY + ROW_GAP;
    }
  }
  const lineBottom = y;
  const lines = heads.map((h, i) => ({ id: `${h.lifeline.id}::line`, x: centers[i]!, y1: headBottom, y2: lineBottom }));
  return {
    width, height: Math.ceil(lineBottom + 8), headingHeight: heading.height,
    heads: heads.map((h, i) => ({ lifeline: h.lifeline, label: h.label, width: h.width, rect: { x: centers[i]! - h.boxWidth / 2, y: headTop, width: h.boxWidth, height: headHeight } })),
    lines, arrows,
  };
}
