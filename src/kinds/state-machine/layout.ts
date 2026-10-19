import { theme } from '../../core/theme.js';
import { clipRoute, type NodeShape } from '../../engine/clip.js';
import { layout, type LayoutEdge, type LayoutLabel, type LayoutNode, type LayoutPort, type Side } from '../../engine/elk.js';
import type { FontMetrics, TextStyle } from '../../engine/fonts.js';
import { inflate, overlapArea, segmentIntersectsRect, simplify, union, type Point, type Rect } from '../../engine/geometry.js';
import { placeLabels, type LabelRequest } from '../../engine/labels.js';
import { planSelfLoops, selfLoopRoute, type SelfLoopPlan } from '../../engine/selfloops.js';
import { measureBox, measureFrameHeading, measureNote, type Compartment, type MeasuredBox } from '../../engine/shapes.js';
import { wrapText } from '../../engine/text.js';
import { behaviorLabel, isNote, isState, type ConnectionPoint, type Element, type Note, type State, type StateMachineDiagram, type Vertex } from './model.js';

/** Positioned geometry of a state machine diagram, ready to draw. */
export interface StateScene {
  width: number;
  height: number;
  frame?: { bounds: Rect; title: string };
  /** Composite states, outermost first (drawn below the edges). */
  composites: { state: State; bounds: Rect; header: MeasuredBox; parent?: string | undefined; separators: { y: number; x1: number; x2: number }[]; regionNames: { text: string; x: number; y: number }[] }[];
  /** Simple and submachine states, pseudostates and notes. */
  nodes: { element: Vertex | Note; bounds: Rect; parent?: string | undefined; box?: MeasuredBox; rows?: string[] }[];
  points: { point: ConnectionPoint; owner: string; bounds: Rect; label?: { rect: Rect; text: string } }[];
  edges: { id: string; type: string; source: string; target: string; points: Point[] }[];
  labels: { id: string; owner: string; rect: Rect; lines: string[]; widths: number[] }[];
}

const LABEL: TextStyle = { size: theme.font.size.label };
const NAME: TextStyle = { size: theme.font.size.name };
const BODY: TextStyle = { size: theme.font.size.body };
const LABEL_WIDTH = 200;
const PAD = 16;

/** Compartments of a state: name (with `: submachine`), then entry/do/exit and internal transitions. */
export function stateCompartments(state: State): Compartment[] {
  const name = state.submachine === undefined ? state.name : `${state.name} : ${state.submachine}`;
  const result: Compartment[] = [{ lines: [{ text: name, style: NAME, align: 'center', wrap: theme.size.maxNameWidth }] }];
  const behaviors = [
    ...(state.entry === undefined ? [] : [`entry / ${state.entry}`]),
    ...(state.doActivity === undefined ? [] : [`do / ${state.doActivity}`]),
    ...(state.exit === undefined ? [] : [`exit / ${state.exit}`]),
    ...(state.internal ?? []).map(behaviorLabel),
  ];
  if (behaviors.length) result.push({ lines: behaviors.map(text => ({ text, style: BODY, align: 'left' as const })) });
  return result;
}

export const pseudostateSize = (type: string): { width: number; height: number; shape: NodeShape } => {
  const s = theme.size.state;
  switch (type) {
    case 'initial': return { width: s.initial, height: s.initial, shape: 'ellipse' };
    case 'final': return { width: s.final, height: s.final, shape: 'ellipse' };
    case 'choice': return { width: s.choice, height: s.choice, shape: 'diamond' };
    case 'junction': return { width: s.junction, height: s.junction, shape: 'ellipse' };
    case 'shallowHistory': case 'deepHistory': return { width: s.history, height: s.history, shape: 'ellipse' };
    case 'terminate': return { width: s.terminate, height: s.terminate, shape: 'diamond' };
    case 'entryPoint': case 'exitPoint': return { width: s.point, height: s.point, shape: 'ellipse' };
    default: return { width: s.barMin, height: s.bar, shape: 'rect' };
  }
};

