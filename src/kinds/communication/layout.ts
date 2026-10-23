import { theme } from '../../core/theme.js';
import type { LineStyle, Marker } from '../../engine/edges.js';
import type { FontMetrics, TextStyle } from '../../engine/fonts.js';
import { boundsOfPoints, direction, distance, distanceToSegment, inflate, segmentDistance, overlapArea, segmentIntersectsRect, union, type Point, type Rect } from '../../engine/geometry.js';
import { measureBox, measureFrameHeading, type MeasuredBox } from '../../engine/shapes.js';
import { stressCenters } from '../../engine/stress.js';
import { wrapText } from '../../engine/text.js';
import { compareSequence, lifelineLabel, messageLabel, parseSequence } from './format.js';
import type { CommunicationDiagram, Lifeline, Message, MessageSort } from './model.js';

/**
 * Layout of a communication diagram.
 *
 * Communication diagrams have no direction (links are undirected and messages
 * flow both ways), so a layered layout would invent a hierarchy. Instead:
 *
 * 1. ELK Stress places the lifelines so that linked lifelines are about one
 *    desired distance apart: cycles become polygons, stars become wheels.
 * 2. The centers are snapped to a grid (rows and columns found by clustering),
 *    so most links come out exactly horizontal or vertical, as in hand-drawn
 *    communication diagrams; collisions in a cell split a row or column.
 * 3. Column and row gaps are widened until every link is long enough for its
 *    message list, and again wherever a message block still touches something.
 * 4. Links are straight lines; a link that would pass through another lifeline
 *    gets an orthogonal detour.
 * 5. Messages on a link are grouped by direction and kind (synchronous,
 *    asynchronous, reply); each group gets one arrow parallel to the link and its
 *    messages stacked beside the arrow, ordered by sequence number. Forward
 *    messages go on the left of the link direction, backward ones on the right.
 */

export const LABEL: TextStyle = { size: theme.font.size.label };
const NAME: TextStyle = { size: theme.font.size.name };
/** Offset of the back rectangle of a multi-object. */
export const STACK = 6;
const ARROW = 40;
const MAX_LABEL_WIDTH = 300;
/** Self-link loop: height above the node and width beyond its right border. */
const LOOP_UP = 22, LOOP_OUT = 26, LOOP_INSET = 18, LOOP_END = 9, SELF_ARROW = 30;

export interface CommNode { lifeline: Lifeline; label: string; box: MeasuredBox; bounds: Rect; front: Rect; back?: Rect }
export interface CommLink { id: string; source: string; target: string; points: Point[] }
export interface CommArrow { owner: string; group: string; source: string; target: string; from: Point; to: Point; style: LineStyle; marker: Marker }
export interface CommLabel { owner: string; group: string; rows: string[]; widths: number[]; x: number; y: number; align: 'left' | 'right'; width: number }
export interface CommScene {
  width: number;
  height: number;
  frame?: { bounds: Rect; title: string };
  nodes: CommNode[];
  links: CommLink[];
  arrows: CommArrow[];
  labels: CommLabel[];
}

interface Group {
  id: string;
  link: string;
  forward: boolean;
  sort: MessageSort;
  source: string;
  target: string;
  messages: { rows: string[]; widths: number[] }[];
  width: number;
  height: number;
}
interface LinkPlan { id: string; from: string; to: string; self: boolean; groups: Group[] }

const markerOf = (sort: MessageSort): Marker => sort === 'synchronous' ? 'filled-triangle' : 'open-arrow';
const halfOf = (sort: MessageSort): number => sort === 'synchronous' ? theme.size.messageTriangle.halfWidth : theme.size.arrow.halfWidth;
const SORTS: MessageSort[] = ['synchronous', 'asynchronous', 'reply'];

function plan(model: CommunicationDiagram, metrics: FontMetrics): LinkPlan[] {
  const lh = metrics.lineHeight(LABEL.size);
  const plans = (model.links ?? []).map((l, i): LinkPlan => ({ id: l.id ?? `links/${i}`, from: l.from, to: l.to, self: l.from === l.to, groups: [] }));
  const byPair = new Map<string, LinkPlan>();
  for (const p of plans) byPair.set(`${p.from}\u0000${p.to}`, p).set(`${p.to}\u0000${p.from}`, p);
  const buckets = new Map<string, { link: LinkPlan; forward: boolean; sort: MessageSort; messages: Message[] }>();
  for (const m of model.messages ?? []) {
    const link = byPair.get(`${m.from}\u0000${m.to}`)!;
    const forward = link.self || m.from === link.from;
    const sort = m.sort ?? 'synchronous';
    const key = `${link.id}\u0000${forward}\u0000${sort}`;
    if (!buckets.has(key)) buckets.set(key, { link, forward, sort, messages: [] });
    buckets.get(key)!.messages.push(m);
  }
  const ordered = [...buckets.values()].sort((a, b) => Number(b.forward) - Number(a.forward) || SORTS.indexOf(a.sort) - SORTS.indexOf(b.sort));
  for (const b of ordered) {
    const messages = [...b.messages].sort((x, y) => compareSequence(x.sequence, y.sequence)).map(m => {
      const rows = wrapText(metrics, messageLabel(m), LABEL, MAX_LABEL_WIDTH);
      return { rows, widths: rows.map(r => Math.ceil(metrics.measure(r.trimEnd(), LABEL))) };
    });
    b.link.groups.push({
      id: `${b.link.id}::${b.forward ? 'forward' : 'backward'}-${b.sort}`, link: b.link.id, forward: b.forward, sort: b.sort,
      source: b.forward ? b.link.from : b.link.to, target: b.forward ? b.link.to : b.link.from,
      messages, width: Math.max(...messages.flatMap(m => m.widths)), height: messages.reduce((s, m) => s + m.rows.length * lh, 0),
    });
  }
  return plans;
}

