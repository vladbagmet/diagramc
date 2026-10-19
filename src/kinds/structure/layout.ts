import { theme } from '../../core/theme.js';
import type { LineStyle, Marker } from '../../engine/edges.js';
import { layout, type Direction, type LayoutEdge, type LayoutLabel, type LayoutNode, type LayoutPort, type Side } from '../../engine/elk.js';
import type { FontMetrics, TextStyle } from '../../engine/fonts.js';
import { contains, direction, distance, inflate, overlaps, segmentIntersectsRect, simplify, union, type Point, type Rect } from '../../engine/geometry.js';
import { placeLabels, type LabelRequest } from '../../engine/labels.js';
import { measureBox, measureFrameHeading, measureNote, type Compartment, type MeasuredBox } from '../../engine/shapes.js';
import { ballBounds, socketBounds } from '../../engine/symbols.js';
import { wrapText } from '../../engine/text.js';
import { chooseLayout, countCrossings, LAYOUT_VARIANTS, routesLength, type LayoutVariant } from '../../engine/aspect.js';
import { repairRoutes, type RepairNode } from '../../engine/repair.js';
import { guillemets, type StructAssembly, type StructEdge, type StructGraph, type StructNode, type StructStub } from './graph.js';

/**
 * Lays out a structure graph with ELK (layered, left to right, compound nodes,
 * fixed-side ports) and returns absolute geometry ready to draw.
 *
 * Conventions that keep ports and interfaces readable:
 * - Provided interfaces face left (WEST) and required ones right (EAST), so an
 *   assembly runs from the requiring element on the left, through its
 *   ball-and-socket joint, to the providing element on the right.
 * - A port's side is voted by its connections: outward connectors leave from
 *   the side facing their partner, delegations into the owner from the opposite side.
 * - Lollipops, sockets and joints are ELK nodes of their own (symbol plus name
 *   above it), joined to their port by a stem; ELK ports pin the stem to the
 *   symbol's center line, so stems and assemblies are straight and aligned.
 * - Ellipses with children (collaborations) are laid out on their own first and
 *   then treated as fixed-size nodes.
 */

export interface PlacedNode {
  node: StructNode;
  bounds: Rect;
  parent?: string | undefined;
  container: boolean;
  /** Compartments to draw: leaves all, box containers header plus an empty body, 3D/ellipse containers header only. */
  box?: MeasuredBox;
  noteRows?: string[];
  ellipse?: { textTop: number; separatorY?: number };
}
export interface PlacedSymbol {
  id: string;
  kind: 'port' | 'ball' | 'socket' | 'joint';
  bounds: Rect;
  center: Point;
  /** Socket opening direction (sockets and joints). */
  u?: Point;
  /** Owner (ports) or enclosing container (interface symbols). */
  parent?: string | undefined;
}
export interface PlacedEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  points: Point[];
  style: LineStyle;
  sourceMarker: Marker;
  targetMarker: Marker;
}
export interface PlacedLabel {
  id: string;
  owner: string;
  rect: Rect;
  lines: string[];
  widths: number[];
  style: TextStyle;
  end?: 'source' | 'target';
  anchor?: Point;
  /** Text color when it is not the default edge text color. */
  fill?: string;
  /** Rows that begin a logical line (a keyword above a name), see startsData. */
  starts?: number[];
}
export interface StructScene {
  kind: string;
  width: number;
  height: number;
  frame?: { bounds: Rect; title: string; keyword: string };
  /** Outer nodes before the nodes nested in them. */
  nodes: PlacedNode[];
  symbols: PlacedSymbol[];
  edges: PlacedEdge[];
  labels: PlacedLabel[];
}

const LABEL: TextStyle = { size: theme.font.size.label };
/**
 * Role names on role bindings (collaboration uses): italic and muted, so they do
 * not read as the multiplicities and role names at connector ends nearby.
 */
const BINDING_LABEL: TextStyle = { size: theme.font.size.label, italic: true };
const CENTER_LABEL_WIDTH = 180;
const NODE_SPACING = 30;
const LAYER_SPACING = 44;
const LABEL_GAP = 3;
/** Room at the right end of a top border kept for the icon in the corner. */
const ICON_ROOM = 30;
/** ELK straightness priority of stems and assembly halves (joints in line with their ports). */
const STRAIGHT = 10;
/** A conventional layout within this size is kept (see layoutStructure). */
const SMALL_LAYOUT = { width: 1000, height: 1000 };
/** Inner padding of containers; sides with ports get more for delegation stubs. */
const PAD = { side: 20, portSide: 34, bottom: 18, belowHeader: 14 };

interface Info {
  node: StructNode;
  parent: string | undefined;
  /** Root of the isolated (ellipse) sub-layout this node belongs to, if any. */
  isolatedRoot: string | undefined;
}
type Ends = NonNullable<StructEdge['ends']>;

