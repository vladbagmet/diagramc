import { theme } from '../../core/theme.js';
import { spreadEllipseEnds } from '../../engine/clip.js';
import { markerHalf, markerLength } from '../../engine/edges.js';
import type { Marker, LineStyle } from '../../engine/edges.js';
import { layout, type LayoutEdge, type LayoutLabel, type LayoutNode } from '../../engine/elk.js';
import type { FontMetrics, TextStyle } from '../../engine/fonts.js';
import { center, contains, direction, distance, inflate, segmentIntersectsRect, union, type Point, type Rect } from '../../engine/geometry.js';
import { placeLabels, type LabelRequest } from '../../engine/labels.js';
import { measureFrameHeading, measureNote } from '../../engine/shapes.js';
import { wrapText } from '../../engine/text.js';
import { countCrossings, layoutScore, routesLength } from '../../engine/aspect.js';
import type { Actor, Element, Extend, Relationship, Subject, UseCase, UseCaseDiagram } from './model.js';
import { Router, type Obstacle, type RouteEnd } from './route.js';

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
  notes: { id: string; bounds: Rect; rows: string[]; parent?: string | undefined; starts?: number[] }[];
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
  // The text block is a rectangle inscribed in the ellipse: its corner (p, q) lies on
  // the ellipse when a = p / cos t and b = q / sin t. t = 45 degrees gives the smallest
  // ellipse; tall blocks (many extension points) use a larger t to stay oval (a >= 1.5 b).
  const p = blockWidth / 2 + 6, q = blockHeight / 2 + 3;
  const t = Math.max(Math.PI / 4, Math.atan(1.5 * q / p));
  const width = Math.max(theme.size.useCase.minWidth, Math.ceil(2 * p / Math.cos(t)));
  const height = Math.max(theme.size.useCase.minHeight, Math.ceil(2 * q / Math.sin(t)));
  return { rows, nameRows, width, height, blockHeight };
}

/** Rows of the condition note of an «extend» (UML 2.5.1 Figure 18.3). */
function conditionRows(metrics: FontMetrics, r: Extend): string[] {
  const style = { size: theme.font.size.body }, width = theme.size.maxNoteWidth;
  return [...wrapText(metrics, `Condition: {${r.condition}}`, style, width), ...wrapText(metrics, `extension point: ${r.extensionPoint}`, style, width)];
}
/** Index of the first row of the extension point line in conditionRows. */
const conditionSplit = (metrics: FontMetrics, r: Extend): number => wrapText(metrics, `Condition: {${r.condition}}`, { size: theme.font.size.body }, theme.size.maxNoteWidth).length;

/**
 * Lays out a use case diagram. When lines between use cases of different subjects
 * can be left out of the layering (subjects above each other instead of in a row),
 * both layouts are made and the more readable one wins (src/engine/aspect.ts).
 */
export async function layoutUseCaseDiagram(model: UseCaseDiagram, metrics: FontMetrics): Promise<UseCaseScene> {
  const stacked = await layoutVariant(model, metrics, true);
  if (!stacked.separated) return stacked.scene;
  const row = await layoutVariant(model, metrics, false);
  const measure = ({ scene }: { scene: UseCaseScene }) => {
    const lines = scene.edges.map(e => e.points);
    return { width: scene.width, height: scene.height, crossings: countCrossings(lines), edgeLength: routesLength(lines) };
  };
  return layoutScore(measure(row)) < layoutScore(measure(stacked)) - 1e-6 ? row.scene : stacked.scene;
}

