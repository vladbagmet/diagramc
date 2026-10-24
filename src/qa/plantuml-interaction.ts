import { theme } from '../core/theme.js';
import { boundsOfPoints, contains, distance, segmentIntersectsRect, union, type Point, type Rect } from '../engine/geometry.js';
import type { GateResult } from './gates.js';
import { pathPoints, pointList, type InspectedNode, type InspectedText, type Scene } from './inspect.js';
import { walk, type XmlElement } from './xml.js';

/**
 * Readers and gates for PlantUML's interaction diagrams (SEQUENCE and TIMING),
 * whose SVG has no entity/link groups. The readers classify PlantUML's drawing
 * primitives (using the fixed theme colors the kinds generate) into lifeline
 * heads, lifelines, activation bars, messages, notes, frames and labels, merge
 * wrapped text lines back into one text per input string, and record the
 * geometry the `message-endpoints` gate checks.
 */

/** `order`: position in drawing order; a shape hides only what was drawn before it. */
export interface InteractionLifeline {
  id: string;
  x: number;
  top: number;
  bottom: number;
  order?: number;
}
export interface InteractionArrowhead {
  style: 'filled' | 'open';
  tip: Point;
  direction: Point;
}
export interface InteractionMessage {
  id: string;
  /** Lifeline alias at the sending end; undefined for a found message. */
  source?: string;
  /** Lifeline alias at the receiving end; undefined for a lost message. */
  target?: string;
  /** Polyline from the sending end to the receiving end. */
  points: Point[];
  dashed: boolean;
  head?: InteractionArrowhead;
  /** Filled circle of a found (at the start) or lost (at the end) message. */
  circle?: Point;
}
export interface Interaction {
  diagram: 'sequence' | 'timing';
  lifelines: InteractionLifeline[];
  /** Activation bars (sequence) with the lifeline they sit on. */
  bars: (Rect & { lifeline: string; order?: number })[];
  messages: InteractionMessage[];
  /** Heads of created lifelines: messages to them end on the head's border. */
  createdHeads: Map<string, Rect>;
  /** Timing: waveform segments that message ends must touch. */
  waveforms: { a: Point; b: Point }[];
  /**
   * Sequence: opaque shapes drawn on top of lifelines and activation bars (heads,
   * notes, state invariants, interaction uses, fragment tabs, label halos). A
   * lifeline or bar drawn before one of them and passing under it is hidden, not
   * crossing its text; one drawn after it is still seen. `text`: the shape only
   * backs a text (label halo, state invariant), so an activation bar hidden by it
   * reads as interrupted.
   */
  occluders: (Rect & { order?: number; text?: boolean })[];
  /** Timing: dashed highlight and time-window borders and dotted duration-constraint extension lines. */
  guides?: { a: Point; b: Point }[];
  /** Timing: the band of each lifeline, top to bottom. */
  rows?: { top: number; bottom: number }[];
}