// ---------------------------------------------------------------------------
// Message blocks: arrows and stacked labels beside a link segment.

interface Placed { group: Group; arrow: { from: Point; to: Point }; arrowBox: Rect; text: Rect; align: 'left' | 'right' }
interface Candidate { placed: Placed[]; rects: Rect[]; lines: [Point, Point][] }

const GROUP_GAP = 14, TEXT_GAP = 4;
/** Message blocks keep this far from other links, so they cannot be read as theirs. */
const FOREIGN_CLEARANCE = 12;

/** Geometry of the groups of one side of a link, at parameter t of segment a-b. */
function sideBlock(groups: readonly Group[], a: Point, b: Point, t: number, sign: 1 | -1, offset: number, shift: number, length: number): Candidate {
  const u = direction(a, b), n = { x: u.y * sign, y: -u.x * sign };
  const horizontal = Math.abs(u.x) >= Math.abs(u.y);
  const dominant = horizontal ? Math.abs(u.x) : Math.abs(u.y);
  const extent = (g: Group) => Math.max(horizontal ? g.width : g.height, length);
  const total = groups.reduce((s, g) => s + extent(g), 0) + GROUP_GAP * (groups.length - 1);
  const base = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  let cursor = -total / 2;
  const placed: Placed[] = [], rects: Rect[] = [], lines: [Point, Point][] = [];
  for (const g of groups) {
    const s = cursor + extent(g) / 2;
    cursor += extent(g) + GROUP_GAP;
    const c = { x: base.x + u.x * s / dominant + n.x * offset, y: base.y + u.y * s / dominant + n.y * offset };
    const d = g.forward ? u : { x: -u.x, y: -u.y };
    const from = { x: c.x - d.x * length / 2, y: c.y - d.y * length / 2 }, to = { x: c.x + d.x * length / 2, y: c.y + d.y * length / 2 };
    const arrowBox = inflate(boundsOfPoints([from, to]), halfOf(g.sort));
    let text: Rect, align: 'left' | 'right' = 'left';
    if (horizontal) {
      const x = c.x - g.width / 2 + shift * Math.sign(n.x || 1) * g.width / 2;
      text = { x, y: n.y < 0 ? arrowBox.y - TEXT_GAP - g.height : arrowBox.y + arrowBox.height + TEXT_GAP, width: g.width, height: g.height };
    } else {
      const y = c.y - g.height / 2 + shift * Math.sign(n.y || 1) * g.height / 2;
      if (n.x > 0) text = { x: arrowBox.x + arrowBox.width + TEXT_GAP, y, width: g.width, height: g.height };
      else { text = { x: arrowBox.x - TEXT_GAP - g.width, y, width: g.width, height: g.height }; align = 'right'; }
    }
    placed.push({ group: g, arrow: { from, to }, arrowBox, text, align });
    rects.push(arrowBox, text);
    lines.push([from, to]);
  }
  return { placed, rects, lines };
}

interface World { nodes: Rect[]; segments: { link: string; a: Point; b: Point }[]; placed: Rect[]; placedLines: [Point, Point][] }

function cost(c: Candidate, link: string, world: World): number {
  let total = 0;
  for (const r of c.rects) {
    const padded = inflate(r, 3);
    for (const n of world.nodes) total += overlapArea(padded, n) * 10;
    for (const p of world.placed) total += overlapArea(padded, p) * 10;
  }
  for (const p of c.placed) {
    const thin = inflate(p.text, 2);
    const clearance = halfOf(p.group.sort) + 3;
    for (const s of world.segments) {
      if (segmentIntersectsRect(s.a, s.b, thin)) total += 400;
      else if (s.link !== link && segmentIntersectsRect(s.a, s.b, inflate(p.text, FOREIGN_CLEARANCE))) total += 60;
      const d = segmentDistance(s.a, s.b, p.arrow.from, p.arrow.to);
      if (d < clearance) total += 400;
      else if (s.link !== link && d < clearance + FOREIGN_CLEARANCE) total += 60;
    }
    for (const [a, b] of world.placedLines) if (segmentIntersectsRect(a, b, thin)) total += 400;
  }
  return total;
}