interface EdgePlan {
  id: string;
  type: string;
  source: string;
  target: string;
  style: LineStyle;
  sourceMarker: Marker;
  targetMarker: Marker;
  center?: { lines: string[]; widths: number[] };
  ends: (Ends[number] & { width: number })[];
  /** Stems and assembly halves: the interface symbol at their target. */
  symbol?: string;
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

const translateRect = (r: Rect, d: Point): Rect => ({ x: r.x + d.x, y: r.y + d.y, width: r.width, height: r.height });
const translatePoint = (p: Point, d: Point): Point => ({ x: p.x + d.x, y: p.y + d.y });

/** An orthogonal route from the side of `a` facing `b` to the side of `b` facing `a` (centers joined by a Z). */
function provisionalRoute(a: Rect, b: Rect): Point[] {
  const ca = { x: a.x + a.width / 2, y: a.y + a.height / 2 }, cb = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  if (Math.abs(cb.y - ca.y) >= Math.abs(cb.x - ca.x)) {
    const down = cb.y > ca.y, y0 = down ? a.y + a.height : a.y, y1 = down ? b.y : b.y + b.height, m = (y0 + y1) / 2;
    return simplify([{ x: ca.x, y: y0 }, { x: ca.x, y: m }, { x: cb.x, y: m }, { x: cb.x, y: y1 }]);
  }
  const right = cb.x > ca.x, x0 = right ? a.x + a.width : a.x, x1 = right ? b.x : b.x + b.width, m = (x0 + x1) / 2;
  return simplify([{ x: x0, y: ca.y }, { x: m, y: ca.y }, { x: m, y: cb.y }, { x: x1, y: cb.y }]);
}

/** Geometry of one ELK run (the whole diagram or the inside of an ellipse), not yet normalized. */
interface Level {
  width: number;
  height: number;
  rects: Map<string, Rect>;
  symbols: PlacedSymbol[];
  routes: Map<string, Point[]>;
  /** ELK's reserved label positions, by label ID. */
  suggestions: Map<string, Rect>;
  /** Fixed labels (interface names above their symbols). */
  fixedLabels: { id: string; owner: string; rect: Rect; text: string; width: number }[];
  ellipses: Map<string, { textTop: number; separatorY?: number }>;
}

/**
 * Lays out a structure graph. The graph's `directions` (default RIGHT only) are
 * tried in order and the most readable result wins (src/engine/aspect.ts). A
 * conventional layout that fits SMALL_LAYOUT is kept: it reads at full scale,
 * whatever its aspect ratio.
 */
export async function layoutStructure(graph: StructGraph, metrics: FontMetrics): Promise<StructScene> {
  const directions = graph.directions ?? ['RIGHT'];
  const runs = new Map<string, Promise<StructScene>>();
  const run = (dir: Direction, variant: LayoutVariant): Promise<StructScene> => {
    const key = `${dir} ${variant}`;
    if (!runs.has(key)) runs.set(key, layoutIn(graph, metrics, dir === 'DOWN' ? 'DOWN' : 'RIGHT', variant));
    return runs.get(key)!;
  };
  const first = await run(directions[0]!, 'plain');
  if (directions.length === 1 || (first.width <= SMALL_LAYOUT.width && first.height <= SMALL_LAYOUT.height)) return first;
  return chooseLayout(directions, run, scene => {
    const lines = scene.edges.map(e => e.points);
    return { width: scene.width, height: scene.height, crossings: countCrossings(lines), edgeLength: routesLength(lines) };
  });
}

/**
 * One layout in direction `dir`. The code reasons in "logical" sides of the left
 * to right convention (provided interfaces WEST, required EAST, lines leave EAST);
 * `S()` maps a logical side to the real one, and `main`/`cross` name the real axes
 * along and across the layout direction.
 */
async function layoutIn(graph: StructGraph, metrics: FontMetrics, dir: 'RIGHT' | 'DOWN', variant: LayoutVariant = 'plain'): Promise<StructScene> {
  const down = dir === 'DOWN';
  const S = (side: Side): Side => down ? ({ EAST: 'SOUTH', WEST: 'NORTH', NORTH: 'WEST', SOUTH: 'EAST' } as const)[side] : side;
  const main = down ? 'y' as const : 'x' as const, cross = down ? 'x' as const : 'y' as const;
  /** A point from its coordinate along and across the layout direction. */
  const at = (along: number, across: number): Point => down ? { x: across, y: along } : { x: along, y: across };
  const lh = metrics.lineHeight(LABEL.size);
  const labelWidth = (text: string): number => Math.ceil(metrics.measure(text.trimEnd(), LABEL));
  const portSize = theme.size.port, depth = theme.size.nodeDepth;

  // ---- Index ----
  const info = new Map<string, Info>();
  const index = (node: StructNode, parent: string | undefined, isolatedRoot: string | undefined): void => {
    info.set(node.id, { node, parent, isolatedRoot });
    const inner = node.shape === 'ellipse' && node.children?.length ? node.id : isolatedRoot;
    for (const child of node.children ?? []) index(child, node.id, inner);
  };
  for (const node of graph.nodes) index(node, undefined, undefined);
  const portOwner = new Map<string, string>(), portLabel = new Map<string, string | undefined>();
  const stubOwner = new Map<string, { owner: string; stub: StructStub; port: boolean }>();
  for (const { node } of info.values()) {
    for (const port of node.ports ?? []) {
      portOwner.set(port.id, node.id);
      portLabel.set(port.id, port.label);
      for (const stub of port.stubs ?? []) stubOwner.set(stub.id, { owner: port.id, stub, port: true });
    }
    for (const stub of node.stubs ?? []) stubOwner.set(stub.id, { owner: node.id, stub, port: false });
  }
  const ownerNode = (endpoint: string): string => portOwner.get(endpoint) ?? endpoint;
  const ancestors = (id: string | undefined): string[] => {
    const out: string[] = [];
    for (let at = id; at !== undefined; at = info.get(at)?.parent) out.push(at);
    return out;
  };
  /** True when node `id` is strictly inside node `container`. */
  const inside = (id: string, container: string): boolean => ancestors(info.get(id)?.parent).includes(container);
  /** Deepest node containing both a and b (strictly), or undefined for the root. */
  const commonParent = (a: string, b: string): string | undefined => {
    const chainB = new Set(ancestors(info.get(b)?.parent));
    return ancestors(info.get(a)?.parent).find(id => chainB.has(id));
  };

  // ---- Edge plans (relationships, stems, assemblies, note anchors) ----
  const plans: EdgePlan[] = graph.edges.map(e => {
    const center: string[] = [];
    if (e.keyword !== undefined) center.push(guillemets([e.keyword]));
    if (e.name !== undefined) center.push(...wrapText(metrics, e.name, LABEL, CENTER_LABEL_WIDTH));
    return {
      id: e.id, type: e.type, source: e.source, target: e.target, style: e.style, sourceMarker: e.sourceMarker, targetMarker: e.targetMarker,
      ...(center.length ? { center: { lines: center, widths: center.map(labelWidth) } } : {}),
      ends: (e.ends ?? []).map(end => ({ ...end, width: e.type === 'role-binding' ? Math.ceil(metrics.measure(end.text, BINDING_LABEL)) : labelWidth(end.text) })),
    };
  });
  for (const { note, target } of graph.anchors) {
    plans.push({ id: `${note}->${target}`, type: 'note-anchor', source: note, target, style: 'dashed', sourceMarker: 'none', targetMarker: 'none', ends: [] });
  }

  // ---- Port sides: provided faces left, required right; connectors vote ----
  const votes = new Map<string, number>();
  const vote = (endpoint: string, side: number): void => { votes.set(endpoint, (votes.get(endpoint) ?? 0) + side); };
  for (const p of plans) {
    if (p.type === 'note-anchor') continue;
    for (const [self, other, isSource] of [[p.source, p.target, true], [p.target, p.source, false]] as const) {
      if (!portOwner.has(self)) continue;
      const inward = inside(ownerNode(other), portOwner.get(self)!);
      vote(self, (isSource !== inward) ? 2 : -2);
    }
  }
  // Connectors outweigh unconnected lollipops and sockets, which can sit on either side.
  for (const a of graph.assemblies) { vote(a.requirer, 2); vote(a.provider, -2); }
  for (const [, { owner, stub, port }] of stubOwner) if (port) vote(owner, stub.kind === 'required' ? 1 : -1);
  const portSide = (port: string): Side => (votes.get(port) ?? 0) > 0 ? 'EAST' : 'WEST';
  /** Side of the border a stub's stem leaves from. */
  const stubSide = (stubId: string): Side => {
    const { owner, stub, port } = stubOwner.get(stubId)!;
    return port ? portSide(owner) : stub.kind === 'required' ? 'EAST' : 'WEST';
  };

  // Symbol nodes (lollipops, sockets, joints) live in the container of their owner.
  interface SymbolPlan { id: string; kind: 'ball' | 'socket' | 'joint'; container: string | undefined; name: string; nameWidth: number; side: Side; size: { width: number; height: number } }
  const symbolPlans: SymbolPlan[] = [];
  for (const [id, { owner, stub }] of stubOwner) {
    const kind = stub.kind === 'provided' ? 'ball' : 'socket';
    const r = theme.size.ball, R = theme.size.socket;
    symbolPlans.push({ id, kind, container: info.get(ownerNode(owner))!.parent, name: stub.name, nameWidth: labelWidth(stub.name), side: stubSide(id), size: kind === 'ball' ? { width: 2 * r, height: 2 * r } : { width: R, height: 2 * R } });
  }
  for (const a of graph.assemblies) {
    const R = theme.size.socket;
    symbolPlans.push({ id: `${a.id}::joint`, kind: 'joint', container: commonParent(ownerNode(a.requirer), ownerNode(a.provider)), name: a.name, nameWidth: labelWidth(a.name), side: 'EAST', size: { width: 2 * R, height: 2 * R } });
  }
  /** Reserved box of a symbol and its name, and the symbol's center in it. */
  const symbolBox = (s: SymbolPlan) => {
    if (down) {
      const sw = s.size.height, sh = s.size.width;
      const width = s.nameWidth + LABEL_GAP + 2 + sw, height = Math.max(sh, lh);
      return { width, height, cx: width - sw / 2, cy: height / 2 };
    }
    const width = Math.max(s.size.width, s.nameWidth + 2), height = lh + LABEL_GAP + s.size.height;
    return { width, height, cx: width / 2, cy: lh + LABEL_GAP + s.size.height / 2 };
  };
  /** Extent of a symbol's box along its owner's side. */
  const symbolExtent = (name: string): number => down ? labelWidth(name) + LABEL_GAP + 2 + 2 * theme.size.socket + 10 : lh + LABEL_GAP + 2 * theme.size.socket + 10;

  // Stub stems and assembly halves as edge plans (semantic direction: owner -> symbol, requirer/provider -> joint).
  for (const s of symbolPlans) {
    if (s.kind === 'joint') continue;
    const { owner } = stubOwner.get(s.id)!;
    plans.push({ id: `${s.id}::stem`, type: s.kind === 'ball' ? 'provided-stem' : 'required-stem', source: owner, target: s.id, style: 'solid', sourceMarker: 'none', targetMarker: 'none', ends: [], symbol: s.id });
  }
  for (const a of graph.assemblies) {
    plans.push({ id: `${a.id}::required`, type: 'assembly-required', source: a.requirer, target: `${a.id}::joint`, style: 'solid', sourceMarker: 'none', targetMarker: 'none', ends: [], symbol: `${a.id}::joint` });
    plans.push({ id: `${a.id}::provided`, type: 'assembly-provided', source: a.provider, target: `${a.id}::joint`, style: 'solid', sourceMarker: 'none', targetMarker: 'none', ends: [], symbol: `${a.id}::joint` });
  }
  // Stems and assemblies at a node without a port leave from an invisible, side-fixed anchor port.
  const anchors = new Map<string, LayoutPort[]>();
  const anchorOf = new Map<string, string>();
  const addAnchor = (plan: string, node: string, side: Side, name: string): void => {
    const id = `${plan}::anchor`;
    anchors.set(node, [...(anchors.get(node) ?? []), { id, side: S(side), width: symbolExtent(name) }]);
    anchorOf.set(plan, id);
  };
  for (const [id, { owner, stub, port }] of stubOwner) if (!port) addAnchor(`${id}::stem`, owner, stub.kind === 'required' ? 'EAST' : 'WEST', stub.name);
  // Ends with a marker or labels at a node (not a port) get a side-fixed port as wide as
  // what is drawn beside the line there, so ELK keeps neighbouring ends far enough apart.
  const endPorts = new Map<string, string>();
  // Lines meet an ellipse where it touches its bounding box: the middle of its left or right side.
  const ellipsePorts = new Set<string>();
  for (const p of plans) {
    if (p.symbol !== undefined) continue;
    for (const end of ['source', 'target'] as const) {
      const endpoint = end === 'source' ? p.source : p.target;
      if (info.get(endpoint)?.node.shape !== 'ellipse') continue;
      const elkSource = (end === 'source') !== (p.type === 'note-anchor');
      const side: Side = elkSource ? 'EAST' : 'WEST';
      const id = `${endpoint}::${side.toLowerCase()}`;
      if (!ellipsePorts.has(id)) {
        ellipsePorts.add(id);
        anchors.set(endpoint, [...(anchors.get(endpoint) ?? []), { id, side: S(side), width: 0 }]);
      }
      endPorts.set(`${p.id}\u0000${end}`, id);
    }
  }
  for (const p of plans) {
    if (p.symbol !== undefined || p.type === 'note-anchor') continue;
    if (inside(ownerNode(p.source), ownerNode(p.target)) || inside(ownerNode(p.target), ownerNode(p.source))) continue;
    for (const end of ['source', 'target'] as const) {
      const endpoint = end === 'source' ? p.source : p.target;
      if (portOwner.has(endpoint) || info.get(endpoint)?.isolatedRoot !== undefined || endPorts.has(`${p.id}\u0000${end}`)) continue;
      // Top to bottom, ELK 0.11 fails on fixed-side ports of a container with lines
      // crossing its border (TypeError in the hierarchical port placement): such ends
      // attach to the container itself, whose port spacing keeps them apart.
      if (down && info.get(endpoint)?.node.children?.length) continue;
      const marker = markerExtent(end === 'source' ? p.sourceMarker : p.targetMarker);
      const labelled = p.ends.some(e => e.end === end);
      if (!marker.length && !labelled) continue;
      const id = `${p.id}::${end}-end`;
      const across = down ? Math.max(0, ...p.ends.filter(e => e.end === end).map(e => e.width)) : lh;
      const width = labelled ? 2 * (across + Math.max(marker.half, 4) + 2) : 2 * (marker.half + 5);
      anchors.set(endpoint, [...(anchors.get(endpoint) ?? []), { id, side: S(end === 'source' ? 'EAST' : 'WEST'), width }]);
      endPorts.set(`${p.id}\u0000${end}`, id);
    }
  }
  for (const a of graph.assemblies) {
    if (!portOwner.has(a.requirer)) addAnchor(`${a.id}::required`, a.requirer, 'EAST', a.name);
    if (!portOwner.has(a.provider)) addAnchor(`${a.id}::provided`, a.provider, 'WEST', a.name);
  }

  // ---- Measuring ----
  const boxes = new Map<string, MeasuredBox>(), noteRows = new Map<string, string[]>();
  const iconRoom = (n: StructNode): number => n.icon === 'component' ? theme.size.componentIcon.width + 10 : n.icon === 'artifact' ? theme.size.artifactIcon.width + 10 : 0;
  const headerWidth = (n: StructNode): number => Math.max(0, ...n.header.map(l => Math.min(metrics.measure(l.text, l.style), l.wrap ?? Infinity)));
  const measureHeader = (n: StructNode, rest: Compartment[]): MeasuredBox => {
    const icon = iconRoom(n);
    const min = Math.max(theme.size.minNodeWidth, icon ? Math.ceil(headerWidth(n)) + 2 * icon + 2 * 4 : 0);
    return measureBox(metrics, [{ header: true, lines: n.header }, ...rest], min);
  };

  // Port extents along their side: room for the square, its name above or below the
  // stem, and the symbols in front of it (so stems can stay straight).
  const portExtent = (portId: string): number => {
    const label = portLabel.get(portId);
    const base = label ? portSize + 2 * ((down ? labelWidth(label) : lh) + LABEL_GAP) : portSize + 12;
    const names = [
      ...symbolPlans.filter(s => s.kind !== 'joint' && stubOwner.get(s.id)!.owner === portId).map(s => s.name),
      ...graph.assemblies.filter(a => a.requirer === portId || a.provider === portId).map(a => a.name),
    ];
    return Math.max(base, names.reduce((sum, name) => sum + symbolExtent(name), 0));
  };

  // ---- One ELK run ----
  const isolated = (n: StructNode): boolean => n.shape === 'ellipse' && !!n.children?.length;

  /** Note anchors ELK could not lay out (see runLevel); repairRoutes routes them. */
  const unrouted = new Set<string>();
  const runLevel = async (roots: readonly StructNode[], rootContainer: string | undefined): Promise<Level> => {
    const ellipses = new Map<string, { textTop: number; separatorY?: number }>();
    const memberOf = (id: string): string | undefined => info.get(ownerNode(id))?.isolatedRoot;
    const symbolLevel = (s: SymbolPlan): string | undefined => s.container === undefined ? undefined : (isolated(info.get(s.container)!.node) ? s.container : info.get(s.container)!.isolatedRoot);
    const levelSymbols = symbolPlans.filter(s => symbolLevel(s) === rootContainer);
    const symbolIds = new Set(levelSymbols.map(s => s.id));
    // Endpoints inside an isolated sub-layout are drawn there; from outside they attach to its ellipse.
    const lift = (endpoint: string): string => {
      if (memberOf(endpoint) === rootContainer) return endpoint;
      return [...ancestors(ownerNode(endpoint))].reverse().find(id => isolated(info.get(id)!.node)) ?? endpoint;
    };
    const levelPlans = plans.filter(p => {
      if (p.symbol !== undefined) return symbolIds.has(p.symbol);
      const a = memberOf(p.source), b = memberOf(p.target);
      if (a === rootContainer && b === rootContainer) return true;
      return rootContainer === undefined && a !== b && lift(p.source) !== lift(p.target);
    });

    // Sub-layouts first.
    const subLevels = new Map<string, Level>();
    const walk = async (nodes: readonly StructNode[]): Promise<void> => {
      for (const n of nodes) {
        if (isolated(n)) subLevels.set(n.id, await runLevel(n.children!, n.id));
        else if (n.children?.length) await walk(n.children);
      }
    };
    await walk(roots);

    const symbolChildren = new Map<string | undefined, SymbolPlan[]>();
    for (const s of levelSymbols) symbolChildren.set(s.container, [...(symbolChildren.get(s.container) ?? []), s]);

    const ellipseGeometry = new Map<string, { width: number; height: number; inner: Point; textTop: number; separatorY?: number }>();
    const build = (n: StructNode): LayoutNode => {
      const ports: LayoutPort[] = (n.ports ?? []).map(p => ({ id: p.id, side: S(portSide(p.id)), width: portExtent(p.id) }));
      ports.push(...anchors.get(n.id) ?? []);
      if (n.shape === 'note') {
        const note = measureNote(metrics, n.noteText ?? '');
        noteRows.set(n.id, note.rows);
        return { id: n.id, width: note.width, height: note.height };
      }
      if (n.shape === 'ellipse') {
        const box = measureBox(metrics, [{ header: false, lines: n.header }], 0);
        boxes.set(n.id, box);
        const textWidth = box.width, textHeight = box.height;
        if (isolated(n)) {
          const sub = subLevels.get(n.id)!;
          const W = Math.max(sub.width, textWidth), H = textHeight + 12 + sub.height;
          const width = Math.ceil(W * Math.SQRT2 + 24), height = Math.ceil(H * Math.SQRT2 + 24);
          const top = (height - H) / 2;
          ellipseGeometry.set(n.id, { width, height, inner: { x: (width - sub.width) / 2, y: top + textHeight + 12 }, textTop: top, separatorY: top + textHeight + 6 });
          return { id: n.id, width, height, ...(ports.length ? { ports } : {}) };
        }
        const width = Math.ceil(textWidth * Math.SQRT2 + 12), height = Math.ceil(textHeight * Math.SQRT2 + 12);
        ellipseGeometry.set(n.id, { width, height, inner: { x: 0, y: 0 }, textTop: (height - textHeight) / 2 });
        return { id: n.id, width, height, ...(ports.length ? { ports } : {}) };
      }
      const extraDepth = n.shape === 'node3d' ? depth : 0;
      const symbols = symbolChildren.get(n.id) ?? [];
      if (n.children?.length || symbols.length) {
        const header = measureHeader(n, []);
        boxes.set(n.id, n.shape === 'box' ? measureHeader(n, [{ lines: [] }]) : header);
        const sides = new Set(ports.map(p => p.side));
        const children = [...(n.children ?? []).map(build), ...symbols.map(buildSymbol)];
        return {
          id: n.id, width: header.width + extraDepth, height: header.height + extraDepth + 40, children, minimumSize: true,
          // Lines crossing the border keep the same distance as parallel lines.
          portSpacing: theme.spacing.edgeEdge,
          padding: {
            top: header.height + extraDepth + PAD.belowHeader + (sides.has('NORTH') ? PAD.portSide - PAD.side : 0), bottom: sides.has('SOUTH') ? PAD.portSide : PAD.bottom,
            left: sides.has('WEST') ? PAD.portSide : PAD.side, right: (sides.has('EAST') ? PAD.portSide : PAD.side) + extraDepth,
          },
          ...(ports.length ? { ports } : {}),
        };
      }
      const box = measureHeader(n, (n.compartments ?? []).map(lines => ({ lines })));
      boxes.set(n.id, box);
      return { id: n.id, width: box.width + extraDepth, height: box.height + extraDepth, ...(ports.length ? { ports } : {}) };
    };
    const buildSymbol = (s: SymbolPlan): LayoutNode => {
      const { width, height, cx, cy } = symbolBox(s);
      // Where a line meets the box on a logical side: the middle of that side, on the symbol's axis.
      const point = (side: Side): Point => down ? { x: cx, y: side === 'WEST' ? 0 : height } : { x: side === 'WEST' ? 0 : width, y: cy };
      const ports: LayoutPort[] = s.kind === 'joint'
        ? [{ id: `${s.id}::in`, side: S('WEST'), position: point('WEST') }, { id: `${s.id}::out`, side: S('EAST'), position: point('EAST') }]
        : s.side === 'WEST' ? [{ id: `${s.id}::port`, side: S('EAST'), position: point('EAST') }] : [{ id: `${s.id}::port`, side: S('WEST'), position: point('WEST') }];
      return { id: s.id, width, height, ports };
    };

    const elkNodes = [...roots.map(build), ...(symbolChildren.get(rootContainer) ?? []).map(buildSymbol)];
    const symbolById = new Map(levelSymbols.map(s => [s.id, s]));
    const elkEdges: LayoutEdge[] = [];
    // ELK edge orientation follows the left-to-right convention; routes are flipped back afterwards.
    const reversed = new Set<string>();
    // A port's name gets room reserved at the port end of its first outward line.
    const reservedPorts = new Set<string>();
    const portLabelFor = (endpoint: string, other: string, elkSource: boolean): LayoutLabel[] => {
      const text = portLabel.get(endpoint);
      if (text === undefined || reservedPorts.has(endpoint) || inside(ownerNode(other), portOwner.get(endpoint)!)) return [];
      reservedPorts.add(endpoint);
      return [{ id: `${endpoint}::label`, width: labelWidth(text) + 4, height: lh, placement: elkSource ? 'tail' : 'head' }];
    };
    for (const p of levelPlans) {
      const source = lift(p.source), target = lift(p.target);
      const symbol = p.symbol === undefined ? undefined : symbolById.get(p.symbol);
      if (symbol) {
        // Owner side: the UML port, or the anchor port on a node without one.
        const owner = anchorOf.get(p.id) ?? source;
        const ownerIsSource = symbol.kind === 'joint' ? p.id.endsWith('::required') : symbol.side !== 'WEST';
        const labels = portLabelFor(source, symbol.id, ownerIsSource);
        const far = symbol.kind === 'joint' ? `${symbol.id}::${ownerIsSource ? 'in' : 'out'}` : `${symbol.id}::port`;
        if (ownerIsSource) elkEdges.push({ id: p.id, source: owner, target: far, labels, straightness: STRAIGHT });
        else { elkEdges.push({ id: p.id, source: far, target: owner, labels, straightness: STRAIGHT }); reversed.add(p.id); }
        continue;
      }
      const labels: LayoutLabel[] = [];
      if (p.center) labels.push({ id: `${p.id}::center`, width: Math.max(...p.center.widths) + 4, height: p.center.lines.length * lh, placement: 'center' });
      p.ends.forEach((e, k) => labels.push({ id: `${p.id}::end${k}`, width: e.width + 4, height: lh, placement: e.end === 'source' ? 'tail' : 'head' }));
      // Notes follow what they annotate, so they never push a connector chain apart.
      if (p.type === 'note-anchor') {
        elkEdges.push({ id: p.id, source: target === p.target ? endPorts.get(`${p.id}\u0000target`) ?? target : target, target: source });
        reversed.add(p.id);
        continue;
      }
      if (portOwner.has(source)) labels.push(...portLabelFor(source, target, true));
      if (portOwner.has(target)) labels.push(...portLabelFor(target, source, false));
      const lifted = source !== p.source || target !== p.target;
      elkEdges.push({
        id: p.id, labels,
        source: lifted ? source : endPorts.get(`${p.id}\u0000source`) ?? source,
        target: lifted ? target : endPorts.get(`${p.id}\u0000target`) ?? target,
      });
    }

    const options = { direction: dir, nodeSpacing: NODE_SPACING, layerSpacing: LAYER_SPACING, ...(rootContainer === undefined ? { elk: LAYOUT_VARIANTS[variant] } : {}) };
    // ELK 0.11 fails on some hierarchy-crossing lines (a note anchor or role binding into
    // a nested part, with many ports on a container, top to bottom): lay out without
    // the hierarchy-crossing anchors and bindings then; repairRoutes routes them.
    let result: Awaited<ReturnType<typeof layout>>;
    try { result = await layout(elkNodes, elkEdges, options); }
    catch {
      const parentOf = (id: string) => info.get(ownerNode(lift(id)))?.parent;
      const anchorIds = new Set(levelPlans.filter(p => p.symbol === undefined && p.sourceMarker === 'none' && p.targetMarker === 'none' && p.style === 'dashed' && parentOf(p.source) !== parentOf(p.target)).map(p => p.id));
      result = await layout(elkNodes, elkEdges.filter(e => !anchorIds.has(e.id)), options);
    }

    const rects = new Map<string, Rect>();
    for (const [id, r] of result.nodes) if (info.has(id)) rects.set(id, r);

    // Ellipse sub-layouts move into their ellipse.
    const symbols: PlacedSymbol[] = [];
    const routes = new Map<string, Point[]>(), suggestions = new Map<string, Rect>();
    const fixedLabels: Level['fixedLabels'] = [];
    for (const [id, g] of ellipseGeometry) {
      const r = rects.get(id)!;
      ellipses.set(id, { textTop: r.y + g.textTop, ...(g.separatorY !== undefined ? { separatorY: r.y + g.separatorY } : {}) });
      const sub = subLevels.get(id);
      if (!sub) continue;
      const d = { x: r.x + g.inner.x, y: r.y + g.inner.y };
      for (const [k, v] of sub.rects) rects.set(k, translateRect(v, d));
      for (const s of sub.symbols) symbols.push({ ...s, bounds: translateRect(s.bounds, d), center: translatePoint(s.center, d) });
      for (const [k, v] of sub.routes) routes.set(k, v.map(p => translatePoint(p, d)));
      for (const [k, v] of sub.suggestions) suggestions.set(k, translateRect(v, d));
      for (const l of sub.fixedLabels) fixedLabels.push({ ...l, rect: translateRect(l.rect, d) });
      for (const [k, v] of sub.ellipses) ellipses.set(k, { textTop: v.textTop + d.y, ...(v.separatorY !== undefined ? { separatorY: v.separatorY + d.y } : {}) });
    }

    // UML ports: squares centered on the border point ELK chose.
    const half = portSize / 2;
    // Ports with no line at all keep the document order along their side: they take
    // the places ELK gave them, sorted (top to bottom, or left to right).
    const connected = new Set(plans.flatMap(p => [p.source, p.target]));
    for (const [, s] of stubOwner) connected.add(s.owner);
    for (const a of graph.assemblies) connected.add(a.requirer).add(a.provider);
    const centers = new Map<string, Point>();
    for (const [portId] of portOwner) { const c = result.ports.get(portId); if (c) centers.set(portId, c); }
    const groups = new Map<string, string[]>();
    for (const [portId, owner] of portOwner) {
      const c = centers.get(portId), r = result.nodes.get(owner);
      if (!c || !r || connected.has(portId)) continue;
      const d = [Math.abs(c.x - r.x - r.width), Math.abs(c.y - r.y - r.height), Math.abs(c.x - r.x), Math.abs(c.y - r.y)];
      const key = `${owner}\u0000${d.indexOf(Math.min(...d))}`;
      groups.set(key, [...(groups.get(key) ?? []), portId]);
    }
    for (const ids of groups.values()) {
      const slots = ids.map(id => centers.get(id)!).sort((a, b) => (a.y - b.y) || (a.x - b.x));
      ids.forEach((id, k) => centers.set(id, slots[k]!));
    }
    for (const [portId, owner] of portOwner) {
      const c = centers.get(portId);
      if (!c) continue;
      symbols.push({ id: portId, kind: 'port', center: c, bounds: { x: c.x - half, y: c.y - half, width: portSize, height: portSize }, parent: owner });
    }
    // Interface symbols inside their reserved node: name on top, symbol below.
    for (const s of levelSymbols) {
      const r = result.nodes.get(s.id)!;
      const { cx, cy } = symbolBox(s);
      const c = { x: r.x + cx, y: r.y + cy };
      // The name sits above the symbol (lines run left to right) or left of it (top to bottom).
      const nameRect = down ? { x: r.x, y: c.y - lh / 2, width: s.nameWidth, height: lh } : { x: r.x + (r.width - s.nameWidth) / 2, y: r.y, width: s.nameWidth, height: lh };
      fixedLabels.push({ id: `${s.id}::name`, owner: s.id, text: s.name, width: s.nameWidth, rect: nameRect });
      if (s.kind === 'ball') {
        symbols.push({ id: s.id, kind: 'ball', center: c, bounds: ballBounds(c), parent: s.container });
      } else if (s.kind === 'socket') {
        const sign = s.side === 'WEST' ? -1 : 1;
        const u = at(sign, 0);
        const R = theme.size.socket;
        // Center the half circle's bounding box in the node.
        const center = at(c[main] + sign * R / 2, c[cross]);
        symbols.push({ id: s.id, kind: 'socket', center, u, bounds: socketBounds(center, u), parent: s.container });
      } else {
        const R = theme.size.socket;
        symbols.push({ id: s.id, kind: 'joint', center: c, u: at(1, 0), bounds: { x: c.x - R, y: c.y - R, width: 2 * R, height: 2 * R }, parent: s.container });
      }
    }
    const symbolOf = new Map(symbols.map(s => [s.id, s]));

    for (const p of levelPlans) {
      const edge = result.edges.get(p.id);
      if (!edge && rects.has(lift(p.source)) && rects.has(lift(p.target)) && !portOwner.has(p.source) && !portOwner.has(p.target)) {
        // Left out of the ELK run: a provisional route, which repairRoutes replaces.
        routes.set(p.id, provisionalRoute(rects.get(lift(p.source))!, rects.get(lift(p.target))!));
        unrouted.add(p.id);
        continue;
      }
      if (!edge) continue;
      let points = reversed.has(p.id) ? [...edge.points].reverse() : [...edge.points];
      for (const [k, v] of edge.labels) suggestions.set(k, v);
      // Ends at UML ports stop at the square's border, not its center.
      const trim = (pts: Point[], endpoint: string): Point[] => {
        if (!portOwner.has(endpoint) || pts.length < 2) return pts;
        const last = pts.at(-1)!, prev = pts.at(-2)!;
        const u = direction(prev, last);
        const by = Math.min(half, distance(prev, last) - 1);
        return [...pts.slice(0, -1), { x: last.x - u.x * by, y: last.y - u.y * by }];
      };
      // Ends at interface symbols reach the symbol itself.
      const reach = (pts: Point[], endpoint: string): Point[] => {
        const s = symbolOf.get(endpoint);
        if (!s || s.kind === 'port' || pts.length < 2) return pts;
        const last = pts.at(-1)!;
        let v = last[main];
        if (s.kind === 'ball') v = s.center[main] + (last[main] < s.center[main] ? -1 : 1) * theme.size.ball;
        else if (s.kind === 'socket') v = s.center[main] - s.u![main] * theme.size.socket;
        else v = s.center[main] + (p.id.endsWith('::required') ? -1 : 1) * theme.size.socket;
        const w = s.center[cross];
        const prev = pts.at(-2)!;
        const out = [...pts.slice(0, -1)];
        if (Math.abs(prev[cross] - w) > 0.01 && Math.abs(prev[main] - last[main]) < 0.01) out[out.length - 1] = at(prev[main], w);
        out.push(at(v, w));
        return out;
      };
      points = trim(points, p.target);
      points = [...trim([...points].reverse(), p.source)].reverse();
      points = reach(points, p.target);
      routes.set(p.id, simplify(points));
    }

    // Straighten stems and assembly lines that ELK gave a small jog: slide an
    // invisible anchor along its node's side, or move the symbol (with its name)
    // onto the line of its port, when nothing is in the way.
    const isJog = (r: readonly Point[] | undefined): r is Point[] => !!r && r.length === 4 &&
      Math.abs(r[0]![cross] - r[1]![cross]) < 0.01 && Math.abs(r[1]![main] - r[2]![main]) < 0.01 && Math.abs(r[2]![cross] - r[3]![cross]) < 0.01;
    const leafRects = [...rects].filter(([id]) => !info.get(id)!.node.children?.length).map(([id, r]) => ({ id, r }));
    const free = (box: Rect, ignore: ReadonlySet<string>, ignoreRoutes: ReadonlySet<string>): boolean => {
      if (leafRects.some(({ id, r }) => !ignore.has(id) && overlaps(inflate(box, 2), r))) return false;
      if (symbols.some(s => !ignore.has(s.id) && overlaps(inflate(box, 2), s.bounds))) return false;
      if (fixedLabels.some(l => !ignore.has(l.owner) && overlaps(inflate(box, 2), l.rect))) return false;
      for (const [id, route] of routes) {
        if (ignoreRoutes.has(id)) continue;
        for (let k = 1; k < route.length; k++) if (segmentIntersectsRect(route[k - 1]!, route[k]!, inflate(box, 2))) return false;
      }
      return true;
    };
    const segmentBox = (a: Point, b: Point): Rect => down
      ? { x: Math.min(a.x, b.x) - 1, y: Math.min(a.y, b.y), width: 2, height: Math.abs(a.y - b.y) }
      : { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) - 1, width: Math.abs(a.x - b.x), height: 2 };
    for (const s of levelSymbols) {
      const symbol = symbols.find(x => x.id === s.id)!;
      const planIds = s.kind === 'joint' ? [`${s.id.slice(0, -'::joint'.length)}::required`, `${s.id.slice(0, -'::joint'.length)}::provided`] : [`${s.id}::stem`];
      const own = new Set(planIds);
      // Lines from UML ports fix the height; anchors (no port square) slide along their node's side.
      const lines = planIds.map(id => routes.get(id));
      if (!lines.every(Boolean) || !lines.some(isJog)) continue;
      const sources = planIds.map(id => plans.find(p => p.id === id)!.source);
      const ends = new Set([s.id, ...sources, ...sources.map(ownerNode)]);
      const label = fixedLabels.find(l => l.owner === s.id)!;
      /** Puts the symbol at cross coordinate y and makes the selected lines straight; false if blocked. */
      const attempt = (y: number, straighten: readonly boolean[]): boolean => {
        const ok = planIds.every((id, k) => {
          if (!straighten[k]) return true;
          if (!anchorOf.has(id)) return Math.abs(lines[k]![0]![cross] - y) < 0.01;
          const node = rects.get(ownerNode(sources[k]!))!;
          const lo = down ? node.x : node.y, size = down ? node.width : node.height;
          return y >= lo + 10 && y <= lo + size - 10;
        });
        if (!ok) return false;
        const dy = y - symbol.center[cross];
        const shift = at(0, dy);
        const moved = { bounds: translateRect(symbol.bounds, shift), label: translateRect(label.rect, shift) };
        if (Math.abs(dy) > 0.01) {
          if (straighten.some(x => !x)) return false;
          const container = s.container === undefined ? undefined : rects.get(s.container);
          if (container && !contains(container, union([moved.bounds, moved.label]))) return false;
          if (!free(union([moved.bounds, moved.label]), ends, own)) return false;
        }
        const next = lines.map((r, k) => straighten[k] ? [at(r![0]![main], y), at(r!.at(-1)![main], y)] : r!);
        if (!next.every((r, k) => !straighten[k] || free(segmentBox(r[0]!, r[1]!), ends, own))) return false;
        symbol.bounds = moved.bounds;
        symbol.center = at(symbol.center[main], y);
        label.rect = moved.label;
        planIds.forEach((id, k) => routes.set(id, next[k]!));
        return true;
      };
      // Lines from UML ports fix the height; anchors (no port square) slide along their node's side.
      const fixed = planIds.flatMap((id, k) => anchorOf.has(id) ? [] : [lines[k]![0]![cross]]);
      const all = planIds.map(() => true);
      if (!fixed.some(y => Math.abs(y - fixed[0]!) > 0.01) && attempt(fixed[0] ?? symbol.center[cross], all)) continue;
      // Otherwise keep the symbol and straighten the anchored lines only.
      attempt(symbol.center[cross], planIds.map((id, k) => anchorOf.has(id) && isJog(lines[k])));
    }

    return { width: result.width, height: result.height, rects, symbols, routes, suggestions, fixedLabels, ellipses };
  };

