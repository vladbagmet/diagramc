import { theme } from '../../core/theme.js';
import { clipRoute, type NodeShape } from '../../engine/clip.js';
import { layout, type LayoutEdge, type LayoutLabel, type LayoutNode, type LayoutPort, type Side } from '../../engine/elk.js';
import type { FontMetrics, TextStyle } from '../../engine/fonts.js';
import { inflate, overlapArea, segmentIntersectsRect, simplify, straightenJogs, union, type Point, type Rect } from '../../engine/geometry.js';
import { labelFits, placeLabels, type LabelRequest } from '../../engine/labels.js';
import { planSelfLoops, selfLoopRoute, type SelfLoopPlan } from '../../engine/selfloops.js';
import { repairRoutes, type RepairNode } from '../../engine/repair.js';
import { measureBox, measureFrameHeading, measureNote, type Compartment, type MeasuredBox } from '../../engine/shapes.js';
import { wrapText } from '../../engine/text.js';
import { chooseLayout, countCrossings, LAYOUT_VARIANTS, layoutScore, routesLength, type LayoutMeasure } from '../../engine/aspect.js';
import { behaviorLabel, isNote, isState, type ConnectionPoint, type Element, type Note, type State, type StateMachineDiagram, type Vertex } from './model.js';

/** Positioned geometry of a state machine diagram, ready to draw. */
export interface StateScene {
  width: number;
  height: number;
  frame?: { bounds: Rect; title: string };
  /** Composite states, outermost first (drawn below the edges). */
  composites: { state: State; bounds: Rect; header: MeasuredBox; parent?: string | undefined; separators: { x1: number; y1: number; x2: number; y2: number }[]; regionNames: { text: string; x: number; y: number }[] }[];
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
/** Extra inner room beside entry and exit points. */
const POINT_ROOM = 16;

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

/**
 * Lays out a state machine. Candidates: top to bottom (the convention) or left to
 * right, each with orthogonal regions placed along the flow (one after the other)
 * or across it (side by side); the most readable result by `layoutScore` wins
 * (src/engine/aspect.ts), so a machine with many regions does not become a
 * column ten times as tall as it is wide.
 */
export async function layoutStateMachine(model: StateMachineDiagram, metrics: FontMetrics): Promise<StateScene> {
  const measure = (scene: StateScene): LayoutMeasure => {
    const lines = scene.edges.filter(e => e.type === 'transition').map(e => e.points);
    return { width: scene.width, height: scene.height, crossings: countCrossings(lines), edgeLength: routesLength(lines) };
  };
  const hasRegions = (elements: readonly Element[]): boolean => elements.some(e => isState(e) && !!e.regions && (e.regions.length > 1 || e.regions[0]!.name !== undefined || hasRegions(e.regions[0]!.elements)));
  const modes: RegionMode[] = hasRegions(model.elements) ? ['along', 'across'] : ['along'];
  const settings = new WeakMap<StateScene, [Parameters<typeof layoutOnce>[2], RegionMode, Record<string, string>]>();
  const chosen = await chooseLayout(['DOWN', 'RIGHT'], async (dir, variant) => {
    let best: StateScene | undefined, bestScore = Infinity;
    for (const mode of modes) {
      let scene: StateScene;
      try {
        scene = await layoutOnce(model, metrics, dir === 'RIGHT' ? 'RIGHT' : 'DOWN', mode, LAYOUT_VARIANTS[variant]);
        settings.set(scene, [dir === 'RIGHT' ? 'RIGHT' : 'DOWN', mode, LAYOUT_VARIANTS[variant]]);
      }
      catch (error) { if (best === undefined && mode === modes.at(-1)) throw error; continue; }
      const score = layoutScore(measure(scene));
      if (score < bestScore - 1e-6) { best = scene; bestScore = score; }
    }
    return best!;
  }, measure, { penalty: i => i ? 0.25 : 0 });
  // Pseudostates with several incoming lines share one arrowhead tip in the
  // candidates. Each line gets the free side of the pseudostate that faces its
  // source in the chosen layout, and that layout runs once more.
  const [dir, mode, variant] = settings.get(chosen)!;
  const sides = incomingSides(model, chosen, dir);
  if (!sides.size) return chosen;
  try { return await layoutOnce(model, metrics, dir, mode, variant, sides); } catch { return chosen; }
}

/** Logical side of the index-th outgoing line of a pseudostate (see layoutOnce). */
function outgoingSide(type: string, outs: readonly { to: string }[], index: number, ins: readonly { from: string }[]): Side {
  const n = outs.length;
  if (type !== 'choice' && type !== 'junction') return 'SOUTH';
  if (n > 1) return index === 0 ? 'WEST' : index === n - 1 ? 'EAST' : 'SOUTH';
  return ins.some(i => i.from === outs[index]!.to) ? 'EAST' : 'SOUTH';
}

/**
 * Real sides for the incoming lines of pseudostates with two or more of them:
 * each line takes the free side (not used by outgoing lines) that faces its
 * source best, the most clearly oriented lines first.
 */
function incomingSides(model: StateMachineDiagram, scene: StateScene, dir: 'DOWN' | 'RIGHT'): Map<string, Side> {
  const real = (side: Side): Side => dir === 'DOWN' ? side : ({ NORTH: 'WEST', SOUTH: 'EAST', WEST: 'NORTH', EAST: 'SOUTH' } as const)[side];
  const centers = new Map<string, Point>();
  const add = (id: string, r: Rect): void => { centers.set(id, { x: r.x + r.width / 2, y: r.y + r.height / 2 }); };
  for (const n of scene.nodes) add(n.element.id, n.bounds);
  for (const c of scene.composites) add(c.state.id, c.bounds);
  for (const p of scene.points) add(p.point.id, p.bounds);
  const out = new Map<string, Side>();
  const normals: [Side, Point][] = [['NORTH', { x: 0, y: -1 }], ['SOUTH', { x: 0, y: 1 }], ['WEST', { x: -1, y: 0 }], ['EAST', { x: 1, y: 0 }]];
  const transitions = (model.transitions ?? []).map((t, i) => ({ ...t, key: t.id ?? `transitions/${i}` })).filter(t => t.from !== t.to);
  for (const n of scene.nodes) {
    const e = n.element;
    if (e.type === 'state' || e.type === 'fork' || e.type === 'join' || e.type === 'note') continue;
    const ins = transitions.filter(t => t.to === e.id);
    if (ins.length < 2) continue;
    const c = centers.get(e.id)!;
    // Sides taken by outgoing lines.
    const outs = transitions.filter(t => t.from === e.id);
    const used = new Set<Side>(outs.map((_, k) => real(outgoingSide(e.type, outs, k, ins))));
    const wishes = ins.map(t => {
      const s = centers.get(t.from) ?? c, d = { x: s.x - c.x, y: s.y - c.y }, len = Math.hypot(d.x, d.y) || 1;
      const ranked = normals.map(([side, v]) => ({ side, dot: (v.x * d.x + v.y * d.y) / len })).sort((a, b) => b.dot - a.dot);
      return { t, ranked };
    }).sort((a, b) => b.ranked[0]!.dot - a.ranked[0]!.dot);
    for (const { t, ranked } of wishes) {
      const side = ranked.find(r => !used.has(r.side))?.side;
      if (!side) continue;
      used.add(side);
      out.set(t.key, side);
    }
  }
  return out;
}

/** Orthogonal regions of a composite: one after the other along the layout direction, or side by side across it. */
type RegionMode = 'along' | 'across';

async function layoutOnce(model: StateMachineDiagram, metrics: FontMetrics, dir: 'DOWN' | 'RIGHT', regionMode: RegionMode, variant: Record<string, string>, inSides: ReadonlyMap<string, Side> = new Map()): Promise<StateScene> {
  const down = dir === 'DOWN';
  /** Real side of a logical side of the top-to-bottom convention (targets NORTH, sources SOUTH). */
  const S = (side: Side): Side => down ? side : ({ NORTH: 'WEST', SOUTH: 'EAST', WEST: 'NORTH', EAST: 'SOUTH' } as const)[side];
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
  const outgoingOf = new Map<string, typeof transitions>(), incomingOf = new Map<string, typeof transitions>();
  for (const t of transitions) {
    if (t.from === t.to) continue;
    outgoingOf.set(t.from, [...(outgoingOf.get(t.from) ?? []), t]);
    incomingOf.set(t.to, [...(incomingOf.get(t.to) ?? []), t]);
  }
  /**
   * Logical sides of a pseudostate's lines. Outgoing lines of a choice or junction
   * spread over its west, south and east points; a line back to a vertex that also
   * leads into it leaves from the side, so the loop stays next to that vertex
   * instead of running around the layer below. Incoming lines arrive at the north
   * point, or at the side `inSides` gives (the second pass of layoutStateMachine,
   * so that several arrowheads never share a tip). S is its own inverse.
   */
  const pseudoSides = new Map<string, Side>();
  for (const [id, { element }] of vertices) {
    const type = element.type;
    if (type === 'state' || type === 'fork' || type === 'join' || type === 'note') continue;
    const outs = outgoingOf.get(id) ?? [], ins = incomingOf.get(id) ?? [];
    outs.forEach((t, index) => pseudoSides.set(`${t.key}\u0000source`, outgoingSide(type, outs, index, ins)));
    for (const t of ins) {
      const real = inSides.get(t.key);
      pseudoSides.set(`${t.key}\u0000target`, real === undefined ? 'NORTH' : S(real));
    }
  }
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
        ports.set(id, [...(ports.get(id) ?? []), { id: portId, side: S(end === 'target' ? 'NORTH' : 'SOUTH'), width: 2 * theme.size.arrow.halfWidth + theme.spacing.edgeEdge }]);
        portOf.set(key, portId);
        continue;
      }
      if (type === 'state' || type === 'fork' || type === 'join' || type === 'note') continue;
      portOf.set(key, addPort(id, S(pseudoSides.get(key) ?? (end === 'target' ? 'NORTH' : 'SOUTH'))));
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
        // Wide enough for the region's name in its top-left corner.
        id: `${e.id}::region${j}`, width: r.name === undefined ? 0 : Math.ceil(metrics.measure(r.name, BODY)) + 2 * theme.spacing.padX, height: regionNameHeight, minimumSize: r.name !== undefined,
        padding: { top: PAD + (r.name !== undefined ? regionNameHeight : 0), left: PAD, bottom: PAD, right: PAD },
        children: inside(`${e.id}::region${j}`, r.elements).map(toNode),
      });
      const single = e.regions.length === 1 && e.regions[0]!.name === undefined;
      const loop = loopPlans.get(e.id);
      return {
        id: e.id, width: Math.max(header.width, 60), height: header.height + 2 * PAD, minimumSize: true,
        ...(loop ? { reserveRight: loop.reserveRight, reserveAbove: loop.reserveAbove, reserveBelow: loop.reserveBelow } : {}),
        // Sides with entry or exit points get room for the arrow from the point to a vertex inside.
        padding: {
          top: header.height + (single ? PAD : 0), bottom: single ? PAD : 0,
          left: (single ? PAD : 0) + (e.connectionPoints?.some(p => p.type === 'entryPoint') ? POINT_ROOM : 0),
          right: (single ? PAD : 0) + (e.connectionPoints?.some(p => p.type === 'exitPoint') ? POINT_ROOM : 0),
        },
        children: single ? inside(e.id, e.regions[0]!.elements).map(toNode) : e.regions.map(regionNode),
        ...withPorts,
      };
    }
    if (isState(e)) {
      const box = measureBox(metrics, stateCompartments(e), 80);
      boxes.set(e.id, box);
      const loop = loopPlans.get(e.id);
      return { id: e.id, width: box.width, height: Math.max(box.height, 40, loop?.minHeight ?? 0), ...(loop ? { reserveRight: loop.reserveRight, reserveAbove: loop.reserveAbove, reserveBelow: loop.reserveBelow } : {}), ...withPorts };
    }
    const size = pseudostateSize(e.type);
    if (e.type === 'fork' || e.type === 'join') {
      const degree = transitions.filter(t => (e.type === 'fork' ? t.from : t.to) === e.id).length;
      const length = Math.max(size.width, 44 * degree);
      return { id: e.id, width: down ? length : size.height, height: down ? size.height : length };
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
  // Regions one after the other: invisible edges order them along the layout direction.
  // Side by side: no edges, so they share a layer.
  const stack = (elements: readonly Element[]): void => {
    for (const e of elements) {
      if (!isState(e) || !e.regions) continue;
      if (e.regions.length > 1 || e.regions[0]!.name !== undefined) {
        if (regionMode === 'along') for (let j = 1; j < e.regions.length; j++) edges.push({ id: `${e.id}::stack${j}`, source: `${e.id}::region${j - 1}`, target: `${e.id}::region${j}`, directionPriority: 20 });
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

  const result = await layout(nodes, edges, { direction: dir, layerSpacing: 52, nodeSpacing: 40, elk: {
    ...variant,
    // Depth-first cycle breaking keeps the main flow top-down (initial first);
    // model-order cycle breaking turned whole machines upside down when hierarchy
    // edges were involved.
    'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
  } });
  const rect = (id: string): Rect => result.nodes.get(id)!;
  /**
   * The cells of a composite's orthogonal regions (the composite's body split by
   * dashed separators), their separators and region names. Regions laid out one
   * after the other along the direction are split across it and the other way
   * round; the arrangement is read from the geometry.
   */
  const regionCells = (e: State, bounds: Rect, headerHeight: number) => {
    const cells: { id: string; rect: Rect }[] = [];
    const drawn = { separators: [] as { x1: number; y1: number; x2: number; y2: number }[], regionNames: [] as { text: string; x: number; y: number }[] };
    const regions = e.regions ?? [];
    if (!(regions.length > 1 || regions[0]?.name !== undefined)) return { cells, drawn };
    const body = { x: bounds.x, y: bounds.y + headerHeight, width: bounds.width, height: bounds.height - headerHeight };
    const rects = regions.map((r, j) => ({ j, r, rect: rect(`${e.id}::region${j}`) }));
    const disjoint = (axis: 'x' | 'y') => rects.every((a, i) => rects.every((b, k) => k <= i || (axis === 'x'
      ? a.rect.x + a.rect.width <= b.rect.x + 0.5 || b.rect.x + b.rect.width <= a.rect.x + 0.5
      : a.rect.y + a.rect.height <= b.rect.y + 0.5 || b.rect.y + b.rect.height <= a.rect.y + 0.5)));
    const sideBySide = rects.length > 1 && !disjoint('y') && disjoint('x');
    const axis = sideBySide ? 'x' as const : 'y' as const;
    const sorted = [...rects].sort((a, b) => a.rect[axis] - b.rect[axis]);
    const cuts = sorted.slice(1).map((c, k) => {
      const prev = sorted[k]!.rect;
      return sideBySide ? (prev.x + prev.width + c.rect.x) / 2 : (prev.y + prev.height + c.rect.y) / 2;
    });
    sorted.forEach((c, k) => {
      const lo = k === 0 ? (sideBySide ? body.x : body.y) : cuts[k - 1]!;
      const hi = k === sorted.length - 1 ? (sideBySide ? body.x + body.width : body.y + body.height) : cuts[k]!;
      const cell = sideBySide ? { x: lo, y: body.y, width: hi - lo, height: body.height } : { x: body.x, y: lo, width: body.width, height: hi - lo };
      cells.push({ id: `${e.id}::region${c.j}`, rect: cell });
      if (c.r.name !== undefined) drawn.regionNames.push({ text: c.r.name, x: cell.x + theme.spacing.padX, y: cell.y + 6 });
    });
    for (const v of cuts) {
      drawn.separators.push(sideBySide ? { x1: v, y1: body.y, x2: v, y2: body.y + body.height } : { x1: body.x, y1: v, x2: body.x + body.width, y2: v });
    }
    return { cells, drawn };
  };

  // Entry and exit points stay clear of their state's rounded corners and of a
  // composite's name compartment (the line inside would cross its texts): ELK may
  // put a port anywhere on its side, so it slides along the side if needed, keeping
  // points on one side apart.
  const pointAt = new Map<string, Point>();
  {
    const bySide = new Map<string, { id: string; at: Point; vertical: boolean; lo: number; hi: number }[]>();
    for (const [id, { owner }] of points) {
      const at = result.ports.get(pointPort.get(id)!)!, r = rect(owner);
      const d = [Math.abs(at.x - r.x), Math.abs(at.x - r.x - r.width), Math.abs(at.y - r.y), Math.abs(at.y - r.y - r.height)];
      const side = d.indexOf(Math.min(...d)), vertical = side < 2;
      const margin = theme.size.state.radius + theme.size.state.point / 2 + 6;
      const ownerElement = vertices.get(owner)!.element;
      const named = isState(ownerElement) && (ownerElement.regions ?? []).some(g => g.name !== undefined);
      // Below the name compartment and the region names in the top corners of the regions.
      const top = (headers.get(owner)?.height ?? 0) + (named ? regionNameHeight : 0);
      let lo = vertical ? r.y + top + margin : r.x + margin, hi = vertical ? r.y + r.height - margin : r.x + r.width - margin;
      // Beside the region its inner lines lead to, so they do not cut through another region.
      if (isState(ownerElement) && ownerElement.regions) {
        const inner = transitions.flatMap(t => t.from === id ? [t.to] : t.to === id ? [t.from] : []);
        const cells = regionCells(ownerElement, r, headers.get(owner)!.height).cells.filter(cell => {
          const j = Number(cell.id.slice(cell.id.lastIndexOf('region') + 6));
          const within = (els: readonly Element[]): boolean => els.some(x => inner.includes(x.id) || (isState(x) && (x.regions ?? []).some(g => within(g.elements))));
          return within(ownerElement.regions![j]!.elements);
        });
        if (cells.length === 1) {
          const cell = cells[0]!.rect, j = Number(cells[0]!.id.slice(cells[0]!.id.lastIndexOf('region') + 6));
          const nameRoom = vertical && ownerElement.regions[j]!.name !== undefined ? regionNameHeight : 0;
          const clo = (vertical ? cell.y : cell.x) + margin + nameRoom, chi = (vertical ? cell.y + cell.height : cell.x + cell.width) - margin;
          if (Math.max(lo, clo) <= Math.min(hi, chi)) { lo = Math.max(lo, clo); hi = Math.min(hi, chi); }
        }
      }
      const list = bySide.get(`${owner}\u0000${side}`) ?? [];
      list.push({ id, at, vertical, lo, hi });
      bySide.set(`${owner}\u0000${side}`, list);
    }
    for (const list of bySide.values()) {
      const axis = list[0]!.vertical ? 'y' as const : 'x' as const;
      const gap = theme.size.state.point + theme.spacing.edgeEdge;
      list.sort((a, b) => a.at[axis] - b.at[axis]);
      const lo = list[0]!.lo, hi = list[0]!.hi;
      const values = list.map(p => hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, p.at[axis])));
      for (let k = 1; k < values.length; k++) values[k] = Math.max(values[k]!, values[k - 1]! + gap);
      for (let k = values.length - 2; k >= 0; k--) values[k] = Math.min(values[k]!, values[k + 1]! - gap);
      list.forEach((p, k) => pointAt.set(p.id, axis === 'y' ? { x: p.at.x, y: values[k]! } : { x: values[k]!, y: p.at.y }));
    }
  }
  /** An ELK route whose end sat at a connection point that moved: a jog in its end segment reaches the new point. */
  const followPoint = (route: Point[], end: 'source' | 'target', id: string): Point[] => {
    const to = pointAt.get(id);
    if (!to || route.length < 2) return route;
    const r = end === 'source' ? [...route].reverse() : [...route];
    const last = r.at(-1)!, prev = r.at(-2)!;
    if (Math.abs(last.x - to.x) < 0.01 && Math.abs(last.y - to.y) < 0.01) return route;
    const horizontal = Math.abs(prev.y - last.y) < 0.01;
    const m = horizontal ? { x: (prev.x + last.x) / 2, y: last.y } : { x: last.x, y: (prev.y + last.y) / 2 };
    const out = simplify([...r.slice(0, -1), m, horizontal ? { x: m.x, y: to.y } : { x: to.x, y: m.y }, to]);
    return end === 'source' ? out.reverse() : out;
  };
  const pointRect = (id: string): Rect => {
    const at = pointAt.get(id)!;
    const d = theme.size.state.point;
    return { x: at.x - d / 2, y: at.y - d / 2, width: d, height: d };
  };
  const shapeOf = (id: string): NodeShape => points.has(id) ? 'ellipse' : vertices.get(id)!.element.type === 'state' || isNote(vertices.get(id)!.element) ? 'rect' : pseudostateSize(vertices.get(id)!.element.type).shape;
  const boundsOf = (id: string): Rect => points.has(id) ? pointRect(id) : rect(id);

  // Routes: ELK's, ends moved onto circle and diamond outlines; self-loops by the engine.
  const sceneEdges: StateScene['edges'] = [];
  const loopIndex = new Map<string, number>();
  const unrouted = new Set<string>();
  // Ends on circles and diamonds stay at their side centers; only rectangular ends may slide.
  const slide = (id: string): Rect => shapeOf(id) === 'rect' && !points.has(id) ? boundsOf(id) : { x: 0, y: 0, width: 0, height: 0 };
  const detours = new Map<string, number>();
  for (const t of transitions) {
    let route: Point[];
    if (t.from === t.to) {
      const i = loopIndex.get(t.from) ?? 0;
      loopIndex.set(t.from, i + 1);
      route = selfLoopRoute(rect(t.from), loopPlans.get(t.from)!, i);
    } else {
      const elkRoute = result.edges.get(t.key)?.points ?? [];
      if (elkRoute.length < 2) {
        // ELK left the line out (graph wrapping does with some lines): a provisional route, which repairRoutes replaces.
        route = provisionalRoute(boundsOf(t.from), boundsOf(t.to));
        unrouted.add(t.key);
      } else route = straightenJogs(followPoint(followPoint(elkRoute, 'source', t.from), 'target', t.to), { source: slide(t.from), target: slide(t.to) });
      route = clipRoute(route, 'source', boundsOf(t.from), shapeOf(t.from));
      route = clipRoute(route, 'target', boundsOf(t.to), shapeOf(t.to));
    }
    if (t.from !== t.to) route = avoidHeaders(route, [...headers].filter(([id]) => id !== t.from && id !== t.to).map(([id, box]) => ({ id, bounds: rect(id), box })), detours);
    sceneEdges.push({ id: t.key, type: 'transition', source: t.from, target: t.to, points: route });
  }
  for (const a of anchors) {
    let route = result.edges.get(a.id)?.points ?? [];
    if (route.length < 2) { route = provisionalRoute(boundsOf(a.note), boundsOf(a.target)); unrouted.add(a.id); }
    route = clipRoute(route, 'target', boundsOf(a.target), shapeOf(a.target));
    sceneEdges.push({ id: a.id, type: 'note-anchor', source: a.note, target: a.target, points: route });
  }

  // Shared route repair (src/engine/repair.ts): lines over composite headers or
  // through states, detours, crowded ends, arrowheads on short end segments.
  // Ends on entry and exit points keep their points.
  // Region cells are containers too: a line between a region's vertex and the
  // outside does not cut through a sibling region.
  const repairNodes: RepairNode[] = [];
  const cellOf = new Map<string, string>();
  for (const [id, v] of vertices) {
    const e = v.element;
    if (!isState(e) || !e.regions) continue;
    const { cells, drawn } = regionCells(e, rect(id), headers.get(id)!.height);
    for (const c of cells) {
      // The region's name in its top-left corner is text no line may cross.
      const name = drawn.regionNames.find(n => Math.abs(n.x - theme.spacing.padX - c.rect.x) < 0.5 && Math.abs(n.y - 6 - c.rect.y) < 0.5);
      const texts = name ? [{ x: name.x - 2, y: name.y, width: metrics.measure(name.text, BODY) + 4, height: lineHeight }] : [];
      repairNodes.push({ id: c.id, rect: c.rect, parent: id, container: true, texts });
      const j = Number(c.id.slice(c.id.lastIndexOf('region') + 6));
      for (const child of e.regions[j]!.elements) cellOf.set(child.id, c.id);
    }
  }
  for (const [id, v] of vertices) {
    const header = headers.get(id);
    const r = rect(id);
    repairNodes.push({ id, rect: r, parent: cellOf.get(id) ?? v.parent, container: !!header, texts: header ? [{ x: r.x, y: r.y, width: r.width, height: header.height }] : [] });
  }
  for (const [id, p] of points) repairNodes.push({ id, rect: pointRect(id), parent: vertices.get(p.owner)?.parent });
  const pinned = (id: string): boolean => points.has(id);
  const repairEdges = () => sceneEdges.map(e => ({
    id: e.id, source: e.source, target: e.target, route: e.points,
    sourceMarker: 'none' as const, targetMarker: e.type === 'note-anchor' ? 'none' as const : 'open-arrow' as const,
    fixedSource: pinned(e.source), fixedTarget: pinned(e.target),
  }));
  // Pseudostates are small: aim for the plain line spacing between ends, not more.
  const repaired = repairRoutes(repairNodes, repairEdges(), { spacing: theme.spacing.edgeEdge, force: unrouted });
  // New ends on circles and diamonds move onto the outline along their end segment.
  const clipEnds = (e: StateScene['edges'][number], route: Point[]): Point[] => {
    if (e.type === 'transition') route = straightenJogs(route, { source: slide(e.source), target: slide(e.target) });
    if (!points.has(e.source)) route = clipRoute(route, 'source', boundsOf(e.source), shapeOf(e.source));
    if (!points.has(e.target)) route = clipRoute(route, 'target', boundsOf(e.target), shapeOf(e.target));
    return route;
  };
  for (const e of sceneEdges) if (repaired.changed.has(e.id)) e.points = clipEnds(e, repaired.routes.get(e.id)!);
  // Later passes replace a route only when the result is simpler and no worse:
  // no more crossings, and every label that had a clean spot (labelFits) keeps one.
  const lines = (skip: string) => sceneEdges.filter(o => o.id !== skip).map(o => o.points);
  const solid = [...vertices.keys()].filter(id => !headers.has(id)).map(rect);
  for (const [id, h] of headers) solid.push({ ...rect(id), height: h.height });
  for (const id of points.keys()) solid.push(pointRect(id));
  const fitting = (): number => {
    const segments: [Point, Point][] = sceneEdges.flatMap(o => o.points.slice(1).map((q, k) => [o.points[k]!, q] as [Point, Point]));
    const all = sceneEdges.map(o => ({ owner: o.id, points: o.points }));
    return sceneEdges.filter(o => {
      const l = labelOf.get(o.id);
      return l && o.source !== o.target && labelFits({ id: o.id, owner: o.id, width: Math.max(...l.widths), height: l.lines.length * lineHeight, route: o.points, at: 'center' }, { rects: solid, segments, lines: all });
    }).length;
  };
  const tryRoute = (e: StateScene['edges'][number], next: Point[]): boolean => {
    if (countCrossings([next, ...lines(e.id)]) > countCrossings([e.points, ...lines(e.id)])) return false;
    const before = fitting(), old = e.points;
    e.points = next;
    if (fitting() < before) { e.points = old; return false; }
    repaired.changed.add(e.id);
    return true;
  };
  // Transitions with three or more bends (ELK's back edges wind around neighbours):
  // rerouted when the router finds a route with fewer bends that is not longer.
  const winding = new Set(sceneEdges.filter(e => e.type === 'transition' && e.source !== e.target && e.points.length >= 5).map(e => e.id));
  if (winding.size) {
    const retry = repairRoutes(repairNodes, repairEdges(), { spacing: theme.spacing.edgeEdge, force: winding, shorten: false });
    for (const e of sceneEdges) {
      if (!winding.has(e.id) || !retry.changed.has(e.id)) continue;
      const next = clipEnds(e, retry.routes.get(e.id)!);
      if (next.length >= e.points.length || routesLength([next]) > routesLength([e.points]) + 20) continue;
      tryRoute(e, next);
    }
  }
  // A Z-shaped transition between two states whose facing sides overlap becomes
  // one straight line (ELK's balanced node placement leaves such jogs in chains).
  const nodeIds = repairNodes.map(n => n.id);
  const ancestorsOf = (id: string): Set<string> => {
    const out = new Set<string>();
    for (let p = repairNodes.find(n => n.id === id)?.parent; p !== undefined && !out.has(p); p = repairNodes.find(n => n.id === p)?.parent) out.add(p);
    return out;
  };
  for (const e of sceneEdges) {
    const r = e.points;
    if (e.type !== 'transition' || r.length !== 4 || e.source === e.target || points.has(e.source) || points.has(e.target)) continue;
    if (shapeOf(e.source) !== 'rect' || shapeOf(e.target) !== 'rect' || typeOf(e.source) !== 'state' || typeOf(e.target) !== 'state') continue;
    const vertical = Math.abs(r[0]!.x - r[1]!.x) < 0.01 && Math.abs(r[2]!.x - r[3]!.x) < 0.01;
    const horizontal = Math.abs(r[0]!.y - r[1]!.y) < 0.01 && Math.abs(r[2]!.y - r[3]!.y) < 0.01;
    if (!vertical && !horizontal) continue;
    const axis = vertical ? 'x' as const : 'y' as const, size = vertical ? 'width' as const : 'height' as const;
    const a = rect(e.source), b = rect(e.target), inset = theme.size.state.radius + 4;
    const lo = Math.max(a[axis], b[axis]) + inset, hi = Math.min(a[axis] + a[size], b[axis] + b[size]) - inset;
    if (hi < lo) continue;
    const mean = (r[0]![axis] + r[3]![axis]) / 2;
    const related = new Set([e.source, e.target, ...ancestorsOf(e.source), ...ancestorsOf(e.target)]);
    const blockers = [
      ...nodeIds.filter(id => !related.has(id) && !id.includes('::region')).map(id => repairNodes.find(n => n.id === id)!.rect),
      ...repairNodes.flatMap(n => n.texts ?? []),
    ];
    const ends = sceneEdges.filter(o => o.id !== e.id).flatMap(o => [o.points[0]!, o.points.at(-1)!]);
    for (const v of [Math.min(hi, Math.max(lo, mean)), (lo + hi) / 2, lo, hi]) {
      const p = { ...r[0]!, [axis]: v }, q = { ...r[3]!, [axis]: v };
      if (blockers.some(x => segmentIntersectsRect(p, q, inflate(x, -1)))) continue;
      if (ends.some(o => Math.min(Math.hypot(o.x - p.x, o.y - p.y), Math.hypot(o.x - q.x, o.y - q.y)) < 2 * theme.size.arrow.halfWidth + 6)) continue;
      if (tryRoute(e, [p, q])) break;
    }
  }

  // Composite states: header, region separators, region names.
  const composites: StateScene['composites'] = [];
  const simple: StateScene['nodes'] = [];
  const walk = (elements: readonly Element[], parent?: string): void => {
    for (const e of elements) {
      if (isState(e) && e.regions) {
        const bounds = rect(e.id);
        const header = headers.get(e.id)!;
        const { separators, regionNames } = regionCells(e, bounds, header.height).drawn;
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
  // Composite borders: a label never straddles one.
  for (const c of composites) {
    const r = c.bounds, k = [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];
    k.forEach((p, i) => segments.push([p, k[(i + 1) % 4]!]));
  }
  const requests: LabelRequest[] = [];
  for (const t of transitions) {
    const label = labelOf.get(t.key);
    if (!label) continue;
    const id = `${t.key}::label`;
    const width = Math.max(...label.widths), height = label.lines.length * lineHeight;
    const suggested = repaired.changed.has(t.key) ? undefined : result.edges.get(t.key)?.labels.get(id);
    const route = sceneEdges.find(e => e.id === t.key)!.points;
    requests.push({ id, owner: t.key, width, height, route, at: 'center', suggestion: t.from === t.to ? selfLoopLabel(route, width, height) : suggested && { x: suggested.x + 2, y: suggested.y, width, height } });
  }
  const placed = placeLabels(requests, { rects: obstacleRects, segments, lines: sceneEdges.map(e => ({ owner: e.id, points: e.points })) });
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
    composites: composites.map(c => ({ ...c, bounds: move(c.bounds), separators: c.separators.map(s => ({ x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy })), regionNames: c.regionNames.map(n => ({ ...n, x: n.x + dx, y: n.y + dy })) })),
    nodes: simple.map(n => ({ ...n, bounds: move(n.bounds) })),
    points: pointsOut.map(p => ({ ...p, bounds: move(p.bounds), ...(p.label ? { label: { ...p.label, rect: move(p.label.rect) } } : {}) })),
    edges: sceneEdges.map(e => ({ ...e, points: e.points.map(movePoint) })),
    labels: labels.map(l => ({ ...l, rect: move(l.rect) })),
  };
}

/** An orthogonal route from the side of `a` facing `b` to the side of `b` facing `a`. */
function provisionalRoute(a: Rect, b: Rect): Point[] {
  const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 }, cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  if (Math.abs(cb.y - ca.y) >= Math.abs(cb.x - ca.x)) {
    const lower = cb.y > ca.y, y0 = lower ? a.y + a.height : a.y, y1 = lower ? b.y : b.y + b.height, m = (y0 + y1) / 2;
    return simplify([{ x: ca.x, y: y0 }, { x: ca.x, y: m }, { x: cb.x, y: m }, { x: cb.x, y: y1 }]);
  }
  const right = cb.x > ca.x, x0 = right ? a.x + a.width : a.x, x1 = right ? b.x : b.x + b.width, m = (x0 + x1) / 2;
  return simplify([{ x: x0, y: ca.y }, { x: m, y: ca.y }, { x: m, y: cb.y }, { x: x1, y: cb.y }]);
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
