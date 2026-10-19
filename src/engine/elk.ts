import ElkModule from 'elkjs/lib/elk.bundled.js';
import type { ELK as ElkApi, ElkExtendedEdge, ElkLabel, ElkNode } from 'elkjs/lib/elk-api.js';
import { theme } from '../core/theme.js';
import { simplify, type Point, type Rect } from './geometry.js';

/**
 * Typed adapter over elkjs (ELK Layered, pinned 0.11.1). Kinds describe nodes
 * (optionally nested, optionally with fixed-side ports), edges and edge label sizes;
 * the adapter returns absolute geometry. Proven on fixtures (test/engine.test.mjs):
 * center/head/tail edge labels get reserved space, fixed-side ports are respected
 * (a shared port gives UML generalization trees), compound nodes with
 * cross-hierarchy edges work with INCLUDE_CHILDREN. Self-loops are NOT given to
 * ELK (its loops are cramped and their labels collide): route them with
 * src/engine/selfloops.ts and reserve room with `reserveRight`.
 */

export type Side = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';
export type Direction = 'DOWN' | 'UP' | 'RIGHT' | 'LEFT';

export interface LayoutPort {
  id: string;
  side: Side;
  /**
   * Width along the node side. Ports are spaced by their widths, so a port as
   * wide as the labels at an edge end keeps neighbouring edges far enough apart
   * for those labels. The edge attaches at the port's middle.
   */
  width?: number;
  /**
   * Fixed position of the port's middle relative to the node's top-left corner.
   * When any port of a node has a position, the node uses FIXED_POS port
   * constraints (e.g. the four vertices of a decision diamond, which are the only
   * points of a diamond on its bounding box).
   */
  position?: Point;
}
export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  /**
   * Nested nodes (compound node). The node's size is then computed by ELK from its
   * children and padding; `width` and `height` are ignored (ELK 0.11 does not
   * apply a minimum size to compound nodes; widen them through `padding`).
   */
  children?: LayoutNode[];
  /**
   * Compound nodes only: treat `width` and `height` as the minimum size (e.g. a
   * name compartment wider than the children). Applied with ELK's MINIMUM_SIZE
   * node size constraint, which ELK 0.11 does honor for compound nodes when it is
   * set explicitly (test/engine-structure.test.mjs).
   */
  minimumSize?: boolean;
  /** Inner padding of a compound node (room for a package tab, a name compartment...). */
  padding?: { top: number; left: number; bottom: number; right: number };
  ports?: LayoutPort[];
  /** Keep exactly this size even with ports (small symbols such as pseudostates). */
  fixedSize?: boolean;
  /** Free space to keep at the right of the node (self-loops and their labels). */
  reserveRight?: number;
  /** Free space to keep above and below the node at its right end (self-loops on its corners). */
  reserveAbove?: { width: number; height: number } | undefined;
  reserveBelow?: { width: number; height: number } | undefined;
  /**
   * Room to keep free below the node for a caption drawn under it (an actor's
   * name): a centered box of this size directly under the node.
   */
  labelBelow?: { width: number; height: number };
  /**
   * Free space to keep above the node's top-left corner (a package tab): the node
   * itself is then only the part edges attach to (the package body).
   */
  reserveTop?: { width: number; height: number };
  /**
   * Minimum distance between edge attachment points on this node's sides. For a
   * compound node this also spaces the points where edges cross its border
   * (ELK creates hidden ports there), so arrowheads ending on it do not touch.
   */
  portSpacing?: number;
  /** Extra ELK layout options of this node (e.g. a layer constraint). */
  elk?: Record<string, string>;
}
export interface LayoutLabel { id: string; width: number; height: number; placement: 'center' | 'head' | 'tail' }
export interface LayoutEdge {
  id: string;
  /** Node or port ID. ELK direction: the source tends to be placed before the target. */
  source: string;
  target: string;
  labels?: LayoutLabel[];
  /** Higher values make ELK keep this edge pointing in the layout direction. */
  directionPriority?: number;
  /** Higher values make ELK node placement keep this edge straight (fewer jogs, lines into a bundle hub). */
  straightness?: number;
}
export interface LayoutOptions {
  direction: Direction;
  /** Edge routing: orthogonal (default) or polyline (straight segments, bends between layers). */
  routing?: 'orthogonal' | 'polyline';
  /** Extra ELK layout options for the root graph, overriding the defaults (kind-specific tuning). */
  elk?: Record<string, string>;
  nodeSpacing?: number;
  layerSpacing?: number;
}
export interface LayoutResult {
  width: number;
  height: number;
  nodes: Map<string, Rect>;
  ports: Map<string, Point>;
  edges: Map<string, { points: Point[]; labels: Map<string, Rect> }>;
}

