import { theme } from '../../core/theme.js';
import { drawEdge, drawMessageArrow } from '../../engine/edges.js';
import type { FontMetrics } from '../../engine/fonts.js';
import { baselineOffset, drawBox, drawFrame } from '../../engine/shapes.js';
import { Canvas, el } from '../../engine/svg.js';
import { LABEL, type CommScene } from './layout.js';

/** Draws a laid-out communication diagram as a self-contained SVG document. */
export async function drawCommunicationDiagram(scene: CommScene, metrics: FontMetrics): Promise<string> {
  const canvas = new Canvas(metrics);
  if (scene.frame) canvas.frame.push(drawFrame(canvas, 'sd', scene.frame.title, scene.frame.bounds));
  for (const link of scene.links) {
    canvas.edges.push(
      drawEdge({
        id: link.id,
        type: 'link',
        source: link.source,
        target: link.target,
        points: link.points,
        style: 'solid',
        sourceMarker: 'none',
        targetMarker: 'none',
      }),
    );
  }
  for (const arrow of scene.arrows) canvas.edges.push(drawMessageArrow(arrow));
  for (const node of scene.nodes) {
    const data = { id: node.lifeline.id, type: node.lifeline.multiObject ? 'multi-object' : 'lifeline' };
    const behind = node.back
      ? [
          el('rect', {
            x: node.back.x,
            y: node.back.y,
            width: node.back.width,
            height: node.back.height,
            fill: theme.color.nodeHeaderFill,
            stroke: theme.color.nodeStroke,
            'stroke-width': theme.stroke.node,
          }),
        ]
      : [];
    canvas.nodes.push(drawBox(canvas, node.box, node.front, data, { outline: node.bounds, behind }));
  }
  const lh = metrics.lineHeight(LABEL.size);
  const baseline = baselineOffset(metrics, LABEL.size, lh);
  for (const label of scene.labels) {
    const xs = label.widths.map(w => (label.align === 'right' ? label.x + label.width - w : label.x));
    canvas.labels.push(
      canvas.lines(label.rows, xs, label.y + baseline, lh, {
        ...LABEL,
        fill: theme.color.edgeText,
        role: 'label',
        owner: label.owner,
        halo: true,
        data: { 'data-uml-group': label.group },
      }),
    );
  }
  return canvas.finish({ width: scene.width, height: scene.height, kind: 'communication', title: scene.frame?.title });
}
