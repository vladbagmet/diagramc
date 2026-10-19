import { theme } from '../../core/theme.js';
import { clipRoute, type NodeShape } from '../../engine/clip.js';
import type { Marker, LineStyle } from '../../engine/edges.js';
import { layout, type LayoutEdge, type LayoutLabel, type LayoutNode } from '../../engine/elk.js';
import type { FontMetrics, TextStyle } from '../../engine/fonts.js';
import { center, direction, distance, inflate, segmentIntersectsRect, union, type Point, type Rect } from '../../engine/geometry.js';
import { placeLabels, type LabelRequest } from '../../engine/labels.js';
import { measureFrameHeading, measureNote } from '../../engine/shapes.js';
import { wrapText } from '../../engine/text.js';
import type { Actor, Element, Extend, Relationship, Subject, UseCase, UseCaseDiagram } from './model.js';

/** A line of text inside a shape: centered at `x`, baseline from `top`. */
export interface TextRow { text: string; style: TextStyle; fill?: string | undefined; width: number; /** Rows of one input string share a group. */ group: number }
export interface MeasuredUseCase { rows: TextRow[]; nameRows: number; width: number; height: number; blockHeight: number }

/** Positioned geometry of a use case diagram, ready to draw. */
export interface UseCaseScene {
  width: number;
  height: number;
  frame?: { bounds: Rect; title: string };
  subjects: { subject: Subject; bounds: Rect; rows: TextRow[] }[];
  actors: { actor: Actor; bounds: Rect; caption: { rect: Rect; rows: TextRow[] } }[];
  useCases: { useCase: UseCase; bounds: Rect; measured: MeasuredUseCase; parent?: string | undefined }[];
  notes: { id: string; bounds: Rect; rows: string[]; parent?: string | undefined }[];
  edges: { id: string; type: string; source: string; target: string; points: Point[]; style: LineStyle; sourceMarker: Marker; targetMarker: Marker }[];
  labels: { id: string; owner: string; rect: Rect; lines: string[]; widths: number[]; end?: 'source' | 'target'; anchor?: Point }[];
}

const LABEL: TextStyle = { size: theme.font.size.label };
const NAME: TextStyle = { size: theme.font.size.name };
const BODY: TextStyle = { size: theme.font.size.body };
const guillemets = (names: readonly string[]): string => `«${names.join(', ')}»`;

export function measureUseCase(metrics: FontMetrics, u: UseCase): MeasuredUseCase {
  const row = (text: string, style: TextStyle, group: number, fill?: string): TextRow => ({ text, style, fill, width: Math.ceil(metrics.measure(text.trimEnd(), style)), group });
  const rows = wrapText(metrics, u.name, NAME, 170).map(t => row(t, NAME, 0));
  const nameRows = rows.length;
  if (u.extensionPoints?.length) {
    rows.push(row('extension points', LABEL, 1, theme.color.mutedText));
    u.extensionPoints.forEach((p, i) => { for (const t of wrapText(metrics, p, BODY, 170)) rows.push(row(t, BODY, i + 2)); });
  }
  const blockHeight = rows.reduce((sum, r) => sum + metrics.lineHeight(r.style.size), 0) + (nameRows < rows.length ? 8 : 0);
  const blockWidth = Math.max(...rows.map(r => r.width));
  // The text block is the rectangle inscribed in the ellipse (half-axes = half-sizes x sqrt 2).
  const width = Math.max(theme.size.useCase.minWidth, Math.ceil(blockWidth * Math.SQRT2 + 12));
  const height = Math.max(theme.size.useCase.minHeight, Math.ceil(blockHeight * Math.SQRT2 + 6));
  return { rows, nameRows, width, height, blockHeight };
}

/** Rows of the condition note of an «extend» (UML 2.5.1 Figure 18.3). */
function conditionRows(metrics: FontMetrics, r: Extend): string[] {
  const style = { size: theme.font.size.body }, width = theme.size.maxNoteWidth;
  return [...wrapText(metrics, `Condition: {${r.condition}}`, style, width), ...wrapText(metrics, `extension point: ${r.extensionPoint}`, style, width)];
}

