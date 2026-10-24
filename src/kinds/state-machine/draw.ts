import { theme } from '../../core/theme.js';
import { drawEdge } from '../../engine/edges.js';
import type { FontMetrics } from '../../engine/fonts.js';
import type { Rect } from '../../engine/geometry.js';
import { baselineOffset, drawFrame, drawNote, nodeAttributes, type MeasuredBox } from '../../engine/shapes.js';
import { Canvas, el, num } from '../../engine/svg.js';
import { isNote, isState } from './model.js';
import type { StateScene } from './layout.js';
import { pseudostateSize } from './layout.js';

/** Draws a laid-out state machine diagram as a self-contained SVG document. */
export async function drawStateMachine(scene: StateScene, metrics: FontMetrics): Promise<string> {
  const canvas = new Canvas(metrics);
  const stroke = { stroke: theme.color.nodeStroke, 'stroke-width': theme.stroke.node };
  const r = theme.size.state.radius;
  if (scene.frame) canvas.frame.push(drawFrame(canvas, 'stm', scene.frame.title, scene.frame.bounds));

  // Composite states are drawn below the edges, so transitions inside them stay visible.
  for (const c of scene.composites) {
    const { bounds, header } = c;
    const parts = [
      el('rect', { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, rx: r, ry: r, fill: theme.color.nodeFill, ...stroke }),
      ...compartments(canvas, header, bounds, c.state.id, true),
      el('line', {
        x1: bounds.x,
        y1: bounds.y + header.height,
        x2: bounds.x + bounds.width,
        y2: bounds.y + header.height,
        stroke: theme.color.nodeStroke,
        'stroke-width': theme.stroke.compartment,
      }),
    ];
    for (const s of c.separators) {
      parts.push(
        el('line', {
          x1: s.x1,
          y1: s.y1,
          x2: s.x2,
          y2: s.y2,
          stroke: theme.color.nodeStroke,
          'stroke-width': theme.stroke.compartment,
          'stroke-dasharray': theme.stroke.dash,
        }),
      );
    }
    for (const n of c.regionNames) {
      const size = theme.font.size.body,
        lh = metrics.lineHeight(size);
      parts.push(
        canvas.text(n.text, n.x, n.y + baselineOffset(metrics, size, lh), { size, italic: true, fill: theme.color.mutedText, role: 'text', owner: c.state.id }),
      );
    }
    canvas.frame.push(el('g', nodeAttributes({ id: c.state.id, type: 'composite-state', parent: c.parent }, bounds), parts));
  }

  for (const edge of scene.edges) {
    const anchor = edge.type === 'note-anchor';
    canvas.edges.push(drawEdge({ ...edge, style: anchor ? 'dashed' : 'solid', sourceMarker: 'none', targetMarker: anchor ? 'none' : 'open-arrow' }));
  }

  for (const node of scene.nodes) {
    const e = node.element,
      b = node.bounds;
    if (isNote(e)) {
      canvas.nodes.push(drawNote(canvas, node.rows!, b, { id: e.id, type: 'note', parent: node.parent }));
      continue;
    }
    if (isState(e)) {
      const parts = [
        el('rect', { x: b.x, y: b.y, width: b.width, height: b.height, rx: r, ry: r, fill: theme.color.nodeFill, ...stroke }),
        ...compartments(canvas, node.box!, b, e.id, false),
      ];
      canvas.nodes.push(el('g', nodeAttributes({ id: e.id, type: e.submachine === undefined ? 'state' : 'submachine-state', parent: node.parent }, b), parts));
      continue;
    }
    const shape = pseudostateSize(e.type).shape;
    canvas.nodes.push(
      el(
        'g',
        nodeAttributes({ id: e.id, type: e.type, parent: node.parent, shape: shape === 'rect' ? undefined : shape }, b),
        pseudostate(canvas, e.type, b, e.id),
      ),
    );
  }

  for (const p of scene.points) {
    const b = p.bounds,
      cx = b.x + b.width / 2,
      cy = b.y + b.height / 2,
      rr = b.width / 2;
    const parts = [el('circle', { cx, cy, r: rr, fill: theme.color.background, ...stroke })];
    if (p.point.type === 'exitPoint') {
      const k = rr * Math.SQRT1_2;
      parts.push(
        el('path', {
          d: `M${num(cx - k)},${num(cy - k)} L${num(cx + k)},${num(cy + k)} M${num(cx - k)},${num(cy + k)} L${num(cx + k)},${num(cy - k)}`,
          fill: 'none',
          ...stroke,
        }),
      );
    }
    canvas.nodes.push(el('g', nodeAttributes({ id: p.point.id, type: p.point.type, parent: p.owner, shape: 'ellipse', borderOf: p.owner }, b), parts));
    if (p.label) {
      const size = theme.font.size.label,
        lh = metrics.lineHeight(size);
      canvas.labels.push(
        canvas.text(p.label.text, p.label.rect.x, p.label.rect.y + baselineOffset(metrics, size, lh), {
          size,
          fill: theme.color.edgeText,
          role: 'label',
          owner: p.point.id,
          halo: true,
        }),
      );
    }
  }

  for (const label of scene.labels) {
    const size = theme.font.size.label,
      lh = metrics.lineHeight(size);
    const { x, y, width } = label.rect;
    canvas.labels.push(
      canvas.lines(
        label.lines,
        label.widths.map(w => x + (width - w) / 2),
        y + baselineOffset(metrics, size, lh),
        lh,
        {
          size,
          fill: theme.color.edgeText,
          role: 'label',
          owner: label.owner,
          halo: true,
        },
      ),
    );
  }
  return canvas.finish({ width: scene.width, height: scene.height, kind: 'state-machine', title: scene.frame?.title });
}

