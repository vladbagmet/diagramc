import { theme } from '../core/theme.js';
import { boundsOfPoints, contains, direction, distance, distanceToBorder, distanceToRect, inflate, overlapArea, segmentDistance, segmentIntersectsRect, union, type Rect } from '../engine/geometry.js';
import { inspectSvg, type Scene } from './inspect.js';

/**
 * Hard quality gates run on every rendered fixture and example (both backends).
 * Own-engine output is checked exactly; PlantUML output best-effort (gates that
 * need data the PlantUML SVG does not carry are skipped and listed as such).
 */
export interface GateResult { gate: string; ok: boolean; skipped?: boolean; failures: string[] }
export interface QaReport { ok: boolean; renderer: Scene['renderer']; gates: GateResult[] }

export const GATES = [
  'safe-markup', 'inside-canvas', 'node-overlap', 'label-overlap', 'label-edge-crossing', 'label-proximity',
  'edge-endpoints', 'markers', 'message-arrows', 'literal-text', 'min-font-size', 'text-fits',
] as const;

const fmt = (r: Rect): string => `[${r.x.toFixed(1)},${r.y.toFixed(1)} ${r.width.toFixed(1)}x${r.height.toFixed(1)}]`;
const snippet = (s: string): string => JSON.stringify(s.length > 40 ? `${s.slice(0, 40)}…` : s);