const num = (s: string | undefined): number => Number(s ?? 0);
const styleOf = (e: XmlElement): { stroke?: string; width?: number; dashed: boolean } => {
  const style = e.attrs.style ?? '';
  const stroke = /stroke:(#[0-9A-Fa-f]{6}|none)/u.exec(style)?.[1];
  const width = /stroke-width:([\d.]+)/u.exec(style)?.[1];
  return { ...(stroke ? { stroke } : {}), ...(width ? { width: Number(width) } : {}), dashed: style.includes('stroke-dasharray') };
};
const elements = (e: XmlElement): XmlElement[] => e.children.filter((c): c is XmlElement => typeof c !== 'string');
const shapeBounds = (e: XmlElement): Rect | undefined => {
  const a = e.attrs;
  switch (e.tag) {
    case 'rect':
      return { x: num(a.x), y: num(a.y), width: num(a.width), height: num(a.height) };
    case 'ellipse':
      return { x: num(a.cx) - num(a.rx), y: num(a.cy) - num(a.ry), width: 2 * num(a.rx), height: 2 * num(a.ry) };
    case 'line':
      return boundsOfPoints([
        { x: num(a.x1), y: num(a.y1) },
        { x: num(a.x2), y: num(a.y2) },
      ]);
    case 'polygon':
    case 'polyline': {
      const p = pointList(a.points);
      return p.length > 0 ? boundsOfPoints(p) : undefined;
    }
    case 'path': {
      const p = pathPoints(a.d ?? '');
      return p.length > 0 ? boundsOfPoints(p) : undefined;
    }
    default:
      return undefined;
  }
};
const lineEnds = (e: XmlElement): [Point, Point] => [
  { x: num(e.attrs.x1), y: num(e.attrs.y1) },
  { x: num(e.attrs.x2), y: num(e.attrs.y2) },
];
const near = (a: Point, b: Point, tolerance = 0.6): boolean => distance(a, b) <= tolerance;

/** Joins wrapped lines of one input string into a single inspected text. */
function merge(parts: InspectedText[], extra: Partial<InspectedText>): InspectedText {
  const lines = parts.flatMap(p => p.lines);
  const first = parts[0]!;
  const { role: _role, node: _node, owner: _owner, ...base } = first;
  return { ...base, content: parts.map(p => p.content).join(''), lines, bounds: union(lines), ...extra };
}

/** Pairs every <text> element with the InspectedText inspectSvg built for it (same document order). */
function textMap(root: XmlElement, texts: InspectedText[]): Map<XmlElement, InspectedText> {
  const map = new Map<XmlElement, InspectedText>();
  let i = 0;
  for (const { element } of walk(root)) if (element.tag === 'text') map.set(element, texts[i++]!);
  return map;
}

/** All drawing primitives' bounds, for the inside-canvas gate. */
function addExtents(root: XmlElement, scene: Scene): void {
  for (const { element } of walk(root)) {
    if (element.tag === 'text' || element.tag === 'svg' || element.tag === 'g') continue;
    const b = shapeBounds(element);
    if (b && [b.x, b.y, b.width, b.height].every(Number.isFinite)) scene.extents.push(b);
  }
}

/** Splits a message group's primitives into its line, arrowhead and found/lost circle. */
function readMessage(group: XmlElement, id: string): InteractionMessage & { texts: XmlElement[] } {
  const parts = elements(group);
  const texts = parts.filter(e => e.tag === 'text');
  const lines = parts.filter(e => e.tag === 'line').map(e => ({ e, ends: lineEnds(e), style: styleOf(e) }));
  let head: InteractionArrowhead | undefined;
  const polygon = parts.find(e => e.tag === 'polygon');
  if (polygon) {
    const p = pointList(polygon.attrs.points);
    const tipIndex = p.map((v, i) => p.reduce((s, w, j) => s + (i === j ? 0 : distance(v, w)), 0)).reduce((best, s, i, all) => (s > all[best]! ? i : best), 0);
    const tip = p[tipIndex]!;
    const others = p.filter((_, i) => i !== tipIndex);
    const base = { x: others.reduce((s, v) => s + v.x, 0) / others.length, y: others.reduce((s, v) => s + v.y, 0) / others.length };
    const length = distance(tip, base) || 1;
    head = { style: 'filled', tip, direction: { x: (tip.x - base.x) / length, y: (tip.y - base.y) / length } };
  }
  // An open arrowhead: two short lines from one tip point.
  const short = lines.filter(l => distance(l.ends[0], l.ends[1]) <= 16 && !l.style.dashed);
  const used = new Set<XmlElement>();
  if (!head) {
    for (let i = 0; i < short.length && !head; i++)
      for (let j = i + 1; j < short.length && !head; j++) {
        const a = short[i]!,
          b = short[j]!;
        for (const ta of a.ends)
          for (const tb of b.ends) {
            if (head || !near(ta, tb)) continue;
            const oa = a.ends.find(p => p !== ta)!,
              ob = b.ends.find(p => p !== tb)!;
            const base = { x: (oa.x + ob.x) / 2, y: (oa.y + ob.y) / 2 };
            const length = distance(ta, base) || 1;
            head = { style: 'open', tip: ta, direction: { x: (ta.x - base.x) / length, y: (ta.y - base.y) / length } };
            used.add(a.e).add(b.e);
          }
      }
  }
  // Remaining lines form the message path; chain them end to end.
  const segments = lines.filter(l => !used.has(l.e));
  const dashed = segments.some(s => s.style.dashed);
  let points: Point[] = [];
  if (segments.length > 0) {
    const pool = segments.map(s => s.ends);
    points = [...pool.shift()!];
    while (pool.length > 0) {
      const k = pool.findIndex(([a, b]) => near(a, points.at(-1)!, 1) || near(b, points.at(-1)!, 1) || near(a, points[0]!, 1) || near(b, points[0]!, 1));
      if (k === -1) break;
      const [a, b] = pool.splice(k, 1)[0]!;
      if (near(a, points.at(-1)!, 1)) points.push(b);
      else if (near(b, points.at(-1)!, 1)) points.push(a);
      else if (near(b, points[0]!, 1)) points.unshift(a);
      else points.unshift(b);
    }
    // Orient the path so that it ends at the arrowhead.
    if (head && distance(points[0]!, head.tip) < distance(points.at(-1)!, head.tip)) points.reverse();
  }
  const ellipse = parts.find(e => e.tag === 'ellipse');
  const circle = ellipse ? { x: num(ellipse.attrs.cx), y: num(ellipse.attrs.cy) } : undefined;
  return { id, points, dashed, ...(head ? { head } : {}), ...(circle ? { circle } : {}), texts };
}

/**
 * SEQUENCE: reads PlantUML's participant, lifeline, activation and message
 * groups and the loose primitives in between (created heads, notes, state
 * invariants, fragments, interaction uses, destruction crosses).
 */
export function readSequence(root: XmlElement, scene: Scene): void {
  const { color, font } = theme;
  const textOf = textMap(root, scene.texts);
  const out: InspectedText[] = [];
  const interaction: Interaction = { diagram: 'sequence', lifelines: [], bars: [], messages: [], createdHeads: new Map(), waveforms: [], occluders: [] };
  scene.interaction = interaction;
  scene.evaluated = ['label-edge-crossing'];
  const main = elements(root).find(e => e.tag === 'g');
  if (!main) return;
  const items = elements(main);
  const used = new Set<XmlElement>();
  const take = (e: XmlElement): InspectedText => {
    used.add(e);
    return textOf.get(e)!;
  };
  const fill = (e: XmlElement): string => e.attrs.fill ?? '';
  let lastTarget: string | undefined;
  let nodeCount = 0;

  for (let i = 0; i < items.length; i++) {
    const e = items[i]!;
    const kids = e.tag === 'g' ? elements(e) : [];
    const cls = e.attrs.class ?? '';
    if (e.tag === 'g' && cls.includes('participant-head')) {
      const id = e.attrs['data-participant'] ?? '';
      const shapes = kids
        .filter(k => k.tag !== 'text')
        .map(shapeBounds)
        .filter((b): b is Rect => !!b);
      const texts = kids.filter(k => k.tag === 'text').map(take);
      const box = kids.find(k => k.tag === 'rect');
      const bounds = box ? shapeBounds(box)! : union([...shapes, ...texts.map(t => t.bounds)]);
      scene.nodes.push({ id, type: 'lifeline-head', bounds });
      if (box) interaction.occluders.push({ ...bounds, order: i });
      if (texts.length > 0) out.push(merge(texts, { role: 'text', node: id }));
      continue;
    }
    if (e.tag === 'g' && cls.includes('message')) {
      const id = `message${interaction.messages.length}`;
      const message = readMessage(e, id);
      for (const halo of kids.filter(k => k.tag === 'rect' && fill(k) === color.labelHalo))
        interaction.occluders.push({ ...shapeBounds(halo)!, order: i, text: true });
      const source = e.attrs['data-participant-1'],
        target = e.attrs['data-participant-2'];
      const texts = message.texts.map(take);
      const numbers = texts.filter(t => t.bold && /^\d+$/u.test(t.content));
      const label = texts.filter(t => !numbers.includes(t));
      for (const n of numbers) out.push({ ...n, role: 'label', owner: id });
      if (label.length > 0) out.push(merge(label, { role: 'label', owner: id }));
      const { texts: _texts, ...rest } = message;
      // PlantUML gives found and lost messages the known lifeline at both ends.
      const found =
        message.circle !== undefined &&
        message.points.length > 0 &&
        distance(message.circle, message.points[0]!) <= distance(message.circle, message.points.at(-1)!);
      const lost = message.circle !== undefined && !found;
      interaction.messages.push({ ...rest, ...(found ? {} : { source }), ...(lost ? {} : { target }) });
      scene.edges.push({ id, type: 'message', source: source ?? '', target: target ?? '', points: message.points, sourceMarker: 'none', targetMarker: 'none' });
      lastTarget = target;
      continue;
    }
    if (e.tag === 'g') {
      const hit = kids.some(k => k.tag === 'rect' && k.attrs['fill-opacity'] !== undefined);
      const line = kids.find(k => k.tag === 'line');
      if (hit && line) {
        const [a, b] = lineEnds(line);
        interaction.lifelines.push({ id: '', x: a.x, top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y), order: i });
        continue;
      }
      const bar = kids.find(k => k.tag === 'rect');
      if (bar) interaction.bars.push({ ...shapeBounds(bar)!, lifeline: '', order: i });
      continue;
    }
    // Loose primitives.
    if (e.tag === 'rect' && fill(e) === color.nodeHeaderFill && lastTarget) {
      // The head of a lifeline created by the preceding create message.
      const bounds = shapeBounds(e)!;
      const texts: InspectedText[] = [];
      while (items[i + 1]?.tag === 'text' && contains(bounds, textOf.get(items[i + 1]!)!.bounds, 2)) texts.push(take(items[++i]!));
      scene.nodes.push({ id: lastTarget, type: 'lifeline-head', bounds });
      interaction.createdHeads.set(lastTarget, bounds);
      interaction.occluders.push({ ...bounds, order: i });
      if (texts.length > 0) out.push(merge(texts, { role: 'text', node: lastTarget }));
      continue;
    }
    if (lastTarget && ((e.tag === 'text' && num(e.attrs['font-size']) === font.size.name) || isHeadIcon(e)) && scene.nodes.every(n => n.id !== lastTarget)) {
      // A created lifeline drawn as an icon: its text and icon shapes follow the create message.
      const group: XmlElement[] = [e];
      while (items[i + 1] && ((items[i + 1]!.tag === 'text' && num(items[i + 1]!.attrs['font-size']) === font.size.name) || isHeadIcon(items[i + 1]!)))
        group.push(items[++i]!);
      const texts = group.filter(g => g.tag === 'text').map(take);
      const bounds = union([...group.filter(g => g.tag !== 'text').map(g => shapeBounds(g)!), ...texts.map(t => t.bounds)]);
      scene.nodes.push({ id: lastTarget, type: 'lifeline-head', bounds });
      interaction.createdHeads.set(lastTarget, bounds);
      if (texts.length > 0) out.push(merge(texts, { role: 'text', node: lastTarget }));
      continue;
    }
    if (e.tag === 'path' && fill(e) === color.noteFill) {
      const bounds = shapeBounds(e)!;
      const id = `note${nodeCount++}`;
      if (items[i + 1]?.tag === 'path' && fill(items[i + 1]!) === color.noteFill) i++; // folded corner
      const texts: InspectedText[] = [];
      while (items[i + 1]?.tag === 'text' && contains(bounds, textOf.get(items[i + 1]!)!.bounds, 2)) texts.push(take(items[++i]!));
      scene.nodes.push({ id, type: 'note', bounds });
      interaction.occluders.push({ ...bounds, order: i });
      if (texts.length > 0) out.push(merge(texts, { role: 'text', node: id }));
      continue;
    }
    if (e.tag === 'rect' && fill(e) === color.background && styleOf(e).stroke === color.background) {
      // State invariant: constraint text in braces on the lifeline.
      const bounds = shapeBounds(e)!;
      const id = `invariant${nodeCount++}`;
      const texts: InspectedText[] = [];
      while (items[i + 1]?.tag === 'text' && contains(bounds, textOf.get(items[i + 1]!)!.bounds, 2)) texts.push(take(items[++i]!));
      scene.nodes.push({ id, type: 'state-invariant', bounds });
      interaction.occluders.push({ ...bounds, order: i, text: true });
      if (texts.length > 0) out.push(merge(texts, { role: 'text', node: id }));
      continue;
    }
    if (
      e.tag === 'rect' &&
      (fill(e) === 'none' || fill(e) === color.background) &&
      i > 1 &&
      items[i + 1]?.tag === 'path' &&
      fill(items[i + 1]!) === color.frameHeadingFill
    ) {
      // Interaction use: frame (opaque), "ref" tab, then the referenced name inside.
      const bounds = shapeBounds(e)!;
      const id = `ref${nodeCount++}`;
      if (fill(e) === color.background) interaction.occluders.push({ ...bounds, order: i });
      i++;
      interaction.occluders.push({ ...shapeBounds(items[i]!)!, order: i });
      const texts: InspectedText[] = [];
      while (items[i + 1]?.tag === 'text' && contains(bounds, textOf.get(items[i + 1]!)!.bounds, 2)) texts.push(take(items[++i]!));
      scene.nodes.push({ id, type: 'interaction-use', bounds });
      const [keyword, ...name] = texts;
      if (keyword) out.push({ ...keyword, role: 'text', node: id });
      if (name.length > 0) out.push(merge(name, { role: 'text', node: id }));
      continue;
    }
    if (e.tag === 'path' && fill(e) === color.frameHeadingFill && i > 1) {
      // Fragment pentagon (operator tab), drawn over lifelines and bars.
      interaction.occluders.push({ ...shapeBounds(e)!, order: i });
      continue;
    }
    if (e.tag === 'rect' && fill(e) === color.labelHalo && e.attrs.style === undefined && i > 0) {
      // Halo painted behind a guard by post-processing.
      interaction.occluders.push({ ...shapeBounds(e)!, order: i, text: true });
      continue;
    }
    if (e.tag === 'line' && items[i + 1]?.tag === 'line' && isCross(e, items[i + 1]!)) {
      // Destruction occurrence: the two diagonals of one square.
      const [a, b] = lineEnds(e);
      scene.markers.push({ marker: 'cross', end: 'target', tip: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, direction: { x: 0, y: 1 } });
      i++;
    }
  }

  // Remaining texts: frame heading, fragment operators and guards.
  const frame = items[0]?.tag === 'rect' && items[1]?.tag === 'path' && fill(items[1]) === color.frameHeadingFill ? shapeBounds(items[1]) : undefined;
  if (frame) scene.frameHeading = frame;
  for (const [element, text] of textOf) {
    if (used.has(element)) continue;
    out.push(frame && contains(frame, text.bounds, 2) ? { ...text, role: 'frame-label' } : { ...text, role: 'label', owner: 'fragment' });
  }

  // Attach lifelines and bars to heads by x position.
  const heads = scene.nodes.filter(n => n.type === 'lifeline-head');
  const centre = (n: InspectedNode): number => n.bounds.x + n.bounds.width / 2;
  for (const l of interaction.lifelines) {
    const head = heads
      .filter(n => l.x >= n.bounds.x && l.x <= n.bounds.x + n.bounds.width)
      .reduce<InspectedNode | undefined>((best, n) => (!best || Math.abs(centre(n) - l.x) < Math.abs(centre(best) - l.x) ? n : best), undefined);
    if (head) l.id = head.id;
  }
  for (const b of interaction.bars) {
    const mid = b.x + b.width / 2;
    const l = interaction.lifelines.reduce<InteractionLifeline | undefined>(
      (best, c) => (!best || Math.abs(c.x - mid) < Math.abs(best.x - mid) ? c : best),
      undefined,
    );
    if (l) b.lifeline = l.id;
  }
  scene.texts = out;
  addExtents(root, scene);
}

