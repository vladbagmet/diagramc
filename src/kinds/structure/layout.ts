import { theme } from '../../core/theme.js';
import type { LineStyle, Marker } from '../../engine/edges.js';
import { layout, type LayoutEdge, type LayoutLabel, type LayoutNode, type LayoutPort, type Side } from '../../engine/elk.js';
import type { FontMetrics, TextStyle } from '../../engine/fonts.js';
import { contains, direction, distance, inflate, overlaps, segmentIntersectsRect, simplify, union, type Point, type Rect } from '../../engine/geometry.js';
import { placeLabels, type LabelRequest } from '../../engine/labels.js';
import { measureBox, measureFrameHeading, measureNote, type Compartment, type MeasuredBox } from '../../engine/shapes.js';
import { ballBounds, socketBounds } from '../../engine/symbols.js';
import { wrapText } from '../../engine/text.js';
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
const CENTER_LABEL_WIDTH = 180;
const NODE_SPACING = 30;
const LAYER_SPACING = 44;
const LABEL_GAP = 3;
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

export async function layoutStructure(graph: StructGraph, metrics: FontMetrics): Promise<StructScene> {
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
      ends: (e.ends ?? []).map(end => ({ ...end, width: labelWidth(end.text) })),
    };
  });
  for (const { note, target } of graph.anchors) {
    plans.push({ id: `${note}->${target}`, type: 'note-anchor', source: note, target, style: 'dashed', sourceMarker: 'none', targetMarker: 'none', ends: [] });
  }

  // ---- Port sides: provided faces left, required right; connectors vote ----
  const votes = new Map<string, number>();
  const vote = (endpoint: string, side: -1 | 1): void => { votes.set(endpoint, (votes.get(endpoint) ?? 0) + side); };
  for (const p of plans) {
    for (const [self, other, isSource] of [[p.source, p.target, true], [p.target, p.source, false]] as const) {
      if (!portOwner.has(self)) continue;
      const inward = inside(ownerNode(other), portOwner.get(self)!);
      vote(self, (isSource !== inward) ? 1 : -1);
    }
  }
  for (const a of graph.assemblies) { vote(a.requirer, 1); vote(a.provider, -1); }
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
  const symbolBox = (s: SymbolPlan) => {
    const width = Math.max(s.size.width, s.nameWidth + 2), height = lh + LABEL_GAP + s.size.height;
    return { width, height, cy: lh + LABEL_GAP + s.size.height / 2 };
  };

  // Stub stems and assembly halves as edge plans (semantic direction: owner -> symbol, requirer/provider -> joint).
  for (const s of symbolPlans) {
    if (s.kind === 'joint') continue;
    const { owner } = stubOwner.get(s.id)!;
    plans.push({ id: `${s.id}::stem`, type: s.kind === 'ball' ? 'provided-stem' : 'required-stem', source: owner, target: s.id, style: 'solid', sourceMarker: 'none', targetMarker: 'none', ends: [], symbol: s.id });
  }
  for (const a of graph.assemblies) {
    plans.push({ id: `${a.id}::required`, type: 'assembly', source: a.requirer, target: `${a.id}::joint`, style: 'solid', sourceMarker: 'none', targetMarker: 'none', ends: [], symbol: `${a.id}::joint` });
    plans.push({ id: `${a.id}::provided`, type: 'assembly', source: a.provider, target: `${a.id}::joint`, style: 'solid', sourceMarker: 'none', targetMarker: 'none', ends: [], symbol: `${a.id}::joint` });
  }
  // Stems and assemblies at a node without a port leave from an invisible, side-fixed anchor port.
  const anchors = new Map<string, LayoutPort[]>();
  const anchorOf = new Map<string, string>();
  const addAnchor = (plan: string, node: string, side: Side): void => {
    const id = `${plan}::anchor`;
    anchors.set(node, [...(anchors.get(node) ?? []), { id, side, width: lh + LABEL_GAP + 2 * theme.size.socket + 10 }]);
    anchorOf.set(plan, id);
  };
  for (const [id, { owner, stub, port }] of stubOwner) if (!port) addAnchor(`${id}::stem`, owner, stub.kind === 'required' ? 'EAST' : 'WEST');
  for (const a of graph.assemblies) {
    if (!portOwner.has(a.requirer)) addAnchor(`${a.id}::required`, a.requirer, 'EAST');
    if (!portOwner.has(a.provider)) addAnchor(`${a.id}::provided`, a.provider, 'WEST');
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
    const base = portLabel.get(portId) ? portSize + 2 * (lh + LABEL_GAP) : portSize + 12;
    const stubs = symbolPlans.filter(s => s.kind !== 'joint' && stubOwner.get(s.id)!.owner === portId);
    const joints = graph.assemblies.filter(a => a.requirer === portId || a.provider === portId).length;
    const symbols = stubs.length + joints;
    return Math.max(base, symbols * (lh + LABEL_GAP + 2 * theme.size.socket + 10));
  };

  // ---- One ELK run ----
  const isolated = (n: StructNode): boolean => n.shape === 'ellipse' && !!n.children?.length;

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
      const ports: LayoutPort[] = (n.ports ?? []).map(p => ({ id: p.id, side: portSide(p.id), width: portExtent(p.id) }));
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
          id: n.id, width: header.width + extraDepth, height: header.height + extraDepth + 40, children,
          padding: { top: header.height + extraDepth + PAD.belowHeader, bottom: PAD.bottom, left: sides.has('WEST') ? PAD.portSide : PAD.side, right: (sides.has('EAST') ? PAD.portSide : PAD.side) + extraDepth },
          ...(ports.length ? { ports } : {}),
        };
      }
      const box = measureHeader(n, (n.compartments ?? []).map(lines => ({ lines })));
      boxes.set(n.id, box);
      return { id: n.id, width: box.width + extraDepth, height: box.height + extraDepth, ...(ports.length ? { ports } : {}) };
    };
    const buildSymbol = (s: SymbolPlan): LayoutNode => {
      const { width, height, cy } = symbolBox(s);
      const ports: LayoutPort[] = s.kind === 'joint'
        ? [{ id: `${s.id}::in`, side: 'WEST', position: cy }, { id: `${s.id}::out`, side: 'EAST', position: cy }]
        : [{ id: `${s.id}::port`, side: s.side === 'WEST' ? 'EAST' : 'WEST', position: cy }];
      return { id: s.id, width, height, ports };
    };

    const elkNodes = [...roots.map(build), ...(symbolChildren.get(rootContainer) ?? []).map(buildSymbol)];
    const symbolById = new Map(levelSymbols.map(s => [s.id, s]));
    const elkEdges: LayoutEdge[] = [];
    // ELK edge orientation follows the left-to-right convention; routes are flipped back afterwards.
    const reversed = new Set<string>();
    for (const p of levelPlans) {
      const source = lift(p.source), target = lift(p.target);
      const symbol = p.symbol === undefined ? undefined : symbolById.get(p.symbol);
      if (symbol) {
        // Owner side: the UML port, or the anchor port on a node without one.
        const owner = anchorOf.get(p.id) ?? source;
        if (symbol.kind === 'joint') {
          if (p.id.endsWith('::required')) elkEdges.push({ id: p.id, source: owner, target: `${symbol.id}::in` });
          else { elkEdges.push({ id: p.id, source: `${symbol.id}::out`, target: owner }); reversed.add(p.id); }
        } else if (symbol.side === 'WEST') { elkEdges.push({ id: p.id, source: `${symbol.id}::port`, target: owner }); reversed.add(p.id); }
        else elkEdges.push({ id: p.id, source: owner, target: `${symbol.id}::port` });
        continue;
      }
      const labels: LayoutLabel[] = [];
      if (p.center) labels.push({ id: `${p.id}::center`, width: Math.max(...p.center.widths) + 4, height: p.center.lines.length * lh, placement: 'center' });
      p.ends.forEach((e, k) => labels.push({ id: `${p.id}::end${k}`, width: e.width + 4, height: lh, placement: e.end === 'source' ? 'tail' : 'head' }));
      // Notes follow what they annotate, so they never push a connector chain apart.
      if (p.type === 'note-anchor') { elkEdges.push({ id: p.id, source: target, target: source }); reversed.add(p.id); continue; }
      elkEdges.push({ id: p.id, source, target, labels });
    }

    const result = await layout(elkNodes, elkEdges, { direction: 'RIGHT', nodeSpacing: NODE_SPACING, layerSpacing: LAYER_SPACING });

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
    for (const [portId, owner] of portOwner) {
      const c = result.ports.get(portId);
      if (!c) continue;
      symbols.push({ id: portId, kind: 'port', center: c, bounds: { x: c.x - half, y: c.y - half, width: portSize, height: portSize }, parent: owner });
    }
    // Interface symbols inside their reserved node: name on top, symbol below.
    for (const s of levelSymbols) {
      const r = result.nodes.get(s.id)!;
      const { cy } = symbolBox(s);
      const c = { x: r.x + r.width / 2, y: r.y + cy };
      fixedLabels.push({ id: `${s.id}::name`, owner: s.id, text: s.name, width: s.nameWidth, rect: { x: r.x + (r.width - s.nameWidth) / 2, y: r.y, width: s.nameWidth, height: lh } });
      if (s.kind === 'ball') {
        symbols.push({ id: s.id, kind: 'ball', center: c, bounds: ballBounds(c), parent: s.container });
      } else if (s.kind === 'socket') {
        const u = { x: s.side === 'WEST' ? -1 : 1, y: 0 };
        const R = theme.size.socket;
        // Center the half circle's bounding box in the node.
        const center = { x: s.side === 'WEST' ? c.x - R / 2 : c.x + R / 2, y: c.y };
        symbols.push({ id: s.id, kind: 'socket', center, u, bounds: socketBounds(center, u), parent: s.container });
      } else {
        const R = theme.size.socket;
        symbols.push({ id: s.id, kind: 'joint', center: c, u: { x: 1, y: 0 }, bounds: { x: c.x - R, y: c.y - R, width: 2 * R, height: 2 * R }, parent: s.container });
      }
    }
    const symbolOf = new Map(symbols.map(s => [s.id, s]));

    for (const p of levelPlans) {
      const edge = result.edges.get(p.id);
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
        let x = last.x;
        if (s.kind === 'ball') x = s.center.x + (last.x < s.center.x ? -1 : 1) * theme.size.ball;
        else if (s.kind === 'socket') x = s.center.x - s.u!.x * theme.size.socket;
        else x = s.center.x + (p.id.endsWith('::required') ? -1 : 1) * theme.size.socket;
        const y = s.center.y;
        const prev = pts.at(-2)!;
        const out = [...pts.slice(0, -1)];
        if (Math.abs(prev.y - y) > 0.01 && Math.abs(prev.x - last.x) < 0.01) out[out.length - 1] = { x: prev.x, y };
        out.push({ x, y });
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
      Math.abs(r[0]!.y - r[1]!.y) < 0.01 && Math.abs(r[1]!.x - r[2]!.x) < 0.01 && Math.abs(r[2]!.y - r[3]!.y) < 0.01;
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
    const segmentBox = (a: Point, b: Point): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) - 1, width: Math.abs(a.x - b.x), height: 2 });
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
      /** Puts the symbol at height y and makes the selected lines straight; false if blocked. */
      const attempt = (y: number, straighten: readonly boolean[]): boolean => {
        const ok = planIds.every((id, k) => {
          if (!straighten[k]) return true;
          if (!anchorOf.has(id)) return Math.abs(lines[k]![0]!.y - y) < 0.01;
          const node = rects.get(ownerNode(sources[k]!))!;
          return y >= node.y + 10 && y <= node.y + node.height - 10;
        });
        if (!ok) return false;
        const dy = y - symbol.center.y;
        const moved = { bounds: translateRect(symbol.bounds, { x: 0, y: dy }), label: translateRect(label.rect, { x: 0, y: dy }) };
        if (Math.abs(dy) > 0.01) {
          if (straighten.some(x => !x)) return false;
          const container = s.container === undefined ? undefined : rects.get(s.container);
          if (container && !contains(container, union([moved.bounds, moved.label]))) return false;
          if (!free(union([moved.bounds, moved.label]), ends, own)) return false;
        }
        const next = lines.map((r, k) => straighten[k] ? [{ x: r![0]!.x, y }, { x: r!.at(-1)!.x, y }] : r!);
        if (!next.every((r, k) => !straighten[k] || free(segmentBox(r[0]!, r[1]!), ends, own))) return false;
        symbol.bounds = moved.bounds;
        symbol.center = { x: symbol.center.x, y };
        label.rect = moved.label;
        planIds.forEach((id, k) => routes.set(id, next[k]!));
        return true;
      };
      // Lines from UML ports fix the height; anchors (no port square) slide along their node's side.
      const fixed = planIds.flatMap((id, k) => anchorOf.has(id) ? [] : [lines[k]![0]!.y]);
      const all = planIds.map(() => true);
      if (!fixed.some(y => Math.abs(y - fixed[0]!) > 0.01) && attempt(fixed[0] ?? symbol.center.y, all)) continue;
      // Otherwise keep the symbol and straighten the anchored lines only.
      attempt(symbol.center.y, planIds.map((id, k) => anchorOf.has(id) && isJog(lines[k])));
    }

    return { width: result.width, height: result.height, rects, symbols, routes, suggestions, fixedLabels, ellipses };
  };

  const level = await runLevel(graph.nodes, undefined);
  const { rects, routes, suggestions, fixedLabels, ellipses } = level;
  const symbols = level.symbols;

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
    const out = Math.abs(c.x - owner.x) < Math.abs(c.x - (owner.x + owner.width)) ? -1 : 1;
    const g = portSize / 2 + LABEL_GAP;
    const candidates: Rect[] = [];
    for (const shift of [0, 8, 16, 28]) {
      for (const dir of [out, -out]) {
        const x = dir < 0 ? c.x - g - width - shift : c.x + g + shift;
        candidates.push({ x, y: c.y - LABEL_GAP - lh, width, height: lh }, { x, y: c.y + LABEL_GAP, width, height: lh });
      }
    }
    // Above or below the square itself, as a last resort.
    candidates.push({ x: c.x - width / 2, y: c.y - portSize / 2 - LABEL_GAP - lh, width, height: lh }, { x: c.x - width / 2, y: c.y + portSize / 2 + LABEL_GAP, width, height: lh });
    requests.push({ id: `${s.id}::label`, width, height: lh, route: [c, c], at: 'center', candidates });
    meta.set(`${s.id}::label`, { owner: s.id, lines: [text], widths: [width] });
  }
  for (const p of plans) {
    if (!p.center) continue;
    const id = `${p.id}::center`;
    const width = Math.max(...p.center.widths), height = p.center.lines.length * lh;
    const suggested = suggestions.get(id);
    requests.push({ id, width, height, route: routes.get(p.id)!, at: 'center', suggestion: suggested && { x: suggested.x + 2, y: suggested.y, width, height } });
    meta.set(id, { owner: p.id, lines: p.center.lines, widths: p.center.widths });
  }
  const labelledEnds = plans.flatMap(p => routes.has(p.id) ? [...new Set(p.ends.map(e => e.end))].map(end => end === 'source' ? routes.get(p.id)![0]! : routes.get(p.id)!.at(-1)!) : []);
  const placed = placeLabels(requests, { ...obstacles, ends: labelledEnds });
  const labels: PlacedLabel[] = [
    ...fixedLabels.map(l => ({ id: l.id, owner: l.owner, rect: l.rect, lines: [l.text], widths: [l.width], style: LABEL })),
    ...[...placed].map(([id, rect]) => ({ id, rect, style: LABEL, ...meta.get(id)! })),
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