// elkjs is CommonJS; its constructor is the module itself (also exposed as .default).
const ElkConstructor = ((ElkModule as unknown as { default?: unknown }).default ?? ElkModule) as new () => ElkApi;
const elk = new ElkConstructor();

export async function layout(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], options: LayoutOptions): Promise<LayoutResult> {
  // elkjs 0.11.1 applies a compound node's minimum size with width and height
  // swapped when the layout direction is vertical (INCLUDE_CHILDREN); compensate.
  const vertical = options.direction === 'DOWN' || options.direction === 'UP';
  const minimum = (node: LayoutNode): string => node.children?.length && vertical ? `(${node.height}, ${node.width})` : `(${node.width}, ${node.height})`;
  // Spacing applies per graph level: compound nodes (packages) need it too, or
  // their children are laid out with ELK's tight defaults.
  const spacing = {
    'elk.spacing.nodeNode': String(options.nodeSpacing ?? theme.spacing.nodeNode),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(options.layerSpacing ?? theme.spacing.layer),
    'elk.spacing.edgeNode': '18',
    'elk.layered.spacing.edgeNodeBetweenLayers': '26',
    'elk.spacing.edgeEdge': String(theme.spacing.edgeEdge),
    'elk.layered.spacing.edgeEdgeBetweenLayers': String(theme.spacing.edgeEdge),
    'elk.spacing.edgeLabel': String(theme.spacing.edgeLabel + 2),
    'elk.spacing.labelLabel': '4',
  };
  const toElk = (node: LayoutNode, nested = false): ElkNode => ({
    id: node.id,
    ...(node.children?.length ? {} : { width: node.width, height: node.height }),
    ...(node.children?.length ? { children: node.children.map(c => toElk(c, true)) } : {}),
    ...(node.ports?.length ? { ports: node.ports.map(p => {
      const horizontal = p.side === 'NORTH' || p.side === 'SOUTH';
      const width = horizontal ? p.width ?? 0 : 0, height = horizontal ? 0 : p.width ?? 0;
      return {
        id: p.id, width, height, layoutOptions: { 'elk.port.side': p.side },
        ...(p.position ? { x: p.position.x - width / 2, y: p.position.y - height / 2 } : {}),
      };
    }) } : {}),
    // An invisible outside label reserves room right of the node. Its text must not
    // be empty: ELK ignores empty labels when computing node margins.
    ...(node.reserveRight || node.reserveTop || node.labelBelow || node.reserveAbove || node.reserveBelow ? { labels: [
      ...(node.reserveAbove ? [{ id: `${node.id}::reserve-above`, text: 'reserved', width: node.reserveAbove.width, height: node.reserveAbove.height, layoutOptions: { 'elk.nodeLabels.placement': '[OUTSIDE, H_RIGHT, V_TOP]' } }] : []),
      ...(node.reserveBelow ? [{ id: `${node.id}::reserve-below`, text: 'reserved', width: node.reserveBelow.width, height: node.reserveBelow.height, layoutOptions: { 'elk.nodeLabels.placement': '[OUTSIDE, H_RIGHT, V_BOTTOM]' } }] : []),
      ...(node.reserveRight ? [{ id: `${node.id}::reserve`, text: 'reserved', width: node.reserveRight, height: Math.max(1, node.height - 2), layoutOptions: { 'elk.nodeLabels.placement': '[OUTSIDE, H_RIGHT, V_CENTER]' } }] : []),
      ...(node.reserveTop ? [{ id: `${node.id}::reserve-top`, text: 'reserved', width: node.reserveTop.width, height: node.reserveTop.height, layoutOptions: { 'elk.nodeLabels.placement': '[OUTSIDE, H_LEFT, V_TOP]' } }] : []),
      ...(node.labelBelow ? [{ id: `${node.id}::below`, text: 'caption', width: node.labelBelow.width, height: node.labelBelow.height, layoutOptions: { 'elk.nodeLabels.placement': '[OUTSIDE, H_CENTER, V_BOTTOM]' } }] : []),
    ] } : {}),
    layoutOptions: {
      ...(node.children?.length ? spacing : {}),
      ...(node.children?.length && node.minimumSize ? {
        'elk.nodeSize.constraints': '[MINIMUM_SIZE]',
        'elk.nodeSize.minimum': minimum(node),
      } : {}),
      ...(node.ports?.length ? {
        'elk.portConstraints': node.ports.some(p => p.position) ? 'FIXED_POS' : 'FIXED_SIDE',
        // Grow the node if its ports need more room than its content.
        ...(node.fixedSize ? { 'elk.nodeSize.constraints': '[]' } : {
          'elk.nodeSize.constraints': '[PORTS, MINIMUM_SIZE]',
          'elk.nodeSize.minimum': minimum(node),
        }),
        'elk.spacing.portPort': '6',
        // Inside a compound node, an individual override: otherwise the parent's
        // port spacing would also size this node's sides (see LayoutNode.portSpacing).
        ...(nested ? { 'elk.spacing.individual': 'org.eclipse.elk.spacing.portPort:6' } : {}),
      } : {}),
      ...(node.portSpacing ? { 'elk.spacing.portPort': String(node.portSpacing) } : {}),
      ...(node.padding ? { 'elk.padding': `[top=${node.padding.top},left=${node.padding.left},bottom=${node.padding.bottom},right=${node.padding.right}]` } : {}),
      'elk.spacing.labelNode': '0',
      ...node.elk,
    },
  });
  const graph: ElkNode = {
    id: '::root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': options.direction,
      'elk.edgeRouting': options.routing === 'polyline' ? 'POLYLINE' : 'ORTHOGONAL',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.randomSeed': '1',
      'elk.padding': '[top=0,left=0,bottom=0,right=0]',
      ...spacing,
      'elk.edgeLabels.inline': 'false',
      'elk.layered.edgeLabels.sideSelection': 'SMART_DOWN',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.cycleBreaking.strategy': 'GREEDY_MODEL_ORDER',
      'elk.layered.thoroughness': '20',
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': String(options.nodeSpacing ?? theme.spacing.nodeNode),
      ...options.elk,
    },
    children: nodes.map(n => toElk(n)),
    edges: edges.map((e): ElkExtendedEdge => ({
      id: e.id, sources: [e.source], targets: [e.target],
      labels: (e.labels ?? []).map((l): ElkLabel => ({
        id: l.id, text: l.id, width: l.width, height: l.height,
        layoutOptions: { 'elk.edgeLabels.placement': l.placement.toUpperCase() },
      })),
      ...(e.directionPriority || e.straightness ? { layoutOptions: {
        ...(e.directionPriority ? { 'elk.layered.priority.direction': String(e.directionPriority) } : {}),
        ...(e.straightness ? { 'elk.layered.priority.straightness': String(e.straightness) } : {}),
      } } : {}),
    })),
  };
  const result = await elk.layout(graph);

  const nodeRects = new Map<string, Rect>(), ports = new Map<string, Point>();
  const offsets = new Map<string, Point>([['::root', { x: 0, y: 0 }]]);
  const visit = (node: ElkNode, origin: Point): void => {
    for (const child of node.children ?? []) {
      const at = { x: origin.x + (child.x ?? 0), y: origin.y + (child.y ?? 0) };
      offsets.set(child.id, at);
      nodeRects.set(child.id, { x: at.x, y: at.y, width: child.width ?? 0, height: child.height ?? 0 });
      for (const port of child.ports ?? []) ports.set(port.id, { x: at.x + (port.x ?? 0) + (port.width ?? 0) / 2, y: at.y + (port.y ?? 0) + (port.height ?? 0) / 2 });
      visit(child, at);
    }
  };
  visit(result, { x: 0, y: 0 });

  const edgeResults = new Map<string, { points: Point[]; labels: Map<string, Rect> }>();
  const collect = (node: ElkNode): void => {
    for (const edge of node.edges ?? []) {
      const origin = offsets.get(edge.container ?? node.id) ?? { x: 0, y: 0 };
      const points: Point[] = [];
      for (const section of edge.sections ?? []) {
        for (const p of [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]) points.push({ x: origin.x + p.x, y: origin.y + p.y });
      }
      const labels = new Map<string, Rect>();
      for (const label of edge.labels ?? []) {
        labels.set(label.id!, { x: origin.x + (label.x ?? 0), y: origin.y + (label.y ?? 0), width: label.width ?? 0, height: label.height ?? 0 });
      }
      edgeResults.set(edge.id, { points: simplify(points), labels });
    }
    for (const child of node.children ?? []) collect(child);
  };
  collect(result);
  return { width: result.width ?? 0, height: result.height ?? 0, nodes: nodeRects, ports, edges: edgeResults };
}
