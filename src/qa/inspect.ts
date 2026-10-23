import { loadFonts, type FontMetrics } from '../engine/fonts.js';
import { union, type Point, type Rect } from '../engine/geometry.js';
import { wordPieces } from '../engine/text.js';
import { theme } from '../core/theme.js';
import { parseXml, textContent, walk, type XmlElement } from './xml.js';
import { readPlantUmlActivity } from './plantuml-activity.js';
import { readSequence, readTiming, type Interaction } from './plantuml-interaction.js';

/**
 * Geometry extracted from a rendered SVG. Own-engine output is read exactly from
 * its data-uml-* attributes; PlantUML output is read best-effort from its
 * entity/link groups and drawing primitives.
 */
export interface InspectedNode {
  id: string;
  type: string;
  bounds: Rect;
  parent?: string;
  /** Outline when it is not the bounds rectangle (data-uml-shape), e.g. "ellipse" or "diamond". */
  shape?: string;
  /** Node whose border this node sits on (data-uml-border-of); overlapping it is intended. */
  borderOf?: string;
  /** Provided-interface ball (data-uml-ball="cx,cy,r"). */
  ball?: { x: number; y: number; r: number };
  /** Required-interface socket (data-uml-socket="cx,cy,r,ux,uy"); `u` points out of its opening. */
  socket?: { x: number; y: number; r: number; u: Point };
  /** The tab of a package (data-uml-tab); the node's outline is then the tab plus the body below it. */
  tab?: Rect;
}
export interface InspectedEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  points: Point[];
  sourceMarker: string;
  targetMarker: string;
}
export interface InspectedMarker {
  marker: string;
  end: string;
  tip: Point;
  direction: Point;
  /** Declared size (data-uml-size) when it differs from the theme's default for the marker. */
  size?: { length: number; halfWidth: number };
}
/** A free-standing message arrow beside a link (communication diagrams). */
export interface InspectedArrow {
  owner: string;
  group: string;
  source: string;
  target: string;
  marker: string;
  from: Point;
  to: Point;
  dashed: boolean;
}
export interface InspectedText {
  content: string;
  size: number;
  bold: boolean;
  italic: boolean;
  /** One box per line (tspans), in px. */
  lines: Rect[];
  /** Text of each line (tspans), in order. */
  rows: string[];
  /**
   * Line breaks that split a word where no break opportunity is (between two
   * letters of "Classifier"), or lines holding only punctuation. A break inside a
   * word is acceptable only within a piece too long for any line (see wordPieces).
   */
  badBreaks: string[];
  bounds: Rect;
  role?: string;
  owner?: string;
  /** Nearest enclosing node group (own engine) or entity (PlantUML). */
  node?: string;
  end?: string;
  anchor?: Point;
  /** data-uml-group: ties message labels to their message arrow. */
  group?: string;
}
export interface Scene {
  renderer: 'engine' | 'plantuml' | 'unknown';
  kind?: string;
  viewBox: Rect;
  nodes: InspectedNode[];
  edges: InspectedEdge[];
  markers: InspectedMarker[];
  arrows: InspectedArrow[];
  texts: InspectedText[];
  /** All coordinates of drawing primitives (best effort), for the canvas gate. */
  extents: Rect[];
  frameHeading?: Rect;
  /** Markup that must never appear (scripts, links, foreign content, event handlers). */
  unsafe: string[];
  /** True when edges, markers and labels were read exactly, so the edge gates can run. */
  exactEdges?: boolean;
  /** PlantUML interaction diagrams (sequence, timing): lifelines and messages for the message-endpoints gate. */
  interaction?: Interaction;
  /** Gates normally evaluated only on own-engine output that this PlantUML scene supplies exact data for. */
  evaluated?: string[];
}

const numbers = (s: string | undefined): number[] => (s ?? '').match(/-?\d*\.?\d+(?:e-?\d+)?/giu)?.map(Number) ?? [];
const rect4 = (s: string | undefined): Rect | undefined => {
  const [x, y, width, height] = numbers(s);
  return height === undefined ? undefined : { x: x!, y: y!, width: width!, height };
};
const point = (s: string | undefined): Point | undefined => {
  const [x, y] = numbers(s);
  return y === undefined ? undefined : { x: x!, y };
};
export const pointList = (s: string | undefined): Point[] => {
  const n = numbers(s),
    out: Point[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i]!, y: n[i + 1]! });
  return out;
};