export async function layoutStateMachine(model: StateMachineDiagram, metrics: FontMetrics): Promise<StateScene> {
  const lineHeight = metrics.lineHeight(LABEL.size);
  const transitions = (model.transitions ?? []).map((t, i) => ({ ...t, key: t.id ?? `transitions/${i}` }));
  const vertices = new Map<string, { element: Vertex | Note; parent?: string | undefined }>();
  const points = new Map<string, { point: ConnectionPoint; owner: string }>();
  const collect = (elements: readonly Element[], parent?: string): void => {
    for (const e of elements) {
      vertices.set(e.id, { element: e, parent });
      if (!isState(e)) continue;
      for (const p of e.connectionPoints ?? []) points.set(p.id, { point: p, owner: e.id });
      for (const r of e.regions ?? []) collect(r.elements, e.id);
    }
  };
  collect(model.elements);
  const typeOf = (id: string): string => points.get(id)?.point.type ?? vertices.get(id)!.element.type;

  // Labels and self-loops.
  const labelOf = new Map<string, { lines: string[]; widths: number[] }>();
  for (const t of transitions) {
    const text = behaviorLabel(t);
    if (!text) continue;
    const lines = wrapText(metrics, text, LABEL, LABEL_WIDTH);
    labelOf.set(t.key, { lines, widths: lines.map(l => Math.ceil(metrics.measure(l.trimEnd(), LABEL))) });
  }
  const loops = new Map<string, typeof transitions>();
  for (const t of transitions) if (t.from === t.to) loops.set(t.from, [...(loops.get(t.from) ?? []), t]);
  const loopPlans = new Map<string, SelfLoopPlan>();
  for (const [id, list] of loops) {
    loopPlans.set(id, planSelfLoops(list.map(t => {
      const l = labelOf.get(t.key);
      // One row of band per loop keeps the arrowheads of nested loops apart (no end labels here).
      return { endLabelWidth: 0, endLabelRows: 1, labelHeight: lineHeight, centerLabel: l ? { width: Math.max(...l.widths), height: l.lines.length * lineHeight } : undefined };
    })));
  }

  // Ports: pseudostates attach their transitions at side centers, so lines meet
  // circles and diamonds head-on; connection points are ports of their state.
  const ports = new Map<string, LayoutPort[]>();
  const portOf = new Map<string, string>();
  const addPort = (node: string, side: Side, width?: number): string => {
    const id = `${node}::${side}`;
    const list = ports.get(node) ?? [];
    if (!list.some(p => p.id === id)) list.push({ id, side, ...(width ? { width } : {}) });
    ports.set(node, list);
    return id;
  };
  const owners = new Set([...points.values()].map(p => p.owner));
  const outgoingOf = new Map<string, typeof transitions>();
  for (const t of transitions) if (t.from !== t.to) outgoingOf.set(t.from, [...(outgoingOf.get(t.from) ?? []), t]);
  for (const t of transitions) {
    if (t.from === t.to) continue;
    for (const [end, id] of [['source', t.from], ['target', t.to]] as const) {
      const type = typeOf(id);
      const key = `${t.key}\u0000${end}`;
      if (points.has(id)) continue;
      if (type === 'state' && owners.has(id)) {
        // A state with entry/exit points has fixed-side ports, so its other
        // transitions get ports too, wide enough to keep arrowheads apart.
        const portId = `${id}::${t.key}::${end}`;
        ports.set(id, [...(ports.get(id) ?? []), { id: portId, side: end === 'target' ? 'NORTH' : 'SOUTH', width: 2 * theme.size.arrow.halfWidth + theme.spacing.edgeEdge }]);
        portOf.set(key, portId);
        continue;
      }
      if (type === 'state' || type === 'fork' || type === 'join' || type === 'note') continue;
      if (end === 'target') { portOf.set(key, addPort(id, 'NORTH')); continue; }
      if (type === 'choice' || type === 'junction') {
        const outs = outgoingOf.get(id)!;
        const index = outs.indexOf(t), n = outs.length;
        const side: Side = n === 1 ? 'SOUTH' : index === 0 ? 'WEST' : index === n - 1 ? 'EAST' : 'SOUTH';
        portOf.set(key, addPort(id, side));
      } else portOf.set(key, addPort(id, 'SOUTH'));
    }
  }
  // Several connection points on one side need one port each.
  const pointPort = new Map<string, string>();
  for (const [id, { point, owner }] of points) {
    const side: Side = point.type === 'entryPoint' ? 'WEST' : 'EAST';
    const portId = `${owner}::point::${id}`;
    ports.set(owner, [...(ports.get(owner) ?? []), { id: portId, side, width: theme.size.state.point + 6 }]);
    pointPort.set(id, portId);
  }
  for (const t of transitions) {
    for (const [end, id] of [['source', t.from], ['target', t.to]] as const) if (pointPort.has(id)) portOf.set(`${t.key}\u0000${end}`, pointPort.get(id)!);
  }

  // Layout containers: the root, a composite state with one unnamed region, or a
  // region node. A note is laid out in the innermost container holding all the
  // vertices it annotates, so its dashed lines stay local.
  const containerOf = new Map<string, string[]>();
  const chain = (elements: readonly Element[], path: string[]): void => {
    for (const e of elements) {
      if (isNote(e)) continue;
      containerOf.set(e.id, path);
      if (!isState(e) || !e.regions) continue;
      const single = e.regions.length === 1 && e.regions[0]!.name === undefined;
      e.regions.forEach((r, j) => chain(r.elements, [...path, single ? e.id : `${e.id}::region${j}`]));
    }
  };
  chain(model.elements, ['::root']);
  const notesIn = new Map<string, Note[]>();
  const noteOwner = new Map<string, string | undefined>();
  for (const e of model.elements) {
    if (!isNote(e)) continue;
    const paths = (e.attachedTo ?? []).map(t => containerOf.get(t)!);
    const common = paths.reduce((a, b) => {
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      return a.slice(0, i);
    }, paths[0] ?? ['::root']);
    const key = common.at(-1) ?? '::root';
    notesIn.set(key, [...(notesIn.get(key) ?? []), e]);
    noteOwner.set(e.id, key === '::root' ? undefined : key.split('::')[0]);
  }
  const inside = (key: string, elements: readonly Element[]): (Vertex | Note)[] => [...elements.filter(e => !isNote(e)), ...(notesIn.get(key) ?? [])];

  const boxes = new Map<string, MeasuredBox>(), noteRows = new Map<string, string[]>();
  const headers = new Map<string, MeasuredBox>();
  const regionNameHeight = lineHeight + 6;
  const toNode = (e: Vertex | Note): LayoutNode => {
    const nodePorts = ports.get(e.id);
    const withPorts = nodePorts?.length ? { ports: nodePorts } : {};
    if (isNote(e)) {
      const note = measureNote(metrics, e.text);
      noteRows.set(e.id, note.rows);
      return { id: e.id, width: note.width, height: note.height };
    }
    if (isState(e) && e.regions) {
      const header = measureBox(metrics, stateCompartments(e));
      headers.set(e.id, header);
      const regionNode = (r: NonNullable<State['regions']>[number], j: number): LayoutNode => ({
        id: `${e.id}::region${j}`, width: 0, height: 0,
        padding: { top: PAD + (r.name !== undefined ? regionNameHeight : 0), left: PAD, bottom: PAD, right: PAD },
        children: inside(`${e.id}::region${j}`, r.elements).map(toNode),
      });
      const single = e.regions.length === 1 && e.regions[0]!.name === undefined;
      const loop = loopPlans.get(e.id);
      return {
        id: e.id, width: Math.max(header.width, 60), height: header.height + 2 * PAD, minimumSize: true,
        ...(loop ? { reserveRight: loop.reserveRight } : {}),
        padding: single ? { top: header.height + PAD, left: PAD, bottom: PAD, right: PAD } : { top: header.height, left: 0, bottom: 0, right: 0 },
        children: single ? inside(e.id, e.regions[0]!.elements).map(toNode) : e.regions.map(regionNode),
        ...withPorts,
      };
    }
    if (isState(e)) {
      const box = measureBox(metrics, stateCompartments(e), 80);
      boxes.set(e.id, box);
      const loop = loopPlans.get(e.id);
      return { id: e.id, width: box.width, height: Math.max(box.height, 40, loop?.minHeight ?? 0), ...(loop ? { reserveRight: loop.reserveRight } : {}), ...withPorts };
    }
    const size = pseudostateSize(e.type);
    if (e.type === 'fork' || e.type === 'join') {
      const degree = transitions.filter(t => (e.type === 'fork' ? t.from : t.to) === e.id).length;
      return { id: e.id, width: Math.max(size.width, 44 * degree), height: size.height };
    }
    return { id: e.id, width: size.width, height: size.height, fixedSize: true, ...withPorts };
  };
  const nodes = inside('::root', model.elements).map(toNode);

  const edges: LayoutEdge[] = [];
  for (const t of transitions) {
    if (t.from === t.to) continue;
    const label = labelOf.get(t.key);
    const labels: LayoutLabel[] = label ? [{ id: `${t.key}::label`, width: Math.max(...label.widths) + 4, height: label.lines.length * lineHeight, placement: 'center' }] : [];
    edges.push({ id: t.key, source: portOf.get(`${t.key}\u0000source`) ?? t.from, target: portOf.get(`${t.key}\u0000target`) ?? t.to, labels });
  }
  // Orthogonal regions are stacked top to bottom: invisible edges order them.
  const stack = (elements: readonly Element[]): void => {
    for (const e of elements) {
      if (!isState(e) || !e.regions) continue;
      if (e.regions.length > 1 || e.regions[0]!.name !== undefined) {
        for (let j = 1; j < e.regions.length; j++) edges.push({ id: `${e.id}::stack${j}`, source: `${e.id}::region${j - 1}`, target: `${e.id}::region${j}`, directionPriority: 20 });
      }
      for (const r of e.regions) stack(r.elements);
    }
  };
  stack(model.elements);
  const anchors: { id: string; note: string; target: string }[] = [];
  for (const e of vertices.values()) {
    if (!isNote(e.element)) continue;
    for (const target of e.element.attachedTo ?? []) {
      const id = `${e.element.id}->${target}`;
      anchors.push({ id, note: e.element.id, target });
      edges.push({ id, source: e.element.id, target });
    }
  }

  const result = await layout(nodes, edges, { direction: 'DOWN', layerSpacing: 52, nodeSpacing: 40, elk: {
    // Depth-first cycle breaking keeps the main flow top-down (initial first);
    // model-order cycle breaking turned whole machines upside down when hierarchy
    // edges were involved.
    'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
  } });
  const rect = (id: string): Rect => result.nodes.get(id)!;
  const pointRect = (id: string): Rect => {
    const at = result.ports.get(pointPort.get(id)!)!;
    const d = theme.size.state.point;
    return { x: at.x - d / 2, y: at.y - d / 2, width: d, height: d };
  };
  const shapeOf = (id: string): NodeShape => points.has(id) ? 'ellipse' : vertices.get(id)!.element.type === 'state' || isNote(vertices.get(id)!.element) ? 'rect' : pseudostateSize(vertices.get(id)!.element.type).shape;
  const boundsOf = (id: string): Rect => points.has(id) ? pointRect(id) : rect(id);

  // Routes: ELK's, ends moved onto circle and diamond outlines; self-loops by the engine.
  const sceneEdges: StateScene['edges'] = [];
  const loopIndex = new Map<string, number>();
  const detours = new Map<string, number>();
  for (const t of transitions) {
    let route: Point[];
    if (t.from === t.to) {
      const i = loopIndex.get(t.from) ?? 0;
      loopIndex.set(t.from, i + 1);
      route = selfLoopRoute(rect(t.from), loopPlans.get(t.from)!, i);
    } else {
      route = result.edges.get(t.key)!.points;
      route = clipRoute(route, 'source', boundsOf(t.from), shapeOf(t.from));
      route = clipRoute(route, 'target', boundsOf(t.to), shapeOf(t.to));
    }
    if (t.from !== t.to) route = avoidHeaders(route, [...headers].filter(([id]) => id !== t.from && id !== t.to).map(([id, box]) => ({ id, bounds: rect(id), box })), detours);
    sceneEdges.push({ id: t.key, type: 'transition', source: t.from, target: t.to, points: route });
  }
  for (const a of anchors) {
    let route = result.edges.get(a.id)!.points;
    route = clipRoute(route, 'target', boundsOf(a.target), shapeOf(a.target));
    sceneEdges.push({ id: a.id, type: 'note-anchor', source: a.note, target: a.target, points: route });
  }

  // Composite states: header, region separators, region names.
  const composites: StateScene['composites'] = [];
  const simple: StateScene['nodes'] = [];
  const walk = (elements: readonly Element[], parent?: string): void => {
    for (const e of elements) {
      if (isState(e) && e.regions) {
        const bounds = rect(e.id);
        const header = headers.get(e.id)!;
        const separators: { y: number; x1: number; x2: number }[] = [];
        const regionNames: { text: string; x: number; y: number }[] = [];
        if (e.regions.length > 1 || e.regions[0]!.name !== undefined) {
          const regionRects = e.regions.map((_, j) => rect(`${e.id}::region${j}`));
          for (let j = 1; j < regionRects.length; j++) {
            const y = (regionRects[j - 1]!.y + regionRects[j - 1]!.height + regionRects[j]!.y) / 2;
            separators.push({ y, x1: bounds.x, x2: bounds.x + bounds.width });
          }
          e.regions.forEach((r, j) => {
            if (r.name === undefined) return;
            const top = j === 0 ? bounds.y + header.height : separators[j - 1]!.y;
            regionNames.push({ text: r.name, x: bounds.x + theme.spacing.padX, y: top + 6 });
          });
        }
        composites.push({ state: e, bounds, header, parent, separators, regionNames });
        for (const r of e.regions) walk(r.elements, e.id);
        continue;
      }
      simple.push({ element: e, bounds: rect(e.id), parent: isNote(e) ? noteOwner.get(e.id) : parent, ...(boxes.has(e.id) ? { box: boxes.get(e.id)! } : {}), ...(noteRows.has(e.id) ? { rows: noteRows.get(e.id)! } : {}) });
    }
  };
  walk(model.elements);

  // Transition labels, then connection point names.
  const obstacleRects: Rect[] = [...simple.map(n => n.bounds), ...[...points.keys()].map(pointRect)];
  for (const c of composites) obstacleRects.push({ ...c.bounds, height: c.header.height });
  for (const c of composites) for (const n of c.regionNames) obstacleRects.push({ x: n.x, y: n.y, width: metrics.measure(n.text, BODY) + 4, height: lineHeight });
  const segments: [Point, Point][] = [];
  for (const e of sceneEdges) e.points.slice(1).forEach((p, k) => segments.push([e.points[k]!, p]));
  const requests: LabelRequest[] = [];
  for (const t of transitions) {
    const label = labelOf.get(t.key);
    if (!label) continue;
    const id = `${t.key}::label`;
    const width = Math.max(...label.widths), height = label.lines.length * lineHeight;
    const suggested = result.edges.get(t.key)?.labels.get(id);
    const route = sceneEdges.find(e => e.id === t.key)!.points;
    requests.push({ id, width, height, route, at: 'center', suggestion: t.from === t.to ? selfLoopLabel(route, width, height) : suggested && { x: suggested.x + 2, y: suggested.y, width, height } });
  }
  const placed = placeLabels(requests, { rects: obstacleRects, segments });
  const labels: StateScene['labels'] = [];
  for (const t of transitions) {
    const r = placed.get(`${t.key}::label`);
    if (r) labels.push({ id: `${t.key}::label`, owner: t.key, rect: r, ...labelOf.get(t.key)! });
  }
  const pointsOut: StateScene['points'] = [];
  for (const [id, { point, owner }] of points) {
    const bounds = pointRect(id);
    let label: { rect: Rect; text: string } | undefined;
    if (point.name !== undefined) {
      const width = Math.ceil(metrics.measure(point.name, LABEL)), height = lineHeight;
      const left = point.type === 'entryPoint';
      const candidates = [-1, 1].flatMap(dy => [left, !left].map(outside => ({
        x: outside === left ? bounds.x - width - 4 : bounds.x + bounds.width + 4,
        y: dy < 0 ? bounds.y - height - 1 : bounds.y + bounds.height + 1, width, height,
      })));
      const busy = [...obstacleRects.filter(r => r !== bounds && !(r.x === rect(owner).x && r.y === rect(owner).y)), ...labels.map(l => l.rect), ...pointsOut.flatMap(p => p.label ? [p.label.rect] : [])];
      const free = (r: Rect) => !busy.some(b => overlapArea(inflate(r, 2), b) > 0) && !segments.some(([p, q]) => segmentIntersectsRect(p, q, inflate(r, 1)));
      label = { rect: candidates.find(free) ?? candidates[0]!, text: point.name };
    }
    pointsOut.push({ point, owner, bounds, ...(label ? { label } : {}) });
  }

  // Translate everything to the canvas margin (inside the frame, if any).
  const content = union([
    ...composites.map(c => c.bounds), ...simple.map(n => n.bounds), ...pointsOut.flatMap(p => [p.bounds, ...(p.label ? [p.label.rect] : [])]),
    ...labels.map(l => l.rect), ...sceneEdges.flatMap(e => e.points.map(p => ({ ...p, width: 0, height: 0 }))),
  ]);
  const margin = theme.spacing.canvas, pad = theme.spacing.frame;
  const heading = model.title === undefined ? undefined : measureFrameHeading(metrics, 'stm', model.title);
  const originX = margin + (heading ? pad : 0), originY = margin + (heading ? heading.height + pad : 0);
  const dx = originX - content.x, dy = originY - content.y;
  const move = (r: Rect): Rect => ({ x: r.x + dx, y: r.y + dy, width: r.width, height: r.height });
  const movePoint = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  let width = originX + content.width + (heading ? pad : 0);
  const height = originY + content.height + (heading ? pad : 0);
  let frame: StateScene['frame'];
  if (heading) {
    const frameWidth = Math.max(width - margin, heading.width + pad);
    frame = { bounds: { x: margin, y: margin, width: frameWidth, height: height - margin }, title: model.title! };
    width = margin + frameWidth;
  }
  return {
    width: width + margin, height: height + margin,
    ...(frame ? { frame } : {}),
    composites: composites.map(c => ({ ...c, bounds: move(c.bounds), separators: c.separators.map(s => ({ y: s.y + dy, x1: s.x1 + dx, x2: s.x2 + dx })), regionNames: c.regionNames.map(n => ({ ...n, x: n.x + dx, y: n.y + dy })) })),
    nodes: simple.map(n => ({ ...n, bounds: move(n.bounds) })),
    points: pointsOut.map(p => ({ ...p, bounds: move(p.bounds), ...(p.label ? { label: { ...p.label, rect: move(p.label.rect) } } : {}) })),
    edges: sceneEdges.map(e => ({ ...e, points: e.points.map(movePoint) })),
    labels: labels.map(l => ({ ...l, rect: move(l.rect) })),
  };
}