/** Approximate footprint of a marker: its length along the line and its width across. */
function markerBox(m: { marker: string; tip: { x: number; y: number }; direction: { x: number; y: number } }): Rect {
  const size = m.marker.includes('diamond') ? theme.size.diamond : m.marker.includes('triangle') ? theme.size.triangle : m.marker === 'open-arrow' ? theme.size.arrow
    : m.marker === 'circle-plus' ? { length: 2 * theme.size.circlePlus.radius, halfWidth: theme.size.circlePlus.radius }
    : { length: theme.size.cross.offset + theme.size.cross.half, halfWidth: theme.size.cross.half };
  const u = m.direction, n = { x: -u.y, y: u.x };
  const base = { x: m.tip.x - u.x * size.length, y: m.tip.y - u.y * size.length };
  const xs = [m.tip.x, base.x + n.x * size.halfWidth, base.x - n.x * size.halfWidth];
  const ys = [m.tip.y, base.y + n.y * size.halfWidth, base.y - n.y * size.halfWidth];
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** Gap between two rectangles (0 when they touch or overlap). */
function gapBetween(a: Rect, b: Rect): number {
  const dx = Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dy = Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.hypot(dx, dy);
}

export function runGates(scene: Scene, expectedTexts: readonly string[] = []): QaReport {
  const engine = scene.renderer === 'engine';
  const gates: GateResult[] = [];
  const gate = (name: string, check: (fail: (message: string) => void) => void, skip = false): void => {
    if (skip) { gates.push({ gate: name, ok: true, skipped: true, failures: [] }); return; }
    const failures: string[] = [];
    check(m => failures.push(m));
    gates.push({ gate: name, ok: !failures.length, failures });
  };
  const labels = scene.texts.filter(t => t.role === 'label');
  const nodeById = new Map(scene.nodes.map(n => [n.id, n]));

  gate('safe-markup', fail => scene.unsafe.forEach(u => fail(`forbidden markup: ${u}`)));

  gate('inside-canvas', fail => {
    const v = scene.viewBox;
    if (v.x < 0 || v.y < 0) fail(`viewBox starts at negative coordinates (${v.x}, ${v.y})`);
    const canvas = { x: Math.max(0, v.x), y: Math.max(0, v.y), width: v.width + Math.min(0, v.x), height: v.height + Math.min(0, v.y) };
    for (const r of scene.extents) if (!contains(canvas, r, 0.5)) fail(`shape ${fmt(r)} outside canvas ${fmt(canvas)}`);
    for (const t of scene.texts) if (!contains(canvas, t.bounds, 0.5)) fail(`text ${snippet(t.content)} ${fmt(t.bounds)} outside canvas`);
  });

  gate('node-overlap', fail => {
    for (let i = 0; i < scene.nodes.length; i++) for (let j = i + 1; j < scene.nodes.length; j++) {
      const a = scene.nodes[i]!, b = scene.nodes[j]!;
      if (overlapArea(a.bounds, b.bounds) <= 0.5) continue;
      if (contains(a.bounds, b.bounds) || contains(b.bounds, a.bounds)) continue;
      fail(`nodes ${a.id} ${fmt(a.bounds)} and ${b.id} ${fmt(b.bounds)} overlap`);
    }
  });

  // Ancestors of a node through data-uml-parent (nesting).
  const ancestors = (id: string): Set<string> => {
    const out = new Set<string>();
    for (let p = nodeById.get(id)?.parent; p && !out.has(p); p = nodeById.get(p)?.parent) out.add(p);
    return out;
  };
  const edgeById = new Map(scene.edges.map(e => [e.id, e]));

  gate('label-overlap', fail => {
    labels.forEach((label, i) => {
      // A label may sit inside a container (package) that encloses an end of its
      // own edge, as long as it keeps clear of the container's tab.
      const edge = label.owner === undefined ? undefined : edgeById.get(label.owner);
      const enclosing = edge ? new Set([...ancestors(edge.source), ...ancestors(edge.target)]) : new Set<string>();
      for (const n of scene.nodes) {
        if (overlapArea(label.bounds, n.bounds) <= 0.5) continue;
        if (enclosing.has(n.id) && contains(n.bounds, label.bounds) && !(n.tab && overlapArea(label.bounds, n.tab) > 0.5)) continue;
        fail(`label ${snippet(label.content)} overlaps node ${n.id}`);
      }
      for (const other of labels.slice(i + 1)) if (overlapArea(label.bounds, other.bounds) > 0.5) fail(`labels ${snippet(label.content)} and ${snippet(other.content)} overlap`);
      if (scene.frameHeading && overlapArea(label.bounds, scene.frameHeading) > 0.5) fail(`label ${snippet(label.content)} overlaps the frame heading`);
    });
    for (const t of scene.texts.filter(t => t.role === 'text')) {
      for (const n of scene.nodes) if (n.id !== t.node && !contains(n.bounds, nodeById.get(t.node ?? '')?.bounds ?? n.bounds) && overlapArea(t.bounds, n.bounds) > 0.5) fail(`text ${snippet(t.content)} of ${t.node} overlaps node ${n.id}`);
    }
  });

  gate('label-edge-crossing', fail => {
    for (const label of labels) {
      const box = inflate(label.bounds, -0.5);
      for (const e of scene.edges) for (let k = 1; k < e.points.length; k++) {
        if (segmentIntersectsRect(e.points[k - 1]!, e.points[k]!, box)) { fail(`label ${snippet(label.content)} crosses edge ${e.id}`); break; }
      }
    }
  }, !engine);

  gate('label-proximity', fail => {
    // An end label must sit near its own end and nearer to it than to any other
    // edge end, otherwise a reader could attach it to the wrong line.
    // Only ends that carry labels themselves can be mistaken for the label's end.
    const labelled = new Set(labels.filter(l => l.end).map(l => `${l.owner}\u0000${l.end}`));
    const ends = scene.edges.flatMap(e => [{ edge: e.id, end: 'source', p: e.points[0]! }, { edge: e.id, end: 'target', p: e.points.at(-1)! }])
      .filter(o => labelled.has(`${o.edge}\u0000${o.end}`));
    for (const label of labels) {
      if (!label.anchor || !label.end) continue;
      const near = distanceToRect(label.anchor, label.bounds);
      if (near > 48) fail(`end label ${snippet(label.content)} is ${near.toFixed(1)}px from its ${label.end} end`);
      if (!scene.edges.some(e => e.id === label.owner)) { fail(`end label ${snippet(label.content)} has no edge ${label.owner}`); continue; }
      const rival = ends.find(o => !(o.edge === label.owner && o.end === label.end) && distanceToRect(o.p, label.bounds) < near - 2);
      if (rival) fail(`end label ${snippet(label.content)} of ${label.owner} is closer to an end of ${rival.edge} than to its own`);
    }
  }, !engine);

  gate('edge-endpoints', fail => {
    for (const e of scene.edges) {
      if (e.points.length < 2) { fail(`edge ${e.id} has fewer than two points`); continue; }
      for (const [end, id, p] of [['source', e.source, e.points[0]!], ['target', e.target, e.points.at(-1)!]] as const) {
        const node = nodeById.get(id);
        if (!node) { fail(`edge ${e.id} ${end} ${id} is not a node`); continue; }
        // A package's outline is its tab plus the body below the tab.
        const d = node.tab
          ? Math.min(distanceToBorder(p, node.tab), distanceToBorder(p, { x: node.bounds.x, y: node.bounds.y + node.tab.height, width: node.bounds.width, height: node.bounds.height - node.tab.height }))
          : distanceToBorder(p, node.bounds);
        if (d > 1) fail(`edge ${e.id} ${end} point (${p.x}, ${p.y}) is ${d.toFixed(2)}px off the border of ${id}`);
      }
      for (let k = 1; k < e.points.length; k++) {
        const a = e.points[k - 1]!, b = e.points[k]!;
        for (const n of scene.nodes) {
          if (n.id === e.source || n.id === e.target || contains(n.bounds, nodeById.get(e.source)?.bounds ?? n.bounds) || contains(n.bounds, nodeById.get(e.target)?.bounds ?? n.bounds)) continue;
          if (segmentIntersectsRect(a, b, inflate(n.bounds, -1))) fail(`edge ${e.id} passes through node ${n.id}`);
        }
      }
    }
  }, !engine);

  gate('markers', fail => {
    for (const e of scene.edges) {
      for (const [end, marker, tip, from] of [
        ['source', e.sourceMarker, e.points[0]!, e.points[1]!],
        ['target', e.targetMarker, e.points.at(-1)!, e.points.at(-2)!],
      ] as const) {
        if (marker === 'none' || !from) continue;
        const into = direction(from, tip);
        const found = scene.markers.find(m => m.marker === marker && distance(m.tip, tip) <= 0.5);
        if (!found) { fail(`edge ${e.id}: no ${marker} at its ${end} end (${tip.x}, ${tip.y})`); continue; }
        if (found.direction.x * into.x + found.direction.y * into.y < 0.99) fail(`edge ${e.id}: ${marker} at its ${end} end points the wrong way`);
      }
    }
    // Distinct markers must not touch (identical shared markers are drawn once).
    const boxes = scene.markers.map(m => ({ m, box: markerBox(m) }));
    boxes.forEach(({ m, box }, i) => {
      for (const other of boxes.slice(i + 1)) {
        if (distance(m.tip, other.m.tip) < 0.5 && m.marker === other.m.marker) continue;
        if (overlapArea(box, other.box) > 0.5) fail(`${m.marker} at (${m.tip.x}, ${m.tip.y}) overlaps ${other.m.marker} at (${other.m.tip.x}, ${other.m.tip.y})`);
      }
    });
    for (const m of scene.markers) {
      if (scene.arrows.some(a => distance(a.to, m.tip) <= 0.5)) continue;
      if (!scene.edges.some(e => distance(e.points[0]!, m.tip) <= 0.5 || distance(e.points.at(-1)!, m.tip) <= 0.5)) fail(`${m.marker} at (${m.tip.x}, ${m.tip.y}) is not at an edge end`);
    }
  }, !engine);

  gate('message-arrows', fail => {
    // Message arrows (communication diagrams) sit beside their own link, parallel
    // to it, point from sender to receiver, touch nothing, and their labels are
    // next to them.
    const boxes = scene.arrows.map(a => inflate(boundsOfPoints([a.from, a.to]), a.marker.includes('triangle') ? theme.size.triangle.halfWidth : theme.size.arrow.halfWidth));
    scene.arrows.forEach((a, i) => {
      const name = `message arrow ${a.group}`;
      const edge = scene.edges.find(e => e.id === a.owner);
      if (!edge) { fail(`${name} has no link ${a.owner}`); return; }
      const u = direction(a.from, a.to);
      const marker = scene.markers.find(m => m.marker === a.marker && distance(m.tip, a.to) <= 0.5);
      if (!marker) fail(`${name}: no ${a.marker} at its tip`);
      else if (marker.direction.x * u.x + marker.direction.y * u.y < 0.99) fail(`${name}: ${a.marker} points the wrong way`);
      const mid = { x: (a.from.x + a.to.x) / 2, y: (a.from.y + a.to.y) / 2 };
      let best: { d: number; dot: number; along: boolean } | undefined;
      for (let k = 1; k < edge.points.length; k++) {
        const p = edge.points[k - 1]!, q = edge.points[k]!, v = direction(p, q);
        const t = (mid.x - p.x) * v.x + (mid.y - p.y) * v.y, length = distance(p, q);
        const d = Math.abs((mid.x - p.x) * v.y - (mid.y - p.y) * v.x);
        const dot = u.x * v.x + u.y * v.y;
        if (Math.abs(dot) < 0.99 || t < 0 || t > length) continue;
        if (!best || d < best.d) best = { d, dot, along: true };
      }
      if (!best) { fail(`${name} is not parallel to, and beside, a segment of link ${a.owner}`); return; }
      if (best.d < 4 || best.d > 26) fail(`${name} is ${best.d.toFixed(1)}px from link ${a.owner} (expected 4 to 26)`);
      const self = edge.source === edge.target;
      const forward = a.source === edge.source && a.target === edge.target;
      const backward = a.source === edge.target && a.target === edge.source;
      if (!forward && !backward) fail(`${name} (${a.source} -> ${a.target}) does not travel on link ${a.owner} (${edge.source} - ${edge.target})`);
      else if ((forward || self) ? best.dot < 0 : best.dot > 0) fail(`${name} points against its message direction ${a.source} -> ${a.target}`);
      // The arrow line (and its head) must keep clear of every line.
      const clearance = (a.marker.includes('triangle') ? theme.size.triangle.halfWidth : theme.size.arrow.halfWidth) * 0.4;
      for (const e of scene.edges) for (let k = 1; k < e.points.length; k++) {
        if (segmentDistance(e.points[k - 1]!, e.points[k]!, a.from, a.to) < clearance) { fail(`${name} touches or crosses edge ${e.id}`); break; }
      }
      for (const n of scene.nodes) if (overlapArea(boxes[i]!, n.bounds) > 0.5) fail(`${name} overlaps node ${n.id}`);
      boxes.forEach((other, j) => { if (j > i && overlapArea(boxes[i]!, other) > 0.5) fail(`${name} overlaps message arrow ${scene.arrows[j]!.group}`); });
      for (const t of labels) if (overlapArea(boxes[i]!, t.bounds) > 0.5) fail(`${name} overlaps label ${snippet(t.content)}`);
      const own = labels.filter(t => t.group === a.group);
      if (!own.length) fail(`${name} has no labels`);
      else if (gapBetween(boxes[i]!, union(own.map(t => t.bounds))) > 12) fail(`labels of ${name} are not next to it`);
    });
  }, !engine);

  gate('literal-text', fail => {
    const contents = scene.texts.map(t => t.content);
    for (const text of new Set(expectedTexts)) if (!contents.some(c => c.includes(text))) fail(`input text ${snippet(text)} is not drawn literally`);
  });

  gate('min-font-size', fail => {
    for (const t of scene.texts) if (t.size < theme.font.size.min) fail(`text ${snippet(t.content)} has font size ${t.size} < ${theme.font.size.min}`);
  });

  gate('text-fits', fail => {
    for (const t of scene.texts) {
      if (t.role === 'frame-label' && scene.frameHeading) {
        if (!contains(scene.frameHeading, t.bounds, 0.5)) fail(`frame heading text ${snippet(t.content)} is wider than its pentagon`);
        continue;
      }
      if (t.role !== 'text' || !t.node) continue;
      const node = nodeById.get(t.node);
      if (node && !contains(node.bounds, t.bounds, engine ? 0.5 : 1.5)) fail(`text ${snippet(t.content)} ${fmt(t.bounds)} does not fit in ${t.node} ${fmt(node.bounds)}`);
    }
  });

  return { ok: gates.every(g => g.ok), renderer: scene.renderer, gates };
}

/** Inspects an SVG and runs every gate. `expectedTexts`: every display string of the input. */
export async function checkSvg(svg: string, expectedTexts: readonly string[] = []): Promise<QaReport> {
  return runGates(await inspectSvg(svg), expectedTexts);
}

export function formatReport(report: QaReport): string {
  return report.gates.filter(g => !g.ok).map(g => `${g.gate}:\n  ${g.failures.slice(0, 20).join('\n  ')}`).join('\n');
}