function placeBlock(groups: Group[], segment: [Point, Point], signs: readonly (1 | -1)[], ts: readonly number[], link: string, world: World, length = ARROW): { candidate: Candidate; cost: number } {
  let best: Candidate | undefined, bestCost = Infinity, index = 0;
  for (const sign of signs) for (const t of ts) for (const offset of [13, 19]) for (const shift of [0, 1, -1]) {
    const candidate = sideBlock(groups, segment[0], segment[1], t, sign, offset, shift, length);
    const c = cost(candidate, link, world);
    const scored = c ? c + index * 0.01 : 0;
    index++;
    if (scored < bestCost) { best = candidate; bestCost = scored; }
    if (bestCost === 0) break;
  }
  if (!best) throw new Error('no candidate');
  world.placed.push(...best.rects);
  world.placedLines.push(...best.lines);
  return { candidate: best, cost: Math.floor(bestCost) };
}

// ---------------------------------------------------------------------------
// Grid snapping.

interface Grid { columns: string[][]; rows: string[][] }

function cluster(ids: readonly string[], value: (id: string) => number, threshold: number): string[][] {
  const sorted = [...ids].sort((a, b) => value(a) - value(b) || ids.indexOf(a) - ids.indexOf(b));
  const groups: string[][] = [];
  for (const id of sorted) {
    const current = groups.at(-1);
    if (current && value(id) - value(current[0]!) <= threshold) current.push(id);
    else groups.push([id]);
  }
  return groups;
}

function snap(ids: readonly string[], centers: Map<string, Point>, threshold: number): Grid {
  const cx = (id: string) => centers.get(id)!.x, cy = (id: string) => centers.get(id)!.y;
  const grid: Grid = { columns: cluster(ids, cx, threshold), rows: cluster(ids, cy, threshold) };
  for (let guard = 0; guard < ids.length * 2; guard++) {
    const col = new Map<string, number>(), row = new Map<string, number>();
    for (const [i, c] of grid.columns.entries()) for (const id of c) col.set(id, i);
    for (const [i, r] of grid.rows.entries()) for (const id of r) row.set(id, i);
    const cells = new Map<string, string>();
    let clash: [string, string] | undefined;
    for (const id of ids) {
      const key = `${col.get(id)},${row.get(id)}`;
      const other = cells.get(key);
      if (other !== undefined) { clash = [other, id]; break; }
      cells.set(key, id);
    }
    if (!clash) return grid;
    const [a, b] = clash;
    const byX = Math.abs(cx(a) - cx(b)) >= Math.abs(cy(a) - cy(b));
    const lines = byX ? grid.columns : grid.rows, value = byX ? cx : cy;
    const index = (byX ? col : row).get(a)!;
    const members = lines[index]!;
    // Split between a and b, at the widest gap between them.
    const ia = members.indexOf(a), ib = members.indexOf(b);
    let cut = Math.max(ia, ib), widest = -1;
    for (let k = Math.min(ia, ib) + 1; k <= Math.max(ia, ib); k++) {
      const gap = value(members[k]!) - value(members[k - 1]!);
      if (gap > widest) { widest = gap; cut = k; }
    }
    lines.splice(index, 1, members.slice(0, cut), members.slice(cut));
  }
  return grid;
}

/**
 * Cost of a placement of lifelines on grid cells: prefers short, horizontal or
 * vertical links (then 45 degree diagonals), no link through a lifeline, few
 * crossings and a compact grid not much wider than tall. Only the placed
 * lifelines (and links between them) count, so a partial placement can be scored.
 */
/** Two links of one lifeline closer than 20 degrees count as crowded. */
const NARROW_COS = Math.cos(20 * Math.PI / 180);
/** Cost of two links crossing, in grid cells of link length. */
const CROSSING = 6;

