import { theme } from '../../core/theme.js';
import { drawEdge } from '../../engine/edges.js';
import type { FontMetrics } from '../../engine/fonts.js';
import { baselineOffset, drawBox, drawFrame, drawNote } from '../../engine/shapes.js';
import { Canvas, num } from '../../engine/svg.js';
import { artifactIcon, componentIcon, drawBall, drawEllipse, drawJoint, drawNode3d, drawPort, drawSocket } from '../../engine/symbols.js';
import type { PlacedNode, StructScene } from './layout.js';

/** Icon at the top-right corner of a node's front face. */
function icon(node: PlacedNode): string[] {
  const { x, y, width } = node.bounds;
  const right = x + width - (node.node.shape === 'node3d' ? theme.size.nodeDepth : 0);
  const top = y + (node.node.shape === 'node3d' ? theme.size.nodeDepth : 0) + 7;
  if (node.node.icon === 'component') return [componentIcon(right - theme.size.componentIcon.width - 7, top)];
  if (node.node.icon === 'artifact') return [artifactIcon(right - theme.size.artifactIcon.width - 8, top)];
  return [];
}

/**
 * Draws a laid-out structure scene. Containers go to the frame layer (behind the
 * lines, which may run inside them), leaves above the lines, then ports and
 * interface symbols, then labels.
 */
export async function drawStructure(scene: StructScene, metrics: FontMetrics): Promise<string> {
  const canvas = new Canvas(metrics);
  if (scene.frame) canvas.frame.push(drawFrame(canvas, scene.frame.keyword, scene.frame.title, scene.frame.bounds));
  for (const n of scene.nodes) {
    const data = { id: n.node.id, type: n.node.type, parent: n.parent };
    const layer = n.container ? canvas.frame : canvas.nodes;
    switch (n.node.shape) {
      case 'note': layer.push(drawNote(canvas, n.noteRows ?? [], n.bounds, data)); break;
      case 'node3d': layer.push(drawNode3d(canvas, n.box!, n.bounds, data, { decorations: icon(n) })); break;
      case 'ellipse': layer.push(drawEllipse(canvas, n.box!, n.bounds, data, { textTop: n.ellipse!.textTop, ...(n.ellipse!.separatorY !== undefined ? { separatorY: n.ellipse!.separatorY } : {}), dashed: n.node.dashed !== false })); break;
      default: layer.push(drawBox(canvas, n.box!, n.bounds, data, { dashed: !!n.node.dashed, decorations: icon(n), middle: !n.container }));
    }
  }
  for (const edge of scene.edges) canvas.edges.push(drawEdge(edge));
  for (const s of scene.symbols) {
    const data = { id: s.id, type: s.kind === 'port' ? 'port' : s.kind === 'ball' ? 'provided-interface' : s.kind === 'socket' ? 'required-interface' : 'assembly', parent: s.parent };
    if (s.kind === 'port') canvas.nodes.push(drawPort(s.bounds, data));
    else if (s.kind === 'ball') canvas.nodes.push(drawBall(s.center, data));
    else if (s.kind === 'socket') canvas.nodes.push(drawSocket(s.center, s.u!, data));
    else canvas.nodes.push(drawJoint(s.center, s.u!, data));
  }
  for (const label of scene.labels) {
    const lh = metrics.lineHeight(label.style.size);
    const { x, y, width } = label.rect;
    const xs = label.widths.map(w => x + (width - w) / 2);
    canvas.labels.push(canvas.lines(label.lines, xs, y + baselineOffset(metrics, label.style.size, lh), lh, {
      ...label.style, fill: theme.color.edgeText, role: 'label', owner: label.owner, halo: true,
      data: label.end ? { 'data-uml-end': label.end, 'data-uml-anchor': `${num(label.anchor!.x)},${num(label.anchor!.y)}` } : {},
    }));
  }
  return canvas.finish({ width: scene.width, height: scene.height, kind: scene.kind, title: scene.frame?.title });
}