async function layoutVariant(model: UseCaseDiagram, metrics: FontMetrics, separate: boolean): Promise<{ scene: UseCaseScene; separated: boolean }> {
  const lineHeight = metrics.lineHeight(LABEL.size);
  const relationships = (model.relationships ?? []).map((r, i) => ({ r, key: r.id ?? `relationships/${i}` }));
  const byId = new Map<string, Element>(model.elements.map(e => [e.id, e]));
  const subjectOf = (id: string): string | undefined => { const e = byId.get(id); return e?.type === 'useCase' ? e.subject : undefined; };
  // Actors stand in the outer columns: primary actors left, actors that only ever
  // are the far end of associations (secondary actors, external systems) right.
  // A specialised actor stands in the column of its general actor.
  const associations = relationships.filter(x => x.r.type === 'association').map(x => x.r);
  const actorIds = model.elements.filter(e => e.type === 'actor').map(e => e.id);
  const secondary = new Set(actorIds.filter(id => associations.some(r => r.to === id) && !associations.some(r => r.from === id)));
  for (let changed = true; changed;) {
    changed = false;
    for (const { r } of relationships) {
      if (r.type !== 'generalization' || !actorIds.includes(r.from) || !actorIds.includes(r.to)) continue;
      if (secondary.has(r.from) !== secondary.has(r.to) && !associations.some(a => a.from === r.from)) {
        if (secondary.has(r.to)) { secondary.add(r.from); changed = true; }
      }
    }
  }

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
        return {
          id: e.id, width: theme.size.actor.width, height: theme.size.actor.height, labelBelow: { width: width + 8, height: height + 4 },
          elk: { 'elk.layered.layering.layerConstraint': secondary.has(e.id) ? 'LAST' : 'FIRST' },
        };
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
        return { id: e.id, width: Math.max(...rows.map(r => r.width)) + 2 * theme.spacing.padX, height: header + 20, padding: { top: header + 8, left: 24, bottom: 24, right: 24 }, children: [], minimumSize: true };
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
  const noteStarts = new Map<string, number[]>();
  for (const { r, key } of relationships) {
    if (r.type !== 'extend' || r.condition === undefined) continue;
    const rows = conditionRows(metrics, r);
    const style = { size: theme.font.size.body };
    const width = Math.ceil(Math.max(...rows.map(t => metrics.measure(t.trimEnd(), style))) + 20 + theme.size.noteFold / 2);
    const height = rows.length * metrics.lineHeight(style.size) + 18;
    const noteId = `${key}::condition`;
    conditions.set(key, { noteId, rows });
    noteRows.set(noteId, rows);
    noteStarts.set(noteId, [0, conditionSplit(metrics, r)]);
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
  // Lines between use cases of different subjects are left out of the layering, so
  // subjects can stand above each other instead of in a long row (the router draws them).
  let separated = false;
  const layered = plans.filter(p => {
    const from = byId.get(p.r.from)!, to = byId.get(p.r.to)!;
    // Actors in one column are not layered against each other either.
    if (from.type === 'actor' && to.type === 'actor' && secondary.has(from.id) === secondary.has(to.id)) return false;
    // A subject no actor uses is placed by these lines.
    const anchored = (s: string | undefined): boolean => s === undefined || associations.some(a => subjectOf(a.from) === s || subjectOf(a.to) === s);
    const cross = from.type === 'useCase' && to.type === 'useCase' && from.subject !== undefined && to.subject !== undefined && from.subject !== to.subject && anchored(from.subject) && anchored(to.subject);
    if (cross && separate) separated = true;
    return !(cross && separate);
  });
  const edges: LayoutEdge[] = layered.map(p => {
    const labels: LayoutLabel[] = [];
    const c = centerLines.get(p.key);
    if (c) labels.push({ id: `${p.key}::center`, width: Math.max(...c.widths) + 4, height: c.lines.length * lineHeight, placement: 'center' });
    p.ends.forEach((e, k) => labels.push({ id: `${p.key}::end${k}`, width: e.width + 4, height: lineHeight, placement: (e.end === 'source') !== p.reversed ? 'tail' : 'head' }));
    let source = p.reversed ? p.r.to : p.r.from, target = p.reversed ? p.r.from : p.r.to;
    // Lines leave the left column and enter the right one (ELK's layer constraints).
    const column = (id: string): number => !actorIds.includes(id) ? 0 : secondary.has(id) ? 1 : -1;
    if (column(source) > column(target) || column(target) < 0 || column(source) > 0) [source, target] = [target, source];
    return { id: p.key, source, target, labels, directionPriority: p.r.type === 'association' ? 5 : 1 };
  });
  const anchors: { id: string; note: string; target: string }[] = [];
  for (const e of model.elements) {
    if (e.type !== 'note') continue;
    for (const target of e.attachedTo ?? []) {
      anchors.push({ id: `${e.id}->${target}`, note: e.id, target });
      edges.push(secondary.has(target) ? { id: `${e.id}->${target}`, source: e.id, target } : { id: `${e.id}->${target}`, source: target, target: e.id });
    }
  }
  for (const [key, c] of conditions) {
    const r = relationships.find(x => x.key === key)!.r;
    // Laid out after the base use case, beside the extending one (extends run base first).
    edges.push({ id: `${c.noteId}::place`, source: r.to, target: c.noteId });
  }

  const result = await layout(roots, edges, { direction: 'RIGHT', routing: 'polyline', layerSpacing: 72, nodeSpacing: 28 });
  const rect = (id: string): Rect => result.nodes.get(id)!;

  // Actor captions (names under the figures).
  const actors: UseCaseScene['actors'] = [];
  for (const e of model.elements) {
    if (e.type !== 'actor') continue;
    const b = rect(e.id), c = captions.get(e.id)!;
    actors.push({ actor: e, bounds: b, caption: { rect: { x: b.x + b.width / 2 - c.width / 2, y: b.y + b.height + 4, width: c.width, height: c.height }, rows: c.rows } });
  }
  const subjectHeader = (id: string): Rect => {
    const b = rect(id), rows = subjectRows.get(id)!;
    const height = rows.reduce((sum, r) => sum + metrics.lineHeight(r.style.size), 0) + 2 * theme.spacing.headerPadY;
    const width = Math.max(...rows.map(r => r.width)) + 8;
    return { x: b.x + (b.width - width) / 2, y: b.y, width, height };
  };

  // Lines: straight, bent around elements in the way (see route.ts).
  const routeObstacles: Obstacle[] = [
    ...model.elements.filter(e => e.type !== 'subject').map(e => ({ id: e.id, rect: rect(e.id) })),
    ...actors.map(a => ({ id: `${a.actor.id}::caption`, rect: a.caption.rect })),
    ...[...conditions.values()].map(c => ({ id: c.noteId, rect: rect(c.noteId) })),
    ...[...subjectRows.keys()].map(id => ({ id: `${id}::header`, rect: subjectHeader(id) })),
  ];
  // A subject is in the way of lines that neither start nor end inside it.
  const subjectIds = [...subjectRows.keys()];
  const around = (...rs: Rect[]): string[] => subjectIds.filter(id => rs.some(r => contains(rect(id), r)));
  const router = new Router([...routeObstacles, ...subjectIds.map(id => ({ id, rect: rect(id) }))]);
  const endOf = (id: string, marker: Marker, generalization = false, labelled = false): RouteEnd => {
    const type = byId.get(id)?.type;
    const r = rect(id);
    const end: RouteEnd = { id, rect: r, shape: type === 'useCase' ? 'ellipse' : type === 'actor' ? 'actor' : 'rect', straight: markerLength(marker) + theme.spacing.bendRadius + 2, labelled };
    // A generalization's arrowhead sits beside the point where an actor's associations
    // meet, never on it: shifted along the side, away from the caption below.
    if (generalization && type === 'actor') {
      const apart = 2 * theme.size.triangle.halfWidth + 6;
      end.attach = (side, toward) => {
        const c = center(r);
        if (Math.abs(side.y - c.y) < 0.5) return { x: side.x, y: toward.y > c.y ? Math.max(r.y + 2, c.y - apart) : Math.min(r.y + r.height - 2, c.y + apart) };
        return { x: c.x + (toward.x > c.x ? -1 : 1) * Math.min(apart, r.width / 2 - 2), y: side.y };
      };
    }
    return end;
  };
  const sceneEdges: UseCaseScene['edges'] = [];
  const routes = new Map<string, Point[]>();
  const rank = (p: Plan): number => p.r.type === 'association' ? 0 : p.r.type === 'generalization' ? 1 : 2;
  for (const p of [...plans].sort((a, b) => rank(a) - rank(b))) {
    const gen = p.r.type === 'generalization', labelled = (end: string) => p.ends.some(e => e.end === end);
    const route = router.route(endOf(p.r.from, 'none', gen, labelled('source')), endOf(p.r.to, p.target, gen, labelled('target')), around(rect(p.r.from), rect(p.r.to)));
    router.add(route);
    routes.set(p.key, route);
  }
  for (const p of plans) sceneEdges.push({ id: p.key, type: p.r.type, source: p.r.from, target: p.r.to, points: routes.get(p.key)!, style: p.style, sourceMarker: 'none', targetMarker: p.target });
  for (const a of anchors) {
    const route = router.route(endOf(a.note, 'none'), endOf(a.target, 'none'), around(rect(a.note), rect(a.target)));
    router.add(route);
    routes.set(a.id, route);
    sceneEdges.push({ id: a.id, type: 'note-anchor', source: a.note, target: a.target, points: route, style: 'dashed', sourceMarker: 'none', targetMarker: 'none' });
  }
  // Ends on one use case keep apart around its ellipse (no overlapping arrowheads).
  for (const e of model.elements) {
    if (e.type !== 'useCase') continue;
    const ends = sceneEdges.flatMap(s => (['source', 'target'] as const).filter(end => (end === 'source' ? s.source : s.target) === e.id && s.source !== s.target)
      .map(end => ({ edge: s.id, end, min: Math.max(theme.spacing.edgeEdge, 2 * markerHalf(end === 'source' ? s.sourceMarker : s.targetMarker) + 6) })));
    spreadEllipseEnds(routes, rect(e.id), ends);
  }
  for (const s of sceneEdges) s.points = routes.get(s.id)!;
  for (const [key, c] of conditions) {
    // The condition note is attached to its «extend» line, at the point nearest
    // to the note whose dashed anchor crosses no other element or line end.
    const note = rect(c.noteId);
    const line = routes.get(key)!;
    const others = routeObstacles.filter(o => o.id !== c.noteId).map(o => inflate(o.rect, 3));
    const walls = (p: Point): Rect[] => subjectIds.filter(id => !around(note, { ...p, width: 0, height: 0 }).includes(id)).map(id => rect(id));
    const candidates = samples(line).map(p => ({ p, from: rectHit(p, note) }))
      .filter(({ p, from }) => !others.some(o => segmentIntersectsRect(from, p, o)) && !walls(p).some(w => segmentIntersectsRect(from, p, w)))
      .sort((a, b) => distance(a.p, a.from) - distance(b.p, b.from));
    let points: Point[];
    if (candidates[0]) points = [candidates[0].from, candidates[0].p];
    else {
      // No clear straight anchor: bend it around what is in the way, to the middle of the line.
      const mid = midpoint(line);
      const point = { x: mid.x, y: mid.y, width: 0, height: 0 };
      points = router.route(endOf(c.noteId, 'none'), { id: `${key}::point`, rect: point, shape: 'rect' }, around(note, point));
    }
    router.add(points);
    sceneEdges.push({ id: `${c.noteId}::anchor`, type: 'note-anchor', source: c.noteId, target: key, points, style: 'dashed', sourceMarker: 'none', targetMarker: 'none' });
  }

  // Labels.
  const obstacles = {
    rects: routeObstacles.map(o => o.rect),
    segments: sceneEdges.flatMap(e => e.points.slice(1).map((p, k) => [e.points[k]!, p] as [Point, Point])),
  };
  // Subject borders: labels stay on one side of them.
  for (const id of subjectIds) {
    const b = rect(id);
    const corners = [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }];
    corners.forEach((c, k) => obstacles.segments.push([c, corners[(k + 1) % 4]!]));
  }
  for (const e of sceneEdges) {
    const box = markerBox(e.points.at(-1)!, e.points.at(-2)!, e.targetMarker);
    if (box) obstacles.rects.push(box);
  }
  const requests: LabelRequest[] = [];
  const meta = new Map<string, Omit<UseCaseScene['labels'][number], 'id' | 'rect'>>();
  for (const p of plans) {
    const route = routes.get(p.key)!;
    p.ends.forEach((e, k) => {
      const id = `${p.key}::end${k}`;
      requests.push({ id, width: e.width, height: lineHeight, route, at: e.end, side: 1, clearance: 4 + (e.end === 'target' ? markerHalf(p.target) : 0) });
      meta.set(id, { owner: p.key, lines: [e.text], widths: [e.width], end: e.end, anchor: e.end === 'source' ? route[0]! : route.at(-1)! });
    });
  }
  for (const p of plans) {
    const c = centerLines.get(p.key);
    if (!c) continue;
    const id = `${p.key}::center`;
    const width = Math.max(...c.widths), height = c.lines.length * lineHeight;
    requests.push({ id, owner: p.key, width, height, route: routes.get(p.key)!, at: 'center' });
    meta.set(id, { owner: p.key, ...c });
  }
  const labelledEnds = plans.flatMap(p => [...new Set(p.ends.map(e => e.end))].map(end => end === 'source' ? routes.get(p.key)![0]! : routes.get(p.key)!.at(-1)!));
  const placed = placeLabels(requests, { ...obstacles, ends: labelledEnds, lines: sceneEdges.map(e => ({ owner: e.id, points: e.points })) });
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
  return { separated, scene: {
    width: width + margin, height: height + margin,
    ...(frame ? { frame } : {}),
    subjects: model.elements.filter((e): e is Subject => e.type === 'subject').map(s => ({ subject: s, bounds: move(rect(s.id)), rows: subjectRows.get(s.id)! })),
    actors: actors.map(a => ({ ...a, bounds: move(a.bounds), caption: { ...a.caption, rect: move(a.caption.rect) } })),
    useCases: model.elements.filter((e): e is UseCase => e.type === 'useCase').map(u => ({ useCase: u, bounds: move(rect(u.id)), measured: useCases.get(u.id)!, parent: u.subject })),
    notes: [...model.elements.filter(e => e.type === 'note').map(e => e.id), ...[...conditions.values()].map(c => c.noteId)].map(id => ({ id, bounds: move(rect(id)), rows: noteRows.get(id)!, parent: noteParent.get(id), ...(noteStarts.has(id) ? { starts: noteStarts.get(id)! } : {}) })),
    edges: sceneEdges.map(e => ({ ...e, points: e.points.map(movePoint) })),
    labels: labels.map(l => ({ ...l, rect: move(l.rect), ...(l.anchor ? { anchor: movePoint(l.anchor) } : {}) })),
  } };
}

/** Box around the arrowhead at `tip` (the line arrives from `from`). */
function markerBox(tip: Point, from: Point, marker: Marker): Rect | undefined {
  const length = markerLength(marker), half = markerHalf(marker);
  if (!length) return undefined;
  const u = direction(from, tip), n = { x: -u.y, y: u.x };
  const base = { x: tip.x - u.x * length, y: tip.y - u.y * length };
  return union([tip, { x: base.x + n.x * half, y: base.y + n.y * half }, { x: base.x - n.x * half, y: base.y - n.y * half }].map(p => ({ ...p, width: 0, height: 0 })));
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

/** The middle of the side of `r` that faces point `q`. */
function sideCenter(r: Rect, q: Point): Point {
  const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  return Math.abs(q.x - c.x) * r.height >= Math.abs(q.y - c.y) * r.width
    ? { x: q.x < c.x ? r.x : r.x + r.width, y: c.y }
    : { x: c.x, y: q.y < c.y ? r.y : r.y + r.height };
}
