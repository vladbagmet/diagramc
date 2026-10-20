import { theme } from '../../core/theme.js';
import { outlineHit, spreadEllipseEnds } from '../../engine/clip.js';
import { markerHalf, markerLength } from '../../engine/edges.js';
import type { Marker, LineStyle } from '../../engine/edges.js';
import { layout, type LayoutEdge, type LayoutLabel, type LayoutNode } from '../../engine/elk.js';
import type { FontMetrics, TextStyle } from '../../engine/fonts.js';
import { center, contains, direction, distance, inflate, overlapArea, segmentIntersectsRect, union, type Point, type Rect } from '../../engine/geometry.js';
import { placeLabels, type LabelRequest } from '../../engine/labels.js';
import { measureFrameHeading, measureNote } from '../../engine/shapes.js';
import { wrapText } from '../../engine/text.js';
import { countCrossings, layoutScore, routesDetour, routesLength, wrapsAround } from '../../engine/aspect.js';
import type { Actor, Element, Extend, Relationship, Subject, UseCase, UseCaseDiagram } from './model.js';
import { properCross, Router, sharedPairs, type Obstacle, type RouteEnd } from './route.js';

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
  // A line running past a subject that holds neither of its ends (subjects in a
  // row, an actor's lines to the far subject skirting the near one) costs like one
  // crossing per PAST_COST px.
  const measure = ({ scene }: { scene: UseCaseScene }) => {
    const lines = scene.edges.map(e => e.points);
    return { width: scene.width, height: scene.height, crossings: countCrossings(lines) + pastSubjects(scene) / PAST_COST, edgeLength: routesLength(lines), detour: routesDetour(lines) };
  };
  return layoutScore(measure(row)) < layoutScore(measure(stacked)) - 1e-6 ? row.scene : stacked.scene;
}

/**
 * Length of association lines running past a subject that holds neither of their
 * ends: inside it or within PAST px of its border.
 */
export function pastSubjects(scene: UseCaseScene): number {
  const subjectOf = new Map(scene.useCases.map(u => [u.useCase.id, u.useCase.subject]));
  let total = 0;
  for (const e of scene.edges) {
    if (e.type !== 'association') continue;
    const own = new Set([subjectOf.get(e.source), subjectOf.get(e.target)]);
    const zones = scene.subjects.filter(s => !own.has(s.subject.id)).map(s => inflate(s.bounds, PAST));
    if (!zones.length) continue;
    for (let k = 1; k < e.points.length; k++) {
      const a = e.points[k - 1]!, b = e.points[k]!, n = Math.ceil(distance(a, b) / 4);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (zones.some(z => p.x > z.x && p.x < z.x + z.width && p.y > z.y && p.y < z.y + z.height)) total += distance(a, b) / n;
      }
    }
  }
  return total;
}
const PAST = 24;
/** How far the bend of a repeated line between two elements lies beside the first line. */
const PARALLEL_OFFSET = 24;
const PAST_COST = 40;
/** More spots along a line for its center label: long straight lines in crowded diagrams. */
const LABEL_FRACTIONS = [0.2, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.8, 0.9, 0.1];