  const level = await runLevel(graph.nodes, undefined);
  const { rects, routes, suggestions, fixedLabels, ellipses } = level;
  const symbols = level.symbols;

  // ---- Route repair: lines over container names, through nodes, detours, crowded ends ----
  const symbolIds = new Set(symbols.map(x => x.id));
  const repairNodes: RepairNode[] = [];
  for (const [id, r] of rects) {
    const { node, parent } = info.get(id)!;
    const container = !!node.children?.length || symbols.some(x => x.kind !== 'port' && x.parent === id);
    const header = boxes.get(id)?.compartments[0];
    const texts: Rect[] = [];
    if (container && header && node.shape !== 'ellipse') {
      // The header text (keywords, name), centered at the top; lines may pass beside it.
      const width = Math.max(0, ...header.lines.flatMap(l => l.widths));
      const top = r.y + (node.shape === 'node3d' ? depth : 0);
      texts.push({ x: r.x + (r.width - (node.shape === 'node3d' ? depth : 0) - width) / 2 - 4, y: top, width: width + 8, height: header.height });
    }
    repairNodes.push({ id, rect: r, parent, container, texts });
  }
  for (const x of symbols) {
    const name = fixedLabels.find(l => l.owner === x.id);
    repairNodes.push({ id: x.id, rect: x.bounds, parent: x.parent, texts: name ? [name.rect] : [] });
  }
  // A port on the top border must not sit on the container's centered name (ELK
  // ignores port alignment on compound nodes): slide it, and its lines, beside the name.
  for (const x of symbols) {
    if (x.kind !== 'port' || x.parent === undefined) continue;
    const owner = rects.get(x.parent)!, text = repairNodes.find(n => n.id === x.parent)?.texts?.[0];
    if (!text || Math.abs(x.center.y - owner.y) > 0.5 || x.center.x < text.x - portSize || x.center.x > text.x + text.width + portSize) continue;
    // Beside the name on the side the port is nearer to, clear of the icon in the top-right corner.
    const right = text.x + text.width + portSize + 4, left = text.x - portSize - 4;
    const rightFits = right + portSize / 2 <= owner.x + owner.width - ICON_ROOM, leftFits = left - portSize / 2 >= owner.x + 4;
    const preferRight = x.center.x >= text.x + text.width / 2;
    const to = (preferRight && rightFits) || !leftFits ? right : left;
    if (!(to === right ? rightFits : leftFits)) continue;
    const dx = to - x.center.x;
    const headerBottom = text.y + text.height;
    /** The route from the port with its first (vertical) segment moved by dx: a jog below the name inside, halfway outside. */
    const shifted = (route: readonly Point[]): Point[] => {
      const r = route.map(q => ({ ...q }));
      const [a, b] = [r[0]!, r[1]!];
      if (Math.abs(a.x - b.x) > 0.5) { r[0] = { x: a.x + dx, y: a.y }; return r; }
      const inward = b.y > a.y;
      const y = inward ? Math.min(headerBottom + 4, (a.y + b.y) / 2) : (a.y + b.y) / 2;
      return simplify([{ x: a.x + dx, y: a.y }, { x: a.x + dx, y }, { x: a.x, y }, ...r.slice(1)]);
    };
    // Lollipops and sockets of the port move with it, so their stems stay straight.
    const stubs = symbols.filter(y => y.kind !== 'port' && stubOwner.get(y.id)?.owner === x.id);
    x.center = { x: to, y: x.center.y };
    x.bounds = translateRect(x.bounds, { x: dx, y: 0 });
    for (const s of stubs) {
      s.center = translatePoint(s.center, { x: dx, y: 0 });
      s.bounds = translateRect(s.bounds, { x: dx, y: 0 });
      for (const l of fixedLabels) if (l.owner === s.id) l.rect = translateRect(l.rect, { x: dx, y: 0 });
      const route = routes.get(`${s.id}::stem`);
      if (route) routes.set(`${s.id}::stem`, route.map(q => translatePoint(q, { x: dx, y: 0 })));
      const n = repairNodes.find(m => m.id === s.id);
      if (n) { n.rect = s.bounds; n.texts = fixedLabels.filter(l => l.owner === s.id).map(l => l.rect); }
    }
    const node = repairNodes.find(n => n.id === x.id);
    if (node) node.rect = x.bounds;
    for (const p of plans) {
      const route = routes.get(p.id);
      if (!route || stubs.some(s => p.id === `${s.id}::stem`)) continue;
      if (p.source === x.id) routes.set(p.id, shifted(route));
      else if (p.target === x.id) routes.set(p.id, shifted([...route].reverse()).reverse());
    }
  }
  // Two notes side by side whose anchors cross trade places (ELK orders notes by the
  // model, and a hierarchy-crossing anchor often meets its container's border on the
  // far side); their anchors are then routed afresh.
  const noteIds = [...rects.keys()].filter(id => info.get(id)!.node.shape === 'note');
  const anchorRoutes = (note: string): Point[][] => plans.filter(p => p.type === 'note-anchor' && p.source === note && routes.has(p.id)).map(p => routes.get(p.id)!);
  for (const [i, a] of noteIds.entries()) {
    for (const b of noteIds.slice(i + 1)) {
      if (info.get(a)!.parent !== info.get(b)!.parent) continue;
      const ra = rects.get(a)!, rb = rects.get(b)!;
      const together = [...anchorRoutes(a), ...anchorRoutes(b)];
      if (!together.length || countCrossings(together) === 0) continue;
      // Same column (one above the other) or same row: swap along that axis.
      const column = Math.min(ra.x + ra.width, rb.x + rb.width) > Math.max(ra.x, rb.x);
      const [first, second] = column ? (ra.y < rb.y ? [ra, rb] : [rb, ra]) : (ra.x < rb.x ? [ra, rb] : [rb, ra]);
      const gap = column ? second.y - first.y - first.height : second.x - first.x - first.width;
      if (gap < 0) continue;
      const movedSecond = column ? { ...second, y: first.y } : { ...second, x: first.x };
      const movedFirst = column ? { ...first, y: first.y + second.height + gap } : { ...first, x: first.x + second.width + gap };
      const others = [...rects].filter(([id]) => id !== a && id !== b && !info.get(id)!.node.children?.length).map(([, r]) => r);
      if ([movedFirst, movedSecond].some(r => others.some(o => overlaps(inflate(r, 4), o)) || symbols.some(s => overlaps(inflate(r, 4), s.bounds)))) continue;
      const firstId = first === ra ? a : b, secondId = first === ra ? b : a;
      rects.set(firstId, movedFirst);
      rects.set(secondId, movedSecond);
      for (const n of repairNodes) if (n.id === firstId) n.rect = movedFirst; else if (n.id === secondId) n.rect = movedSecond;
      for (const p of plans) {
        if (p.type !== 'note-anchor' || (p.source !== a && p.source !== b) || !routes.has(p.id)) continue;
        const r = rects.get(p.source)!, t = rects.get(p.target) ?? symbols.find(s => s.id === p.target)?.bounds;
        if (!t) continue;
        routes.set(p.id, provisionalRoute(r, t));
        unrouted.add(p.id);
      }
    }
  }
  // Ports, interface symbols and ellipses keep their attachment points (and directions).
  const pinned = (id: string): boolean => symbolIds.has(id) || info.get(id)?.node.shape === 'ellipse';
  const repaired = repairRoutes(repairNodes, plans.filter(p => routes.has(p.id)).map(p => ({
    id: p.id, source: p.source, target: p.target, route: routes.get(p.id)!, sourceMarker: p.sourceMarker, targetMarker: p.targetMarker,
    fixedSource: pinned(p.source), fixedTarget: pinned(p.target),
  })), { keep: new Set(plans.filter(p => p.symbol !== undefined).map(p => p.id)), force: unrouted, junctions: true });
  for (const id of repaired.changed) { routes.set(id, repaired.routes.get(id)!); for (const key of [...suggestions.keys()]) if (key.startsWith(`${id}::`)) suggestions.delete(key); }
  straightenZigZags();