function isCross(a: XmlElement, b: XmlElement): boolean {
  const [p, q] = lineEnds(a),
    [r, t] = lineEnds(b);
  const w = Math.abs(q.x - p.x),
    h = Math.abs(q.y - p.y);
  return w > 10 && Math.abs(w - h) < 0.01 && p.x === r.x && q.x === t.x && p.y === t.y && q.y === r.y;
}

function isHeadIcon(e: XmlElement): boolean {
  const s = styleOf(e);
  return (
    (e.tag === 'ellipse' || e.tag === 'path' || e.tag === 'line' || e.tag === 'polygon') &&
    s.width === theme.stroke.node &&
    !s.dashed &&
    (e.attrs.fill === theme.color.nodeFill || e.attrs.fill === 'none' || e.tag === 'line' || e.tag === 'polygon')
  );
}

/**
 * `message-endpoints`: every message starts and ends on its lifelines (the dashed
 * line, an activation bar's border, or a created lifeline's head), carries its
 * arrowhead at the receiving end pointing along the line, and found/lost messages
 * have their circle at the unknown end.
 */
export function interactionGates(scene: Scene): GateResult[] {
  const interaction = scene.interaction;
  if (!interaction) return [];
  const failures: string[] = [];
  const tolerance = 3;
  const at = (p: Point): string => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`;
  if (interaction.diagram === 'sequence') {
    const onLifeline = (id: string, p: Point): boolean => {
      const head = interaction.createdHeads.get(id);
      if (
        head &&
        p.y >= head.y - tolerance &&
        p.y <= head.y + head.height + tolerance &&
        (Math.abs(p.x - head.x) <= tolerance || Math.abs(p.x - head.x - head.width) <= tolerance)
      )
        return true;
      const line = interaction.lifelines.find(l => l.id === id);
      if (!line || p.y < line.top - tolerance || p.y > line.bottom + tolerance) return false;
      return Math.abs(p.x - line.x) <= tolerance
        ? true
        : interaction.bars.some(
            b =>
              b.lifeline === id &&
              p.y >= b.y - tolerance &&
              p.y <= b.y + b.height + tolerance &&
              (Math.abs(p.x - b.x) <= tolerance || Math.abs(p.x - b.x - b.width) <= tolerance),
          );
    };
    for (const m of interaction.messages) {
      if (m.points.length < 2) {
        failures.push(`${m.id} has no line`);
        continue;
      }
      // The receiving end is the arrowhead's tip (PlantUML stops the line inside a filled head).
      const start = m.points[0]!,
        end = m.head && m.target !== undefined ? m.head.tip : m.points.at(-1)!;
      if (m.source !== undefined && !onLifeline(m.source, start)) failures.push(`${m.id} starts at ${at(start)}, not on lifeline ${m.source}`);
      if (m.target !== undefined && !onLifeline(m.target, end)) failures.push(`${m.id} ends at ${at(end)}, not on lifeline ${m.target}`);
      if (m.source === undefined || m.target === undefined) {
        const free = m.source === undefined ? start : (m.head?.tip ?? m.points.at(-1)!);
        if (!m.circle || distance(m.circle, free) > 9) failures.push(`${m.id}: found/lost message without a circle at its open end ${at(free)}`);
      }
      checkHead(m, failures, at);
    }
  } else {
    const onWave = (p: Point): boolean => interaction.waveforms.some(({ a, b }) => distanceToSegment(p, a, b) <= tolerance);
    for (const m of interaction.messages) {
      if (m.points.length < 2) {
        failures.push(`${m.id} has no line`);
        continue;
      }
      if (!onWave(m.points[0]!)) failures.push(`${m.id} starts at ${at(m.points[0]!)}, not on a lifeline's state line`);
      const end = m.head?.tip ?? m.points.at(-1)!;
      if (!onWave(end)) failures.push(`${m.id} ends at ${at(end)}, not on a lifeline's state line`);
      checkHead(m, failures, at);
    }
  }
  return [
    { gate: 'message-endpoints', ok: failures.length === 0, failures },
    interaction.diagram === 'sequence' ? lifelineCrossing(scene, interaction) : timingLines(scene, interaction),
  ];
}

