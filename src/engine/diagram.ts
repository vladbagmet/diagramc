import { theme } from '../core/theme.js';
import { drawEdge, type LineStyle, type Marker } from './edges.js';
import { layout, type Direction, type LayoutEdge, type LayoutLabel, type LayoutNode, type LayoutPort, type LayoutResult, type Side } from './elk.js';
import type { FontMetrics, TextStyle } from './fonts.js';
import { direction, simplify, union, type Point, type Rect } from './geometry.js';
import { labelCost, labelFits, placeLabels, type LabelRequest } from './labels.js';
import { drawPackageNode, measurePackage, packageTabRect, type MeasuredPackage, type PackageHeader } from './packages.js';
import { repairRoutes, type RepairNode } from './repair.js';
import { bundleHub, bundleSpacing, type BundleMember } from './bundles.js';
import { chooseLayout, countCrossings, LAYOUT_VARIANTS, routesLength, type LayoutVariant } from './aspect.js';
import { planSelfLoops, selfLoopRoute, type SelfLoopPlan } from './selfloops.js';
import { baselineOffset, startsData, drawBox, drawFrame, drawNote, measureBox, measureFrameHeading, measureNote, type Compartment, type MeasuredBox } from './shapes.js';
import { Canvas, el, num } from './svg.js';
import { wrapText } from './text.js';

/**
 * A generic pipeline for node-and-edge diagrams: compartment boxes, notes and
 * packages (optionally nesting other nodes), connected by UML lines with end
 * markers, end labels and center labels. Kinds map their model to a
 * `DiagramSpec`; this module measures, lays out (ELK, compound nodes for
 * nesting), routes, places labels and draws. The class kind predates it and has
 * its own copy of the same steps.
 */

export type NodeShape =
  | { kind: 'box'; compartments: Compartment[] }
  | { kind: 'note'; text: string }
  | { kind: 'package'; header: PackageHeader };

export interface DiagramNodeSpec {
  id: string;
  /** Written to data-uml-type. */
  type: string;
  shape: NodeShape;
  /** Nested nodes; only for packages. A package with children is drawn as a container. */
  children?: DiagramNodeSpec[];
}

export interface CenterLine { text: string; underline?: boolean; /** Set on the first row of each logical line after wrapping. */ start?: boolean }

export interface DiagramEdgeSpec {
  id: string;
  type: string;
  source: string;
  target: string;
  style: LineStyle;
  sourceMarker: Marker;
  targetMarker: Marker;
  /** Lines near the middle (keywords, names); names are wrapped. */
  center?: CenterLine[];
  /** Labels near an end (role names, multiplicities, {required}). */
  ends?: { end: 'source' | 'target'; text: string; kind: 'multiplicity' | 'role' }[];
  /**
   * Tree edges (generalization, extension) are laid out from the target down to
   * the source, and every tree edge of one type into the same target shares one
   * port and one drawn arrowhead.
   */
  tree?: boolean;
  /**
   * Laid out from the target down to the source like a tree edge, but with its
   * own line and arrowhead (extension: metaclass above its stereotypes).
   */
  reversed?: boolean;
  /** ELK direction priority; higher keeps the edge pointing in the layout direction. */
  priority?: number;
}

export interface DiagramSpec {
  /** Kind name, written to data-uml-kind. */
  kind: string;
  frameKeyword: string;
  title?: string | undefined;
  nodes: DiagramNodeSpec[];
  edges: DiagramEdgeSpec[];
  /**
   * Layout directions to try, the conventional one first; the most readable result
   * wins (see src/engine/aspect.ts). Default DOWN.
   */
  directions?: Direction[];
  /**
   * Also try ELK graph wrapping (long layer sequences folded into rows). Off by
   * default: wrapped layouts get long lines from the end of one row back to the
   * start of the next, which rarely beats another direction.
   */
  wrap?: boolean;
}

interface SceneNode { spec: DiagramNodeSpec; parent?: string | undefined; bounds: Rect; box?: MeasuredBox; rows?: string[]; pkg?: MeasuredPackage }
interface SceneEdge { spec: DiagramEdgeSpec; points: Point[]; drawTargetMarker: boolean }
interface SceneLabel { owner: string; rect: Rect; lines: CenterLine[]; widths: number[]; end?: 'source' | 'target'; anchor?: Point }

export interface DiagramScene {
  kind: string;
  frameKeyword: string;
  width: number;
  height: number;
  frame?: { bounds: Rect; title: string };
  /** Pre-order: containers before their children. */
  nodes: SceneNode[];
  edges: SceneEdge[];
  labels: SceneLabel[];
}

const LABEL: TextStyle = { size: theme.font.size.label };
const CENTER_LABEL_WIDTH = 180;
const CONTAINER_PAD = 18;
/** ELK's gap between neighbouring ports on a side ('elk.spacing.portPort' in elk.ts). */
const BUNDLE_PORT_GAP = 6;
/** Room between lines meeting a container's border: two arrowheads side by side plus a gap. */
const CONTAINER_PORT_SPACING = 2 * theme.size.triangle.halfWidth + 12;

