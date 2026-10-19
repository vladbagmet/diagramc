import { theme } from '../../core/theme.js';
import { drawEdge } from '../../engine/edges.js';
import type { FontMetrics } from '../../engine/fonts.js';
import { baselineOffset, drawBox, drawFrame, drawNote } from '../../engine/shapes.js';
import { Canvas, num } from '../../engine/svg.js';
import type { ClassScene } from './layout.js';

/** Draws a laid-out class diagram as a self-contained SVG document. */
export async function drawClassDiagram(scene: ClassScene, metrics: FontMetrics): Promise<string> {
  const canvas = new Canvas(metrics);
  if (scene.frame) canvas.frame.push(drawFrame(canvas, 'class', scene.frame.title, scene.frame.bounds));
  for (const edge of scene.edges) {
    canvas.edges.push(drawEdge(edge));
  }
  for (const node of scene.nodes) {
    const data = { id: node.element.id, type: node.element.type };
    canvas.nodes.push(node.rows ? drawNote(canvas, node.rows, node.bounds, data) : drawBox(canvas, node.box!, node.bounds, data));
  }
  for (const label of scene.labels) {
    const lh = metrics.lineHeight(label.style.size);
    const { x, y, width } = label.rect;
    // Multi-line center labels are centered line by line; single lines fill their box.
    const xs = label.widths.map(w => x + (width - w) / 2);
    canvas.labels.push(canvas.lines(label.lines, xs, y + baselineOffset(metrics, label.style.size, lh), lh, {
      ...label.style, fill: theme.color.edgeText, role: 'label', owner: label.owner, halo: true,
      data: label.end ? { 'data-uml-end': label.end, 'data-uml-anchor': `${num(label.anchor!.x)},${num(label.anchor!.y)}` } : {},
    }));
  }
  return canvas.finish({ width: scene.width, height: scene.height, kind: 'class', title: scene.frame?.title });
}