/** Length over which two segments run on top of each other (0 unless collinear within 1.5 px). */
function sharedLength(a: Point, b: Point, c: Point, d: Point): number {
  const len = distance(a, b);
  if (len < 0.01) return 0;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  // Parallel (within 2 degrees), with both ends of c-d within 1.5 px of the line through a and b.
  const other = distance(c, d);
  if (other < 0.01 || Math.abs(u.x * (d.y - c.y) - u.y * (d.x - c.x)) / other > 0.035) return 0;
  const off = (p: Point): number => Math.abs((p.x - a.x) * u.y - (p.y - a.y) * u.x);
  if (off(c) > 1.5 || off(d) > 1.5) return 0;
  const t = (p: Point): number => (p.x - a.x) * u.x + (p.y - a.y) * u.y;
  return Math.max(0, Math.min(len, Math.max(t(c), t(d))) - Math.max(0, Math.min(t(c), t(d))));
}

/**
 * `timing-lines` (timing): a message never runs along another line (a state
 * step, a value band edge, a highlight or time-window border, a constraint's
 * extension line, another message), its label sits in the band of its sender or
 * its receiver, and no dashed highlight or extension line runs through text.
 */
export function timingLines(scene: Scene, interaction: Interaction): GateResult {
  const failures: string[] = [];
  const guides = interaction.guides ?? [];
  const lines = [
    ...interaction.waveforms.map(w => ({ ...w, what: 'a state line' })),
    ...guides.map(g => ({ ...g, what: 'a highlight or constraint line' })),
    ...interaction.messages.flatMap(m => m.points.slice(1).map((q, k) => ({ a: m.points[k]!, b: q, what: `message ${m.id}`, owner: m.id }))),
  ];
  const rows = interaction.rows ?? [];
  const rowOf = (p: Point): number => rows.findIndex(r => p.y >= r.top - 0.5 && p.y <= r.bottom + 0.5);
  for (const m of interaction.messages) {
    for (let k = 1; k < m.points.length; k++) {
      const a = m.points[k - 1]!,
        b = m.points[k]!;
      const hit = lines.find(l => (l as { owner?: string }).owner !== m.id && sharedLength(a, b, l.a, l.b) > 2);
      if (hit) {
        failures.push(`${m.id} runs along ${hit.what} at x=${a.x.toFixed(1)}`);
        break;
      }
    }
    if (m.points.length < 2 || rows.length === 0) continue;
    const ends = new Set([rowOf(m.points[0]!), rowOf(m.head?.tip ?? m.points.at(-1)!)]);
    for (const t of scene.texts.filter(t => t.owner === m.id)) {
      const c = { x: t.bounds.x + t.bounds.width / 2, y: t.bounds.y + t.bounds.height / 2 };
      if (!ends.has(rowOf(c))) failures.push(`label ${JSON.stringify(t.content)} of ${m.id} is in the band of neither its sender nor its receiver`);
    }
  }
  for (const t of scene.texts) {
    if (t.role === 'frame-label') continue;
    for (const box of t.lines) {
      const inner = { x: box.x + 0.5, y: box.y + 1, width: box.width - 1, height: box.height - 2 };
      if (guides.some(g => segmentIntersectsRect(g.a, g.b, inner))) {
        failures.push(`text ${JSON.stringify(t.content)} is crossed by a highlight or constraint line`);
        break;
      }
    }
  }
  return { gate: 'timing-lines', ok: failures.length === 0, failures };
}