export function markerExtent(marker: Marker): { length: number; half: number } {
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

const JOG = 12;

/**
 * Removes a short jog next to the start of an orthogonal route (ELK sometimes
 * leaves a few-pixel sidestep between a port and the main line) by sliding the
 * start point along the node's border, if it stays clear of the corners.
 */
function straightenJog(route: Point[], node: Rect, max = JOG): Point[] {
  if (route.length < 4) return route;
  const [p0, p1, p2, p3] = route as [Point, Point, Point, Point];
  const vertical = Math.abs(p0.x - p1.x) < 0.01 && Math.abs(p2.x - p3.x) < 0.01 && Math.abs(p1.y - p2.y) < 0.01;
  const horizontal = Math.abs(p0.y - p1.y) < 0.01 && Math.abs(p2.y - p3.y) < 0.01 && Math.abs(p1.x - p2.x) < 0.01;
  const jog = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if ((!vertical && !horizontal) || jog < 0.01 || jog > max) return route;
  const start = { x: p0.x + (p2.x - p1.x), y: p0.y + (p2.y - p1.y) };
  const margin = 8;
  if (vertical && (start.x < node.x + margin || start.x > node.x + node.width - margin)) return route;
  if (horizontal && (start.y < node.y + margin || start.y > node.y + node.height - margin)) return route;
  return simplify([start, ...route.slice(2)]);
}

/**
 * Makes the start of a route meet a package's outline (tab or body). Empty
 * packages are laid out as their body, so a vertical line onto the body under the
 * tab is cut back to the tab's top. Containers include the tab: a vertical start
 * on the top border right of the tab is extended down to the body, and a
 * horizontal start on the right border beside the tab is shifted down into the
 * body's height (with a jog when the route is a single segment).
 */
function fitToTab(route: Point[], tab: Rect | undefined, node: Rect): Point[] {
  if (!tab || route.length < 2) return route;
  const bodyTop = tab.y + tab.height;
  const [p, q] = route as [Point, Point];
  const out = route.map(pt => ({ ...pt }));
  const fromAbove = Math.abs(q.x - p.x) < 0.5 && q.y < p.y;
  // A line through the tab onto the body stops at the tab instead.
  if (fromAbove && Math.abs(p.y - bodyTop) < 0.5 && p.x >= tab.x - 0.5 && p.x <= tab.x + tab.width + 0.5) {
    out[0] = { x: p.x, y: tab.y };
    return out;
  }
  if (p.y >= bodyTop - 0.5) return route;
  if (Math.abs(p.y - node.y) < 0.5 && p.x > tab.x + tab.width + 0.5 && fromAbove) {
    out[0] = { x: p.x, y: bodyTop };
    return out;
  }
  const rightBorder = Math.abs(p.x - (node.x + node.width)) < 0.5;
  if (!rightBorder || Math.abs(q.y - p.y) > 0.5) return route;
  const y = bodyTop + Math.min(10, (node.y + node.height - bodyTop) / 2);
  if (route.length === 2) {
    const mid = (p.x + q.x) / 2;
    return [{ x: p.x, y }, { x: mid, y }, { x: mid, y: q.y }, q];
  }
  out[0] = { x: p.x, y };
  out[1] = { x: q.x, y };
  return out;
}

interface EdgePlan {
  spec: DiagramEdgeSpec;
  center?: { lines: CenterLine[]; widths: number[] };
  ends: { end: 'source' | 'target'; text: string; width: number; kind: 'multiplicity' | 'role' }[];
  /** ELK source: the shared tree port for tree edges. */
  elkSource: string;
}

/** Side of a node where edges leave (`out`) or arrive (`in`) for a layout direction. */
function sides(dir: Direction): { out: Side; in: Side } {
  switch (dir) {
    case 'RIGHT': return { out: 'EAST', in: 'WEST' };
    case 'LEFT': return { out: 'WEST', in: 'EAST' };
    case 'UP': return { out: 'NORTH', in: 'SOUTH' };
    default: return { out: 'SOUTH', in: 'NORTH' };
  }
}

export async function layoutDiagram(spec: DiagramSpec, metrics: FontMetrics): Promise<DiagramScene> {
  const lineHeight = metrics.lineHeight(LABEL.size);
  const width = (text: string) => Math.ceil(metrics.measure(text, LABEL));

  // Flatten the node tree.
  const all = new Map<string, { spec: DiagramNodeSpec; parent?: string | undefined }>();
  const visit = (node: DiagramNodeSpec, parent?: string): void => {
    all.set(node.id, { spec: node, parent });
    for (const child of node.children ?? []) visit(child, node.id);
  };
  spec.nodes.forEach(n => visit(n));

  // Measure.
  const boxes = new Map<string, MeasuredBox>(), noteRows = new Map<string, string[]>(), packages = new Map<string, MeasuredPackage>();
  const sizes = new Map<string, { width: number; height: number }>();
  for (const [id, { spec: node }] of all) {
    if (node.shape.kind === 'box') {
      const box = measureBox(metrics, node.shape.compartments);
      boxes.set(id, box);
      sizes.set(id, box);
    } else if (node.shape.kind === 'note') {
      const note = measureNote(metrics, node.shape.text);
      noteRows.set(id, note.rows);
      sizes.set(id, note);
    } else {
      const pkg = measurePackage(metrics, node.shape.header, !!node.children?.length);
      packages.set(id, pkg);
      sizes.set(id, pkg);
    }
  }

  // Edge plans.
  const plans: EdgePlan[] = spec.edges.map(e => {
    const p: EdgePlan = { spec: e, ends: [], elkSource: e.tree ? `${e.target}::tree::${e.type}` : e.source };
    if (e.center?.length) {
      const lines: CenterLine[] = [];
      for (const line of e.center) wrapText(metrics, line.text, LABEL, CENTER_LABEL_WIDTH).forEach((row, k) => lines.push({ ...line, text: row, start: k === 0 }));
      p.center = { lines, widths: lines.map(l => Math.ceil(metrics.measure(l.text.trimEnd(), LABEL))) };
    }
    for (const end of e.ends ?? []) p.ends.push({ ...end, width: width(end.text) });
    return p;
  });

  // Parallel relationships between one pair of nodes with center labels (no end
  // labels, not tree edges) run as a bundle through an invisible hub node in the
  // innermost container of both ends (src/engine/bundles.ts).
  const chain = (id: string): string[] => { const out: string[] = []; for (let p = all.get(id)?.parent; p; p = all.get(p)?.parent) out.push(p); return out; };
  interface Bundle { id: string; source: string; target: string; parent: string | undefined; members: EdgePlan[]; info: BundleMember[] }
  const bundles: Bundle[] = [];
  const bundleOf = new Map<string, { bundle: Bundle; index: number; forward: boolean }>();
  {
    const groups = new Map<string, EdgePlan[]>();
    for (const p of plans) {
      const e = p.spec;
      if (e.source === e.target || e.tree || e.reversed || p.ends.length || chain(e.source).includes(e.target) || chain(e.target).includes(e.source)) continue;
      const key = [e.source, e.target].sort().join('\u0000');
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    for (const members of groups.values()) {
      if (members.length < 2 || !members.some(p => p.center)) continue;
      const { source, target } = members[0]!.spec;
      const targetChain = new Set(chain(target));
      const bundle: Bundle = {
        id: `${members[0]!.spec.id}::bundle`, source, target, parent: chain(source).find(id => targetChain.has(id)), members,
        info: members.map(p => ({ id: p.spec.id, markers: [p.spec.sourceMarker, p.spec.targetMarker], label: p.center ? { width: Math.max(...p.center.widths), height: p.center.lines.length * lineHeight } : undefined })),
      };
      bundles.push(bundle);
      members.forEach((p, index) => bundleOf.set(p.spec.id, { bundle, index, forward: p.spec.source === source }));
    }
  }

  // Self-loops are routed by the engine, not ELK; plan their room first (leaf nodes only).
  const loopsByNode = new Map<string, EdgePlan[]>();
  for (const p of plans) if (p.spec.source === p.spec.target) loopsByNode.set(p.spec.source, [...(loopsByNode.get(p.spec.source) ?? []), p]);
  const loopPlans = new Map<string, SelfLoopPlan>();
  for (const [node, loops] of loopsByNode) {
    loopPlans.set(node, planSelfLoops(loops.map(l => ({
      endLabelWidth: Math.max(0, ...l.ends.map(e => e.width)),
      sourceLabelWidth: Math.max(0, ...l.ends.filter(e => e.end === 'source').map(e => e.width)),
      targetLabelWidth: Math.max(0, ...l.ends.filter(e => e.end === 'target').map(e => e.width)),
      endLabelRows: Math.max(l.ends.filter(e => e.end === 'source').length, l.ends.filter(e => e.end === 'target').length),
      labelHeight: lineHeight,
      centerLabel: l.center ? { width: Math.max(...l.center.widths), height: l.center.lines.length * lineHeight } : undefined,
    }))));
  }

  /**
   * One layout run in direction `dir`; `variant`: see LAYOUT_VARIANTS in
   * src/engine/aspect.ts. Edges that ELK sends against the direction (cycles)
   * leave their fixed-side port the wrong way; repairRoutes reroutes them.
   */
  const attempt = async (dir: Direction, variant: LayoutVariant): Promise<{ result: LayoutResult; dir: Direction }> => {
    const side = sides(dir);
    const ports = new Map<string, LayoutPort[]>();
    // Compound nodes get no ports: ELK's hierarchical layout fails on some port
    // configurations of compound nodes. Their edges attach freely.
    const isContainer = (node: string) => !!all.get(node)!.spec.children?.length;
    const addPort = (node: string, port: LayoutPort) => ports.set(node, [...(ports.get(node) ?? []), port]);
    const endPort = new Map<string, string>();
    const treePorts = new Set<string>();
    for (const p of plans) {
      const e = p.spec;
      if (e.source === e.target) continue;
      const member = bundleOf.get(e.id);
      if (member) {
        // Bundle members leave the bundle's source and reach its target, whatever their own direction.
        for (const end of ['source', 'target'] as const) {
          const node = end === 'source' ? member.bundle.source : member.bundle.target;
          if (isContainer(node)) continue;
          const marker = (end === 'source') === member.forward ? e.sourceMarker : e.targetMarker;
          const id = `${e.id}::port-${end}`;
          // Ports as far apart as the lines inside the hub, so the lines run straight into it.
          addPort(node, { id, side: end === 'source' ? side.out : side.in, width: Math.max(2 * markerExtent(marker).half + 2, bundleSpacing(member.bundle.info) - BUNDLE_PORT_GAP) });
          endPort.set(`${e.id}\u0000${end}`, id);
        }
        continue;
      }
      if (e.tree && isContainer(e.target)) p.elkSource = e.target;
      if (e.tree) {
        if (!isContainer(e.target) && !treePorts.has(p.elkSource)) {
          treePorts.add(p.elkSource);
          addPort(e.target, { id: p.elkSource, side: side.out, width: 2 * (markerExtent(e.targetMarker).half + 5) });
        }
        continue;
      }
      // Ends with labels or a marker get their own port, as wide as what is drawn
      // beside the line, so ELK keeps neighbouring edges far enough apart.
      for (const end of ['source', 'target'] as const) {
        const labels = p.ends.filter(l => l.end === end);
        const marker = markerExtent(end === 'source' ? e.sourceMarker : e.targetMarker);
        if (!labels.length && !marker.length) continue;
        if (isContainer(end === 'source' ? e.source : e.target)) continue;
        const id = `${e.id}::port-${end}`;
        const horizontalSide = side.out === 'SOUTH' || side.out === 'NORTH';
        const across = horizontalSide ? Math.max(0, ...labels.map(l => l.width)) : labels.length * (lineHeight + 2);
        const half = Math.max(labels.length ? across + marker.half + 8 : 0, marker.half + 5);
        const leaving = (end === 'source') !== !!e.reversed;
        addPort(end === 'source' ? e.source : e.target, { id, side: leaving ? side.out : side.in, width: 2 * half });
        endPort.set(`${e.id}\u0000${end}`, id);
      }
    }
    // ELK ignores minimum sizes of compound nodes: a container narrower than its
    // tab gets extra right padding and the layout runs again.
    const extraRight = new Map<string, number>();
    // Hubs: lines enter on the side facing the bundle's source (top or left; mirrored for UP and LEFT).
    const flip = dir === 'UP' || dir === 'LEFT';
    const hubs = (parent: string | undefined): LayoutNode[] => bundles.filter(b => b.parent === parent).map(b => {
      const hub = bundleHub(b.info, dir === 'DOWN' || dir === 'UP');
      const mirror = (q: Point): Point => flip ? (dir === 'UP' ? { x: q.x, y: hub.height - q.y } : { x: hub.width - q.x, y: q.y }) : q;
      return { id: b.id, width: hub.width, height: hub.height, fixedSize: true, ports: b.members.flatMap((p, i) => [
        { id: `${b.id}::in${i}`, side: side.in, position: mirror(hub.enter[i]!) }, { id: `${b.id}::out${i}`, side: side.out, position: mirror(hub.exit[i]!) },
      ]) };
    });
    const toLayout = (id: string): LayoutNode => {
      const { spec: node } = all.get(id)!;
      const size = sizes.get(id)!;
      const loops = loopPlans.get(id);
      const pkg = packages.get(id);
      const nodePorts = ports.get(id);
      // An empty package is laid out as its body; its tab is reserved above it.
      const leafPackage = pkg && !node.children?.length ? pkg : undefined;
      return {
        id, width: size.width, height: Math.max(size.height - (leafPackage?.tab.height ?? 0), loops?.minHeight ?? 0),
        ...(leafPackage ? { reserveTop: leafPackage.tab } : {}),
        ...(node.children?.length ? {
          children: [...node.children.map(c => toLayout(c.id)), ...hubs(id)],
          padding: { top: pkg!.tab.height + CONTAINER_PAD, left: CONTAINER_PAD, bottom: CONTAINER_PAD, right: CONTAINER_PAD + (extraRight.get(id) ?? 0) },
          portSpacing: CONTAINER_PORT_SPACING,
        } : {}),
        ...(nodePorts?.length ? { ports: nodePorts } : {}),
        ...(loops ? { reserveRight: loops.reserveRight, reserveAbove: loops.reserveAbove, reserveBelow: loops.reserveBelow } : {}),
      };
    };
    const edges: LayoutEdge[] = plans.filter(p => p.spec.source !== p.spec.target).flatMap((p): LayoutEdge[] => {
      const e = p.spec;
      const member = bundleOf.get(e.id);
      if (member) {
        const { bundle, index } = member;
        return [
          { id: `${e.id}::in`, source: endPort.get(`${e.id}\u0000source`) ?? bundle.source, target: `${bundle.id}::in${index}`, directionPriority: 1, straightnessPriority: 10 },
          { id: `${e.id}::out`, source: `${bundle.id}::out${index}`, target: endPort.get(`${e.id}\u0000target`) ?? bundle.target, directionPriority: 1, straightnessPriority: 10 },
        ];
      }
      const labels: LayoutLabel[] = [];
      if (p.center) labels.push({ id: `${e.id}::center`, width: Math.max(...p.center.widths) + 4, height: p.center.lines.length * lineHeight, placement: 'center' });
      p.ends.forEach((l, k) => labels.push({ id: `${e.id}::end${k}`, width: l.width + 4, height: lineHeight, placement: (l.end === 'source') !== !!(e.tree || e.reversed) ? 'tail' : 'head' }));
      const sourcePort = endPort.get(`${e.id}\u0000source`) ?? e.source, targetPort = endPort.get(`${e.id}\u0000target`) ?? e.target;
      return [{
        id: e.id,
        source: e.tree ? p.elkSource : e.reversed ? targetPort : sourcePort,
        target: e.tree ? e.source : e.reversed ? sourcePort : targetPort,
        labels,
        directionPriority: e.priority ?? (e.tree || e.reversed ? 10 : 1),
      }];
    });
    const roots = (): LayoutNode[] => [...spec.nodes.map(n => toLayout(n.id)), ...hubs(undefined)];
    // Network simplex node placement keeps the lines into and out of a bundle's hub straight.
    const options = { direction: dir, elk: { ...LAYOUT_VARIANTS[variant], ...(bundles.length ? { 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX' } : {}) } };
    let result = await layout(roots(), edges, options);
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const [id, pkg] of packages) {
        const width = result.nodes.get(id)!.width;
        if (!all.get(id)!.spec.children?.length || width >= pkg.width - 0.5) continue;
        extraRight.set(id, (extraRight.get(id) ?? 0) + Math.ceil(pkg.width - width));
        changed = true;
      }
      if (!changed) break;
      result = await layout(roots(), edges, options);
    }
    return { result, dir };
  };

  // Try each direction (and variants); keep the most readable result.
  // The kind's first direction is its convention; others must be clearly better,
  // the more so the more of the diagram is a hierarchy (generalizations, extensions).
  const hierarchy = spec.edges.filter(e => e.tree || e.reversed).length / Math.max(1, spec.edges.filter(e => e.type !== 'note-anchor').length);
  const best = await chooseLayout(spec.directions ?? ['DOWN'], attempt, ({ result: r }) => {
    const lines = [...r.edges.values()].map(e => e.points);
    return { width: r.width, height: r.height, crossings: countCrossings(lines), edgeLength: routesLength(lines) };
  }, { penalty: i => i ? 0.15 + 0.6 * hierarchy : 0, wrap: !!spec.wrap });
  const result = best.result;
  const rects = new Map<string, Rect>([...all.keys()].map(id => {
    const r = result.nodes.get(id)!, pkg = packages.get(id);
    // Leaf packages were laid out as their body: add the tab back on top.
    return [id, pkg && !all.get(id)!.spec.children?.length ? { x: r.x, y: r.y - pkg.tab.height, width: r.width, height: r.height + pkg.tab.height } : r];
  }));
  const tabs = new Map<string, Rect>([...packages].map(([id, pkg]) => [id, packageTabRect(pkg, rects.get(id)!)]));

  // Routes from the semantic source border to the semantic target border.
  const loopIndex = new Map<string, number>();
  const routes = new Map<string, Point[]>();
  const bundled = new Set<string>(), bundleLabels = new Map<string, Rect>();
  for (const p of plans) {
    const e = p.spec;
    if (e.source === e.target) {
      const i = loopIndex.get(e.source) ?? 0;
      loopIndex.set(e.source, i + 1);
      routes.set(e.id, selfLoopRoute(rects.get(e.source)!, loopPlans.get(e.source)!, i));
      continue;
    }
    const member = bundleOf.get(e.id);
    let points = result.edges.get(e.id)?.points ?? [];
    if (member) {
      // In through the hub, along the member's own path inside it, and out.
      const { bundle, index, forward } = member;
      const r = result.nodes.get(bundle.id)!;
      const inside = bundleHub(bundle.info, best.dir === 'DOWN' || best.dir === 'UP').paths[index]!.map(q => {
        const m = best.dir === 'UP' ? { x: q.x, y: r.height - q.y } : best.dir === 'LEFT' ? { x: r.width - q.x, y: q.y } : q;
        return { x: r.x + m.x, y: r.y + m.y };
      });
      const label = bundleHub(bundle.info, best.dir === 'DOWN' || best.dir === 'UP').labels[index];
      if (label) {
        const l = best.dir === 'UP' ? { ...label, y: r.height - label.y - label.height } : best.dir === 'LEFT' ? { ...label, x: r.width - label.x - label.width } : label;
        bundleLabels.set(e.id, { ...l, x: r.x + l.x, y: r.y + l.y });
      }
      // The pieces outside the hub lose small jogs at the nodes (all members slide alike: one pitch).
      const jog = 2 * bundleSpacing(bundle.info);
      const enter = straightenJog(result.edges.get(`${e.id}::in`)!.points, rects.get(bundle.source)!, jog);
      const leave = straightenJog([...result.edges.get(`${e.id}::out`)!.points].reverse(), rects.get(bundle.target)!, jog).reverse();
      points = simplify([...enter.slice(0, -1), ...inside, ...leave.slice(1)]);
      if (!forward) points = points.reverse();
      bundled.add(e.id);
    }
    let route = e.tree || e.reversed ? [...points].reverse() : [...points];
    // Shared tree ports must stay put; other ends may slide to remove small jogs.
    if (!member) {
      route = straightenJog(route, rects.get(e.source)!);
      if (!e.tree) route = straightenJog([...route].reverse(), rects.get(e.target)!).reverse();
    }
    // Lines must meet a package's outline (tab or body), not the empty corner
    // right of the tab.
    route = fitToTab(route, tabs.get(e.source), rects.get(e.source)!);
    route = fitToTab([...route].reverse(), tabs.get(e.target), rects.get(e.target)!).reverse();
    routes.set(e.id, route);
  }
  // Repair routes that cross texts or nodes, detour, crowd other ends or bend under a marker.
  const repairNodes: RepairNode[] = [...all.keys()].map(id => {
    const r = rects.get(id)!, tab = tabs.get(id);
    return {
      id, parent: all.get(id)!.parent, container: !!all.get(id)!.spec.children?.length,
      rect: tab ? { x: r.x, y: r.y + tab.height, width: r.width, height: r.height - tab.height } : r,
      texts: tab ? [tab] : [],
    };
  });
  // The room of a node's self-loops is an obstacle for every other line.
  for (const [id] of loopPlans) {
    const loops = plans.filter(p => p.spec.source === id && p.spec.target === id).map(p => routes.get(p.spec.id)!);
    repairNodes.push({ id: `${id}::self-loops`, rect: union(loops.flat().map(p => ({ ...p, width: 0, height: 0 }))), parent: all.get(id)!.parent });
  }
  const labelObstacles = [...all.keys()].flatMap(id => all.get(id)!.spec.children?.length ? [tabs.get(id)!] : [rects.get(id)!]);
  const containerBorders: [Point, Point][] = [];
  for (const id of all.keys()) {
    if (!all.get(id)!.spec.children?.length) continue;
    const r = rects.get(id)!, top = r.y + tabs.get(id)!.height;
    const c = [{ x: r.x, y: top }, { x: r.x + r.width, y: top }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];
    c.forEach((q, k) => containerBorders.push([q, c[(k + 1) % 4]!]));
  }
  const baseRoutes = new Map(routes);
  /**
   * Repairs routes, then places labels. `crowded`: edges whose center label found
   * no clean spot in an earlier pass; their lines are spread apart from the others.
   */
  const routeAndLabel = (crowded: ReadonlySet<string>, previous?: ReadonlyMap<string, Point[]>) => {
    const unplaced = new Set<string>();
    const repaired = repairRoutes(repairNodes, plans.map(p => ({
      id: p.spec.id, source: p.spec.source, target: p.spec.target, route: baseRoutes.get(p.spec.id)!,
      sourceMarker: p.spec.sourceMarker, targetMarker: p.spec.targetMarker,
      group: p.spec.tree ? `${p.spec.type}@${p.spec.target}` : undefined,
    })), {
      keep: bundled,
      // Center labels need a clean spot beside their own line (no crossing, not as
      // close to another line); bundled lines without one are spread apart.
      labelFits: (id, route, current) => {
        const p = plans.find(q => q.spec.id === id)!;
        if (!p.center || bundled.has(id)) return true;
        // The original route of a crowded edge has no room (an earlier pass found none); a new route is judged normally.
        if (crowded.has(id) && [baseRoutes.get(id), previous?.get(id)].some(r => JSON.stringify(route) === JSON.stringify(r))) return false;
        const others = [...current].filter(([other]) => other !== id);
        const segments: [Point, Point][] = [...containerBorders];
        for (const [, r] of others) r.slice(1).forEach((q, k) => segments.push([r[k]!, q]));
        const request: LabelRequest = { id: `${id}::center`, owner: id, width: Math.max(...p.center.widths), height: p.center.lines.length * lineHeight, route, at: 'center' };
        return labelFits(request, { rects: labelObstacles, segments, lines: others.map(([owner, points]) => ({ owner, points })) });
      },
      labelSpacing: id => {
        const p = plans.find(q => q.spec.id === id)!;
        return p.center ? Math.max(...p.center.widths) + 16 : undefined;
      },
    });
    const routes = new Map(baseRoutes);
    for (const id of repaired.changed) routes.set(id, repaired.routes.get(id)!);

    // Tree edges into one shared port draw their arrowhead once.
    const drawnTips = new Set<string>();
    const sceneEdges: SceneEdge[] = plans.map(p => {
      const points = routes.get(p.spec.id)!;
      const tip = points.at(-1)!;
      const key = `${p.spec.type}\u0000${p.spec.targetMarker}@${tip.x},${tip.y}`;
      const drawTargetMarker = !p.spec.tree || !drawnTips.has(key);
      drawnTips.add(key);
      return { spec: p.spec, points, drawTargetMarker };
    });

    // Labels. Leaf nodes, package tabs and markers are obstacles; a container's
    // border lines are obstacles too, and a container's inside is free only for
    // labels of edges that start or end inside it.
    const containers = [...all.keys()].filter(id => all.get(id)!.spec.children?.length);
    const ancestors = (id: string): Set<string> => {
      const out = new Set<string>();
      for (let p = all.get(id)?.parent; p; p = all.get(p)?.parent) out.add(p);
      return out;
    };
    const baseRects: Rect[] = [];
    const segments: [Point, Point][] = [];
    for (const [id, r] of rects) {
      if (!containers.includes(id)) { baseRects.push(r); continue; }
      baseRects.push(tabs.get(id)!);
      const corners = [{ x: r.x, y: r.y + tabs.get(id)!.height }, { x: r.x + r.width, y: r.y + tabs.get(id)!.height }, { x: r.x + r.width, y: r.y + r.height }, { x: r.x, y: r.y + r.height }];
      corners.forEach((c, k) => segments.push([c, corners[(k + 1) % 4]!]));
    }
    for (const edge of sceneEdges) {
      edge.points.slice(1).forEach((p, k) => segments.push([edge.points[k]!, p]));
      for (const r of [markerRect(edge.points[0]!, edge.points[1]!, edge.spec.sourceMarker), markerRect(edge.points.at(-1)!, edge.points.at(-2)!, edge.spec.targetMarker)]) if (r) baseRects.push(r);
    }
    const foreign = new Map<string, Rect[]>();
    for (const p of plans) {
      const inside = new Set([...ancestors(p.spec.source), ...ancestors(p.spec.target)]);
      foreign.set(p.spec.id, containers.filter(c => !inside.has(c)).map(c => rects.get(c)!));
    }
    const requests: { owner: string; request: LabelRequest; lines: CenterLine[]; widths: number[]; end?: 'source' | 'target'; anchor?: Point }[] = [];
    for (const p of plans) {
      const e = p.spec, route = routes.get(e.id)!;
      p.ends.forEach((l, k) => {
        const id = `${e.id}::end${k}`;
        const marker = l.end === 'source' ? e.sourceMarker : e.targetMarker;
        const suggested = repaired.changed.has(e.id) ? undefined : result.edges.get(e.id)?.labels.get(id);
        const inside = e.source === e.target ? { onlySide: l.end === 'source' ? -1 as const : 1 as const } : {};
        requests.push({
          owner: e.id, lines: [{ text: l.text }], widths: [l.width], end: l.end, anchor: l.end === 'source' ? route[0]! : route.at(-1)!,
          request: { id, width: l.width, height: lineHeight, route, at: l.end, side: l.kind === 'multiplicity' ? 1 : -1, clearance: markerExtent(marker).half + 3, ...inside, suggestion: suggested && { x: suggested.x + 2, y: suggested.y, width: l.width, height: lineHeight } },
        });
      });
    }
    for (const p of plans) {
      if (!p.center) continue;
      const e = p.spec, id = `${e.id}::center`;
      const w = Math.max(...p.center.widths), h = p.center.lines.length * lineHeight;
      const suggested = repaired.changed.has(e.id) ? undefined : result.edges.get(e.id)?.labels.get(id);
      const suggestion = bundleLabels.get(e.id) ?? (suggested && { x: suggested.x + 2, y: suggested.y, width: w, height: h });
      requests.push({ owner: e.id, lines: p.center.lines, widths: p.center.widths, request: { id, owner: e.id, width: w, height: h, route: routes.get(e.id)!, at: 'center', suggestion } });
    }
    const labelledEnds = plans.flatMap(p => [...new Set(p.ends.map(l => l.end))].map(end => end === 'source' ? routes.get(p.spec.id)![0]! : routes.get(p.spec.id)!.at(-1)!));
    const lineOwners = plans.map(p => ({ owner: p.spec.id, points: routes.get(p.spec.id)! }));
    const placedRects: Rect[] = [];
    const labels: SceneLabel[] = [];
    for (const r of requests) {
      const placed = placeLabels([r.request], { rects: [...baseRects, ...placedRects, ...foreign.get(r.owner)!], segments, ends: labelledEnds, lines: lineOwners }).get(r.request.id);
      if (!placed) continue;
      placedRects.push(placed);
      labels.push({ owner: r.owner, rect: placed, lines: r.lines, widths: r.widths, ...(r.end ? { end: r.end, anchor: r.anchor! } : {}) });
      // A center label that found no clean spot: its line gets spread from the others in a second pass.
      if (!r.end && labelCost(placed, { rects: [...baseRects, ...placedRects.slice(0, -1), ...foreign.get(r.owner)!], segments, lines: lineOwners }, [], undefined, r.request) > 0) unplaced.add(r.owner);
    }
    return { repaired, routes, sceneEdges, baseRects, labels, unplaced };
  };
  let placement = routeAndLabel(new Set());
  if (placement.unplaced.size) placement = routeAndLabel(placement.unplaced, placement.routes);
  const { sceneEdges, baseRects, labels } = placement;

  // Translate so the drawing starts at the canvas margin (inside the frame, if any).
  const content = union([
    ...rects.values(), ...labels.map(l => l.rect), ...baseRects,
    ...sceneEdges.flatMap(e => e.points.map(p => ({ ...p, width: 0, height: 0 }))),
  ]);
  const margin = theme.spacing.canvas, pad = theme.spacing.frame;
  const heading = spec.title === undefined ? undefined : measureFrameHeading(metrics, spec.frameKeyword, spec.title);
  const originX = margin + (heading ? pad : 0), originY = margin + (heading ? heading.height + pad : 0);
  const dx = originX - content.x, dy = originY - content.y;
  const move = (r: Rect): Rect => ({ x: r.x + dx, y: r.y + dy, width: r.width, height: r.height });
  const movePoint = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  let w = originX + content.width + (heading ? pad : 0);
  const h = originY + content.height + (heading ? pad : 0);
  let frame: DiagramScene['frame'];
  if (heading) {
    const frameWidth = Math.max(w - margin, heading.width + pad);
    frame = { bounds: { x: margin, y: margin, width: frameWidth, height: h - margin }, title: spec.title! };
    w = margin + frameWidth;
  }
  return {
    kind: spec.kind, frameKeyword: spec.frameKeyword,
    width: w + margin, height: h + margin,
    ...(frame ? { frame } : {}),
    nodes: [...all].map(([id, { spec: node, parent }]) => ({
      spec: node, parent, bounds: move(rects.get(id)!),
      ...(boxes.has(id) ? { box: boxes.get(id)! } : {}),
      ...(noteRows.has(id) ? { rows: noteRows.get(id)! } : {}),
      ...(packages.has(id) ? { pkg: packages.get(id)! } : {}),
    })),
    edges: sceneEdges.map(e => ({ ...e, points: e.points.map(movePoint) })),
    labels: labels.map(l => ({ ...l, rect: move(l.rect), ...(l.anchor ? { anchor: movePoint(l.anchor) } : {}) })),
  };
}

/** Draws a laid-out diagram as a self-contained SVG document. */
export async function drawDiagram(scene: DiagramScene, metrics: FontMetrics): Promise<string> {
  const canvas = new Canvas(metrics);
  if (scene.frame) canvas.frame.push(drawFrame(canvas, scene.frameKeyword, scene.frame.title, scene.frame.bounds));
  for (const edge of scene.edges) {
    const e = edge.spec;
    canvas.edges.push(drawEdge({ id: e.id, type: e.type, source: e.source, target: e.target, points: edge.points, style: e.style, sourceMarker: e.sourceMarker, targetMarker: e.targetMarker, drawTargetMarker: edge.drawTargetMarker }));
  }
  for (const node of scene.nodes) {
    const data = { id: node.spec.id, type: node.spec.type, parent: node.parent };
    // Containers go below the edge layer so lines between nested elements stay visible.
    if (node.pkg) (node.spec.children?.length ? canvas.frame : canvas.nodes).push(drawPackageNode(canvas, node.pkg, node.bounds, data));
    else if (node.rows) canvas.nodes.push(drawNote(canvas, node.rows, node.bounds, data));
    else canvas.nodes.push(drawBox(canvas, node.box!, node.bounds, data));
  }
  for (const label of scene.labels) {
    const lh = metrics.lineHeight(LABEL.size);
    const { x, y, width } = label.rect;
    const xs = label.widths.map(w => x + (width - w) / 2);
    const first = y + baselineOffset(metrics, LABEL.size, lh);
    canvas.labels.push(canvas.lines(label.lines.map(l => l.text), xs, first, lh, {
      ...LABEL, fill: theme.color.edgeText, role: 'label', owner: label.owner, halo: true,
      data: label.end ? { 'data-uml-end': label.end, 'data-uml-anchor': `${num(label.anchor!.x)},${num(label.anchor!.y)}` } : startsData(label.lines.flatMap((l, i) => l.start ? [i] : [])),
    }));
    label.lines.forEach((line, i) => {
      if (!line.underline) return;
      const uy = first + i * lh + Math.max(1.5, LABEL.size * 0.12);
      canvas.labels.push(el('line', { x1: xs[i]!, y1: uy, x2: xs[i]! + label.widths[i]!, y2: uy, stroke: theme.color.edgeText, 'stroke-width': 0.9 }));
    });
  }
  return canvas.finish({ width: scene.width, height: scene.height, kind: scene.kind, title: scene.frame?.title });
}

/** Lays out and draws a diagram spec. */
export async function renderDiagram(spec: DiagramSpec, metrics: FontMetrics): Promise<string> {
  return drawDiagram(await layoutDiagram(spec, metrics), metrics);
}

export const guillemets = (names: readonly string[]): string => `«${names.join(', ')}»`;

/** Name compartment of a name-only classifier box (keyword, stereotypes, name). */
export function nameCompartment(keywords: readonly string[], stereotypes: readonly string[] | undefined, name: string, options: { italic?: boolean; underline?: boolean } = {}): Compartment {
  const label = { size: theme.font.size.label };
  const muted = theme.color.mutedText;
  const lines: Compartment['lines'] = [];
  if (keywords.length) lines.push({ text: guillemets(keywords), style: label, align: 'center', fill: muted });
  if (stereotypes?.length) lines.push({ text: guillemets(stereotypes), style: label, align: 'center', fill: muted });
  lines.push({ text: name, style: { size: theme.font.size.name, bold: true, italic: !!options.italic }, align: 'center', wrap: theme.size.maxNameWidth, underline: !!options.underline });
  return { header: true, lines };
}

/**
 * Builds the node tree from `members` (validated: one owner, acyclic). Roots
 * keep document order; children keep `members` order.
 */
export function nestElements<E extends { id: string }>(elements: readonly E[], members: (e: E) => readonly string[] | undefined, toNode: (e: E) => Omit<DiagramNodeSpec, 'children'>): DiagramNodeSpec[] {
  const byId = new Map(elements.map(e => [e.id, e]));
  const nested = new Set(elements.flatMap(e => [...members(e) ?? []]));
  const build = (e: E): DiagramNodeSpec => {
    const children = (members(e) ?? []).map(id => build(byId.get(id)!));
    return { ...toNode(e), ...(children.length ? { children } : {}) };
  };
  return elements.filter(e => !nested.has(e.id)).map(build);
}