  /**
   * A line between two nodes side by side that zig-zags (out, across, in) because
   * ELK attached it at different heights becomes one straight segment when one of
   * its ends can slide along its node's side: within the side, clear of other ends,
   * nodes, container texts and lines, and without adding crossings.
   */
  function straightenZigZags(): void {
    const nodeRect = (id: string): Rect | undefined => pinned(id) || portOwner.has(id) ? undefined : rects.get(id);
    const texts = repairNodes.flatMap(n => n.texts ?? []);
    for (const p of plans) {
      const r = routes.get(p.id);
      if (!r || r.length < 4 || p.symbol !== undefined) continue;
      const n = r.length;
      // Both end segments along one axis, and the route never turns back along it.
      const monotone = (axis: 'x' | 'y'): boolean => {
        const steps = r.slice(1).map((q, i) => Math.sign(Math.round(q[axis] - r[i]![axis])));
        return !(steps.includes(1) && steps.includes(-1));
      };
      const horizontal = Math.abs(r[0]!.y - r[1]!.y) < 0.01 && Math.abs(r[n - 2]!.y - r[n - 1]!.y) < 0.01 && monotone('x');
      const vertical = Math.abs(r[0]!.x - r[1]!.x) < 0.01 && Math.abs(r[n - 2]!.x - r[n - 1]!.x) < 0.01 && monotone('y');
      if (!horizontal && !vertical) continue;
      const k = horizontal ? 'y' as const : 'x' as const;
      const others = plans.filter(o => o.id !== p.id && routes.has(o.id)).map(o => ({ o, route: routes.get(o.id)! }));
      const before = countCrossings([r, ...others.map(x => x.route)]);
      const related = new Set([...ancestors(ownerNode(p.source)), ...ancestors(ownerNode(p.target))]);
      for (const [moving, value] of [['target', r[0]![k]], ['source', r[n - 1]![k]]] as const) {
        const node = nodeRect(moving === 'source' ? p.source : p.target);
        if (!node) continue;
        const lo = k === 'y' ? node.y : node.x, size = k === 'y' ? node.height : node.width;
        if (value < lo + 10 || value > lo + size - 10) continue;
        const next = horizontal
          ? [{ x: r[0]!.x, y: value }, { x: r[n - 1]!.x, y: value }]
          : [{ x: value, y: r[0]!.y }, { x: value, y: r[n - 1]!.y }];
        const end = moving === 'source' ? next[0]! : next[1]!, endpoint = moving === 'source' ? p.source : p.target;
        const box = { x: Math.min(next[0]!.x, next[1]!.x), y: Math.min(next[0]!.y, next[1]!.y), width: Math.abs(next[0]!.x - next[1]!.x), height: Math.abs(next[0]!.y - next[1]!.y) };
        const blocked = [...rects].some(([id, rect]) => !related.has(id) && id !== ownerNode(p.source) && id !== ownerNode(p.target) && segmentIntersectsRect(next[0]!, next[1]!, inflate(rect, -1)))
          || symbols.some(s => s.id !== p.source && s.id !== p.target && segmentIntersectsRect(next[0]!, next[1]!, inflate(s.bounds, 2)))
          || texts.some(t => segmentIntersectsRect(next[0]!, next[1]!, t))
          || others.some(({ route }) => route.slice(1).some((q, i) => {
            const a = route[i]!;
            // Running along another line closer than the line spacing.
            const parallel = horizontal ? Math.abs(a.y - q.y) < 0.01 && Math.abs(a.y - value) < theme.spacing.edgeEdge : Math.abs(a.x - q.x) < 0.01 && Math.abs(a.x - value) < theme.spacing.edgeEdge;
            if (!parallel) return false;
            const [s0, s1] = horizontal ? [Math.min(a.x, q.x), Math.max(a.x, q.x)] : [Math.min(a.y, q.y), Math.max(a.y, q.y)];
            const [t0, t1] = horizontal ? [box.x, box.x + box.width] : [box.y, box.y + box.height];
            return Math.min(s1, t1) - Math.max(s0, t0) > 0;
          }))
          || others.some(({ o, route }) => [[o.source, route[0]!], [o.target, route.at(-1)!]].some(([n, q]) => n === endpoint && distance(q as Point, end) < theme.spacing.endEnd));
        if (blocked || countCrossings([next, ...others.map(x => x.route)]) > before) continue;
        routes.set(p.id, next);
        for (const key of [...suggestions.keys()]) if (key.startsWith(`${p.id}::`)) suggestions.delete(key);
        break;
      }
    }
  }

