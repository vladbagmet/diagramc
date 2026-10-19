import { theme } from '../../core/theme.js';
import { drawEdge } from '../../engine/edges.js';
import type { FontMetrics } from '../../engine/fonts.js';
import type { Rect } from '../../engine/geometry.js';
import { baselineOffset, drawFrame, measureFrameHeading } from '../../engine/shapes.js';
import { Canvas, el, num, pointsAttr } from '../../engine/svg.js';
import { FRAGMENT_TEXT } from './fragment.js';
import { GUARD, NAME, type OverviewScene, type OverviewSceneNode } from './layout.js';

const stroke = { stroke: theme.color.nodeStroke, 'stroke-width': theme.stroke.node };

function group(id: string, type: string, bounds: Rect, parts: string[], parent?: string): string {
  return el('g', {
    'data-uml-role': 'node', 'data-uml-id': id, 'data-uml-type': type, 'data-uml-parent': parent,
    'data-uml-bounds': `${num(bounds.x)} ${num(bounds.y)} ${num(bounds.width)} ${num(bounds.height)}`,
  }, parts);
}

/** Frame with a pentagon heading `keyword name` at its top left, as a node (ref and sd frames). */
function frameParts(canvas: Canvas, keyword: string, name: string, bounds: Rect, owner: string): string[] {
  const heading = measureFrameHeading(canvas.metrics, keyword, name);
  const size = theme.font.size.body, cut = 8, { x, y } = bounds, w = heading.width, h = heading.height;
  const baseline = y + baselineOffset(canvas.metrics, size, h), tx = x + theme.spacing.padX;
  return [
    el('rect', { x, y, width: bounds.width, height: bounds.height, fill: theme.color.nodeFill, ...stroke }),
    el('polygon', { points: pointsAttr([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h - cut }, { x: x + w - cut, y: y + h }, { x, y: y + h }]), fill: theme.color.nodeHeaderFill, stroke: theme.color.nodeStroke, 'stroke-width': theme.stroke.frame }),
    canvas.text(name ? `${keyword} ` : keyword, tx, baseline, { size, bold: true, role: 'text', owner }),
    ...(name ? [canvas.text(name, tx + heading.keywordWidth, baseline, { size, role: 'text', owner })] : []),
  ];
}