export async function layoutUseCaseDiagram(model: UseCaseDiagram, metrics: FontMetrics): Promise<UseCaseScene> {
  const lineHeight = metrics.lineHeight(LABEL.size);
  const relationships = (model.relationships ?? []).map((r, i) => ({ r, key: r.id ?? `relationships/${i}` }));
  const byId = new Map<string, Element>(model.elements.map(e => [e.id, e]));
  const subjectOf = (id: string): string | undefined => { const e = byId.get(id); return e?.type === 'useCase' ? e.subject : undefined; };

  // Sizes.
  const useCases = new Map<string, MeasuredUseCase>();
  const captions = new Map<string, { rows: TextRow[]; width: number; height: number }>();
  const noteRows = new Map<string, string[]>();
  const subjectRows = new Map<string, TextRow[]>();
  const nodeOf = (e: Element): LayoutNode => {
    switch (e.type) {
      case 'useCase': {
        const m = measureUseCase(metrics, e);
        useCases.set(e.id, m);
        return { id: e.id, width: m.width, height: m.height };
      }
      case 'actor': {
        const rows: TextRow[] = [];
        if (e.stereotypes?.length) rows.push({ text: guillemets(e.stereotypes), style: LABEL, fill: theme.color.mutedText, width: Math.ceil(metrics.measure(guillemets(e.stereotypes), LABEL)), group: 0 });
        for (const t of wrapText(metrics, e.name, BODY, 140)) rows.push({ text: t, style: BODY, width: Math.ceil(metrics.measure(t.trimEnd(), BODY)), group: 1 });
        const width = Math.max(...rows.map(r => r.width)) + 4;
        const height = rows.reduce((sum, r) => sum + metrics.lineHeight(r.style.size), 0) + 4;
        captions.set(e.id, { rows, width, height });
        return { id: e.id, width: theme.size.actor.width, height: theme.size.actor.height, labelBelow: { width: width + 8, height: height + 4 } };
      }
      case 'note': {
        const note = measureNote(metrics, e.text);
        noteRows.set(e.id, note.rows);
        return { id: e.id, width: note.width, height: note.height };
      }
      case 'subject': {
        const rows: TextRow[] = [];
        if (e.stereotypes?.length) rows.push({ text: guillemets(e.stereotypes), style: LABEL, fill: theme.color.mutedText, width: Math.ceil(metrics.measure(guillemets(e.stereotypes), LABEL)), group: 0 });
        for (const t of wrapText(metrics, e.name, { ...NAME, bold: true }, theme.size.maxNameWidth)) rows.push({ text: t, style: { ...NAME, bold: true }, width: Math.ceil(metrics.measure(t.trimEnd(), { ...NAME, bold: true })), group: 1 });
        subjectRows.set(e.id, rows);
        const header = rows.reduce((sum, r) => sum + metrics.lineHeight(r.style.size), 0) + 2 * theme.spacing.headerPadY;
        return { id: e.id, width: Math.max(...rows.map(r => r.width)) + 2 * theme.spacing.padX, height: header + 20, padding: { top: header + 8, left: 24, bottom: 24, right: 24 }, children: [] };
      }
    }
  };
  const roots: LayoutNode[] = [];
  const subjects = new Map<string, LayoutNode>();
  for (const e of model.elements) if (e.type === 'subject') { const n = nodeOf(e); subjects.set(e.id, n); }
  // Notes go into the subject when everything they annotate is inside it.
  const containerOfNote = (targets: readonly string[]): string | undefined => {
    const set = new Set(targets.map(subjectOf));
    return set.size === 1 ? [...set][0] : undefined;
  };
  const noteParent = new Map<string, string | undefined>();
  for (const e of model.elements) {
    if (e.type === 'subject') { roots.push(subjects.get(e.id)!); continue; }
    const parent = e.type === 'useCase' ? e.subject : e.type === 'note' ? containerOfNote(e.attachedTo ?? []) : undefined;
    if (e.type === 'note') noteParent.set(e.id, parent);
    (parent ? subjects.get(parent)!.children! : roots).push(nodeOf(e));
  }
  // Condition notes of «extend», beside the extending use case.
  const conditions = new Map<string, { noteId: string; rows: string[] }>();
  for (const { r, key } of relationships) {
    if (r.type !== 'extend' || r.condition === undefined) continue;
    const rows = conditionRows(metrics, r);
    const style = { size: theme.font.size.body };
    const width = Math.ceil(Math.max(...rows.map(t => metrics.measure(t.trimEnd(), style))) + 20 + theme.size.noteFold / 2);
    const height = rows.length * metrics.lineHeight(style.size) + 18;
    const noteId = `${key}::condition`;
    conditions.set(key, { noteId, rows });
    noteRows.set(noteId, rows);
    const parent = subjectOf(r.from) !== undefined && subjectOf(r.from) === subjectOf(r.to) ? subjectOf(r.from) : undefined;
    noteParent.set(noteId, parent);
    (parent ? subjects.get(parent)!.children! : roots).push({ id: noteId, width, height });
  }

  // Edges: generalizations and extends point "backwards" in reading order, so ELK
  // gets them reversed (general and base first); routes are flipped back after layout.
  interface Plan { key: string; r: Relationship; reversed: boolean; style: LineStyle; target: Marker; center?: string; ends: { end: 'source' | 'target'; text: string; width: number }[] }
  const plans: Plan[] = relationships.map(({ r, key }) => {
    const ends: Plan['ends'] = [];
    if (r.type === 'association') {
      for (const [end, data] of [['source', r.fromEnd], ['target', r.toEnd]] as const) {
        if (data?.multiplicity !== undefined) ends.push({ end, text: data.multiplicity, width: Math.ceil(metrics.measure(data.multiplicity, LABEL)) });
      }
    }
    switch (r.type) {
      case 'association': return { key, r, reversed: false, style: 'solid', target: 'none', ...(r.name !== undefined ? { center: r.name } : {}), ends };
      case 'include': return { key, r, reversed: false, style: 'dashed', target: 'open-arrow', center: '«include»', ends };
      case 'extend': return { key, r, reversed: true, style: 'dashed', target: 'open-arrow', center: '«extend»', ends };
      default: return { key, r, reversed: true, style: 'solid', target: 'hollow-triangle', ends };
    }
  });
  const centerLines = new Map<string, { lines: string[]; widths: number[] }>();
  for (const p of plans) {
    if (p.center === undefined) continue;
    const lines = wrapText(metrics, p.center, LABEL, 160);
    centerLines.set(p.key, { lines, widths: lines.map(l => Math.ceil(metrics.measure(l.trimEnd(), LABEL))) });
  }
  const edges: LayoutEdge[] = plans.map(p => {
    const labels: LayoutLabel[] = [];
    const c = centerLines.get(p.key);
    if (c) labels.push({ id: `${p.key}::center`, width: Math.max(...c.widths) + 4, height: c.lines.length * lineHeight, placement: 'center' });
    p.ends.forEach((e, k) => labels.push({ id: `${p.key}::end${k}`, width: e.width + 4, height: lineHeight, placement: (e.end === 'source') !== p.reversed ? 'tail' : 'head' }));
    return { id: p.key, source: p.reversed ? p.r.to : p.r.from, target: p.reversed ? p.r.from : p.r.to, labels, directionPriority: p.r.type === 'association' ? 5 : 1 };
  });
  const anchors: { id: string; note: string; target: string }[] = [];
  for (const e of model.elements) {
    if (e.type !== 'note') continue;
    for (const target of e.attachedTo ?? []) {
      anchors.push({ id: `${e.id}->${target}`, note: e.id, target });
      edges.push({ id: `${e.id}->${target}`, source: target, target: e.id });
    }
  }
  for (const [key, c] of conditions) {
    const r = relationships.find(x => x.key === key)!.r;
    // Laid out after the base use case, beside the extending one (extends run base first).
    edges.push({ id: `${c.noteId}::place`, source: r.to, target: c.noteId });
  }

  const result = await layout(roots, edges, { direction: 'RIGHT', routing: 'polyline', layerSpacing: 72, nodeSpacing: 28 });
  const rect = (id: string): Rect => result.nodes.get(id)!;
  const shapeOf = (id: string): NodeShape => byId.get(id)?.type === 'useCase' ? 'ellipse' : 'rect';

  const sceneEdges: UseCaseScene['edges'] = [];
  const routes = new Map<string, Point[]>();
  for (const p of plans) {
    let route = result.edges.get(p.key)!.points;
    if (p.reversed) route = [...route].reverse();
    route = clipRoute(route, 'source', rect(p.r.from), shapeOf(p.r.from));
    route = clipRoute(route, 'target', rect(p.r.to), shapeOf(p.r.to));
    routes.set(p.key, route);
    sceneEdges.push({ id: p.key, type: p.r.type, source: p.r.from, target: p.r.to, points: route, style: p.style, sourceMarker: 'none', targetMarker: p.target });
  }
  for (const a of anchors) {
    // Laid out from the target to the note; drawn from the note to the target.
    let route = [...result.edges.get(a.id)!.points].reverse();
    route = clipRoute(route, 'target', rect(a.target), shapeOf(a.target));
    sceneEdges.push({ id: a.id, type: 'note-anchor', source: a.note, target: a.target, points: route, style: 'dashed', sourceMarker: 'none', targetMarker: 'none' });
  }
  for (const [key, c] of conditions) {
    // The condition note is attached to its «extend» line, at the point nearest
    // to the note whose dashed anchor crosses no other element.
    const note = rect(c.noteId);
    const others = [...model.elements.filter(e => e.type !== 'subject').map(e => rect(e.id)), ...[...conditions.values()].filter(o => o !== c).map(o => rect(o.noteId))];
    const candidates = samples(routes.get(key)!).map(p => ({ p, from: rectHit(p, note) }))
      .filter(({ p, from }) => !others.some(o => segmentIntersectsRect(from, p, inflate(o, 2))))
      .sort((a, b) => distance(a.p, a.from) - distance(b.p, b.from));
    const mid = midpoint(routes.get(key)!);
    const best = candidates[0] ?? { p: mid, from: rectHit(mid, note) };
    sceneEdges.push({ id: `${c.noteId}::anchor`, type: 'note-anchor', source: c.noteId, target: key, points: [best.from, best.p], style: 'dashed', sourceMarker: 'none', targetMarker: 'none' });
  }

  // Actor captions and labels.
  const actors: UseCaseScene['actors'] = [];
  for (const e of model.elements) {
    if (e.type !== 'actor') continue;
    const b = rect(e.id), c = captions.get(e.id)!;
    actors.push({ actor: e, bounds: b, caption: { rect: { x: b.x + b.width / 2 - c.width / 2, y: b.y + b.height + 4, width: c.width, height: c.height }, rows: c.rows } });
  }
  const obstacles = {
    rects: [...model.elements.filter(e => e.type !== 'subject').map(e => rect(e.id)), ...actors.map(a => a.caption.rect), ...[...conditions.values()].map(c => rect(c.noteId))],
    segments: sceneEdges.flatMap(e => e.points.slice(1).map((p, k) => [e.points[k]!, p] as [Point, Point])),
  };
  for (const [id, rows] of subjectRows) {
    const b = rect(id);
    const height = rows.reduce((sum, r) => sum + metrics.lineHeight(r.style.size), 0) + 2 * theme.spacing.headerPadY;
    obstacles.rects.push({ x: b.x, y: b.y, width: b.width, height });
  }
  const requests: LabelRequest[] = [];
  const meta = new Map<string, Omit<UseCaseScene['labels'][number], 'id' | 'rect'>>();
  for (const p of plans) {
    const route = routes.get(p.key)!;
    p.ends.forEach((e, k) => {
      const id = `${p.key}::end${k}`;
      requests.push({ id, width: e.width, height: lineHeight, route, at: e.end, side: 1, clearance: 4 });
      meta.set(id, { owner: p.key, lines: [e.text], widths: [e.width], end: e.end, anchor: e.end === 'source' ? route[0]! : route.at(-1)! });
    });
  }
  for (const p of plans) {
    const c = centerLines.get(p.key);
    if (!c) continue;
    const id = `${p.key}::center`;
    const width = Math.max(...c.widths), height = c.lines.length * lineHeight;
    const suggested = result.edges.get(p.key)?.labels.get(id);
    requests.push({ id, width, height, route: routes.get(p.key)!, at: 'center', suggestion: suggested && { x: suggested.x + 2, y: suggested.y, width, height } });
    meta.set(id, { owner: p.key, ...c });
  }
  const labelledEnds = plans.flatMap(p => [...new Set(p.ends.map(e => e.end))].map(end => end === 'source' ? routes.get(p.key)![0]! : routes.get(p.key)!.at(-1)!));
  const placed = placeLabels(requests, { ...obstacles, ends: labelledEnds });
  const labels: UseCaseScene['labels'] = [...placed].map(([id, r]) => ({ id, rect: r, ...meta.get(id)! }));

  // Translate to the canvas margin (inside the frame, if any).
  const allRects = [...model.elements.map(e => rect(e.id)), ...[...conditions.values()].map(c => rect(c.noteId)), ...actors.map(a => a.caption.rect), ...labels.map(l => l.rect)];
  const content = union([...allRects, ...sceneEdges.flatMap(e => e.points.map(p => ({ ...p, width: 0, height: 0 })))]);
  const margin = theme.spacing.canvas, pad = theme.spacing.frame;
  const heading = model.title === undefined ? undefined : measureFrameHeading(metrics, 'uc', model.title);
  const originX = margin + (heading ? pad : 0), originY = margin + (heading ? heading.height + pad : 0);
  const dx = originX - content.x, dy = originY - content.y;
  const move = (r: Rect): Rect => ({ x: r.x + dx, y: r.y + dy, width: r.width, height: r.height });
  const movePoint = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  let width = originX + content.width + (heading ? pad : 0);
  const height = originY + content.height + (heading ? pad : 0);
  let frame: UseCaseScene['frame'];
  if (heading) {
    const frameWidth = Math.max(width - margin, heading.width + pad);
    frame = { bounds: { x: margin, y: margin, width: frameWidth, height: height - margin }, title: model.title! };
    width = margin + frameWidth;
  }
  return {
    width: width + margin, height: height + margin,
    ...(frame ? { frame } : {}),
    subjects: model.elements.filter((e): e is Subject => e.type === 'subject').map(s => ({ subject: s, bounds: move(rect(s.id)), rows: subjectRows.get(s.id)! })),
    actors: actors.map(a => ({ ...a, bounds: move(a.bounds), caption: { ...a.caption, rect: move(a.caption.rect) } })),
    useCases: model.elements.filter((e): e is UseCase => e.type === 'useCase').map(u => ({ useCase: u, bounds: move(rect(u.id)), measured: useCases.get(u.id)!, parent: u.subject })),
    notes: [...model.elements.filter(e => e.type === 'note').map(e => e.id), ...[...conditions.values()].map(c => c.noteId)].map(id => ({ id, bounds: move(rect(id)), rows: noteRows.get(id)!, parent: noteParent.get(id) })),
    edges: sceneEdges.map(e => ({ ...e, points: e.points.map(movePoint) })),
    labels: labels.map(l => ({ ...l, rect: move(l.rect), ...(l.anchor ? { anchor: movePoint(l.anchor) } : {}) })),
  };
}