async function layoutVariant(model: UseCaseDiagram, metrics: FontMetrics, separate: boolean): Promise<{ scene: UseCaseScene; separated: boolean }> {
  const lineHeight = metrics.lineHeight(LABEL.size);
  const relationships = (model.relationships ?? []).map((r, i) => ({ r, key: r.id ?? `relationships/${i}` }));
  const byId = new Map<string, Element>(model.elements.map(e => [e.id, e]));
  const subjectOf = (id: string): string | undefined => { const e = byId.get(id); return e?.type === 'useCase' ? e.subject : undefined; };
  // Actors stand in the outer columns: primary actors left, actors that only ever
  // are the far end of associations (secondary actors) and external systems
  // (keyword «system») right, as long as some actor stays left. A specialised
  // actor stands in the column of its general actor.
  const associations = relationships.filter(x => x.r.type === 'association').map(x => x.r);
  const actorIds = model.elements.filter(e => e.type === 'actor').map(e => e.id);
  const isSystem = (id: string): boolean => { const e = byId.get(id); return e?.type === 'actor' && (e.stereotypes ?? []).some(k => k.toLowerCase() === 'system'); };
  const related = (id: string): boolean => relationships.some(({ r }) => r.type === 'generalization' && (r.from === id || r.to === id) && actorIds.includes(r.from) && actorIds.includes(r.to));
  const onlyTarget = actorIds.filter(id => associations.some(r => r.to === id) && !associations.some(r => r.from === id));
  const systems = actorIds.filter(id => isSystem(id) && !related(id));
  const right = new Set([...onlyTarget, ...systems]);
  const secondary = right.size < actorIds.length ? right : new Set(onlyTarget);
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
  reorderColumns(model, result.nodes, captions, [...plans.map(p => [p.r.from, p.r.to] as [string, string]), ...edges.filter(e => e.id.includes('->') || e.id.endsWith('::place')).map(e => [e.source, e.target] as [string, string])],
    new Set(associations.flatMap(r => [r.from, r.to]).filter(id => byId.get(id)?.type === 'useCase')));

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
    // The whole band across the subject: no line runs through it (gate edge-endpoints).
    return { x: b.x, y: b.y, width: b.width, height };
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
        // On the top of the head: toward the other end, away from the associations on the far side.
        return { x: c.x + (toward.x > c.x ? 1 : -1) * Math.min(apart, r.width / 2 - 2), y: side.y };
      };
    }
    return end;
  };
  const sceneEdges: UseCaseScene['edges'] = [];
  const routes = new Map<string, Point[]>();
  const rank = (p: Plan): number => p.r.type === 'association' ? 0 : p.r.type === 'generalization' ? 1 : 2;
  // Two or more generalizations to one element form a tree: one hollow triangle on
  // the general element, a short trunk out of it, and the lines from the specific
  // elements meeting at the trunk's end (UML 2.5.1 shared target style).
  const trees = new Map<string, { tip: Point; hub: Point; out: Point; trunk: number }>();
  for (const [target, members] of groupBy(plans.filter(p => p.r.type === 'generalization'), p => p.r.to)) {
    if (members.length < 2) continue;
    const r = rect(target), c = center(r), type = byId.get(target)?.type;
    const mean = { x: members.reduce((sum, p) => sum + center(rect(p.r.from)).x, 0) / members.length, y: members.reduce((sum, p) => sum + center(rect(p.r.from)).y, 0) / members.length };
    let tip: Point, out: Point;
    if (type === 'actor') {
      // A side of the figure, away from its associations when the specific actors stand in its column.
      const assoc = plans.filter(p => p.r.type === 'association' && (p.r.from === target || p.r.to === target)).map(p => center(rect(p.r.from === target ? p.r.to : p.r.from)));
      const assocSide = assoc.length ? Math.sign(assoc.reduce((sum, q) => sum + q.x - c.x, 0)) || 1 : 1;
      const side = Math.abs(mean.x - c.x) < r.width ? -assocSide : Math.sign(mean.x - c.x) || -assocSide;
      const apart = 2 * theme.size.triangle.halfWidth + 6;
      tip = { x: side < 0 ? r.x : r.x + r.width, y: mean.y > c.y ? Math.min(r.y + r.height - 2, c.y + apart) : Math.max(r.y + 2, c.y - apart) };
      out = { x: side, y: 0 };
    } else {
      const d = { x: mean.x - c.x, y: mean.y - c.y }, len = Math.hypot(d.x, d.y) || 1;
      out = { x: d.x / len, y: d.y / len };
      tip = outlineHit({ x: c.x + out.x * 4 * (r.width + r.height), y: c.y + out.y * 4 * (r.width + r.height) }, c, r, type === 'useCase' ? 'ellipse' : 'rect');
    }
    const trunk = markerLength('hollow-triangle') + theme.spacing.bendRadius + 18;
    trees.set(target, { tip, hub: { x: tip.x + out.x * trunk, y: tip.y + out.y * trunk }, out, trunk });
  }
  /** Route of a tree member to the hub and on to the shared tip. */
  const treeRoute = (p: Plan, tree: { tip: Point; hub: Point }): Point[] => {
    const hub: RouteEnd = { id: `${p.r.to}::tree`, rect: { ...tree.hub, width: 0, height: 0 }, shape: 'rect' };
    return [...router.route(endOf(p.r.from, 'none'), hub, around(rect(p.r.from), rect(p.r.to)), `${p.r.to}::tree`).slice(0, -1), tree.hub, tree.tip];
  };
  const settled = new Set<string>();
  const pairs = new Map<string, number>();
  for (const p of [...plans].sort((a, b) => rank(a) - rank(b))) {
    const gen = p.r.type === 'generalization', labelled = (end: string) => p.ends.some(e => e.end === end);
    const tree = gen ? trees.get(p.r.to) : undefined;
    if (tree) {
      // A member that would wrap round its neighbours to reach the hub (specific
      // actors above the general one in its column) gets a longer trunk: the hub moves
      // out until no member's line turns the same way three times.
      if (!settled.has(p.r.to)) {
        settled.add(p.r.to);
        const members = plans.filter(m => m.r.type === 'generalization' && m.r.to === p.r.to);
        for (const extra of [0, 20, 40, 60]) {
          const hub = { x: tree.tip.x + tree.out.x * (tree.trunk + extra), y: tree.tip.y + tree.out.y * (tree.trunk + extra) };
          if (!members.some(m => wrapsAround(treeRoute(m, { tip: tree.tip, hub })))) { tree.hub = hub; break; }
        }
      }
      const route = treeRoute(p, tree);
      router.add(route, `${p.r.to}::tree`);
      routes.set(p.key, route);
      continue;
    }
    // A second (third...) line between the same two elements bends at a point
    // beside the middle of the first, alternately on either side, so it is
    // visibly its own line.
    const pair = [p.r.from, p.r.to].sort().join('\u0000'), k = pairs.get(pair) ?? 0;
    pairs.set(pair, k + 1);
    const source = endOf(p.r.from, 'none', gen, labelled('source')), target = endOf(p.r.to, p.target, gen, labelled('target'));
    let route: Point[];
    if (k > 0) {
      const a = center(rect(p.r.from)), b = center(rect(p.r.to)), d = distance(a, b) || 1;
      const off = PARALLEL_OFFSET * Math.ceil(k / 2) * (k % 2 ? 1 : -1);
      const via = { x: (a.x + b.x) / 2 - (b.y - a.y) / d * off, y: (a.y + b.y) / 2 + (b.x - a.x) / d * off };
      const hub: RouteEnd = { id: `${p.key}::via`, rect: { ...via, width: 0, height: 0 }, shape: 'rect' };
      const ignore = around(rect(p.r.from), rect(p.r.to));
      route = [...router.route(source, hub, ignore), ...router.route(hub, target, ignore).slice(1)];
    } else route = router.route(source, target, around(rect(p.r.from), rect(p.r.to)));
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
  const spread = (id: string): void => {
    const e = byId.get(id)!;
    // A generalization tree's shared tip counts once.
    const tree = trees.get(e.id);
    const members = sceneEdges.filter(s => tree && s.type === 'generalization' && s.target === e.id).map(s => s.id);
    const ends = sceneEdges.flatMap(s => (['source', 'target'] as const).filter(end => (end === 'source' ? s.source : s.target) === e.id && s.source !== s.target && !(end === 'target' && members.slice(1).includes(s.id)))
      .map(end => ({ edge: s.id, end, min: Math.max(theme.spacing.edgeEdge, 2 * markerHalf(end === 'source' ? s.sourceMarker : s.targetMarker) + 6) })));
    spreadEllipseEnds(routes, rect(e.id), ends);
    // Two ends whose first segments cross trade places on the outline.
    for (let pass = 0; pass < 3; pass++) {
      let swapped = false;
      for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
        const a = ends[i]!, b = ends[j]!, ra = routes.get(a.edge)!, rb = routes.get(b.edge)!;
        const ka = a.end === 'source' ? 0 : ra.length - 1, kb = b.end === 'source' ? 0 : rb.length - 1;
        const na = ra[a.end === 'source' ? 1 : ra.length - 2]!, nb = rb[b.end === 'source' ? 1 : rb.length - 2]!;
        if (!properCross(ra[ka]!, na, rb[kb]!, nb)) continue;
        const blocked = (p: Point, q: Point, edge: string) => { const x = sceneEdges.find(o => o.id === edge)!; return routeObstacles.some(o => o.id !== x.source && o.id !== x.target && o.id !== e.id && segmentIntersectsRect(p, q, o.rect)); };
        if (blocked(rb[kb]!, na, a.edge) || blocked(ra[ka]!, nb, b.edge)) continue;
        [ra[ka], rb[kb]] = [rb[kb]!, ra[ka]!];
        swapped = true;
      }
      if (!swapped) break;
    }
    for (const id of members.slice(1)) { const r = routes.get(id)!; r[r.length - 1] = routes.get(members[0]!)!.at(-1)!; }
  };
  for (const e of model.elements) if (e.type === 'useCase') spread(e.id);
  // An end moved along its ellipse may have brought its first segment onto an
  // element the router had passed: the segment bends round that element's corner.
  for (const x of sceneEdges) {
    const route = routes.get(x.id)!;
    const others = routeObstacles.filter(o => o.id !== x.source && o.id !== x.target && !o.id.startsWith(`${x.source}::`) && !o.id.startsWith(`${x.target}::`));
    const hit = (p: Point, q: Point) => others.find(o => segmentIntersectsRect(p, q, o.rect));
    for (const atStart of [true, false]) {
      const k = atStart ? 0 : route.length - 2;
      const p = route[k]!, q = route[k + 1]!, o = hit(p, q);
      if (!o) continue;
      const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => { const r = inflate(o.rect, 12); return { x: r.x + i! * r.width, y: r.y + j! * r.height }; })
        .filter(c => !hit(p, c) && !hit(c, q)).sort((a, b) => distance(p, a) + distance(a, q) - distance(p, b) - distance(b, q));
      if (corners[0]) route.splice(k + 1, 0, corners[0]);
    }
  }
  for (const s of sceneEdges) s.points = routes.get(s.id)!;
  // Lines that still run on top of each other (the router saw only the lines
  // routed before each one): each line of such a pair is routed again, against all
  // other lines, and the new route is kept when fewer pairs remain.
  const reroutable = new Map<string, () => Point[]>();
  for (const p of plans) {
    if (p.r.type === 'generalization' && trees.has(p.r.to)) continue;
    if (sceneEdges.filter(e => [e.source, e.target].sort().join('\u0000') === [p.r.from, p.r.to].sort().join('\u0000')).length > 1) continue;
    const labelled = (end: string) => p.ends.some(e => e.end === end), gen = p.r.type === 'generalization';
    reroutable.set(p.key, () => {
      const others = new Router([...routeObstacles, ...subjectIds.map(id => ({ id, rect: rect(id) }))]);
      for (const e of sceneEdges) if (e.id !== p.key) others.add(e.points);
      return others.route(endOf(p.r.from, 'none', gen, labelled('source')), endOf(p.r.to, p.target, gen, labelled('target')), around(rect(p.r.from), rect(p.r.to)));
    });
  }
  // Ends on one side of a node closer than the gate allows (end-spacing) count too.
  const crowded = (): number => {
    const ends = sceneEdges.flatMap(e => e.source === e.target ? [] : [
      { e, node: e.source, p: e.points[0]!, half: markerHalf(e.sourceMarker) },
      { e, node: e.target, p: e.points.at(-1)!, half: markerHalf(e.targetMarker) },
    ]).filter(o => byId.has(o.node));
    const side = (node: string, p: Point): number => {
      const r = rect(node), d = [Math.abs(p.y - r.y), Math.abs(p.x - r.x - r.width), Math.abs(p.y - r.y - r.height), Math.abs(p.x - r.x)];
      return d.indexOf(Math.min(...d));
    };
    let n = 0;
    ends.forEach((a, i) => { for (const b of ends.slice(i + 1)) {
      if (a.node !== b.node || a.e === b.e || side(a.node, a.p) !== side(b.node, b.p)) continue;
      const d = distance(a.p, b.p);
      if (d > 0.5 && d < Math.max(theme.spacing.edgeEdge, a.half + b.half + 6) + 0.5) n++;
    } });
    return n;
  };
  const problems = (): number => sharedPairs(sceneEdges).length + crowded();
  for (let pass = 0; pass < 6; pass++) {
    const pairs = sharedPairs(sceneEdges);
    if (!pairs.length) break;
    let improved = false;
    for (const id of [...new Set(pairs.flat())].reverse()) {
      const again = reroutable.get(id), e = sceneEdges.find(x => x.id === id);
      if (!again || !e) continue;
      const old = e.points, count = problems();
      e.points = again();
      routes.set(id, e.points);
      const olds = new Map(sceneEdges.map(x => [x.id, x.points.map(q => ({ ...q }))]));
      for (const node of [e.source, e.target]) if (byId.get(node)?.type === 'useCase') spread(node);
      for (const x of sceneEdges) x.points = routes.get(x.id)!;
      if (problems() < count) { routes.set(id, e.points); improved = true; break; }
      for (const x of sceneEdges) { const q = olds.get(x.id)!; x.points = x.id === id ? old : q; routes.set(x.id, x.points); }
    }
    if (!improved) break;
  }

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
      requests.push({ id, owner: p.key, width: e.width, height: lineHeight, route, at: e.end, side: 1, clearance: 4 + (e.end === 'target' ? markerHalf(p.target) : 0) });
      meta.set(id, { owner: p.key, lines: [e.text], widths: [e.width], end: e.end, anchor: e.end === 'source' ? route[0]! : route.at(-1)! });
    });
  }
  for (const p of plans) {
    const c = centerLines.get(p.key);
    if (!c) continue;
    const id = `${p.key}::center`;
    const width = Math.max(...c.widths), height = c.lines.length * lineHeight;
    requests.push({ id, owner: p.key, width, height, route: routes.get(p.key)!, at: 'center', fractions: LABEL_FRACTIONS });
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

/**
 * ELK orders the elements of a column (one layer of actors, or use cases of one
 * subject at one depth) to reduce crossings of its own routes, not of the straight
 * lines drawn here. Two elements of a column swap places (their middles trade
 * vertical positions), then single elements move along their column into free
 * space, whenever that removes a crossing of the straight lines between the
 * elements (a line through a third element counts as one). Every element stays
 * clear of the others and inside its subject.
 */
/** Cost of one crossing in reorderColumns, against the lines' length in px. */
const CROSSING = 1e6;

function reorderColumns(model: UseCaseDiagram, nodes: Map<string, Rect>, captions: ReadonlyMap<string, { width: number; height: number }>, lines: readonly [string, string][], anchored: ReadonlySet<string>): void {
  const movable = model.elements.filter(e => e.type === 'actor' || e.type === 'useCase');
  const subjectOf = new Map(model.elements.flatMap(e => e.type === 'useCase' ? [[e.id, e.subject]] : []));
  /** The area an element needs: an actor with its name below. */
  const box = (id: string, r: Rect): Rect => {
    const c = captions.get(id);
    return c ? union([r, { x: r.x + r.width / 2 - c.width / 2 - 4, y: r.y + r.height, width: c.width + 8, height: c.height + 8 }]) : r;
  };
  const columns = new Map<string, string[]>();
  for (const e of movable) {
    const r = nodes.get(e.id)!;
    const key = `${e.type === 'actor' ? 'actor' : subjectOf.get(e.id) ?? ''}\u0000${Math.round(r.x + r.width / 2)}`;
    columns.set(key, [...(columns.get(key) ?? []), e.id]);
  }
  // Use cases stay below their subject's name (as high as the highest one was).
  const top = new Map<string, number>();
  for (const [id, s] of subjectOf) if (s !== undefined) top.set(s, Math.min(top.get(s) ?? Infinity, nodes.get(id)!.y));
  const ends = lines.filter(([a, b]) => nodes.has(a) && nodes.has(b) && a !== b);
  const subjects = new Set(model.elements.filter(e => e.type === 'subject').map(e => e.id));
  /**
   * The part of the cost that depends on the elements `ids`: their lines' length,
   * crossings with their lines, and lines through them or from them through
   * another element (a line through a third element would have to bend: it counts
   * like a crossing). Moving only `ids` changes the cost by the change of this.
   */
  const local = (ids: readonly string[]): number => {
    const solid = [...nodes].filter(([id]) => !subjects.has(id)).map(([id, r]) => ({ id, r: inflate(r, -Math.min(r.width, r.height) * 0.15) }));
    const segment = ([a, b]: [string, string]): [Point, Point] => [center(nodes.get(a)!), center(nodes.get(b)!)];
    const through = (p: Point, q: Point, r: Rect): boolean => Math.max(p.x, q.x) >= r.x && Math.min(p.x, q.x) <= r.x + r.width && Math.max(p.y, q.y) >= r.y && Math.min(p.y, q.y) <= r.y + r.height && segmentIntersectsRect(p, q, r);
    const touched = ends.map(([a, b]) => ids.includes(a) || ids.includes(b));
    const segments = ends.map(segment);
    let crossings = 0, length = 0;
    segments.forEach(([p, q], i) => {
      const [a, b] = ends[i]!;
      if (touched[i]) {
        length += distance(p, q);
        crossings += solid.filter(o => o.id !== a && o.id !== b && through(p, q, o.r)).length;
        for (let j = 0; j < segments.length; j++) if (j !== i && (!touched[j] || j > i) && properCross(p, q, segments[j]![0], segments[j]![1])) crossings++;
      } else crossings += solid.filter(o => ids.includes(o.id) && o.id !== a && o.id !== b && through(p, q, o.r)).length;
    });
    return crossings * CROSSING + length;
  };
  const others = (skip: readonly string[]) => [...nodes].filter(([id]) => !skip.includes(id) && !subjects.has(id));
  const fits = (id: string, r: Rect, skip: readonly string[]): boolean => {
    const s = subjectOf.get(id);
    if (s !== undefined && (!contains(nodes.get(s)!, inflate(r, 8)) || r.y < (top.get(s) ?? -Infinity) - 0.5)) return false;
    return !others(skip).some(([o, q]) => overlapArea(inflate(box(id, r), 8), box(o, q)) > 0);
  };
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (const ids of columns.values()) {
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]!, b = ids[j]!, ra = nodes.get(a)!, rb = nodes.get(b)!;
        const na = { ...ra, y: rb.y + rb.height / 2 - ra.height / 2 }, nb = { ...rb, y: ra.y + ra.height / 2 - rb.height / 2 };
        if (!fits(a, na, [a, b]) || !fits(b, nb, [a, b]) || overlapArea(inflate(box(a, na), 8), box(b, nb)) > 0) continue;
        const before = local([a, b]);
        nodes.set(a, na); nodes.set(b, nb);
        if (local([a, b]) < before - CROSSING / 2) improved = true;
        else { nodes.set(a, ra); nodes.set(b, rb); }
      }
    }
    if (!improved) break;
  }
  // Then single elements move along their column: actors, and use cases no actor
  // is linked to (an included use case below the lines that pass its column).
  const all = union([...nodes.values()]);
  for (let pass = 0; pass < 2; pass++) {
    let improved = false;
    for (const e of movable.filter(x => !anchored.has(x.id))) {
      const r = nodes.get(e.id)!;
      const s = subjectOf.get(e.id);
      const lo = s !== undefined ? nodes.get(s)!.y : all.y, hi = s !== undefined ? nodes.get(s)!.y + nodes.get(s)!.height - r.height : all.y + all.height - r.height;
      const steps = Math.min(40, Math.max(1, Math.floor((hi - lo) / 16)));
      let best = r, current = local([e.id]);
      for (let k = 0; k <= steps; k++) {
        const next = { ...r, y: lo + (hi - lo) * k / steps };
        if (Math.abs(next.y - r.y) < 8 || !fits(e.id, next, [e.id])) continue;
        nodes.set(e.id, next);
        const c = local([e.id]);
        if (c < current - CROSSING / 2) { current = c; best = next; }
        nodes.set(e.id, best);
      }
      if (best !== r) improved = true;
    }
    if (!improved) break;
  }
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return out;
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
