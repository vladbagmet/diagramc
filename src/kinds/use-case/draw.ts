import { theme } from '../../core/theme.js';
import { drawEdge } from '../../engine/edges.js';
import type { FontMetrics } from '../../engine/fonts.js';
import { baselineOffset, drawFrame, drawNote, nodeAttributes } from '../../engine/shapes.js';
import { Canvas, el, num } from '../../engine/svg.js';
import type { TextRow, UseCaseScene } from './layout.js';

/** Draws a laid-out use case diagram as a self-contained SVG document. */
export async function drawUseCaseDiagram(scene: UseCaseScene, metrics: FontMetrics): Promise<string> {
  const canvas = new Canvas(metrics);
  const stroke = { stroke: theme.color.nodeStroke, 'stroke-width': theme.stroke.node };
  if (scene.frame) canvas.frame.push(drawFrame(canvas, 'uc', scene.frame.title, scene.frame.bounds));

  // Subjects (system boundaries) below the edges: rectangle, name at the top center.
  for (const s of scene.subjects) {
    const b = s.bounds;
    const parts = [el('rect', { x: b.x, y: b.y, width: b.width, height: b.height, fill: theme.color.background, ...stroke })];
    parts.push(rowsAt(canvas, s.rows, b.x + b.width / 2, b.y + theme.spacing.headerPadY, s.subject.id, 'text'));
    canvas.frame.push(el('g', nodeAttributes({ id: s.subject.id, type: 'subject' }, b), parts));
  }

  for (const edge of scene.edges) canvas.edges.push(drawEdge(edge));

  for (const u of scene.useCases) {
    const b = u.bounds, m = u.measured;
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2, rx = b.width / 2, ry = b.height / 2;
    const parts = [el('ellipse', { cx, cy, rx, ry, fill: theme.color.nodeFill, ...stroke })];
    const top = cy - m.blockHeight / 2;
    const names = m.rows.slice(0, m.nameRows), points = m.rows.slice(m.nameRows);
    parts.push(rowsAt(canvas, names, cx, top, u.useCase.id, 'text'));
    if (points.length) {
      // Extension points compartment: a chord across the ellipse, then the points.
      const nameHeight = names.reduce((sum, r) => sum + metrics.lineHeight(r.style.size), 0);
      const y = top + nameHeight + 4;
      const half = rx * Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2));
      parts.push(el('line', { x1: cx - half, y1: y, x2: cx + half, y2: y, stroke: theme.color.nodeStroke, 'stroke-width': theme.stroke.compartment }));
      parts.push(rowsAt(canvas, points, cx, y + 4, u.useCase.id, 'text'));
    }
    canvas.nodes.push(el('g', nodeAttributes({ id: u.useCase.id, type: 'use-case', parent: u.parent, shape: 'ellipse' }, b), parts));
  }

  for (const a of scene.actors) {
    const b = a.bounds, cx = b.x + b.width / 2, head = 7;
    const neck = b.y + 2 * head + 1, hip = b.y + b.height * 0.62, arms = neck + 6;
    const d = `M${num(cx)},${num(neck)} V${num(hip)} M${num(b.x)},${num(arms)} H${num(b.x + b.width)} M${num(b.x + 2)},${num(b.y + b.height)} L${num(cx)},${num(hip)} L${num(b.x + b.width - 2)},${num(b.y + b.height)}`;
    canvas.nodes.push(el('g', nodeAttributes({ id: a.actor.id, type: 'actor' }, b), [
      el('circle', { cx, cy: b.y + head + 0.5, r: head, fill: theme.color.background, ...stroke }),
      el('path', { d, fill: 'none', ...stroke, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    ]));
    // The name is a caption under the figure (QA role "label", owned by the actor).
    canvas.labels.push(rowsAt(canvas, a.caption.rows, cx, a.caption.rect.y + 2, a.actor.id, 'label'));
  }

  for (const n of scene.notes) canvas.nodes.push(drawNote(canvas, n.rows, n.bounds, { id: n.id, type: 'note', parent: n.parent }));

  for (const label of scene.labels) {
    const size = theme.font.size.label, lh = metrics.lineHeight(size);
    const { x, y, width } = label.rect;
    canvas.labels.push(canvas.lines(label.lines, label.widths.map(w => x + (width - w) / 2), y + baselineOffset(metrics, size, lh), lh, {
      size, fill: theme.color.edgeText, role: 'label', owner: label.owner, halo: true,
      data: label.end ? { 'data-uml-end': label.end, 'data-uml-anchor': `${num(label.anchor!.x)},${num(label.anchor!.y)}` } : {},
    }));
  }
  return canvas.finish({ width: scene.width, height: scene.height, kind: 'use-case', title: scene.frame?.title });
}

/** Centered rows starting at `top`; one <text> per input string (its wrapped rows become tspans), so text stays literal. */
function rowsAt(canvas: Canvas, rows: readonly TextRow[], cx: number, top: number, owner: string, role: string): string {
  const parts: string[] = [];
  let y = top, k = 0;
  while (k < rows.length) {
    let end = k + 1;
    while (end < rows.length && rows[end]!.group === rows[k]!.group) end++;
    const run = rows.slice(k, end), style = run[0]!.style, lh = canvas.metrics.lineHeight(style.size);
    parts.push(canvas.lines(run.map(r => r.text), run.map(r => cx - r.width / 2), y + baselineOffset(canvas.metrics, style.size, lh), lh, {
      ...style, fill: run[0]!.fill, role, owner, ...(role === 'label' ? { halo: true } : {}),
    }));
    y += run.length * lh;
    k = end;
  }
  return parts.join('');
}
