import { theme } from '../core/theme.js';
import { center, contains, direction, distance, distanceToBorder, distanceToEllipse, distanceToRect, inflate, overlapArea, segmentIntersectsRect, type Point, type Rect } from '../engine/geometry.js';
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
  'edge-endpoints', 'markers', 'literal-text', 'min-font-size', 'text-fits', 'ports',
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
  // Containers (nodes some other node, not just a port, declares as its parent) may hold labels in their body.
  const containers = new Set(scene.nodes.flatMap(n => n.parent && n.type !== 'port' ? [n.parent] : []));

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
      // A port straddles the border of the node it belongs to.
      if (a.parent === b.id || b.parent === a.id) continue;
      fail(`nodes ${a.id} ${fmt(a.bounds)} and ${b.id} ${fmt(b.bounds)} overlap`);
    }
  });

  gate('label-overlap', fail => {
    labels.forEach((label, i) => {
      for (const n of scene.nodes) {
        if (overlapArea(label.bounds, n.bounds) <= 0.5) continue;
        if (containers.has(n.id) && contains(n.bounds, label.bounds)) continue;
        fail(`label ${snippet(label.content)} overlaps node ${n.id}`);
      }
      for (const t of scene.texts) if (t.role !== 'label' && overlapArea(label.bounds, t.bounds) > 0.5) fail(`label ${snippet(label.content)} overlaps text ${snippet(t.content)}`);
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
        const d = node.shape === 'ellipse' ? distanceToEllipse(p, node.bounds) : distanceToBorder(p, node.bounds);
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
      if (!scene.edges.some(e => distance(e.points[0]!, m.tip) <= 0.5 || distance(e.points.at(-1)!, m.tip) <= 0.5)) fail(`${m.marker} at (${m.tip.x}, ${m.tip.y}) is not at an edge end`);
    }
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

  gate('ports', fail => checkPorts(scene, labels, fail), !engine);

  return { ok: gates.every(g => g.ok), renderer: scene.renderer, gates };
}

/**
 * Ports and interface symbols (component, composite structure and similar kinds):
 * port squares are centered on their owner's border, their names next to them; lollipop balls and sockets
 * sit at the end of their stem, outside their owner, facing outward; in an
 * assembly the ball sits concentrically in the socket, the requiring line meets
 * the socket's back and the providing line enters through its opening, on one
 * straight axis; interface names stay next to their symbol.
 */
function checkPorts(scene: Scene, labels: readonly Scene['texts'][number][], fail: (message: string) => void): void {
  const nodeById = new Map(scene.nodes.map(n => [n.id, n]));
  const at = (p: Point): string => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;
  for (const port of scene.nodes.filter(n => n.type === 'port')) {
    const owner = port.parent === undefined ? undefined : nodeById.get(port.parent);
    if (!owner) { fail(`port ${port.id} has no owner node`); continue; }
    const c = center(port.bounds);
    const d = distanceToBorder(c, owner.bounds);
    if (d > 0.5) fail(`port ${port.id} center ${at(c)} is ${d.toFixed(2)}px off the border of ${owner.id}`);
    for (const label of labels.filter(l => l.owner === port.id)) {
      const gap = distanceToRect(c, label.bounds) - port.bounds.width / 2;
      if (gap > 16) fail(`port name ${snippet(label.content)} is ${gap.toFixed(1)}px away from port ${port.id}`);
    }
  }
  // Each route end touching a symbol, with the direction of its last segment (into the symbol).
  const ends = (id: string) => scene.edges.flatMap(e => {
    const out: { edge: string; type: string; other: string; p: Point; into: Point }[] = [];
    if (e.target === id && e.points.length > 1) out.push({ edge: e.id, type: e.type, other: e.source, p: e.points.at(-1)!, into: direction(e.points.at(-2)!, e.points.at(-1)!) });
    if (e.source === id && e.points.length > 1) out.push({ edge: e.id, type: e.type, other: e.target, p: e.points[0]!, into: direction(e.points[1]!, e.points[0]!) });
    return out;
  });
  const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
  const offAxis = (p: Point, c: Point, u: Point): number => Math.abs((p.x - c.x) * u.y - (p.y - c.y) * u.x);
  /** The node an interface faces away from: a port's owner, or the node itself. */
  const body = (id: string) => { const n = nodeById.get(id); return n?.type === 'port' && n.parent ? nodeById.get(n.parent) : n; };
  for (const node of scene.nodes) {
    const { ball, socket } = node;
    if (!ball && !socket) continue;
    const touching = ends(node.id);
    if (ball && socket) {
      // Assembly: ball and socket concentric, requirer at the back, provider through the opening, aligned.
      if (distance(ball, socket) > 0.5) fail(`assembly ${node.id}: ball and socket are not concentric`);
      if (ball.r >= socket.r) fail(`assembly ${node.id}: ball does not fit inside the socket`);
      const u = socket.u, c = { x: socket.x, y: socket.y };
      // Lines declare their role in their type ("...required" / "...provided").
      const back = touching.find(t => t.type.endsWith('required')), front = touching.find(t => t.type.endsWith('provided'));
      if (!back) fail(`assembly ${node.id}: no requiring connector`);
      else if (distance(back.p, { x: c.x - u.x * socket.r, y: c.y - u.y * socket.r }) > 0.75) fail(`assembly ${node.id}: requiring connector ${back.edge} does not meet the socket's back`);
      else if (dot(back.into, u) < 0.99) fail(`assembly ${node.id}: requiring connector does not run into the socket's back`);
      if (!front) fail(`assembly ${node.id}: no providing connector`);
      else if (distance(front.p, { x: c.x + u.x * socket.r, y: c.y + u.y * socket.r }) > 0.75) fail(`assembly ${node.id}: providing connector ${front.edge} does not enter through the socket's opening`);
      else if (dot(front.into, u) > -0.99) fail(`assembly ${node.id}: providing connector does not run into the opening toward the ball`);
      for (const t of [back, front]) if (t && offAxis(t.p, c, u) > 0.5) fail(`assembly ${node.id}: connector ${t.edge} is not aligned with the ball and socket`);
      if (touching.length !== 2) fail(`assembly ${node.id}: expected 2 connectors, found ${touching.length}`);
    } else if (ball) {
      if (!touching.length) fail(`provided interface ${node.id} has no stem`);
      for (const t of touching) {
        if (Math.abs(distance(t.p, ball) - ball.r) > 0.75) fail(`provided interface ${node.id}: stem ${t.edge} does not end on the ball ${at(t.p)}`);
        if (offAxis(ball, t.p, t.into) > 0.5) fail(`provided interface ${node.id}: stem ${t.edge} does not point at the ball's center`);
        const owner = body(t.other);
        if (owner && contains(owner.bounds, { x: ball.x, y: ball.y, width: 0, height: 0 })) fail(`provided interface ${node.id} faces into its owner ${owner.id}`);
      }
    } else if (socket) {
      if (!touching.length) fail(`required interface ${node.id} has no stem`);
      const c = { x: socket.x, y: socket.y };
      for (const t of touching) {
        if (distance(t.p, { x: c.x - socket.u.x * socket.r, y: c.y - socket.u.y * socket.r }) > 0.75) fail(`required interface ${node.id}: stem ${t.edge} does not meet the socket's back ${at(t.p)}`);
        if (dot(t.into, socket.u) < 0.99) fail(`required interface ${node.id}: socket does not open away from its stem ${t.edge}`);
        const owner = body(t.other);
        if (owner && contains(owner.bounds, { x: c.x, y: c.y, width: 0, height: 0 })) fail(`required interface ${node.id} faces into its owner ${owner.id}`);
      }
    }
    for (const label of labels.filter(l => l.owner === node.id)) {
      const gap = distanceToRect(center(node.bounds), label.bounds) - Math.max(node.bounds.width, node.bounds.height) / 2;
      if (gap > 12) fail(`interface name ${snippet(label.content)} is ${gap.toFixed(1)}px away from its symbol ${node.id}`);
    }
  }
}

/** Inspects an SVG and runs every gate. `expectedTexts`: every display string of the input. */
export async function checkSvg(svg: string, expectedTexts: readonly string[] = []): Promise<QaReport> {
  return runGates(await inspectSvg(svg), expectedTexts);
}

export function formatReport(report: QaReport): string {
  return report.gates.filter(g => !g.ok).map(g => `${g.gate}:\n  ${g.failures.slice(0, 20).join('\n  ')}`).join('\n');
}