/**
 * `lifeline-crossing` (sequence): no visible lifeline or activation bar runs
 * through drawn text (message labels and numbers, operators, guards, state
 * invariants, notes, heads). A crossing is allowed only where an opaque shape
 * drawn later, on top (note, invariant, head, interaction use, tab, label halo),
 * hides the line under the text. An activation bar is never hidden by a shape
 * that only backs a text (label halo, state invariant): the bar would look
 * interrupted.
 */
export function lifelineCrossing(scene: Scene, interaction: Interaction): GateResult {
  const failures: string[] = [];
  // An opaque shape hides what was drawn before it (unknown order: anything).
  const hidden = (r: Rect, order = -Infinity, bar = false): boolean =>
    interaction.occluders.some(o => (o.order ?? Infinity) > order && !(bar && o.text) && contains(o, r, 0.5));
  const name = (t: InspectedText): string => JSON.stringify(t.content.length > 40 ? `${t.content.slice(0, 40)}…` : t.content);
  for (const t of scene.texts) {
    if (t.role === 'frame-label') continue;
    for (const box of t.lines) {
      const top = box.y + 1,
        bottom = box.y + box.height - 1;
      for (const l of interaction.lifelines) {
        if (l.x <= box.x + 0.5 || l.x >= box.x + box.width - 0.5) continue;
        const y0 = Math.max(top, l.top),
          y1 = Math.min(bottom, l.bottom);
        if (y1 <= y0) continue;
        if (!hidden({ x: l.x - 0.5, y: y0, width: 1, height: y1 - y0 }, l.order)) {
          failures.push(`text ${name(t)} is crossed by lifeline ${l.id || '?'} at x=${l.x.toFixed(1)}`);
          break;
        }
      }
      for (const b of interaction.bars) {
        const x0 = Math.max(box.x + 0.5, b.x),
          x1 = Math.min(box.x + box.width - 0.5, b.x + b.width);
        const y0 = Math.max(top, b.y),
          y1 = Math.min(bottom, b.y + b.height);
        if (x1 <= x0 || y1 <= y0) continue;
        if (!hidden({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, b.order, true)) {
          failures.push(`text ${name(t)} overlaps the activation bar of ${b.lifeline || '?'}`);
          break;
        }
      }
    }
  }
  return { gate: 'lifeline-crossing', ok: failures.length === 0, failures };
}

function checkHead(m: InteractionMessage, failures: string[], at: (p: Point) => string): void {
  const end = m.points.at(-1)!,
    before = m.points.at(-2)!;
  if (!m.head) {
    failures.push(`${m.id} has no arrowhead`);
    return;
  }
  if (distance(m.head.tip, end) > 6) failures.push(`${m.id}: arrowhead at ${at(m.head.tip)} is not at the receiving end ${at(end)}`);
  const length = distance(before, end) || 1;
  const dir = { x: (end.x - before.x) / length, y: (end.y - before.y) / length };
  if (dir.x * m.head.direction.x + dir.y * m.head.direction.y < 0.9) failures.push(`${m.id}: arrowhead points the wrong way`);
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * TIMING: PlantUML draws timing diagrams without groups. Primitives are
 * classified by the fixed styles the timing kind generates: robust state lines
 * are the only lines at stroke width `theme.stroke.node + 0.25`; concise values
 * are hexagon-ended shapes filled with nodeHeaderFill; notes use noteFill;
 * messages are a line with one arrowhead, duration constraints a line with two.
 */
export function readTiming(root: XmlElement, scene: Scene): void {
  const { color } = theme;
  const textOf = textMap(root, scene.texts);
  const interaction: Interaction = { diagram: 'timing', lifelines: [], bars: [], messages: [], createdHeads: new Map(), waveforms: [], occluders: [] };
  scene.interaction = interaction;
  scene.evaluated = ['label-edge-crossing'];
  const main = elements(root).find(e => e.tag === 'g');
  if (!main) return;
  const items = elements(main);
  const robustWidth = theme.stroke.node + 0.25;
  const owned = new Map<XmlElement, { role: string; owner: string }>();
  const separators: number[] = [];
  const containers: { id: string; bounds: Rect }[] = [];
  let count = 0;

  const frame = items[0]?.tag === 'rect' && items[1]?.tag === 'path' && items[1].attrs.fill === color.frameHeadingFill ? shapeBounds(items[1]) : undefined;
  if (frame) scene.frameHeading = frame;

  for (let i = 0; i < items.length; i++) {
    const e = items[i]!;
    const style = styleOf(e);
    if (e.tag === 'line' && style.width === robustWidth && !style.dashed) {
      const [a, b] = lineEnds(e);
      interaction.waveforms.push({ a, b });
      scene.edges.push({ id: `wave${count++}`, type: 'waveform', source: '', target: '', points: [a, b], sourceMarker: 'none', targetMarker: 'none' });
      continue;
    }
    if ((e.tag === 'polygon' || e.tag === 'path') && e.attrs.fill === color.nodeHeaderFill) {
      // The open-ended last value is drawn twice (fill without outline, then outline): keep the outline.
      if (style.stroke === color.nodeHeaderFill) continue;
      const points = e.tag === 'polygon' ? pointList(e.attrs.points) : pathPoints(e.attrs.d ?? '');
      const id = `value${count++}`;
      const bounds = boundsOfPoints(points);
      scene.nodes.push({ id, type: 'concise-value', bounds });
      containers.push({ id, bounds });
      for (let k = 0; k + 1 < points.length + (e.tag === 'polygon' ? 1 : 0); k++)
        interaction.waveforms.push({ a: points[k]!, b: points[(k + 1) % points.length]! });
      continue;
    }
    if (e.tag === 'path' && e.attrs.fill === color.noteFill) {
      const id = `note${count++}`;
      const bounds = shapeBounds(e)!;
      scene.nodes.push({ id, type: 'note', bounds });
      containers.push({ id, bounds });
      if (items[i + 1]?.tag === 'path' && items[i + 1]!.attrs.fill === color.noteFill) i++;
      continue;
    }
    if (e.tag === 'line' && style.dashed && style.stroke === color.edge && !(e.attrs.style ?? '').includes('dasharray:3,5')) {
      // Highlight and time-window borders (4,4) and duration-constraint extension lines (2,2); not the time grid (3,5).
      const [a, b] = lineEnds(e);
      (interaction.guides ??= []).push({ a, b });
      continue;
    }
    if (e.tag === 'line' && !style.dashed && style.stroke === color.edge) {
      const [a, b] = lineEnds(e);
      if (a.y === b.y && Math.abs(b.x - a.x) > scene.viewBox.width / 2) {
        separators.push(a.y);
        // Band separator between lifelines (or the time axis): labels must not sit on it.
        scene.edges.push({ id: `separator${count++}`, type: 'separator', source: '', target: '', points: [a, b], sourceMarker: 'none', targetMarker: 'none' });
        continue;
      }
      const heads: XmlElement[] = [];
      while (items[i + 1 + heads.length]?.tag === 'polygon' && items[i + 1 + heads.length]!.attrs.fill === color.edge) heads.push(items[i + 1 + heads.length]!);
      if (heads.length === 0) continue;
      const kind = heads.length === 1 ? 'message' : 'constraint';
      const id = `${kind}${count++}`;
      const message = readMessage({ tag: 'g', attrs: {}, children: [e, ...heads] }, id);
      i += heads.length;
      while (items[i + 1]?.tag === 'text') owned.set(items[++i]!, { role: 'label', owner: id });
      if (kind === 'message') interaction.messages.push({ id, points: message.points, dashed: false, ...(message.head ? { head: message.head } : {}) });
      scene.edges.push({
        id,
        type: kind === 'message' ? 'message' : 'duration-constraint',
        source: '',
        target: '',
        points: message.points.length > 0 ? message.points : lineEnds(e),
        sourceMarker: 'none',
        targetMarker: 'none',
      });
    }
  }

  const out: InspectedText[] = [];
  const pending: { container: string; parts: InspectedText[] }[] = [];
  for (const [element, text] of textOf) {
    const known = owned.get(element);
    if (known) {
      out.push({ ...text, ...known });
      continue;
    }
    if (frame && contains(frame, text.bounds, 2)) {
      out.push({ ...text, role: 'frame-label' });
      continue;
    }
    // Texts that start inside a note or a concise value belong to it (text-fits checks they also end inside).
    const container = containers.find(
      c =>
        text.bounds.x >= c.bounds.x &&
        text.bounds.x < c.bounds.x + c.bounds.width &&
        text.bounds.y + text.bounds.height / 2 >= c.bounds.y &&
        text.bounds.y + text.bounds.height / 2 <= c.bounds.y + c.bounds.height,
    );
    if (container) {
      const last = pending.at(-1);
      if (last?.container === container.id) last.parts.push(text);
      else pending.push({ container: container.id, parts: [text] });
      continue;
    }
    out.push({ ...text, role: 'label', owner: 'timing' });
  }
  for (const p of pending) out.push(merge(p.parts, { role: 'text', node: p.container }));
  scene.texts = out;
  // Lifeline bands: between consecutive separators (the last one is the time axis).
  const ys = [...new Set(separators)].sort((a, b) => a - b);
  interaction.rows = ys.slice(1).map((y, k) => ({ top: ys[k]!, bottom: y }));
  addExtents(root, scene);
}