/** Self-transition labels sit right of the loop's outer leg. */
function selfLoopLabel(route: readonly Point[], width: number, height: number): Rect {
  const leg = route[1]!, bottom = route[2]!;
  return { x: leg.x + 6, y: (leg.y + bottom.y) / 2 - height / 2, width, height };
}

/**
 * ELK routes transitions that enter a composite state from outside through its
 * top padding, which holds the name and behaviors. A vertical segment that would
 * cross those texts takes a detour through the nearest free column of the header
 * (above the state, across the header, back below it), or around the state's
 * side when the texts fill the header.
 */
function avoidHeaders(route: Point[], composites: { id: string; bounds: Rect; box: MeasuredBox }[], used: Map<string, number>): Point[] {
  let points = route.map(p => ({ ...p }));
  const { padX } = theme.spacing;
  for (const { id, bounds: c, box } of composites) {
    const blocked: [number, number][] = [];
    for (const comp of box.compartments) for (const line of comp.lines) for (const w of line.widths) {
      const x0 = line.align === 'center' ? c.x + (c.width - w) / 2 : c.x + padX;
      blocked.push([x0 - 6, x0 + w + 6]);
    }
    const band = { x: c.x, y: c.y, width: c.width, height: box.height };
    const lo = c.x + theme.size.state.radius + 6, hi = c.x + c.width - theme.size.state.radius - 6;
    const free = (x: number): boolean => x >= lo && x <= hi && !blocked.some(([l, r]) => x > l + 0.01 && x < r - 0.01);
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1]!, b = points[k]!;
      if (Math.abs(a.x - b.x) > 0.01 || free(a.x) || !segmentIntersectsRect(a, b, inflate(band, -0.5))) continue;
      // A free column of the header, or else just outside the state's side border.
      const inside = [lo, hi, ...blocked.flat()].filter(free);
      // Each detour around a state gets its own lane, so detours never share a line.
      const lane = used.get(id) ?? 0;
      used.set(id, lane + 1);
      const gap = theme.spacing.edgeEdge;
      const columns = inside.length ? inside : [c.x - gap * (lane + 1), c.x + c.width + gap * (lane + 1)];
      // Prefer the side the route comes from.
      const prev = points[k - 2];
      const from = prev && Math.abs(prev.y - a.y) < 0.01 ? prev.x : a.x;
      const outside = from < c.x - gap / 2 || from > c.x + c.width + gap / 2;
      // Already coming from beside the state: keep that column instead of a new one.
      const x = !inside.length && outside ? from : columns.sort((p, q) => Math.abs(p - from) - Math.abs(q - from))[0];
      if (x === undefined) continue;
      const above = c.y - 8 - lane * gap / 2, below = c.y + band.height + 8 + lane * gap / 2;
      const [y1, y2] = a.y < b.y ? [above, below] : [below, above];
      if ((a.y < b.y ? a.y > y1 || b.y < y2 : a.y < y1 || b.y > y2)) continue;
      // Coming in horizontally from that side, above the state: turn down at the detour column directly.
      const direct = prev && from !== a.x && Math.sign(from - a.x) === Math.sign(x - a.x) && Math.abs(from - a.x) >= Math.abs(x - a.x);
      points = direct
        ? [...points.slice(0, k - 1), { x, y: a.y }, { x, y: y2 }, { x: a.x, y: y2 }, ...points.slice(k)]
        : [...points.slice(0, k), { x: a.x, y: y1 }, { x, y: y1 }, { x, y: y2 }, { x: a.x, y: y2 }, ...points.slice(k)];
      break;
    }
  }
  return simplify(points);
}