function drawNode(canvas: Canvas, entry: OverviewSceneNode): string {
  const { node, bounds: b } = entry, id = node.id;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2, edge = theme.color.edge;
  switch (node.type) {
    case 'initial':
      return group(id, node.type, b, [el('circle', { cx, cy, r: b.width / 2, fill: edge })]);
    case 'final':
      return group(id, node.type, b, [
        el('circle', { cx, cy, r: b.width / 2 - 0.6, fill: theme.color.background, stroke: edge, 'stroke-width': theme.stroke.edge }),
        el('circle', { cx, cy, r: b.width / 2 - 5.5, fill: edge }),
      ]);
    case 'flow-final': {
      const r = b.width / 2 - 0.6, k = r * Math.SQRT1_2;
      return group(id, node.type, b, [
        el('circle', { cx, cy, r, fill: theme.color.background, stroke: edge, 'stroke-width': theme.stroke.edge }),
        el('path', { d: `M${num(cx - k)},${num(cy - k)} L${num(cx + k)},${num(cy + k)} M${num(cx - k)},${num(cy + k)} L${num(cx + k)},${num(cy - k)}`, stroke: edge, 'stroke-width': theme.stroke.edge, fill: 'none' }),
      ]);
    }
    case 'decision': case 'merge':
      return group(id, node.type, b, [el('polygon', { points: pointsAttr([{ x: cx, y: b.y }, { x: b.x + b.width, y: cy }, { x: cx, y: b.y + b.height }, { x: b.x, y: cy }]), fill: theme.color.nodeFill, ...stroke, 'stroke-linejoin': 'miter' })]);
    case 'fork': case 'join':
      return group(id, node.type, b, [el('rect', { x: b.x, y: b.y, width: b.width, height: b.height, rx: 1, fill: edge })]);
    case 'interaction-use': {
      const lh = canvas.metrics.lineHeight(NAME.size);
      const top = b.y + entry.headingHeight! + (b.height - entry.headingHeight! - entry.rows!.length * lh) / 2 - 2;
      const xs = entry.widths!.map(w => cx - w / 2);
      return group(id, node.type, b, [
        ...frameParts(canvas, 'ref', '', b, id),
        canvas.lines(entry.rows!, xs, top + baselineOffset(canvas.metrics, NAME.size, lh), lh, { ...NAME, role: 'text', owner: id }),
      ]);
    }
    case 'interaction': {
      const f = entry.fragment!, ox = b.x, oy = b.y;
      const lh = canvas.metrics.lineHeight(FRAGMENT_TEXT.size), base = baselineOffset(canvas.metrics, FRAGMENT_TEXT.size, lh);
      const parts = frameParts(canvas, 'sd', node.name, b, id);
      for (const line of f.lines) {
        const r = { x: ox + line.x, y: oy + line.y1, width: 0, height: line.y2 - line.y1 };
        parts.push(group(line.id, 'lifeline-line', r, [el('line', { x1: r.x, y1: r.y, x2: r.x, y2: r.y + r.height, stroke: theme.color.nodeStroke, 'stroke-width': 1, 'stroke-dasharray': theme.stroke.shortDash })], id));
      }
      for (const head of f.heads) {
        const r = { x: ox + head.rect.x, y: oy + head.rect.y, width: head.rect.width, height: head.rect.height };
        parts.push(group(head.lifeline.id, 'lifeline', r, [
          el('rect', { x: r.x, y: r.y, width: r.width, height: r.height, fill: theme.color.nodeHeaderFill, ...stroke }),
          canvas.text(head.label, r.x + (r.width - head.width) / 2, r.y + baselineOffset(canvas.metrics, FRAGMENT_TEXT.size, r.height), { ...FRAGMENT_TEXT, role: 'text', owner: head.lifeline.id }),
        ], id));
      }
      for (const arrow of f.arrows) {
        parts.push(drawEdge({ id: arrow.id, type: 'message', source: arrow.source, target: arrow.target, points: arrow.points.map(p => ({ x: ox + p.x, y: oy + p.y })), style: arrow.style, sourceMarker: 'none', targetMarker: arrow.marker }));
        parts.push(canvas.lines(arrow.rows, arrow.labelX.map(x => ox + x), oy + arrow.labelTop + base, lh, { ...FRAGMENT_TEXT, fill: theme.color.edgeText, role: 'text', owner: arrow.id }));
      }
      return group(id, node.type, b, parts);
    }
  }
}

/** Draws a laid-out interaction overview diagram as a self-contained SVG document. */
export async function drawInteractionOverview(scene: OverviewScene, metrics: FontMetrics): Promise<string> {
  const canvas = new Canvas(metrics);
  if (scene.frame) canvas.frame.push(drawFrame(canvas, 'sd', scene.frame.title, scene.frame.bounds));
  for (const edge of scene.edges) {
    canvas.edges.push(drawEdge({ ...edge, type: 'control-flow', style: 'solid', sourceMarker: 'none', targetMarker: 'open-arrow' }));
  }
  for (const node of scene.nodes) canvas.nodes.push(drawNode(canvas, node));
  const lh = metrics.lineHeight(GUARD.size);
  for (const label of scene.labels) {
    canvas.labels.push(canvas.text(label.text, label.rect.x, label.rect.y + baselineOffset(metrics, GUARD.size, lh), {
      ...GUARD, fill: theme.color.edgeText, role: 'label', owner: label.owner, halo: true,
      data: { 'data-uml-end': 'source', 'data-uml-anchor': `${num(label.anchor.x)},${num(label.anchor.y)}` },
    }));
  }
  return canvas.finish({ width: scene.width, height: scene.height, kind: 'interaction-overview', title: scene.frame?.title });
}