/** Name compartment (centered) and behavior compartment (left-aligned) of a state. */
function compartments(canvas: Canvas, box: MeasuredBox, bounds: Rect, owner: string, composite: boolean): string[] {
  const { padX, padY, headerPadY } = theme.spacing;
  const parts: string[] = [];
  let y = bounds.y;
  for (const [index, c] of box.compartments.entries()) {
    const height = index === box.compartments.length - 1 && !composite ? bounds.y + bounds.height - y : c.height;
    if (index > 0)
      parts.push(
        el('line', { x1: bounds.x, y1: y, x2: bounds.x + bounds.width, y2: y, stroke: theme.color.nodeStroke, 'stroke-width': theme.stroke.compartment }),
      );
    // A lone name compartment of a simple state is vertically centered.
    const content = c.lines.reduce((sum, l) => sum + l.rows.length * l.lineHeight, 0);
    let rowTop = !composite && box.compartments.length === 1 ? y + (height - content) / 2 : y + (index === 0 ? headerPadY : padY);
    for (const line of c.lines) {
      const xs = line.widths.map(w => (line.align === 'center' ? bounds.x + (bounds.width - w) / 2 : bounds.x + padX));
      const first = rowTop + baselineOffset(canvas.metrics, line.style.size, line.lineHeight);
      parts.push(canvas.lines(line.rows, xs, first, line.lineHeight, { ...line.style, fill: line.fill, role: 'text', owner }));
      rowTop += line.rows.length * line.lineHeight;
    }
    y += height;
  }
  return parts;
}

/** Pseudostate symbols (UML 2.5.1 14.2.4). */
function pseudostate(canvas: Canvas, type: string, b: Rect, owner: string): string[] {
  const cx = b.x + b.width / 2,
    cy = b.y + b.height / 2,
    rr = b.width / 2;
  const ink = theme.color.text,
    line = { stroke: theme.color.nodeStroke, 'stroke-width': theme.stroke.node };
  switch (type) {
    case 'initial':
    case 'junction':
      return [el('circle', { cx, cy, r: rr, fill: ink, stroke: ink, 'stroke-width': theme.stroke.node })];
    case 'final':
      return [el('circle', { cx, cy, r: rr, fill: theme.color.background, ...line }), el('circle', { cx, cy, r: theme.size.state.finalInner / 2, fill: ink })];
    case 'choice':
      return [
        el('polygon', {
          points: `${num(cx)},${num(b.y)} ${num(b.x + b.width)},${num(cy)} ${num(cx)},${num(b.y + b.height)} ${num(b.x)},${num(cy)}`,
          fill: theme.color.nodeFill,
          ...line,
        }),
      ];
    case 'fork':
    case 'join':
      return [el('rect', { x: b.x, y: b.y, width: b.width, height: b.height, fill: theme.color.edge })];
    case 'terminate':
      return [
        el('path', {
          d: `M${num(b.x)},${num(b.y)} L${num(b.x + b.width)},${num(b.y + b.height)} M${num(b.x)},${num(b.y + b.height)} L${num(b.x + b.width)},${num(b.y)}`,
          fill: 'none',
          stroke: ink,
          'stroke-width': 1.75,
        }),
      ];
    default: {
      // Shallow (H) and deep (H*) history.
      const text = type === 'deepHistory' ? 'H*' : 'H';
      const size = theme.font.size.body,
        width = canvas.metrics.measure(text, { size, bold: true });
      const baseline = cy - (canvas.metrics.ascent(size) + canvas.metrics.descent(size)) / 2 + canvas.metrics.ascent(size);
      return [
        el('circle', { cx, cy, r: rr, fill: theme.color.background, ...line }),
        canvas.text(text, cx - width / 2, baseline, { size, bold: true, role: 'text', owner }),
      ];
    }
  }
}
