import { theme } from '../../core/theme.js';
import type { Marker, LineStyle } from '../../engine/edges.js';
import { layout, type LayoutEdge, type LayoutLabel, type LayoutNode, type LayoutPort } from '../../engine/elk.js';
import type { FontMetrics, TextStyle } from '../../engine/fonts.js';
import { direction, union, type Point, type Rect } from '../../engine/geometry.js';
import { placeLabels, type LabelRequest } from '../../engine/labels.js';
import { planSelfLoops, selfLoopRoute, type SelfLoopPlan } from '../../engine/selfloops.js';
import { measureBox, measureFrameHeading, measureNote, type Compartment, type MeasuredBox } from '../../engine/shapes.js';
import { wrapText } from '../../engine/text.js';
import { classifierKeyword, formatAttribute, formatOperation, guillemets, isAbstractOperation, isStatic } from './format.js';
import { isNote, type ClassDiagram, type Classifier, type Element, type Relationship } from './model.js';

/** Positioned geometry of a class diagram, ready to draw. */
export interface ClassScene {
  width: number;
  height: number;
  frame?: { bounds: Rect; title: string };
  nodes: { element: Element; bounds: Rect; box?: MeasuredBox; rows?: string[] }[];
  edges: { id: string; type: string; source: string; target: string; points: Point[]; style: LineStyle; sourceMarker: Marker; targetMarker: Marker; drawTargetMarker: boolean }[];
  labels: { id: string; owner: string; rect: Rect; lines: string[]; widths: number[]; style: TextStyle; end?: 'source' | 'target'; anchor?: Point }[];
}

const LABEL: TextStyle = { size: theme.font.size.label };
const CENTER_LABEL_WIDTH = 180;

function compartments(c: Classifier): Compartment[] {
  const header: Compartment = { header: true, lines: [] };
  const keyword = classifierKeyword(c.type);
  const muted = theme.color.mutedText;
  if (keyword) header.lines.push({ text: guillemets([keyword]), style: LABEL, align: 'center', fill: muted });
  if (c.stereotypes?.length) header.lines.push({ text: guillemets(c.stereotypes), style: LABEL, align: 'center', fill: muted });
  header.lines.push({ text: c.name, style: { size: theme.font.size.name, bold: true, italic: c.type === 'class' && !!c.abstract }, align: 'center', wrap: theme.size.maxNameWidth });
  const body: TextStyle = { size: theme.font.size.body };
  const attributes: Compartment = { lines: (c.attributes ?? []).map(a => ({ text: formatAttribute(a), style: body, align: 'left', underline: isStatic(a) })) };
  const operations: Compartment = { lines: (c.operations ?? []).map(o => ({ text: formatOperation(o), style: { ...body, italic: isAbstractOperation(o) }, align: 'left', underline: isStatic(o) })) };
  const result = [header];
  if (c.type === 'enumeration') {
    result.push({ lines: (c.literals ?? []).map(text => ({ text, style: body, align: 'left' })) });
    if (attributes.lines.length) result.push(attributes);
    if (operations.lines.length) result.push(operations);
  } else if (attributes.lines.length || operations.lines.length) {
    result.push(attributes, operations);
  }
  return result;
}

interface EdgePlan {
  id: string;
  relationship?: Relationship;
  type: string;
  source: string;
  target: string;
  style: LineStyle;
  sourceMarker: Marker;
  targetMarker: Marker;
  /** ELK edge goes from `to` to `from` (generalizations: parent above child). */
  reversed: boolean;
  elkSource: string;
  center?: { lines: string[]; widths: number[] };
  ends: { end: 'source' | 'target'; text: string; width: number; kind: 'multiplicity' | 'role' }[];
}

const navigability = (navigable: boolean | undefined): Marker => navigable === undefined ? 'none' : navigable ? 'open-arrow' : 'cross';