function gridCost(pos: ReadonlyMap<string, Point>, pairs: readonly [string, string][], loops: ReadonlySet<string> = new Set()): number {
  let cost = 0;
  // A self-link needs a corner of its lifeline that no diagonal link leaves through.
  for (const id of loops) {
    const p = pos.get(id);
    if (!p) continue;
    const corners = new Set<string>();
    for (const [a, b] of pairs) {
      const other = a === id ? pos.get(b) : b === id ? pos.get(a) : undefined;
      if (other && other.x !== p.x && other.y !== p.y) corners.add(`${Math.sign(other.x - p.x)},${Math.sign(other.y - p.y)}`);
    }
    if (corners.size === 4) cost += 8;
  }
  const placed = pairs.filter(([a, b]) => pos.has(a) && pos.has(b));
  const segments = placed.map(([a, b]) => [pos.get(a)!, pos.get(b)!] as const);
  for (const [i, [a, b]] of placed.entries()) {
    const [p, q] = segments[i]!;
    const dx = Math.abs(p.x - q.x), dy = Math.abs(p.y - q.y);
    cost += Math.hypot(dx, dy) + (dx === 0 || dy === 0 ? 0 : dx === dy ? 0.45 : 1.2);
    for (const [id, c] of pos) {
      if (id === a || id === b) continue;
      if (Math.abs(c.x - p.x) + Math.abs(c.y - p.y) > dx + dy) continue;
      if (distanceToSegment(c, p, q) < 0.3) cost += 6;
    }
    for (let j = i + 1; j < placed.length; j++) {
      const [c, d] = placed[j]!;
      if (c === a || c === b || d === a || d === b) continue;
      const [r, t] = segments[j]!;
      if (segmentDistance(p, q, r, t) < 1e-9) cost += CROSSING;
    }
  }
  // Links leaving one lifeline at a narrow angle crowd each other's message blocks.
  const spokes = new Map<string, Point[]>();
  for (const [a, b] of placed) {
    const p = pos.get(a)!, q = pos.get(b)!;
    spokes.set(a, [...spokes.get(a) ?? [], { x: q.x - p.x, y: q.y - p.y }]);
    spokes.set(b, [...spokes.get(b) ?? [], { x: p.x - q.x, y: p.y - q.y }]);
  }
  for (const vs of spokes.values()) {
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const u = vs[i]!, v = vs[j]!;
      const cos = (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y));
      if (cos > NARROW_COS) cost += 3;
    }
  }
  const xs = [...pos.values()].map(p => p.x), ys = [...pos.values()].map(p => p.y);
  // Compact, and not much wider than tall: a cell is about three times wider
  // than tall on paper, so a grid with more columns than rows is already wide.
  const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
  return cost + 0.25 * (width + height) + 0.6 * Math.max(0, width - height);
}

const toGrid = (ids: readonly string[], pos: ReadonlyMap<string, Point>): Grid => {
  const xs = [...new Set([...pos.values()].map(p => p.x))].sort((a, b) => a - b);
  const ys = [...new Set([...pos.values()].map(p => p.y))].sort((a, b) => a - b);
  return {
    columns: xs.map(x => ids.filter(id => pos.get(id)!.x === x)),
    rows: ys.map(y => ids.filter(id => pos.get(id)!.y === y)),
  };
};

const fromGrid = (grid: Grid): Map<string, Point> => {
  const pos = new Map<string, Point>();
  for (const [x, c] of grid.columns.entries()) for (const id of c) pos.set(id, { x, y: 0 });
  for (const [y, r] of grid.rows.entries()) for (const id of r) { pos.get(id)!.y = y; }
  return pos;
};

/**
 * Greedy construction: the best connected lifeline first (a hub in the middle),
 * then each next lifeline (most links to those already placed) on the free cell
 * that adds least cost. Stars become wheels around their hub, with every spoke
 * on a neighbouring cell, instead of whatever the stress layout snapped to.
 */
function constructGrid(ids: readonly string[], pairs: readonly [string, string][], loops: ReadonlySet<string>): Map<string, Point> {
  const pos = new Map<string, Point>();
  const degree = new Map(ids.map(id => [id, 0]));
  for (const [a, b] of pairs) { degree.set(a, degree.get(a)! + 1); degree.set(b, degree.get(b)! + 1); }
  const taken = new Set<string>();
  const key = (p: Point) => `${p.x},${p.y}`;
  while (pos.size < ids.length) {
    const links = (id: string) => pairs.filter(([a, b]) => (a === id && pos.has(b)) || (b === id && pos.has(a))).length;
    let next = ids[0]!, best = -Infinity;
    for (const id of ids) {
      if (pos.has(id)) continue;
      const score = links(id) * 100 + degree.get(id)!;
      if (score > best) { best = score; next = id; }
    }
    if (pos.size === 0) { pos.set(next, { x: 0, y: 0 }); taken.add('0,0'); continue; }
    const xs = [...pos.values()].map(p => p.x), ys = [...pos.values()].map(p => p.y);
    let cell: Point | undefined, cellCost = Infinity;
    for (let y = Math.min(...ys) - 2; y <= Math.max(...ys) + 2; y++) for (let x = Math.min(...xs) - 2; x <= Math.max(...xs) + 2; x++) {
      if (taken.has(`${x},${y}`)) continue;
      pos.set(next, { x, y });
      const c = gridCost(pos, pairs, loops);
      if (c < cellCost - 1e-9) { cellCost = c; cell = { x, y }; }
    }
    pos.set(next, cell!);
    taken.add(key(cell!));
  }
  return pos;
}

/**
 * Local search on grid cells (gridCost), from a start placement: moves or swaps
 * one lifeline at a time while that lowers the cost. Deterministic.
 */
