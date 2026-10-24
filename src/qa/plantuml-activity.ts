import { theme } from '../core/theme.js';
import { boundsOfPoints, contains, distance, distanceToBorder, union, type Point, type Rect } from '../engine/geometry.js';
import { pathPoints, type InspectedEdge, type InspectedNode, type InspectedText, type Scene } from './inspect.js';
import { walk, type XmlElement } from './xml.js';

/**
 * Reads PlantUML activity diagrams (data-diagram-type="ACTIVITY", new activity
 * syntax), whose SVG is a flat list of primitives without entity or link groups.
 * Shapes are classified by their theme colors (src/plantuml/skin.ts), flow lines
 * are chained into edges, and the open arrowheads the activity kind draws are
 * read as markers, so every geometry gate can run on this output:
 *
 * - nodes: rounded rectangles (actions), rectangles (object nodes), pentagons
 *   (send/accept), diamonds, bars, circles (initial/final), notes;
 * - edges: chains of edge-colored <line> segments between node borders; the end
 *   with an arrowhead is the target. A chain end that touches no node is reported
 *   with an empty node ID, which the edge-endpoints gate fails;
 * - note anchors: dashed lines, not flows (they only count for the canvas);
 * - texts: inside a node -> role "text"; in the frame heading -> "frame-label";
 *   swimlane titles -> "partition-label"; anything else (guards) -> "label".
 *   The lines of a node (wrapped names, notes) are merged into one text.
 */