function plan(model: ClassDiagram, metrics: FontMetrics): EdgePlan[] {
  const plans: EdgePlan[] = [];
  const width = (text: string) => Math.ceil(metrics.measure(text, LABEL));
  (model.relationships ?? []).forEach((r, i) => {
    const id = r.id ?? `relationships/${i}`;
    const base = { id, relationship: r, type: r.type, source: r.from, target: r.to, reversed: false, elkSource: r.from, ends: [] as EdgePlan['ends'] };
    let p: EdgePlan;
    switch (r.type) {
      case 'generalization': case 'realization':
        p = { ...base, style: r.type === 'realization' ? 'dashed' : 'solid', sourceMarker: 'none', targetMarker: 'hollow-triangle', reversed: true, elkSource: `${r.to}::${r.type}` };
        break;
      case 'dependency':
        p = { ...base, style: 'dashed', sourceMarker: 'none', targetMarker: 'open-arrow' };
        break;
      case 'containment':
        p = { ...base, style: 'solid', sourceMarker: 'circle-plus', targetMarker: 'none' };
        break;
      default: {
        const whole: Marker = r.type === 'composition' ? 'filled-diamond' : r.type === 'aggregation' ? 'hollow-diamond' : navigability(r.fromEnd?.navigable);
        p = { ...base, style: 'solid', sourceMarker: whole, targetMarker: navigability(r.toEnd?.navigable) };
      }
    }
    const center: string[] = [];
    if (r.keyword !== undefined) center.push(guillemets([r.keyword]));
    if (r.name !== undefined) center.push(...wrapText(metrics, r.name, LABEL, CENTER_LABEL_WIDTH));
    if (center.length) p.center = { lines: center, widths: center.map(l => Math.ceil(metrics.measure(l.trimEnd(), LABEL))) };
    for (const [end, data] of [['source', r.fromEnd], ['target', r.toEnd]] as const) {
      if (data?.multiplicity !== undefined) p.ends.push({ end, text: data.multiplicity, width: width(data.multiplicity), kind: 'multiplicity' });
      if (data?.role !== undefined) p.ends.push({ end, text: data.role, width: width(data.role), kind: 'role' });
    }
    plans.push(p);
  });
  for (const element of model.elements) {
    if (!isNote(element)) continue;
    for (const target of element.attachedTo ?? []) {
      plans.push({ id: `${element.id}->${target}`, type: 'note-anchor', source: element.id, target, style: 'dashed', sourceMarker: 'none', targetMarker: 'none', reversed: false, elkSource: element.id, ends: [] });
    }
  }
  return plans;
}

function markerExtent(marker: Marker): { length: number; half: number } {
  switch (marker) {
    case 'hollow-triangle': case 'filled-triangle': return { length: theme.size.triangle.length, half: theme.size.triangle.halfWidth };
    case 'hollow-diamond': case 'filled-diamond': return { length: theme.size.diamond.length, half: theme.size.diamond.halfWidth };
    case 'open-arrow': return { length: theme.size.arrow.length, half: theme.size.arrow.halfWidth };
    case 'cross': return { length: theme.size.cross.offset + theme.size.cross.half, half: theme.size.cross.half };
    case 'circle-plus': return { length: 2 * theme.size.circlePlus.radius, half: theme.size.circlePlus.radius };
    default: return { length: 0, half: 0 };
  }
}

function markerRect(tip: Point, from: Point, marker: Marker): Rect | undefined {
  const { length, half } = markerExtent(marker);
  if (!length) return undefined;
  const u = direction(from, tip), n = { x: -u.y, y: u.x };
  const base = { x: tip.x - u.x * length, y: tip.y - u.y * length };
  return union([tip, { x: base.x + n.x * half, y: base.y + n.y * half }, { x: base.x - n.x * half, y: base.y - n.y * half }].map(p => ({ ...p, width: 0, height: 0 })));
}