  // ---- Scene edges ----
  const sceneEdges: PlacedEdge[] = [];
  for (const p of plans) {
    const points = routes.get(p.id);
    if (!points) continue;
    sceneEdges.push({ id: p.id, type: p.type, source: p.source, target: p.target, points, style: p.style, sourceMarker: p.sourceMarker, targetMarker: p.targetMarker });
  }

  // ---- Labels ----
  const placedNodes: PlacedNode[] = [];
  const visit = (n: StructNode, parent: string | undefined): void => {
    const symbolsInside = symbols.some(s => s.kind !== 'port' && s.parent === n.id);
    const container = !!n.children?.length || symbolsInside;
    placedNodes.push({
      node: n, bounds: rects.get(n.id)!, parent, container,
      ...(boxes.has(n.id) ? { box: boxes.get(n.id)! } : {}),
      ...(noteRows.has(n.id) ? { noteRows: noteRows.get(n.id)! } : {}),
      ...(ellipses.has(n.id) ? { ellipse: ellipses.get(n.id)! } : {}),
    });
    for (const child of n.children ?? []) visit(child, n.id);
  };
  for (const n of graph.nodes) visit(n, undefined);

  const obstacles = { rects: [] as Rect[], segments: [] as [Point, Point][] };
  for (const pn of placedNodes) {
    const r = pn.bounds;
    if (!pn.container) { obstacles.rects.push(r); continue; }
    // Containers: their header and border are obstacles, their body is free room.
    const headerHeight = (pn.box?.compartments[0]?.height ?? 0) + (pn.node.shape === 'node3d' ? depth : 0);
    obstacles.rects.push({ x: r.x, y: r.y, width: r.width, height: pn.node.shape === 'ellipse' ? (pn.ellipse?.separatorY ?? r.y) - r.y : headerHeight });
    const corners = [{ x: r.x, y: r.y }, { x: r.x + r.width, y: r.y }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];
    corners.forEach((c, i) => obstacles.segments.push([c, corners[(i + 1) % 4]!]));
  }
  for (const s of symbols) obstacles.rects.push(s.bounds);
  for (const l of fixedLabels) obstacles.rects.push(l.rect);
  for (const edge of sceneEdges) {
    edge.points.slice(1).forEach((p, k) => obstacles.segments.push([edge.points[k]!, p]));
    for (const r of [markerRect(edge.points[0]!, edge.points[1]!, edge.sourceMarker), markerRect(edge.points.at(-1)!, edge.points.at(-2)!, edge.targetMarker)]) if (r) obstacles.rects.push(r);
  }

