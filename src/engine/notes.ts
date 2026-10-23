import { center, contains, inflate, overlaps, segmentIntersectsRect, union, type Point, type Rect } from './geometry.js';

/**
 * Note placement after the layered layout. ELK puts a note in the layer before the
 * elements it is attached to, which for a note on several elements (or on an
 * element inside a container) often leaves it far away, with anchors running across
 * the drawing and over other lines. `placeNotes` moves such a note to a free spot
 * near its targets: candidate boxes beside each target and beside the targets as a
 * group, scored by the length of the straight anchors to the targets plus a cost
 * per line or element the anchors would cross. A spot must keep clear of every
 * node (containers count: a note stays inside its own container and outside the
 * others), of every line and of the drawing's edge. The note moves only when the
 * new spot is clearly better; its anchors are then routed again.
 */

export interface NoteToPlace {
  id: string;
  rect: Rect;
  /** Container the note is drawn in, if any. */
  parent?: string | undefined;
  /** Outlines of the elements it is attached to. */
  targets: Rect[];
}

export interface PlacementNode {
  id: string;
  rect: Rect;
  /** Containers of this node (the note may lie inside these). */
  container?: boolean;
}

/** Gap kept between a moved note and anything else. */
const CLEAR = 18;
/** Distance between a note and the target it is placed beside. */
const BESIDE = 40;
/** Cost of an anchor crossing a line, and of crossing another element. */
const CROSS_LINE = 160;
const CROSS_NODE = 400;
/** A new spot must cost at most this share of the current one. */
const BETTER = 0.7;

/** Nearest point of a rectangle's border region to p (p itself when inside). */
function nearest(r: Rect, p: Point): Point {
  return { x: Math.min(Math.max(p.x, r.x), r.x + r.width), y: Math.min(Math.max(p.y, r.y), r.y + r.height) };
}

export function placeNotes(
  notes: readonly NoteToPlace[],
  nodes: readonly PlacementNode[],
  lines: readonly { source: string; target: string; points: readonly Point[] }[],
  ancestors: (id: string) => ReadonlySet<string>,
  bounds: Rect,
): Map<string, Rect> {
  const moved = new Map<string, Rect>();
  for (const note of notes) {
    if (note.targets.length === 0) continue;
    // Lines other than the note's own anchors (those are routed again when it moves).
    const segments: [Point, Point][] = [];
    for (const line of lines)
      if (line.source !== note.id && line.target !== note.id) for (const [k, q] of line.points.slice(1).entries()) segments.push([line.points[k]!, q]);
    const own = new Set([note.id, ...ancestors(note.id)]);
    const placedRects = [...moved.entries()].filter(([id]) => id !== note.id).map(([, r]) => r);
    const others = nodes.filter(n => !own.has(n.id));
    const anchorsCost = (r: Rect): number => {
      const c = center(r);
      let cost = 0;
      for (const t of note.targets) {
        const p = nearest(t, c),
          q = nearest(r, p);
        cost += Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
        for (const [a, b] of segments)
          if (segmentIntersectsRect(a, b, { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(p.x - q.x), height: Math.abs(p.y - q.y) }))
            cost += CROSS_LINE;
        for (const n of others) {
          if (n.container || note.targets.includes(n.rect)) continue;
          const box = inflate(n.rect, -1);
          if (segmentIntersectsRect(q, p, box)) cost += CROSS_NODE;
        }
      }
      return cost;
    };
    const free = (r: Rect): boolean => {
      if (!contains(bounds, r)) return false;
      const padded = inflate(r, CLEAR);
      for (const n of others) {
        // Its own containers must enclose it; any other node must stay clear.
        if (n.container && ancestors(note.id).has(n.id)) continue;
        if (overlaps(padded, n.rect)) return false;
      }
      for (const a of ancestors(note.id)) {
        const container = nodes.find(n => n.id === a);
        if (container && !contains(container.rect, padded)) return false;
      }
      for (const p of placedRects) if (overlaps(padded, p)) return false;
      const thin = inflate(r, CLEAR / 2);
      for (const [a, b] of segments) if (segmentIntersectsRect(a, b, thin)) return false;
      return true;
    };
    const { width: w, height: h } = note.rect;
    const candidates: Rect[] = [];
    const around = (t: Rect): void => {
      const xs = [t.x, t.x + (t.width - w) / 2, t.x + t.width - w];
      const ys = [t.y, t.y + (t.height - h) / 2, t.y + t.height - h];
      for (const x of xs) candidates.push({ x, y: t.y - BESIDE - h, width: w, height: h }, { x, y: t.y + t.height + BESIDE, width: w, height: h });
      for (const y of ys) candidates.push({ x: t.x - BESIDE - w, y, width: w, height: h }, { x: t.x + t.width + BESIDE, y, width: w, height: h });
    };
    for (const t of note.targets) around(t);
    if (note.targets.length > 1) around(union(note.targets));
    const current = anchorsCost(note.rect);
    let best: Rect | undefined,
      bestCost = current * BETTER;
    for (const c of candidates) {
      if (!free(c)) continue;
      const cost = anchorsCost(c);
      if (cost < bestCost - 1e-6) {
        best = c;
        bestCost = cost;
      }
    }
    if (best) moved.set(note.id, best);
  }
  return moved;
}