export async function layoutClassDiagram(model: ClassDiagram, metrics: FontMetrics): Promise<ClassScene> {
  const lineHeight = metrics.lineHeight(LABEL.size);
  const plans = plan(model, metrics);

  // Self-loops are routed by the engine, not ELK; plan their room first.
  const loopsByNode = new Map<string, EdgePlan[]>();
  for (const p of plans) if (p.source === p.target) loopsByNode.set(p.source, [...(loopsByNode.get(p.source) ?? []), p]);
  const loopPlans = new Map<string, SelfLoopPlan>();
  for (const [node, loops] of loopsByNode) {
    loopPlans.set(node, planSelfLoops(loops.map(l => {
      const rows = Math.max(l.ends.filter(e => e.end === 'source').length, l.ends.filter(e => e.end === 'target').length);
      return {
        endLabelWidth: Math.max(0, ...l.ends.map(e => e.width)), endLabelRows: rows, labelHeight: lineHeight,
        centerLabel: l.center ? { width: Math.max(...l.center.widths), height: l.center.lines.length * lineHeight } : undefined,
      };
    })));
  }

  const boxes = new Map<string, MeasuredBox>(), noteRows = new Map<string, string[]>();
  const generalized = new Set(plans.filter(p => p.reversed).map(p => p.elkSource));
  // Ends with labels or a marker get their own port, as wide as what is drawn
  // beside the line, so ELK keeps neighbouring edges far enough apart for them.
  const endPorts = new Map<string, LayoutPort[]>();
  const endPort = new Map<string, string>();
  for (const p of plans) {
    if (p.source === p.target || p.reversed) continue;
    for (const end of ['source', 'target'] as const) {
      const labels = p.ends.filter(e => e.end === end);
      const marker = markerExtent(end === 'source' ? p.sourceMarker : p.targetMarker);
      if (!labels.length && !marker.length) continue;
      const node = end === 'source' ? p.source : p.target;
      const id = `${p.id}::port-${end}`;
      const half = Math.max(labels.length ? Math.max(...labels.map(l => l.width)) + marker.half + 8 : 0, marker.half + 5);
      endPorts.set(node, [...(endPorts.get(node) ?? []), { id, side: end === 'source' ? 'SOUTH' : 'NORTH', width: 2 * half }]);
      endPort.set(`${p.id}\u0000${end}`, id);
    }
  }

  const nodes: LayoutNode[] = model.elements.map(element => {
    let width: number, height: number;
    if (isNote(element)) {
      const note = measureNote(metrics, element.text);
      noteRows.set(element.id, note.rows);
      ({ width, height } = note);
    } else {
      const box = measureBox(metrics, compartments(element));
      boxes.set(element.id, box);
      ({ width, height } = box);
    }
    const loops = loopPlans.get(element.id);
    const shared = [...generalized].filter(port => port.startsWith(`${element.id}::`));
    const ports: LayoutPort[] = [...shared.map(id => ({ id, side: 'SOUTH' as const, width: 2 * (theme.size.triangle.halfWidth + 5) })), ...(endPorts.get(element.id) ?? [])];
    return {
      id: element.id, width, height: Math.max(height, loops?.minHeight ?? 0),
      ...(ports.length ? { ports } : {}),
      ...(loops ? { reserveRight: loops.reserveRight } : {}),
    };
  });

  const edges: LayoutEdge[] = plans.filter(p => p.source !== p.target).map(p => {
    const labels: LayoutLabel[] = [];
    if (p.center) labels.push({ id: `${p.id}::center`, width: Math.max(...p.center.widths) + 4, height: p.center.lines.length * lineHeight, placement: 'center' });
    p.ends.forEach((e, k) => labels.push({ id: `${p.id}::end${k}`, width: e.width + 4, height: lineHeight, placement: (e.end === 'source') !== p.reversed ? 'tail' : 'head' }));
    return {
      id: p.id, source: endPort.get(`${p.id}\u0000source`) ?? p.elkSource, target: p.reversed ? p.source : endPort.get(`${p.id}\u0000target`) ?? p.target, labels,
      directionPriority: p.reversed ? 10 : p.type === 'composition' || p.type === 'aggregation' || p.type === 'containment' ? 4 : 1,
    };
  });

  const result = await layout(nodes, edges, { direction: 'DOWN' });
  const rects = new Map(model.elements.map(e => {
    const r = result.nodes.get(e.id)!;
    return [e.id, r] as const;
  }));

  // Routes from the semantic source border to the semantic target border.
  const routes = new Map<string, Point[]>();
  const loopIndex = new Map<string, number>();
  for (const p of plans) {
    if (p.source === p.target) {
      const i = loopIndex.get(p.source) ?? 0;
      loopIndex.set(p.source, i + 1);
      routes.set(p.id, selfLoopRoute(rects.get(p.source)!, loopPlans.get(p.source)!, i));
      continue;
    }
    const points = result.edges.get(p.id)!.points;
    routes.set(p.id, p.reversed ? [...points].reverse() : points);
  }

  // Generalizations into one shared port draw their arrowhead once.
  const drawnTips = new Set<string>();
  const sceneEdges: ClassScene['edges'] = plans.map(p => {
    const points = routes.get(p.id)!;
    const tip = points.at(-1)!;
    const key = `${p.targetMarker}@${tip.x},${tip.y}`;
    const drawTargetMarker = !p.reversed || !drawnTips.has(key);
    drawnTips.add(key);
    return { id: p.id, type: p.type, source: p.source, target: p.target, points, style: p.style, sourceMarker: p.sourceMarker, targetMarker: p.targetMarker, drawTargetMarker };
  });

  // Labels: end labels first (they are tied to a spot), then centers.
  const obstacles = { rects: [...rects.values()] as Rect[], segments: [] as [Point, Point][] };
  for (const edge of sceneEdges) {
    edge.points.slice(1).forEach((p, k) => obstacles.segments.push([edge.points[k]!, p]));
    const source = markerRect(edge.points[0]!, edge.points[1]!, edge.sourceMarker);
    const target = markerRect(edge.points.at(-1)!, edge.points.at(-2)!, edge.targetMarker);
    for (const r of [source, target]) if (r) obstacles.rects.push(r);
  }
  const requests: LabelRequest[] = [];
  const meta = new Map<string, { owner: string; lines: string[]; widths: number[]; end?: 'source' | 'target'; anchor?: Point }>();
  for (const p of plans) {
    const route = routes.get(p.id)!;
    p.ends.forEach((e, k) => {
      const id = `${p.id}::end${k}`;
      const marker = e.end === 'source' ? p.sourceMarker : p.targetMarker;
      const suggested = result.edges.get(p.id)?.labels.get(id);
      // Self-loop labels stay inside their own loop (see engine/selfloops.ts).
      const inside = p.source === p.target ? { onlySide: e.end === 'source' ? -1 as const : 1 as const } : {};
      requests.push({ id, width: e.width, height: lineHeight, route, at: e.end, side: e.kind === 'multiplicity' ? 1 : -1, clearance: markerExtent(marker).half + 3, ...inside, suggestion: suggested && { x: suggested.x + 2, y: suggested.y, width: e.width, height: lineHeight } });
      meta.set(id, { owner: p.id, lines: [e.text], widths: [e.width], end: e.end, anchor: e.end === 'source' ? route[0]! : route.at(-1)! });
    });
  }
  for (const p of plans) {
    if (!p.center) continue;
    const id = `${p.id}::center`;
    const width = Math.max(...p.center.widths), height = p.center.lines.length * lineHeight;
    const suggested = result.edges.get(p.id)?.labels.get(id);
    requests.push({ id, width, height, route: routes.get(p.id)!, at: 'center', suggestion: suggested && { x: suggested.x + 2, y: suggested.y, width, height } });
    meta.set(id, { owner: p.id, lines: p.center.lines, widths: p.center.widths });
  }
  const labelledEnds = plans.flatMap(p => [...new Set(p.ends.map(e => e.end))].map(end => end === 'source' ? routes.get(p.id)![0]! : routes.get(p.id)!.at(-1)!));
  const placed = placeLabels(requests, { ...obstacles, ends: labelledEnds });
  const labels: ClassScene['labels'] = [...placed].map(([id, rect]) => ({ id, rect, style: LABEL, ...meta.get(id)! }));

  // Translate everything so the drawing starts at the canvas margin (inside the frame, if any).
  const content = union([
    ...rects.values(), ...labels.map(l => l.rect), ...obstacles.rects,
    ...sceneEdges.flatMap(e => e.points.map(p => ({ ...p, width: 0, height: 0 }))),
  ]);
  const margin = theme.spacing.canvas, pad = theme.spacing.frame;
  const heading = model.title === undefined ? undefined : measureFrameHeading(metrics, 'class', model.title);
  const originX = margin + (heading ? pad : 0), originY = margin + (heading ? heading.height + pad : 0);
  const dx = originX - content.x, dy = originY - content.y;
  const move = (r: Rect): Rect => ({ x: r.x + dx, y: r.y + dy, width: r.width, height: r.height });
  const movePoint = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  let width = originX + content.width + (heading ? pad : 0);
  let height = originY + content.height + (heading ? pad : 0);
  let frame: ClassScene['frame'];
  if (heading) {
    const frameWidth = Math.max(width - margin, heading.width + pad);
    frame = { bounds: { x: margin, y: margin, width: frameWidth, height: height - margin }, title: model.title! };
    width = margin + frameWidth;
  }
  return {
    width: width + margin, height: height + margin,
    ...(frame ? { frame } : {}),
    nodes: model.elements.map(element => ({
      element, bounds: move(rects.get(element.id)!),
      ...(boxes.has(element.id) ? { box: boxes.get(element.id)! } : {}),
      ...(noteRows.has(element.id) ? { rows: noteRows.get(element.id)! } : {}),
    })),
    edges: sceneEdges.map(e => ({ ...e, points: e.points.map(movePoint) })),
    labels: labels.map(l => ({ ...l, rect: move(l.rect), ...(l.anchor ? { anchor: movePoint(l.anchor) } : {}) })),
  };
}