  const requests: LabelRequest[] = [];
  const meta = new Map<string, Omit<PlacedLabel, 'id' | 'rect' | 'style'>>();
  for (const p of plans) {
    const route = routes.get(p.id);
    if (!route) continue;
    p.ends.forEach((e, k) => {
      const id = `${p.id}::end${k}`;
      const marker = e.end === 'source' ? p.sourceMarker : p.targetMarker;
      const suggested = suggestions.get(id);
      requests.push({ id, width: e.width, height: lh, route, at: e.end, side: e.kind === 'multiplicity' ? 1 : -1, clearance: markerExtent(marker).half + 3, suggestion: suggested && { x: suggested.x + 2, y: suggested.y, width: e.width, height: lh } });
      meta.set(id, { owner: p.id, lines: [e.text], widths: [e.width], end: e.end, anchor: e.end === 'source' ? route[0]! : route.at(-1)! });
    });
  }
  // Port names: beside the port, outside the owner, above or below the line through it.
  for (const s of symbols) {
    if (s.kind !== 'port') continue;
    const text = portLabel.get(s.id);
    if (text === undefined) continue;
    const width = labelWidth(text), c = s.center, owner = rects.get(s.parent!)!;
    const vertical = Math.min(Math.abs(c.x - owner.x), Math.abs(c.x - owner.x - owner.width)) <= Math.min(Math.abs(c.y - owner.y), Math.abs(c.y - owner.y - owner.height));
    const out = vertical ? (Math.abs(c.x - owner.x) < Math.abs(c.x - (owner.x + owner.width)) ? -1 : 1) : (Math.abs(c.y - owner.y) < Math.abs(c.y - (owner.y + owner.height)) ? -1 : 1);
    const g = portSize / 2 + LABEL_GAP;
    const candidates: Rect[] = [];
    // The room ELK reserved at the port end of a line, if it is right next to the port.
    const reserved = suggestions.get(`${s.id}::label`);
    const near = (r: Rect): boolean => Math.hypot(Math.max(r.x - c.x, 0, c.x - (r.x + r.width)), Math.max(r.y - c.y, 0, c.y - (r.y + r.height))) - portSize / 2 <= 12;
    if (reserved && near({ x: reserved.x + 2, y: reserved.y, width, height: lh })) candidates.push({ x: reserved.x + 2, y: reserved.y, width, height: lh });
    for (const shift of [0, 6, 12]) {
      for (const side of [out, -out]) {
        if (vertical) {
          // Ports on a left or right border: beside the square, above or below the line through it.
          const x = side < 0 ? c.x - g - width - shift : c.x + g + shift;
          // Clear of the line, and further off when an arrowhead or diamond sits at the port.
          for (const off of [LABEL_GAP, LABEL_GAP + theme.size.diamond.halfWidth]) candidates.push({ x, y: c.y - off - lh, width, height: lh }, { x, y: c.y + off, width, height: lh });
        } else {
          // Ports on a top or bottom border: above or below the square, left or right of the line.
          const y = side < 0 ? c.y - g - lh - shift : c.y + g + shift;
          candidates.push({ x: c.x + LABEL_GAP + 1, y, width, height: lh }, { x: c.x - LABEL_GAP - 1 - width, y, width, height: lh });
        }
      }
    }
    // Above or below the square itself, as a last resort.
    if (vertical) candidates.push({ x: c.x - width / 2, y: c.y - portSize / 2 - LABEL_GAP - lh, width, height: lh }, { x: c.x - width / 2, y: c.y + portSize / 2 + LABEL_GAP, width, height: lh });
    else candidates.push({ x: c.x + portSize / 2 + LABEL_GAP, y: c.y - lh / 2, width, height: lh }, { x: c.x - portSize / 2 - LABEL_GAP - width, y: c.y - lh / 2, width, height: lh });
    requests.push({ id: `${s.id}::label`, width, height: lh, route: [c, c], at: 'center', candidates });
    meta.set(`${s.id}::label`, { owner: s.id, lines: [text], widths: [width] });
  }
  for (const p of plans) {
    if (!p.center) continue;
    const id = `${p.id}::center`;
    const width = Math.max(...p.center.widths), height = p.center.lines.length * lh;
    const suggested = suggestions.get(id);
    requests.push({ id, owner: p.id, width, height, route: routes.get(p.id)!, at: 'center', suggestion: suggested && { x: suggested.x + 2, y: suggested.y, width, height } });
    meta.set(id, { owner: p.id, lines: p.center.lines, widths: p.center.widths, ...(graph.edges.find(e => e.id === p.id)?.keyword !== undefined && p.center.lines.length > 1 ? { starts: [0, 1] } : {}) });
  }
  const labelledEnds = plans.flatMap(p => routes.has(p.id) ? [...new Set(p.ends.map(e => e.end))].map(end => end === 'source' ? routes.get(p.id)![0]! : routes.get(p.id)!.at(-1)!) : []);
  const placed = placeLabels(requests, { ...obstacles, ends: labelledEnds, lines: sceneEdges.map(e => ({ owner: e.id, points: e.points })) });
  const labels: PlacedLabel[] = [
    ...fixedLabels.map(l => ({ id: l.id, owner: l.owner, rect: l.rect, lines: [l.text], widths: [l.width], style: LABEL })),
    ...[...placed].map(([id, rect]) => {
      const binding = plans.find(p => id.startsWith(`${p.id}::end`))?.type === 'role-binding';
      return { id, rect, style: binding ? BINDING_LABEL : LABEL, ...(binding ? { fill: theme.color.mutedText } : {}), ...meta.get(id)! };
    }),
  ];