function localSearch(ids: readonly string[], pairs: readonly [string, string][], loops: ReadonlySet<string>, pos: Map<string, Point>): number {
  const occupant = new Map<string, string>();
  const key = (p: Point) => `${p.x},${p.y}`;
  for (const [id, p] of pos) occupant.set(key(p), id);
  const move = (id: string, to: Point): void => {
    const from = pos.get(id)!, other = occupant.get(key(to));
    occupant.delete(key(from));
    if (other !== undefined) { pos.set(other, from); occupant.set(key(from), other); }
    pos.set(id, to);
    occupant.set(key(to), id);
  };
  let current = gridCost(pos, pairs, loops);
  for (let pass = 0; pass < 40; pass++) {
    let improved = false;
    for (const id of ids) {
      const origin = pos.get(id)!;
      let best: Point | undefined, bestCost = current - 1e-6;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (!dx && !dy) continue;
        const to = { x: origin.x + dx, y: origin.y + dy };
        move(id, to);
        const c = gridCost(pos, pairs, loops);
        if (c < bestCost) { bestCost = c; best = to; }
        move(id, origin);
      }
      if (best) { move(id, best); current = bestCost; improved = true; }
    }
    if (!improved) break;
  }
  return current;
}

/**
 * The grid: the snapped stress layout and a greedy construction, each improved
 * by local search; the cheaper one wins (the stress layout on ties).
 */
function refineGrid(ids: readonly string[], pairs: readonly [string, string][], loops: ReadonlySet<string>, start: Grid): Grid {
  const snapped = fromGrid(start);
  const a = localSearch(ids, pairs, loops, snapped);
  const built = constructGrid(ids, pairs, loops);
  const b = localSearch(ids, pairs, loops, built);
  return toGrid(ids, b < a - 1e-6 ? built : snapped);
}

// ---------------------------------------------------------------------------
// Routing.

function clip(rect: Rect, toward: Point): Point {
  const c = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const dx = toward.x - c.x, dy = toward.y - c.y;
  const t = Math.min(dx ? rect.width / 2 / Math.abs(dx) : Infinity, dy ? rect.height / 2 / Math.abs(dy) : Infinity);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

function blocked(points: readonly Point[], obstacles: readonly Rect[]): boolean {
  for (let k = 1; k < points.length; k++) for (const r of obstacles) if (segmentIntersectsRect(points[k - 1]!, points[k]!, inflate(r, 4))) return true;
  return false;
}

function route(a: Rect, b: Rect, others: readonly Rect[]): Point[] {
  const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 }, cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const straight = [clip(a, cb), clip(b, ca)];
  if (!blocked(straight, others)) return straight;
  const options: Point[][] = [];
  const sideX = (r: Rect, toward: number) => toward > r.x + r.width / 2 ? r.x + r.width : r.x;
  const sideY = (r: Rect, toward: number) => toward > r.y + r.height / 2 ? r.y + r.height : r.y;
  // L-shapes: horizontal first or vertical first.
  if ((cb.x < a.x || cb.x > a.x + a.width) && (ca.y < b.y || ca.y > b.y + b.height)) options.push([{ x: sideX(a, cb.x), y: ca.y }, { x: cb.x, y: ca.y }, { x: cb.x, y: sideY(b, ca.y) }]);
  if ((ca.x < b.x || ca.x > b.x + b.width) && (cb.y < a.y || cb.y > a.y + a.height)) options.push([{ x: ca.x, y: sideY(a, cb.y) }, { x: ca.x, y: cb.y }, { x: sideX(b, ca.x), y: cb.y }]);
  // Channels above, below, left and right of everything in between.
  const span = union([a, b, ...others.filter(r => segmentIntersectsRect(straight[0]!, straight[1]!, inflate(r, 4)))]);
  const above = span.y - 24, below = span.y + span.height + 24, left = span.x - 24, rightX = span.x + span.width + 24;
  options.push([{ x: ca.x, y: a.y }, { x: ca.x, y: above }, { x: cb.x, y: above }, { x: cb.x, y: b.y }], [{ x: ca.x, y: a.y + a.height }, { x: ca.x, y: below }, { x: cb.x, y: below }, { x: cb.x, y: b.y + b.height }], [{ x: a.x, y: ca.y }, { x: left, y: ca.y }, { x: left, y: cb.y }, { x: b.x, y: cb.y }], [{ x: a.x + a.width, y: ca.y }, { x: rightX, y: ca.y }, { x: rightX, y: cb.y }, { x: b.x + b.width, y: cb.y }]);
  return options.find(o => !blocked(o, others)) ?? straight;
}

function longestSegment(points: readonly Point[]): [Point, Point] {
  let best: [Point, Point] = [points[0]!, points[1]!];
  for (let k = 2; k < points.length; k++) if (distance(points[k - 1]!, points[k]!) > distance(best[0], best[1]) + 0.5) best = [points[k - 1]!, points[k]!];
  return best;
}

// ---------------------------------------------------------------------------

