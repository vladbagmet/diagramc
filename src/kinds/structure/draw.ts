import { theme } from '../../core/theme.js';
import { drawEdge } from '../../engine/edges.js';
import type { FontMetrics } from '../../engine/fonts.js';
import { baselineOffset, drawBox, drawFrame, drawNote, startsData } from '../../engine/shapes.js';
import { Canvas, num } from '../../engine/svg.js';
import { inflate, overlaps, type Rect } from '../../engine/geometry.js';
import { artifactIcon, componentIcon, drawBall, drawEllipse, drawJoint, drawNode3d, drawPort, drawSocket } from '../../engine/symbols.js';
import type { PlacedNode, StructScene } from './layout.js';

const ICON_GAP = 4;

/**
 * Icon at the top-right corner of a node's front face. A port square straddling
 * the border next to that corner pushes the icon left or down (whichever moves it
 * less), so the square never touches it.
 */
function icon(node: PlacedNode, ports: readonly Rect[]): string[] {
  const { x, y, width } = node.bounds;
  const right = x + width - (node.node.shape === 'node3d' ? theme.size.nodeDepth : 0);
  const size = node.node.icon === 'component' ? theme.size.componentIcon : node.node.icon === 'artifact' ? theme.size.artifactIcon : undefined;
  if (!size) return [];
  let at = { x: right - size.width - (node.node.icon === 'component' ? 7 : 8), y: y + (node.node.shape === 'node3d' ? theme.size.nodeDepth : 0) + 7 };
  for (let round = 0; round < 4; round++) {
    const hit = ports.find(p => overlaps(inflate(p, ICON_GAP), { ...at, ...size }));
    if (!hit) break;
    const left = { x: hit.x - ICON_GAP - size.width - 0.5, y: at.y },
      down = { x: at.x, y: hit.y + hit.height + ICON_GAP + 0.5 };
    at = at.x - left.x <= down.y - at.y ? left : down;
  }
  return [node.node.icon === 'component' ? componentIcon(at.x, at.y) : artifactIcon(at.x, at.y)];
}

/**
 * Draws a laid-out structure scene. Containers go to the frame layer (behind the
 * lines, which may run inside them), leaves above the lines, then ports and
 * interface symbols, then labels.
 */
export async function drawStructure(scene: StructScene, metrics: FontMetrics): Promise<string> {
  const canvas = new Canvas(metrics);
  const portsOf = (id: string): Rect[] => scene.symbols.filter(s => s.kind === 'port' && s.parent === id).map(s => s.bounds);
  if (scene.frame) canvas.frame.push(drawFrame(canvas, scene.frame.keyword, scene.frame.title, scene.frame.bounds));
  for (const n of scene.nodes) {
    const data = { id: n.node.id, type: n.node.type, parent: n.parent };
    const layer = n.container ? canvas.frame : canvas.nodes;
    switch (n.node.shape) {
      case 'note':
        layer.push(drawNote(canvas, n.noteRows ?? [], n.bounds, data));
        break;
      case 'node3d':
        layer.push(drawNode3d(canvas, n.box!, n.bounds, data, { above: icon(n, portsOf(n.node.id)), middle: !n.container }));
        break;
      case 'ellipse':
        layer.push(
          drawEllipse(canvas, n.box!, n.bounds, data, {
            textTop: n.ellipse!.textTop,
            ...(n.ellipse!.separatorY === undefined ? {} : { separatorY: n.ellipse!.separatorY }),
            dashed: n.node.dashed !== false,
          }),
        );
        break;
      default:
        layer.push(drawBox(canvas, n.box!, n.bounds, data, { dashed: !!n.node.dashed, above: icon(n, portsOf(n.node.id)), middle: !n.container }));
    }
  }
  for (const edge of scene.edges) canvas.edges.push(drawEdge(edge));
  for (const s of scene.symbols) {
    const data = {
      id: s.id,
      type: s.kind === 'port' ? 'port' : s.kind === 'ball' ? 'provided-interface' : s.kind === 'socket' ? 'required-interface' : 'assembly',
      parent: s.parent,
    };
    switch (s.kind) {
      case 'port': {
        canvas.nodes.push(drawPort(s.bounds, data));
        break;
      }
      case 'ball': {
        canvas.nodes.push(drawBall(s.center, data));
        break;
      }
      case 'socket': {
        canvas.nodes.push(drawSocket(s.center, s.u!, data));
        break;
      }
      default:
        canvas.nodes.push(drawJoint(s.center, s.u!, data));
    }
  }
  for (const label of scene.labels) {
    const lh = metrics.lineHeight(label.style.size);
    const { x, y, width } = label.rect;
    const xs = label.widths.map(w => x + (width - w) / 2);
    canvas.labels.push(
      canvas.lines(label.lines, xs, y + baselineOffset(metrics, label.style.size, lh), lh, {
        ...label.style,
        fill: label.fill ?? theme.color.edgeText,
        role: 'label',
        owner: label.owner,
        halo: true,
        data: label.end ? { 'data-uml-end': label.end, 'data-uml-anchor': `${num(label.anchor!.x)},${num(label.anchor!.y)}` } : startsData(label.starts),
      }),
    );
  }
  return canvas.finish({ width: scene.width, height: scene.height, kind: scene.kind, title: scene.frame?.title });
}