  // ---- Normalize into the canvas (inside the frame, if any) ----
  const content = union([
    ...placedNodes.map(n => n.bounds), ...symbols.map(s => s.bounds), ...labels.map(l => l.rect),
    ...obstacles.rects, ...sceneEdges.flatMap(e => e.points.map(p => ({ ...p, width: 0, height: 0 }))),
  ]);
  const margin = theme.spacing.canvas, pad = theme.spacing.frame;
  const heading = graph.title === undefined ? undefined : measureFrameHeading(metrics, graph.frameKeyword, graph.title);
  const originX = margin + (heading ? pad : 0), originY = margin + (heading ? heading.height + pad : 0);
  const d = { x: originX - content.x, y: originY - content.y };
  let width = originX + content.width + (heading ? pad : 0);
  const height = originY + content.height + (heading ? pad : 0);
  let frame: StructScene['frame'];
  if (heading) {
    const frameWidth = Math.max(width - margin, heading.width + pad);
    frame = { bounds: { x: margin, y: margin, width: frameWidth, height: height - margin }, title: graph.title!, keyword: graph.frameKeyword };
    width = margin + frameWidth;
  }
  return {
    kind: graph.kind,
    width: width + margin, height: height + margin,
    ...(frame ? { frame } : {}),
    nodes: placedNodes.map(n => ({
      ...n, bounds: translateRect(n.bounds, d),
      ...(n.ellipse ? { ellipse: { textTop: n.ellipse.textTop + d.y, ...(n.ellipse.separatorY !== undefined ? { separatorY: n.ellipse.separatorY + d.y } : {}) } } : {}),
    })),
    symbols: symbols.map(s => ({ ...s, bounds: translateRect(s.bounds, d), center: translatePoint(s.center, d) })),
    edges: sceneEdges.map(e => ({ ...e, points: e.points.map(p => translatePoint(p, d)) })),
    labels: labels.map(l => ({ ...l, rect: translateRect(l.rect, d), ...(l.anchor ? { anchor: translatePoint(l.anchor, d) } : {}) })),
  };
}

export type { StructAssembly };