export async function layoutCommunicationDiagram(model: CommunicationDiagram, metrics: FontMetrics): Promise<CommScene> {
  const links = plan(model, metrics);
  const lh = metrics.lineHeight(LABEL.size);

  // Lifeline boxes and the room their self-links need.
  const nodes = new Map<string, { lifeline: Lifeline; label: string; box: MeasuredBox; w: number; h: number; left: number; right: number; top: number; bottom: number; loop?: { sx: 1 | -1; sy: 1 | -1; up: number } }>();
  for (const l of model.lifelines) {
    const label = lifelineLabel(l);
    const box = measureBox(metrics, [{ header: true, lines: [{ text: label, style: NAME, align: 'center', wrap: theme.size.maxNameWidth }] }]);
    const s = l.multiObject ? STACK : 0;
    nodes.set(l.id, { lifeline: l, label, box, w: box.width + s, h: box.height + s, left: 0, right: 0, top: 0, bottom: 0 });
  }
  const ids = model.lifelines.map(l => l.id);
  const pairs = links.filter(k => !k.self);

  // 1. Stress placement, 2. grid snapping.
  const desired = 190;
  const centers = await stressCenters(
    ids.map(id => ({ id, width: nodes.get(id)!.w, height: nodes.get(id)!.h })),
    pairs.map(k => ({ source: k.from, target: k.to, length: Math.max(desired, 90 + Math.max(0, ...k.groups.map(g => Math.max(g.width, g.height)))) })),
    { edgeLength: desired });
  const grid = refineGrid(ids, pairs.map(k => [k.from, k.to]), new Set(links.filter(k => k.self).map(k => k.from)), snap(ids, centers, desired * 0.42));
  // Mirror so that messages mostly flow left to right and top to bottom, the
  // reading direction (the stress layout has no preferred orientation).
  {
    const col = new Map<string, number>(), row = new Map<string, number>();
    for (const [i, c] of grid.columns.entries()) for (const id of c) col.set(id, i);
    for (const [i, r] of grid.rows.entries()) for (const id of r) row.set(id, i);
    let flowX = 0, flowY = 0;
    for (const m of model.messages ?? []) {
      const weight = 1 / (1 + (parseSequence(m.sequence)?.length ?? 1));
      flowX += Math.sign(col.get(m.to)! - col.get(m.from)!) * weight;
      flowY += Math.sign(row.get(m.to)! - row.get(m.from)!) * weight;
    }
    if (flowX < 0) grid.columns.reverse();
    if (flowY < 0) grid.rows.reverse();
  }
  const colOf = new Map<string, number>(), rowOf = new Map<string, number>();
  for (const [i, c] of grid.columns.entries()) for (const id of c) colOf.set(id, i);
  for (const [i, r] of grid.rows.entries()) for (const id of r) rowOf.set(id, i);
  const C = grid.columns.length, R = grid.rows.length;

  // Self-links: a rectangular loop at the corner of the lifeline that no link
  // leaves through, with its message block beside the loop's outer leg.
  for (const link of links.filter(k => k.self)) {
    const n = nodes.get(link.from)!;
    const here = { x: colOf.get(link.from)!, y: rowOf.get(link.from)! };
    const away = pairs.filter(k => k.from === link.from || k.to === link.from).map(k => {
      const other = k.from === link.from ? k.to : k.from;
      return { x: Math.sign(colOf.get(other)! - here.x), y: Math.sign(rowOf.get(other)! - here.y) };
    });
    const corners = [[1, -1], [-1, -1], [1, 1], [-1, 1]] as const;
    const penalty = ([sx, sy]: readonly [number, number]) => away.reduce((sum, d) =>
      sum + (d.x === sx && d.y === sy ? 10 : d.y === 0 && d.x === sx ? 1 : d.x === 0 && d.y === sy ? 0.5 : 0), 0);
    const [sx, sy] = [...corners].sort((a, b) => penalty(a) - penalty(b))[0]!;
    const width = link.groups.length > 0 ? Math.max(...link.groups.map(g => g.width)) : 0;
    const extent = link.groups.reduce((sum, g) => sum + Math.max(g.height, SELF_ARROW), 0) + GROUP_GAP * Math.max(0, link.groups.length - 1);
    const up = Math.max(LOOP_UP, extent + 10 - (n.h / 2 - LOOP_END));
    const side = LOOP_OUT + (width ? 19 + theme.size.arrow.halfWidth + TEXT_GAP + width + 4 : 6);
    if (sx > 0) n.right = side; else n.left = side;
    if (sy < 0) n.top = up + 4; else n.bottom = up + 4;
    n.loop = { sx, sy, up };
  }
  const colLeft = grid.columns.map(c => Math.max(...c.map(id => nodes.get(id)!.w / 2 + nodes.get(id)!.left)));
  const colRight = grid.columns.map(c => Math.max(...c.map(id => nodes.get(id)!.w / 2 + nodes.get(id)!.right)));
  const rowTop = grid.rows.map(r => Math.max(...r.map(id => nodes.get(id)!.h / 2 + nodes.get(id)!.top)));
  const rowBottom = grid.rows.map(r => Math.max(...r.map(id => nodes.get(id)!.h / 2 + nodes.get(id)!.bottom)));
  const gapX = Array.from({ length: Math.max(0, C - 1) }, () => 64);
  const gapY = Array.from({ length: Math.max(0, R - 1) }, () => 56);

  const along = (k: LinkPlan, horizontal: boolean): number => {
    const sides = [k.groups.filter(g => g.forward), k.groups.filter(g => !g.forward)];
    return Math.max(0, ...sides.map(gs => gs.reduce((s, g) => s + Math.max(horizontal ? g.width : g.height, ARROW), 0) + GROUP_GAP * Math.max(0, gs.length - 1)));
  };

  const build = () => {
    const xs: number[] = [], ys: number[] = [];
    let x = 0;
    for (let c = 0; c < C; c++) { x += colLeft[c]!; xs.push(x); x += colRight[c]! + (gapX[c] ?? 0); }
    let y = 0;
    for (let r = 0; r < R; r++) { y += rowTop[r]!; ys.push(y); y += rowBottom[r]! + (gapY[r] ?? 0); }
    const rects = new Map<string, Rect>();
    for (const id of ids) {
      const n = nodes.get(id)!;
      rects.set(id, { x: xs[colOf.get(id)!]! - n.w / 2, y: ys[rowOf.get(id)!]! - n.h / 2, width: n.w, height: n.h });
    }
    return rects;
  };

  // 3. Widen gaps until straight horizontal and vertical links fit their messages.
  for (let pass = 0; pass < 4; pass++) {
    const rects = build();
    let changed = false;
    for (const k of pairs) {
      const a = rects.get(k.from)!, b = rects.get(k.to)!;
      const [ca, cb] = [colOf.get(k.from)!, colOf.get(k.to)!], [ra, rb] = [rowOf.get(k.from)!, rowOf.get(k.to)!];
      if (ra === rb && ca !== cb) {
        const free = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width);
        const need = along(k, true) + 2 * 26;
        if (free < need) { for (let c = Math.min(ca, cb); c < Math.max(ca, cb); c++) gapX[c]! += (need - free) / Math.abs(ca - cb); changed = true; }
      } else if (ca === cb && ra !== rb) {
        const free = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height);
        const need = along(k, false) + 2 * 22;
        if (free < need) { for (let r = Math.min(ra, rb); r < Math.max(ra, rb); r++) gapY[r]! += (need - free) / Math.abs(ra - rb); changed = true; }
      }
    }
    if (!changed) break;
  }

  // 4./5. Route, place message blocks; widen the gaps around trouble and retry.
  let best: { cost: number; rects: Map<string, Rect>; routes: Map<string, Point[]>; placed: Placed[] } | undefined;
  for (let attempt = 0; attempt < 10; attempt++) {
    const rects = build();
    const routes = new Map<string, Point[]>();
    for (const k of links) {
      if (k.self) {
        const r = rects.get(k.from)!, { sx, sy, up } = nodes.get(k.from)!.loop!;
        const side = sx > 0 ? r.x + r.width : r.x, inner = side - sx * LOOP_INSET, outer = side + sx * LOOP_OUT;
        const edge = sy < 0 ? r.y : r.y + r.height, far = edge + sy * up, end = r.y + r.height / 2 + sy * LOOP_END;
        routes.set(k.id, [{ x: inner, y: edge }, { x: inner, y: far }, { x: outer, y: far }, { x: outer, y: end }, { x: side, y: end }]);
      } else {
        routes.set(k.id, route(rects.get(k.from)!, rects.get(k.to)!, ids.filter(id => id !== k.from && id !== k.to).map(id => rects.get(id)!)));
      }
    }
    const world: World = { nodes: [...rects.values()], segments: [], placed: [], placedLines: [] };
    for (const k of links) {
      const points = routes.get(k.id)!;
      for (let i = 1; i < points.length; i++) world.segments.push({ link: k.id, a: points[i - 1]!, b: points[i]! });
    }
    let total = 0;
    const placed: Placed[] = [];
    const trouble = new Set<LinkPlan>();
    const order = [...links].sort((x, y) => y.groups.length - x.groups.length || links.indexOf(x) - links.indexOf(y));
    for (const k of order) {
      if (k.groups.length === 0) continue;
      const points = routes.get(k.id)!;
      if (k.self) {
        const { sx, sy } = nodes.get(k.from)!.loop!;
        const result = placeBlock(k.groups, [points[2]!, points[3]!], [(sx * (sy < 0 ? 1 : -1)) as 1 | -1], [0.5, 0.42, 0.58], k.id, world, SELF_ARROW);
        placed.push(...result.candidate.placed);
        total += result.cost;
        if (result.cost) trouble.add(k);
        continue;
      }
      const segment = longestSegment(points);
      const u = direction(segment[0], segment[1]);
      const horizontal = Math.abs(u.x) >= Math.abs(u.y);
      const forward = k.groups.filter(g => g.forward), backward = k.groups.filter(g => !g.forward);
      // Left of the travel direction; with one direction only, prefer above / right.
      const nicer: 1 | -1 = (horizontal ? u.x > 0 : u.y > 0) ? 1 : -1;
      const ts = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74];
      for (const [groups, sign] of [[forward, 1], [backward, -1]] as const) {
        if (groups.length === 0) continue;
        const signs: (1 | -1)[] = forward.length > 0 && backward.length > 0 ? [sign] : [nicer, -nicer as 1 | -1];
        const result = placeBlock(groups, segment, signs, ts, k.id, world);
        placed.push(...result.candidate.placed);
        total += result.cost;
        if (result.cost) trouble.add(k);
      }
    }
    if (!best || total < best.cost) best = { cost: total, rects, routes, placed };
    if (total === 0) break;
    for (const k of trouble) {
      const [ca, cb] = [colOf.get(k.from)!, colOf.get(k.to)!], [ra, rb] = [rowOf.get(k.from)!, rowOf.get(k.to)!];
      for (let c = Math.min(ca, cb); c < Math.max(ca, cb); c++) gapX[c]! += 28;
      for (let r = Math.min(ra, rb); r < Math.max(ra, rb); r++) gapY[r]! += 24;
      if (k.self) {
        const { sx, sy } = nodes.get(k.from)!.loop!;
        const c = sx > 0 ? ca : ca - 1, r = sy > 0 ? ra : ra - 1;
        if (c >= 0 && c < C - 1) gapX[c]! += 28;
        if (r >= 0 && r < R - 1) gapY[r]! += 24;
      }
      if (ca === cb && ra !== rb) { if (ca > 0) gapX[ca - 1]! += 14; if (ca < C - 1) gapX[ca]! += 14; }
      if (ra === rb && ca !== cb) { if (ra > 0) gapY[ra - 1]! += 12; if (ra < R - 1) gapY[ra]! += 12; }
    }
  }
  const { rects, routes, placed } = best!;

  // Scene in absolute coordinates, moved to the canvas margin (inside the frame).
  const sceneNodes: CommNode[] = model.lifelines.map(l => {
    const n = nodes.get(l.id)!, bounds = rects.get(l.id)!;
    const s = l.multiObject ? STACK : 0;
    const front = { x: bounds.x, y: bounds.y + s, width: n.box.width, height: n.box.height };
    return { lifeline: l, label: n.label, box: n.box, bounds, front, ...(s ? { back: { ...front, x: front.x + s, y: bounds.y } } : {}) };
  });
  const sceneLinks: CommLink[] = links.map(k => ({ id: k.id, source: k.from, target: k.to, points: routes.get(k.id)! }));
  const arrows: CommArrow[] = placed.map(p => ({
    owner: p.group.link, group: p.group.id, source: p.group.source, target: p.group.target,
    from: p.arrow.from, to: p.arrow.to, style: p.group.sort === 'reply' ? 'dashed' : 'solid', marker: markerOf(p.group.sort),
  }));
  const labels: CommLabel[] = placed.flatMap(p => {
    let y = p.text.y;
    return p.group.messages.map(m => {
      const label: CommLabel = { owner: p.group.link, group: p.group.id, rows: m.rows, widths: m.widths, x: p.text.x, y, align: p.align, width: p.text.width };
      y += m.rows.length * lh;
      return label;
    });
  });

  const content = union([
    ...sceneNodes.map(n => n.bounds), ...placed.flatMap(p => [p.text, p.arrowBox]),
    ...sceneLinks.flatMap(l => l.points.map(p => ({ ...p, width: 0, height: 0 }))),
  ]);
  const margin = theme.spacing.canvas, pad = theme.spacing.frame;
  const heading = model.title === undefined ? undefined : measureFrameHeading(metrics, 'sd', model.title);
  const originX = margin + (heading ? pad : 0), originY = margin + (heading ? heading.height + pad : 0);
  const dx = originX - content.x, dy = originY - content.y;
  const mr = (r: Rect): Rect => ({ x: r.x + dx, y: r.y + dy, width: r.width, height: r.height });
  const mp = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  let width = originX + content.width + (heading ? pad : 0);
  const height = originY + content.height + (heading ? pad : 0);
  let frame: CommScene['frame'];
  if (heading) {
    const frameWidth = Math.max(width - margin, heading.width + pad);
    frame = { bounds: { x: margin, y: margin, width: frameWidth, height: height - margin }, title: model.title! };
    width = margin + frameWidth;
  }
  return {
    width: width + margin, height: height + margin, ...(frame ? { frame } : {}),
    nodes: sceneNodes.map(n => ({ ...n, bounds: mr(n.bounds), front: mr(n.front), ...(n.back ? { back: mr(n.back) } : {}) })),
    links: sceneLinks.map(l => ({ ...l, points: l.points.map(mp) })),
    arrows: arrows.map(a => ({ ...a, from: mp(a.from), to: mp(a.to) })),
    labels: labels.map(l => ({ ...l, x: l.x + dx, y: l.y + dy })),
  };
}