/** End points of an SVG path (absolute and relative M/L/H/V/C/S/Q/T/A/Z); control points included. */
export function pathPoints(d: string): Point[] {
  const out: Point[] = [];
  let x = 0,
    y = 0,
    startX = 0,
    startY = 0;
  const arity: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  for (const [, command, args] of d.matchAll(/([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/gu)) {
    const values = numbers(args),
      lower = command!.toLowerCase(),
      relative = command !== command!.toUpperCase();
    const n = arity[lower]!;
    if (n === 0) {
      x = startX;
      y = startY;
      continue;
    }
    for (let i = 0; i + n <= values.length; i += n) {
      const v = values.slice(i, i + n);
      const ox = relative ? x : 0,
        oy = relative ? y : 0;
      switch (lower) {
        case 'h': {
          x = ox + v[0]!;
          break;
        }
        case 'v': {
          y = oy + v[0]!;
          break;
        }
        case 'a': {
          x = ox + v[5]!;
          y = oy + v[6]!;
          break;
        }
        default: {
          for (let k = 0; k + 1 < n - 2; k += 2) out.push({ x: ox + v[k]!, y: oy + v[k + 1]! });
          x = ox + v[n - 2]!;
          y = oy + v[n - 1]!;
        }
      }
      out.push({ x, y });
      if (lower === 'm' && i === 0) {
        startX = x;
        startY = y;
      }
    }
  }
  return out;
}

const UNSAFE_TAGS = new Set([
  'script',
  'foreignObject',
  'a',
  'image',
  'use',
  'iframe',
  'object',
  'embed',
  'animate',
  'set',
  'animateMotion',
  'animateTransform',
  'feImage',
]);

export async function inspectSvg(svg: string): Promise<Scene> {
  const metrics = await loadFonts();
  const document = parseXml(svg);
  const root = document.children.find((c): c is XmlElement => typeof c !== 'string' && c.tag === 'svg');
  if (!root) throw new Error('No <svg> root element');
  const view = numbers(root.attrs.viewBox);
  const viewBox =
    view.length === 4
      ? { x: view[0]!, y: view[1]!, width: view[2]!, height: view[3]! }
      : { x: 0, y: 0, width: Number.parseFloat(root.attrs.width ?? '0'), height: Number.parseFloat(root.attrs.height ?? '0') };
  const renderer = root.attrs['data-uml-renderer'] === 'engine' ? 'engine' : root.attrs['data-diagram-type'] ? 'plantuml' : 'unknown';
  const scene: Scene = {
    renderer,
    ...(root.attrs['data-uml-kind'] ? { kind: root.attrs['data-uml-kind'] } : {}),
    viewBox,
    nodes: [],
    edges: [],
    markers: [],
    arrows: [],
    texts: [],
    extents: [],
    unsafe: [],
  };

  for (const { element, ancestors } of walk(root)) {
    if (UNSAFE_TAGS.has(element.tag)) scene.unsafe.push(`<${element.tag}>`);
    for (const [name, value] of Object.entries(element.attrs)) {
      if (/^on/iu.test(name) || /(?:^|:)href$/iu.test(name)) scene.unsafe.push(`${element.tag} ${name}`);
      if (/url\(/iu.test(value) && name !== 'style') scene.unsafe.push(`${element.tag} ${name}=url(...)`);
    }
    if (element.tag === 'style') {
      const css = textContent(element);
      const stripped = css.replaceAll(/url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\)/gu, '');
      if (/url\(|@import|expression\(|javascript:/iu.test(stripped)) scene.unsafe.push('<style> with external reference');
    }
    if (element.attrs.style && /url\(|expression\(|javascript:/iu.test(element.attrs.style)) scene.unsafe.push(`${element.tag} style=url(...)`);
    if (element.tag === 'text') scene.texts.push(readText(element, ancestors, metrics, renderer));
  }

  if (renderer === 'engine') readEngine(root, scene);
  else
    switch (root.attrs['data-diagram-type']) {
      case 'SEQUENCE': {
        readSequence(root, scene);
        break;
      }
      case 'TIMING': {
        readTiming(root, scene);
        break;
      }
      case 'ACTIVITY': {
        readPlantUmlActivity(root, scene);
        break;
      }
      default:
        readPlantUml(root, scene);
    }
  return scene;
}

/** See InspectedText.badBreaks. */
function badBreaks(
  rows: readonly string[],
  style: { size: number; bold: boolean; italic: boolean },
  metrics: FontMetrics,
  starts: ReadonlySet<number>,
): string[] {
  const out: string[] = [];
  // A row that is a whole logical line (data-uml-starts) may be punctuation, e.g. a name "]]>".
  for (const [i, row] of rows.entries()) {
    if (rows.length > 1 && /^[\p{P}\p{S}]+$/u.test(row.trim()) && !(starts.has(i) && (starts.has(i + 1) || i === rows.length - 1)))
      out.push(`line ${JSON.stringify(row)} holds only punctuation`);
  }
  for (let i = 1; i < rows.length; i++) {
    if (starts.has(i)) continue;
    const before = rows[i - 1]!,
      after = rows[i]!;
    if (/\s$/u.test(before) || /^\s/u.test(after) || !before || !after) continue;
    const head = /\S+$/u.exec(before)![0],
      tail = /^\S+/u.exec(after)![0];
    // Is the boundary between two pieces of the word? Then it is a proper break.
    let at = 0,
      proper = false,
      piece = '';
    for (const p of wordPieces(head + tail)) {
      if (at === head.length) proper = true;
      if (at < head.length && at + p.length > head.length) piece = p;
      at += p.length;
    }
    if (proper) continue;
    if (metrics.measure(piece, style) > theme.size.maxTokenWidth) continue;
    out.push(`"${head}|${tail}" breaks a word`);
  }
  return out;
}

function readText(element: XmlElement, ancestors: XmlElement[], metrics: FontMetrics, renderer: Scene['renderer']): InspectedText {
  const size = Number.parseFloat(element.attrs['font-size'] ?? '16');
  const bold = /^(?:bold|[6-9]00)$/u.test(element.attrs['font-weight'] ?? '');
  const italic = element.attrs['font-style'] === 'italic';
  const style = { size, bold, italic };
  const ascent = metrics.ascent(size),
    descent = metrics.descent(size);
  const box = (x: number, y: number, content: string, length?: string, anchor?: string): Rect => {
    const width = length === undefined ? metrics.measure(content.trimEnd(), style) : Number.parseFloat(length);
    const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
    return { x: left, y: y - ascent, width, height: ascent + descent };
  };
  const spans = element.children.filter((c): c is XmlElement => typeof c !== 'string' && c.tag === 'tspan');
  const content = textContent(element);
  const rows = spans.length > 0 ? spans.map(s => textContent(s)) : [content];
  const lines =
    spans.length > 0
      ? spans.map(s => box(Number(s.attrs.x), Number(s.attrs.y), textContent(s), undefined, element.attrs['text-anchor']))
      : [
          box(
            Number(element.attrs.x),
            Number(element.attrs.y),
            content,
            renderer === 'plantuml' ? element.attrs.textLength : undefined,
            element.attrs['text-anchor'],
          ),
        ];
  const owner = ancestors.findLast(a => a.attrs['data-uml-role'] === 'node' || a.attrs.class === 'entity');
  // PlantUML: texts inside an entity belong to it, texts inside a link are labels.
  const plantRole = renderer === 'plantuml' ? (owner ? 'text' : ancestors.some(a => a.attrs.class === 'link') ? 'label' : undefined) : undefined;
  return {
    content: renderer === 'plantuml' ? content.replaceAll(/^\u200B|\u200B$/gu, '') : content,
    size,
    bold,
    italic,
    lines,
    rows,
    badBreaks: badBreaks(rows, style, metrics, new Set((element.attrs['data-uml-starts'] ?? '0').split(' ').map(Number))),
    bounds: union(lines),
    ...(element.attrs['data-uml-role'] ? { role: element.attrs['data-uml-role'] } : plantRole ? { role: plantRole } : {}),
    ...(element.attrs['data-uml-owner'] ? { owner: element.attrs['data-uml-owner'] } : {}),
    ...(owner ? { node: owner.attrs['data-uml-id'] ?? owner.attrs['data-entity'] ?? '' } : {}),
    ...(element.attrs['data-uml-end'] ? { end: element.attrs['data-uml-end'] } : {}),
    ...(element.attrs['data-uml-anchor'] ? { anchor: point(element.attrs['data-uml-anchor'])! } : {}),
    ...(element.attrs['data-uml-group'] ? { group: element.attrs['data-uml-group'] } : {}),
  };
}

function readEngine(root: XmlElement, scene: Scene): void {
  for (const { element } of walk(root)) {
    const a = element.attrs;
    switch (a['data-uml-role']) {
      case 'node': {
        const ball = numbers(a['data-uml-ball']),
          socket = numbers(a['data-uml-socket']);
        scene.nodes.push({
          id: a['data-uml-id'] ?? '',
          type: a['data-uml-type'] ?? '',
          bounds: rect4(a['data-uml-bounds'])!,
          ...(a['data-uml-parent'] ? { parent: a['data-uml-parent'] } : {}),
          ...(a['data-uml-shape'] ? { shape: a['data-uml-shape'] } : {}),
          ...(a['data-uml-border-of'] ? { borderOf: a['data-uml-border-of'] } : {}),
          ...(ball.length === 3 ? { ball: { x: ball[0]!, y: ball[1]!, r: ball[2]! } } : {}),
          ...(a['data-uml-tab'] ? { tab: rect4(a['data-uml-tab'])! } : {}),
          ...(socket.length === 5 ? { socket: { x: socket[0]!, y: socket[1]!, r: socket[2]!, u: { x: socket[3]!, y: socket[4]! } } } : {}),
        });

        break;
      }
      case 'edge': {
        scene.edges.push({
          id: a['data-uml-id'] ?? '',
          type: a['data-uml-type'] ?? '',
          source: a['data-uml-source'] ?? '',
          target: a['data-uml-target'] ?? '',
          points: pointList(a['data-uml-points']),
          sourceMarker: a['data-uml-source-marker'] ?? 'none',
          targetMarker: a['data-uml-target-marker'] ?? 'none',
        });

        break;
      }
      case 'message-arrow': {
        const [from, to] = pointList(a['data-uml-points']);
        const path = element.children.find((c): c is XmlElement => typeof c !== 'string' && c.tag === 'path');
        scene.arrows.push({
          owner: a['data-uml-owner'] ?? '',
          group: a['data-uml-group'] ?? '',
          source: a['data-uml-source'] ?? '',
          target: a['data-uml-target'] ?? '',
          marker: a['data-uml-marker'] ?? 'none',
          from: from!,
          to: to!,
          dashed: !!path?.attrs['stroke-dasharray'],
        });

        break;
      }
      case 'marker': {
        const size = point(a['data-uml-size']);
        scene.markers.push({
          marker: a['data-uml-marker'] ?? '',
          end: a['data-uml-end'] ?? '',
          tip: point(a['data-uml-tip'])!,
          direction: point(a['data-uml-direction'])!,
          ...(size ? { size: { length: size.x, halfWidth: size.y } } : {}),
        });

        break;
      }
      case 'frame': {
        scene.extents.push(rect4(a['data-uml-bounds'])!);
        scene.frameHeading = rect4(a['data-uml-heading'])!;

        break;
      }
      // No default
    }
  }
  for (const n of scene.nodes) scene.extents.push(n.bounds);
  for (const e of scene.edges) for (const p of e.points) scene.extents.push({ ...p, width: 0, height: 0 });
  for (const a of scene.arrows) for (const p of [a.from, a.to]) scene.extents.push({ ...p, width: 0, height: 0 });
}

/** Best effort: entity groups give nodes, primitives give extents. */
function readPlantUml(root: XmlElement, scene: Scene): void {
  for (const { element } of walk(root)) {
    const a = element.attrs;
    if (element.tag === 'g' && a.class === 'entity') {
      const shapes: Rect[] = [];
      for (const { element: child } of walk(element)) {
        if (child.tag === 'rect')
          shapes.push({ x: Number(child.attrs.x), y: Number(child.attrs.y), width: Number(child.attrs.width), height: Number(child.attrs.height) });
        if (child.tag === 'path' || child.tag === 'polygon')
          shapes.push(union((child.attrs.d ? pathPoints(child.attrs.d) : pointList(child.attrs.points)).map(p => ({ ...p, width: 0, height: 0 }))));
      }
      if (shapes.length > 0) scene.nodes.push({ id: a['data-entity'] ?? a.id ?? '', type: 'entity', bounds: union(shapes) });
    }
    if (element.tag === 'rect') scene.extents.push({ x: Number(a.x ?? 0), y: Number(a.y ?? 0), width: Number(a.width ?? 0), height: Number(a.height ?? 0) });
    if (element.tag === 'line')
      scene.extents.push(
        union([
          { x: Number(a.x1), y: Number(a.y1), width: 0, height: 0 },
          { x: Number(a.x2), y: Number(a.y2), width: 0, height: 0 },
        ]),
      );
    if (element.tag === 'polygon' || element.tag === 'polyline' || element.tag === 'path') {
      const pts = a.d ? pathPoints(a.d) : pointList(a.points);
      if (pts.length > 0) scene.extents.push(union(pts.map(p => ({ ...p, width: 0, height: 0 }))));
    }
    if (element.tag === 'ellipse')
      scene.extents.push({ x: Number(a.cx) - Number(a.rx), y: Number(a.cy) - Number(a.ry), width: 2 * Number(a.rx), height: 2 * Number(a.ry) });
  }
}
