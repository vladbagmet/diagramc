import { theme } from '../core/theme.js';
import { boundsOfPoints, center, contains, direction, distance, distanceToBorder, distanceToEllipse, distanceToRect, inflate, overlapArea, segmentDistance, segmentIntersectsRect, union, type Point, type Rect } from '../engine/geometry.js';
import { distanceToOutline } from '../engine/clip.js';
import { inspectSvg, type Scene } from './inspect.js';
import { interactionGates } from './plantuml-interaction.js';

/**
 * Hard quality gates run on every rendered fixture and example (both backends).
 * Own-engine output is checked exactly; PlantUML output best-effort (gates that
 * need data the PlantUML SVG does not carry are skipped and listed as such).
 */
export interface GateResult { gate: string; ok: boolean; skipped?: boolean; failures: string[] }
export interface QaReport { ok: boolean; renderer: Scene['renderer']; gates: GateResult[] }

export const GATES = [
  'safe-markup', 'inside-canvas', 'node-overlap', 'label-overlap', 'label-edge-crossing', 'label-proximity',
  'edge-endpoints', 'markers', 'message-arrows', 'literal-text', 'min-font-size', 'text-fits', 'ports',
] as const;

function distanceToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

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
  // Edge gates need exact edge geometry: the own engine, or a PlantUML reader that provides it.
  const exactEdges = engine || scene.exactEdges === true;
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
      // A port, or an entry/exit point, straddles the border of the node it belongs to.
      if (a.parent === b.id || b.parent === a.id) continue;
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
  /** Containers around an edge end or a symbol: a port counts from its owner's containers, not the owner itself. */
  const endAncestors = (id: string): Set<string> => {
    const node = nodeById.get(id);
    return node?.type === 'port' && node.parent ? ancestors(node.parent) : ancestors(id);
  };

  gate('label-overlap', fail => {
    labels.forEach((label, i) => {
      // A label may sit inside a container (package, component, node) that encloses an
      // end of its own edge, or, for the name of a port or interface symbol, a container
      // of the element it belongs to; never on its tab, on a leaf, or across a border.
      const edge = label.owner === undefined ? undefined : edgeById.get(label.owner);
      const enclosing = edge ? new Set([...endAncestors(edge.source), ...endAncestors(edge.target)])
        : label.owner !== undefined && nodeById.has(label.owner) ? endAncestors(label.owner) : new Set<string>();
      for (const n of scene.nodes) {
        if (overlapArea(label.bounds, n.bounds) <= 0.5) continue;
        if (enclosing.has(n.id) && contains(n.bounds, label.bounds) && !(n.tab && overlapArea(label.bounds, n.tab) > 0.5)) continue;
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
  }, !exactEdges && !scene.evaluated?.includes('label-edge-crossing'));

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
  }, !exactEdges);

  gate('edge-endpoints', fail => {
    // Container types whose own texts (name and behaviors at the top) edges must not
    // cross. Packages are not listed yet: profile diagrams still route lines over
    // package tabs (known issue, see docs/kinds/state-machine.md).
    const guarded = new Set(['composite-state', 'subject']);
    const nodeTexts = scene.texts.filter(t => t.role === 'text' && t.node && guarded.has(nodeById.get(t.node)?.type ?? ''));
    for (const e of scene.edges) {
      if (e.points.length < 2) { fail(`edge ${e.id} has fewer than two points`); continue; }
      for (const [end, id, p] of [['source', e.source, e.points[0]!], ['target', e.target, e.points.at(-1)!]] as const) {
        const node = nodeById.get(id);
        const onEdge = node ? undefined : scene.edges.find(other => other.id === id && other !== e);
        if (onEdge) {
          // An end attached to another edge (a note anchored to a relationship) must lie on that edge.
          const d = Math.min(...onEdge.points.slice(1).map((q, k) => distanceToSegment(p, onEdge.points[k]!, q)));
          if (d > 1) fail(`edge ${e.id} ${end} point (${p.x}, ${p.y}) is ${d.toFixed(2)}px off edge ${id}`);
          continue;
        }
        if (!node) { fail(`edge ${e.id} ${end} ${id} is not a node`); continue; }
        // A package's outline is its tab plus the body below the tab; ellipses and diamonds are their outlines.
        const d = node.tab
          ? Math.min(distanceToBorder(p, node.tab), distanceToBorder(p, { x: node.bounds.x, y: node.bounds.y + node.tab.height, width: node.bounds.width, height: node.bounds.height - node.tab.height }))
          : node.shape === 'ellipse' ? distanceToEllipse(p, node.bounds)
          : node.shape === 'diamond' ? distanceToOutline(p, node.bounds, 'diamond') : distanceToBorder(p, node.bounds);
        if (d > 1) fail(`edge ${e.id} ${end} point (${p.x}, ${p.y}) is ${d.toFixed(2)}px off the ${node.shape ?? 'border'} of ${id}`);
      }
      for (let k = 1; k < e.points.length; k++) {
        const a = e.points[k - 1]!, b = e.points[k]!;
        for (const n of scene.nodes) {
          if (n.id === e.source || n.id === e.target || contains(n.bounds, nodeById.get(e.source)?.bounds ?? n.bounds) || contains(n.bounds, nodeById.get(e.target)?.bounds ?? n.bounds)) continue;
          // A node on the border of an end node (entry/exit point) may be touched by that end's lines.
          if (n.borderOf !== undefined && (n.borderOf === e.source || n.borderOf === e.target)) continue;
          if (segmentIntersectsRect(a, b, inflate(n.bounds, -1))) fail(`edge ${e.id} passes through node ${n.id}`);
        }
        // Lines crossing into a container must not run over its texts (a composite state's name).
        for (const t of nodeTexts) {
          if (t.node === e.source || t.node === e.target) continue;
          if (segmentIntersectsRect(a, b, inflate(t.bounds, -1))) { fail(`edge ${e.id} crosses text ${snippet(t.content)} of ${t.node}`); break; }
        }
      }
    }
  }, !exactEdges);

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
  }, !exactEdges);

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
  }, !exactEdges);

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

  gate('ports', fail => checkPorts(scene, labels, fail), !exactEdges);

  gates.push(...interactionGates(scene));
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