/** Points every 6 px along the middle 70% of a polyline. */
function samples(route: readonly Point[]): Point[] {
  const total = route.slice(1).reduce((sum, p, k) => sum + distance(route[k]!, p), 0);
  const out: Point[] = [];
  for (let t = 0.15 * total; t <= 0.85 * total; t += 6) out.push(pointAt(route, t));
  return out;
}

function pointAt(route: readonly Point[], at: number): Point {
  let left = at;
  for (let k = 1; k < route.length; k++) {
    const a = route[k - 1]!, b = route[k]!, d = distance(a, b);
    if (left <= d) { const u = direction(a, b); return { x: a.x + u.x * left, y: a.y + u.y * left }; }
    left -= d;
  }
  return route.at(-1)!;
}

/** The point halfway along a polyline. */
function midpoint(route: readonly Point[]): Point {
  const total = route.slice(1).reduce((sum, p, k) => sum + distance(route[k]!, p), 0);
  let left = total / 2;
  for (let k = 1; k < route.length; k++) {
    const a = route[k - 1]!, b = route[k]!, d = distance(a, b);
    if (left <= d) { const u = direction(a, b); return { x: a.x + u.x * left, y: a.y + u.y * left }; }
    left -= d;
  }
  return route.at(-1)!;
}

/** Where the segment from `from` to the center of `r` crosses the border of `r`. */
function rectHit(from: Point, r: Rect): Point {
  const c = center(r);
  const dx = c.x - from.x, dy = c.y - from.y;
  let t = 1;
  for (const [d, lo, hi, o] of [[dx, r.x, r.x + r.width, from.x], [dy, r.y, r.y + r.height, from.y]] as const) {
    if (Math.abs(d) < 1e-9) continue;
    for (const edge of [lo, hi]) {
      const s = (edge - o) / d;
      if (s < 0 || s > 1) continue;
      const p = { x: from.x + s * dx, y: from.y + s * dy };
      if (p.x >= r.x - 1e-6 && p.x <= r.x + r.width + 1e-6 && p.y >= r.y - 1e-6 && p.y <= r.y + r.height + 1e-6) t = Math.min(t, s);
    }
  }
  return { x: from.x + t * dx, y: from.y + t * dy };
}