export function readPlantUmlActivity(root: XmlElement, scene: Scene): void {
  const same = (a: string | undefined, b: string): boolean => (a ?? '').toUpperCase() === b.toUpperCase();
  const strokeOf = (e: XmlElement): string => e.attrs.style?.match(/stroke:(#[0-9A-Fa-f]{6})/u)?.[1] ?? e.attrs.stroke ?? '';
  const num = (v: string | undefined): number => Number(v ?? 0);
  const pts = (s: string | undefined): Point[] => {
    const n = (s ?? '').split(/[ ,]+/u).filter(Boolean).map(Number);
    const out: Point[] = [];
    for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i]!, y: n[i + 1]! });
    return out;
  };
  const pathPts = (d: string | undefined): Point[] => pathPoints(d ?? '');
  const { color } = theme;

  const nodes: InspectedNode[] = [];
  const add = (type: string, bounds: Rect): void => {
    nodes.push({ id: `${type}#${nodes.length}`, type, bounds });
  };
  const segments: [Point, Point][] = [];
  let frame: Rect | undefined;
  const elements = [...walk(root)].map(w => w.element);

  for (const e of elements) {
    const a = e.attrs;
    if (e.tag === 'rect') {
      const r = { x: num(a.x), y: num(a.y), width: num(a.width), height: num(a.height) };
      if (!frame && same(a.fill, color.background) && r.width > 0) {
        frame = r;
        continue;
      }
      if (same(a.fill, color.nodeFill)) add(num(a.rx) > 0 ? 'action' : 'object', r);
      else if (same(a.fill, color.edge) && r.height <= 10) add('bar', r);
    } else if (e.tag === 'polygon' && same(a.fill, color.nodeFill)) {
      const p = pts(a.points);
      const unique = new Set(p.map(q => `${q.x},${q.y}`)).size;
      add(unique === 4 ? 'diamond' : 'signal', boundsOfPoints(p));
    } else if (e.tag === 'ellipse') {
      const r = { x: num(a.cx) - num(a.rx), y: num(a.cy) - num(a.ry), width: 2 * num(a.rx), height: 2 * num(a.ry) };
      if (nodes.every(n => !(n.type === 'circle' && contains(n.bounds, r, 0.5)))) add('circle', r);
    } else if (e.tag === 'path' && same(a.fill, color.noteFill)) {
      const r = boundsOfPoints(pathPts(a.d));
      if (nodes.every(n => !(n.type === 'note' && contains(n.bounds, r, 0.5)))) add('note', r);
    } else if (e.tag === 'line' && same(strokeOf(e), color.edge) && !e.attrs.style?.includes('stroke-dasharray')) {
      const p = { x: num(a.x1), y: num(a.y1) },
        q = { x: num(a.x2), y: num(a.y2) };
      if (distance(p, q) > 0.01) segments.push([p, q]);
    } else if (e.tag === 'polyline' && same(strokeOf(e), color.edge) && a.fill === 'none') {
      const [l, tip, r] = pts(a.points);
      if (l && tip && r) {
        const base = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
        const d = distance(base, tip) || 1;
        scene.markers.push({ marker: 'open-arrow', end: 'target', tip, direction: { x: (tip.x - base.x) / d, y: (tip.y - base.y) / d } });
      }
    }
  }
  // Frame heading: the bent line closing the pentagon at the frame's top left.
  if (frame) {
    const heading = elements.find(
      e => e.tag === 'path' && e.attrs.fill === 'none' && pathPts(e.attrs.d).length === 4 && Math.abs(pathPts(e.attrs.d)[0]!.y - frame.y) < 0.5,
    );
    if (heading) {
      const p = pathPts(heading.attrs.d);
      scene.frameHeading = { x: frame.x, y: frame.y, width: Math.max(...p.map(q => q.x)) - frame.x, height: Math.max(...p.map(q => q.y)) - frame.y };
    }
    scene.extents.push(frame);
  }
  // Flow-final crosses are drawn as lines in the end color, not as flows; nothing to do.
  scene.nodes.push(...nodes);

  // Chain flow segments into edges: points of degree 2 are bends; other points end a chain.
  const key = (p: Point): string => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
  const adjacency = new Map<string, { point: Point; segments: number[] }>();
  for (const [i, s] of segments.entries()) {
    for (const p of s) {
      const k = key(p);
      const entry = adjacency.get(k) ?? { point: p, segments: [] };
      entry.segments.push(i);
      adjacency.set(k, entry);
    }
  }
  const used = new Set<number>();
  const onNode = (p: Point): InspectedNode | undefined => {
    let best: InspectedNode | undefined,
      bestDistance = 1.5;
    for (const n of nodes) {
      const d = distanceToBorder(p, n.bounds);
      if (d <= bestDistance) {
        best = n;
        bestDistance = d;
      }
    }
    return best;
  };
  const isEnd = (p: Point): boolean => adjacency.get(key(p))!.segments.length !== 2 || onNode(p) !== undefined;
  const chains: Point[][] = [];
  const follow = (start: Point, first: number): Point[] => {
    const chain = [start];
    let at = start,
      index = first;
    for (;;) {
      used.add(index);
      const [p, q] = segments[index]!;
      const next = key(p) === key(at) ? q : p;
      chain.push(next);
      if (isEnd(next)) return chain;
      const further = adjacency.get(key(next))!.segments.find(j => !used.has(j));
      if (further === undefined) return chain;
      at = next;
      index = further;
    }
  };
  for (const { point, segments: list } of adjacency.values()) {
    if (!isEnd(point)) continue;
    for (const i of list) if (!used.has(i)) chains.push(follow(point, i));
  }
  for (const i of segments.keys()) {
    if (!used.has(i)) chains.push(follow(segments[i]![0], i));
  }

  const edges: InspectedEdge[] = chains.map((chain, i) => {
    const tipAt = (p: Point) => scene.markers.some(m => distance(m.tip, p) <= 0.6);
    const points = tipAt(chain[0]!) && !tipAt(chain.at(-1)!) ? [...chain].reverse() : chain;
    const head = tipAt(points.at(-1)!);
    return {
      id: `flow#${i}`,
      type: 'flow',
      source: onNode(points[0]!)?.id ?? '',
      target: onNode(points.at(-1)!)?.id ?? '',
      points: simplifyChain(points),
      sourceMarker: 'none',
      targetMarker: head ? 'open-arrow' : 'none',
    };
  });
  scene.edges.push(...edges);

  // Texts: classify, and merge the lines of each note into one paragraph.
  const center = (t: InspectedText): Point => ({ x: t.bounds.x + t.bounds.width / 2, y: t.bounds.y + t.bounds.height / 2 });
  const inside = (r: Rect, p: Point): boolean => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
  const kept: InspectedText[] = [];
  const notes = new Map<string, InspectedText>();
  for (const t of scene.texts) {
    const c = center(t);
    if (scene.frameHeading && inside(scene.frameHeading, c)) {
      kept.push({ ...t, role: 'frame-label' });
      continue;
    }
    const owner = nodes.filter(n => inside(n.bounds, c)).sort((m, n) => m.bounds.width * m.bounds.height - n.bounds.width * n.bounds.height)[0];
    // Lines of one node (a wrapped name or note) form one text, in drawing order.
    if (owner) {
      const previous = notes.get(owner.id);
      if (previous) {
        previous.content += t.content;
        previous.lines.push(...t.lines);
        previous.bounds = union(previous.lines);
      } else {
        const paragraph = { ...t, lines: [...t.lines], role: 'text', node: owner.id };
        notes.set(owner.id, paragraph);
        kept.push(paragraph);
      }
      continue;
    }
    kept.push({ ...t, role: t.bold ? 'partition-label' : 'label' });
  }
  scene.texts.splice(0, scene.texts.length, ...kept);

  for (const n of nodes) scene.extents.push(n.bounds);
  for (const [p, q] of segments)
    scene.extents.push(
      union([
        { ...p, width: 0, height: 0 },
        { ...q, width: 0, height: 0 },
      ]),
    );
  for (const e of elements) {
    if (e.tag === 'line' && (!same(strokeOf(e), color.edge) || e.attrs.style?.includes('stroke-dasharray')))
      scene.extents.push(
        union([
          { x: num(e.attrs.x1), y: num(e.attrs.y1), width: 0, height: 0 },
          { x: num(e.attrs.x2), y: num(e.attrs.y2), width: 0, height: 0 },
        ]),
      );
  }
  scene.exactEdges = true;
}

/** Drops collinear interior points so each edge is a minimal polyline. */
function simplifyChain(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1),
      prev = out.at(-2);
    if (last && prev && Math.abs((last.x - prev.x) * (p.y - last.y) - (last.y - prev.y) * (p.x - last.x)) < 0.01) out.pop();
    out.push(p);
  }
  return out;
}
