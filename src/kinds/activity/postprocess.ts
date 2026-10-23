import { theme } from '../../core/theme.js';
import { inflate, overlapArea, segmentIntersectsRect, type Point, type Rect } from '../../engine/geometry.js';
import { CALL_BEHAVIOR_MARK } from '../../plantuml/skin.js';
import { padCanvas } from '../../plantuml/geometry.js';

/**
 * Fixes PlantUML's activity SVG where it deviates from UML 2.5.1 notation. Only
 * PlantUML's own drawing primitives are rewritten; no input text is touched.
 *
 * - Activity edges end in an open arrowhead (UML 15.2.4); PlantUML draws filled,
 *   notched heads. They become open arrowheads of the shared theme size.
 * - PlantUML adds direction arrowheads in the middle of long return lines;
 *   UML draws one arrowhead at the target only, so these are removed.
 * - Call behavior actions get the rake symbol in their lower right corner
 *   (UML 16.3.4). They are found by the marker stroke color the skin gives them.
 * - Fork and join branches that PlantUML attaches at a bar's end with a sideways
 *   jog leave or enter the bar straight; bars are trimmed to their flows.
 * - The flow into a fork (out of a join) moves along the bar off the line of a branch.
 * - Swimlanes are widened where a node, note or text comes within LANE_PADDING
 *   of a lane border.
 * - A guard label that PlantUML placed across a flow line (it happens beside
 *   narrow loops) is moved to the nearest free spot beside the same line; if
 *   there is none (a loop in a narrow swimlane), a column is opened for it.
 */
export function fixActivitySvg(svg: string, model?: { title?: string }): string {
  const ends: [number, number][] = [];
  for (const [tag] of svg.matchAll(/<line\b[^>]*>/gu)) {
    const a = attrs(tag);
    ends.push([Number(a.x1), Number(a.y1)], [Number(a.x2), Number(a.y2)]);
  }
  const { edge } = theme.color;
  const { length, halfWidth } = theme.size.arrow;
  svg = svg.replaceAll(/<polygon\b[^>]*>/gu, tag => {
    const a = attrs(tag);
    if (a.fill?.toUpperCase() !== edge.toUpperCase()) return tag;
    const n = (a.points ?? '').split(/[ ,]+/u).filter(Boolean).map(Number);
    if (n.length !== 8 || n.some(v => !Number.isFinite(v))) return tag;
    const tip = { x: n[2]!, y: n[3]! },
      notch = { x: n[6]!, y: n[7]! };
    if (!ends.some(([x, y]) => Math.abs(x - tip.x) < 0.6 && Math.abs(y - tip.y) < 0.6)) return '';
    const d = Math.hypot(tip.x - notch.x, tip.y - notch.y) || 1;
    const u = { x: (tip.x - notch.x) / d, y: (tip.y - notch.y) / d };
    const at = (side: number) => `${fmt(tip.x - u.x * length - u.y * halfWidth * side)},${fmt(tip.y - u.y * length + u.x * halfWidth * side)}`;
    return `<polyline fill="none" points="${at(1)} ${fmt(tip.x)},${fmt(tip.y)} ${at(-1)}" style="stroke:${edge};stroke-width:${theme.stroke.edge};stroke-linejoin:miter;stroke-linecap:round;"/>`;
  });
  svg = svg.replaceAll(/<rect\b[^>]*>/gu, tag => {
    if (!tag.includes(`stroke:${CALL_BEHAVIOR_MARK};`)) return tag;
    const a = attrs(tag);
    const x = Number(a.x),
      y = Number(a.y),
      w = Number(a.width),
      h = Number(a.height);
    const fixed = tag.replace(`stroke:${CALL_BEHAVIOR_MARK};`, `stroke:${theme.color.nodeStroke};`);
    const r = theme.size.rake,
      right = x + w - 10,
      bottom = y + h - 8;
    const cx = right - r.width / 2,
      left = right - r.width,
      top = bottom - r.height,
      bar = top + r.height / 2;
    const d = `M${fmt(cx)},${fmt(top)} V${fmt(bottom)} M${fmt(left)},${fmt(bottom)} V${fmt(bar)} H${fmt(right)} V${fmt(bottom)}`;
    return `${fixed}<path d="${d}" fill="none" style="stroke:${theme.color.nodeStroke};stroke-width:${theme.stroke.node};"/>`;
  });
  const fixed = padLanes(moveCrossedLabels(anchorNotes(trimBars(separateBarFlows(straightenBarBranches(mirrorAcceptEvents(svg))))), 0));
  // Without a title there is no frame: give the drawing the own engine's canvas margin.
  return model && model.title === undefined ? padCanvas(fixed, theme.spacing.canvas) : fixed;
}

/**
 * Accept event actions have their concave notch on the left (UML 16.10.4);
 * PlantUML's <<input>> shape has it on the right. The pentagon is mirrored in
 * place, so the text keeps its position inside the same bounding box.
 */
function mirrorAcceptEvents(svg: string): string {
  return svg.replaceAll(/<polygon\b[^>]*>/gu, tag => {
    const a = attrs(tag);
    if (a.fill !== theme.color.nodeFill) return tag;
    const n = (a.points ?? '').split(/[ ,]+/u).filter(Boolean).map(Number);
    if (n.length !== 10) return tag;
    const [x1, y1, x2, y2, x3, y3, x4, y4, x5, y5] = n as [number, number, number, number, number, number, number, number, number, number];
    // (x1,y1) top left, (x2,y2) top right, (x3,y3) notch tip inside the right edge, (x4,y4) bottom right, (x5,y5) bottom left.
    if (y1 !== y2 || x2 !== x4 || x1 !== x5 || y4 !== y5 || !(x3 < x2) || !(y3 > y1 && y3 < y4)) return tag;
    const depth = x2 - x3;
    const points = [
      [x1, y1],
      [x2, y2],
      [x4, y4],
      [x5, y5],
      [x1 + depth, y3],
    ]
      .map(([x, y]) => `${fmt(x!)},${fmt(y!)}`)
      .join(',');
    return tag.replace(/ points="[^"]*"/u, ` points="${points}"`);
  });
}

/** Least room between a swimlane border and the shapes, notes, texts and vertical flows beside it. */
export const LANE_PADDING = 12;

/**
 * PlantUML leaves as little as 4 px between a swimlane border and the widest
 * node or note in the lane. Each border with something closer than LANE_PADDING
 * on either side gets a column of the missing width (everything beyond moves).
 */
function padLanes(svg: string): string {
  let widened = false;
  for (let round = 0; round < 40; round++) {
    const borders: { x: number; y0: number; y1: number }[] = [];
    const items: Rect[] = [];
    for (const [tag, name] of svg.matchAll(/<(rect|polygon|ellipse|path|text|line)\b[^>]*>/gu)) {
      const a = attrs(tag);
      if (name === 'line') {
        const x1 = Number(a.x1),
          x2 = Number(a.x2),
          y1 = Number(a.y1),
          y2 = Number(a.y2);
        if (x1 !== x2) continue;
        if (tag.includes(`stroke:${theme.color.frameStroke};`)) borders.push({ x: x1, y0: Math.min(y1, y2), y1: Math.max(y1, y2) });
        else if (tag.includes(`stroke:${theme.color.edge};`)) items.push({ x: x1, y: Math.min(y1, y2), width: 0, height: Math.abs(y2 - y1) });
        continue;
      }
      if (name === 'rect' && a.fill !== theme.color.nodeFill && a.fill !== theme.color.edge) continue;
      if (name === 'polygon' && a.fill !== theme.color.nodeFill) continue;
      if (name === 'path' && a.fill !== theme.color.noteFill) continue;
      const r = elementBox(name!, a);
      if (r) items.push(r);
    }
    let fix: { x0: number; width: number } | undefined;
    for (const b of borders.sort((p, q) => q.x - p.x)) {
      const beside = items.filter(r => r.y < b.y1 && r.y + r.height > b.y0);
      const left = Math.min(Infinity, ...beside.filter(r => r.x + r.width <= b.x).map(r => b.x - r.x - r.width));
      const right = Math.min(Infinity, ...beside.filter(r => r.x >= b.x).map(r => r.x - b.x));
      if (left < LANE_PADDING - 0.25) {
        fix = { x0: b.x - left / 2, width: Math.ceil(LANE_PADDING - left) };
        break;
      }
      if (right < LANE_PADDING - 0.25) {
        fix = { x0: b.x + right / 2, width: Math.ceil(LANE_PADDING - right) };
        break;
      }
    }
    if (!fix) return widened ? centerLaneTitles(svg, borders) : svg;
    svg = insertColumn(svg, fix.x0, fix.width, Math.min(...borders.map(b => b.y0)));
    widened = true;
  }
  return svg;
}

/** Centers each swimlane title (bold text at the top of the lanes) between its lane's borders again. */
function centerLaneTitles(svg: string, borders: readonly { x: number; y0: number }[]): string {
  const xs = borders.map(b => b.x).sort((a, b) => a - b),
    top = Math.min(...borders.map(b => b.y0));
  return svg.replaceAll(/<text\b[^>]*>/gu, tag => {
    const a = attrs(tag);
    if (a['font-weight'] !== 'bold' || !(Number(a.y) > top && Number(a.y) < top + 48)) return tag;
    const width = Number(a.textLength),
      middle = Number(a.x) + width / 2;
    const left = xs.findLast(x => x < middle),
      right = xs.find(x => x > middle);
    if (left === undefined || right === undefined || right - left < width) return tag;
    return tag.replace(/ x="[^"]*"/u, ` x="${fmt((left + right) / 2 - width / 2)}"`);
  });
}

/** Longest stub PlantUML draws between a bar and the sideways jog of a branch flow. */
const STUB_MAX = 24;

/**
 * PlantUML attaches a fork or join branch that lies beyond the bar (often in
 * another swimlane) at the bar's end: a short stub, a horizontal jog along the
 * bar and a vertical line to the branch. UML draws each branch straight from the
 * bar's underside (fork) or into its top (join), so the bar is lengthened to the
 * branch, the stub and jog are dropped and the vertical line runs to the bar.
 * Done only when nothing else lies on the lengthened part of the bar. The one
 * flow into a fork (out of a join) is straightened the same way when it lies
 * over the bar.
 */
function straightenBarBranches(svg: string): string {
  const flow = `stroke:${theme.color.edge};`;
  interface Line {
    tag: string;
    p: Point;
    q: Point;
  }
  const lines: Line[] = [];
  for (const [tag] of svg.matchAll(/<line\b[^>]*>/gu)) {
    if (!tag.includes(flow) || tag.includes('stroke-dasharray')) continue;
    const a = attrs(tag);
    lines.push({ tag, p: { x: Number(a.x1), y: Number(a.y1) }, q: { x: Number(a.x2), y: Number(a.y2) } });
  }
  const at = (p: Point, q: Point): boolean => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
  const other = (l: Line, p: Point): Point => (at(l.p, p) ? l.q : l.p);
  const vertical = (l: Line): boolean => Math.abs(l.p.x - l.q.x) < 0.01;
  const horizontal = (l: Line): boolean => Math.abs(l.p.y - l.q.y) < 0.01;
  const shapes: { tag: string; r: Rect }[] = [];
  for (const [tag, name] of svg.matchAll(/<(rect|polygon|ellipse|path)\b[^>]*>/gu)) {
    const a = attrs(tag);
    const r = elementBox(name!, a);
    if (r && (a.fill === theme.color.nodeFill || a.fill === theme.color.noteFill || a.fill === theme.color.edge || name === 'ellipse')) shapes.push({ tag, r });
  }
  const edits = new Map<string, string>();
  for (const [tag] of svg.matchAll(/<rect\b[^>]*>/gu)) {
    const a = attrs(tag);
    if (a.fill !== theme.color.edge) continue;
    let bar = { x: Number(a.x), y: Number(a.y), width: Number(a.width), height: Number(a.height) };
    if (!(bar.height <= 10 && bar.width > bar.height)) continue;
    const top = bar.y,
      bottom = bar.y + bar.height;
    // Branches are on the side with several flows (below a fork, above a join);
    // the single flow into a fork or out of a join keeps its route.
    const count = (y: number): number =>
      lines.filter(l => [l.p, l.q].some(p => Math.abs(p.y - y) < 0.5 && p.x >= bar.x - 0.5 && p.x <= bar.x + bar.width + 0.5)).length;
    const branches = count(bottom) > 1 ? bottom : count(top) > 1 ? top : undefined;
    if (branches === undefined) continue;
    // Branches may lengthen the bar; the single flow on the other side only moves along it.
    for (const [side, grow] of [
      [branches, true],
      [branches === bottom ? top : bottom, false],
    ] as const)
      for (const stub of lines) {
        if (edits.has(stub.tag) || !vertical(stub)) continue;
        // The stub starts on the bar's top or bottom edge, within the bar.
        const start = [stub.p, stub.q].find(p => p.x >= bar.x - 0.5 && p.x <= bar.x + bar.width + 0.5 && Math.abs(p.y - side) < 0.5);
        if (!start) continue;
        const knee = other(stub, start);
        const below = knee.y > start.y;
        if (Math.abs(knee.y - start.y) > STUB_MAX) continue;
        const jogs = lines.filter(l => l !== stub && horizontal(l) && (at(l.p, knee) || at(l.q, knee)));
        if (jogs.length !== 1) continue;
        const jog = jogs[0]!,
          corner = other(jog, knee);
        const legs = lines.filter(l => l !== jog && vertical(l) && (at(l.p, corner) || at(l.q, corner)));
        if (legs.length !== 1) continue;
        const leg = legs[0]!,
          far = other(leg, corner);
        // The leg must continue away from the bar, and nothing else may meet the knee or corner.
        if (below ? far.y <= corner.y : far.y >= corner.y) continue;
        if (lines.some(l => l !== stub && l !== jog && l !== leg && [l.p, l.q].some(p => at(p, knee) || at(p, corner)))) continue;
        if (!grow && (corner.x < bar.x + BAR_OVERHANG || corner.x > bar.x + bar.width - BAR_OVERHANG)) continue;
        const left = Math.min(bar.x, corner.x - BAR_OVERHANG),
          right = Math.max(bar.x + bar.width, corner.x + BAR_OVERHANG);
        const grown = { x: left, y: bar.y - 1, width: right - left, height: bar.height + 2 };
        // Nothing but this bar and the flows ending on it may lie where the bar grows.
        const ends = (l: Line): boolean => [l.p, l.q].some(p => (Math.abs(p.y - top) < 0.5 || Math.abs(p.y - bottom) < 0.5) && p.x >= left && p.x <= right);
        if (shapes.some(s => s.tag !== tag && overlapArea(s.r, grown) > 0)) continue;
        if (lines.some(l => l !== stub && l !== jog && l !== leg && !ends(l) && segmentIntersectsRect(l.p, l.q, grown))) continue;
        const edge = below ? bottom : top;
        edits.set(stub.tag, '');
        edits.set(jog.tag, '');
        edits.set(leg.tag, leg.tag.replace(at(leg.p, corner) ? / y1="[^"]*"/u : / y2="[^"]*"/u, ` ${at(leg.p, corner) ? 'y1' : 'y2'}="${fmt(edge)}"`));
        // A join's arrowhead moves with the flow from the stub's start to the leg.
        const dx = corner.x - start.x;
        for (const [head] of svg.matchAll(/<polyline\b[^>]*>/gu)) {
          const n = (attrs(head).points ?? '').split(/[ ,]+/u).filter(Boolean).map(Number);
          if (n.length !== 6 || !at({ x: n[2]!, y: n[3]! }, start)) continue;
          const moved = [0, 2, 4].map(i => `${fmt(n[i]! + dx)},${fmt(n[i + 1]!)}`).join(' ');
          edits.set(head, head.replace(/ points="[^"]*"/u, ` points="${moved}"`));
        }
        bar = { ...bar, x: left, width: right - left };
        edits.set(tag, tag.replace(/ x="[^"]*"/u, ` x="${fmt(bar.x)}"`).replace(/ width="[^"]*"/u, ` width="${fmt(bar.width)}"`));
      }
  }
  return edits.size > 0 ? svg.replaceAll(/<(?:line|rect|polyline)\b[^>]*>/gu, tag => edits.get(tag) ?? tag) : svg;
}

/** Least horizontal distance between the flow into a fork (out of a join) and any of its branches. */
const BAR_FLOW_GAP = 20;

/**
 * The one flow into a fork (or out of a join) that meets the bar exactly where
 * a branch leaves it on the other side reads as one line passing through the
 * bar. When that flow arrives with a horizontal jog, its last leg moves along the
 * bar to the middle of the nearest gap between branches (at least BAR_FLOW_GAP
 * px from each), and the jog is shortened or lengthened to it.
 */
function separateBarFlows(svg: string): string {
  const flow = `stroke:${theme.color.edge};`;
  interface Line {
    tag: string;
    p: Point;
    q: Point;
  }
  const lines: Line[] = [];
  for (const [tag] of svg.matchAll(/<line\b[^>]*>/gu)) {
    if (!tag.includes(flow) || tag.includes('stroke-dasharray')) continue;
    const a = attrs(tag);
    lines.push({ tag, p: { x: Number(a.x1), y: Number(a.y1) }, q: { x: Number(a.x2), y: Number(a.y2) } });
  }
  const at = (p: Point, q: Point): boolean => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
  const edits = new Map<string, string>();
  const setX = (l: Line, end: Point, x: number): string => {
    const first = at(l.p, end);
    return (edits.get(l.tag) ?? l.tag).replace(first ? / x1="[^"]*"/u : / x2="[^"]*"/u, ` ${first ? 'x1' : 'x2'}="${fmt(x)}"`);
  };
  for (const [tag] of svg.matchAll(/<rect\b[^>]*>/gu)) {
    const a = attrs(tag);
    if (a.fill !== theme.color.edge) continue;
    const bar = { x: Number(a.x), y: Number(a.y), width: Number(a.width), height: Number(a.height) };
    if (!(bar.height <= 10 && bar.width > bar.height)) continue;
    const ends = (y: number): { line: Line; end: Point }[] =>
      lines.flatMap(l =>
        [l.p, l.q].filter(p => Math.abs(p.y - y) < 0.5 && p.x >= bar.x - 0.5 && p.x <= bar.x + bar.width + 0.5).map(end => ({ line: l, end })),
      );
    const top = ends(bar.y),
      bottom = ends(bar.y + bar.height);
    const [single, branches] =
      top.length === 1 && bottom.length > 1 ? [top[0]!, bottom] : bottom.length === 1 && top.length > 1 ? [bottom[0]!, top] : [undefined, []];
    if (!single || Math.abs(single.line.p.x - single.line.q.x) > 0.01) continue;
    const xs = branches.map(b => b.end.x).sort((p, q) => p - q);
    if (!xs.some(x => Math.abs(x - single.end.x) < BAR_FLOW_GAP)) continue;
    const corner = at(single.line.p, single.end) ? single.line.q : single.line.p;
    const jogs = lines.filter(l => l !== single.line && (at(l.p, corner) || at(l.q, corner)));
    if (jogs.length !== 1 || Math.abs(jogs[0]!.p.y - jogs[0]!.q.y) > 0.01) continue;
    const jog = jogs[0]!,
      from = at(jog.p, corner) ? jog.q : jog.p;
    // Candidate x: middles of the gaps between neighbouring branches, nearest the jog's start first.
    const gaps = xs
      .slice(1)
      .map((x, k) => (x + xs[k]!) / 2)
      .filter(m => xs.every(x => Math.abs(x - m) >= BAR_FLOW_GAP));
    const nx = gaps.sort((p, q) => Math.abs(p - from.x) - Math.abs(q - from.x))[0];
    if (nx === undefined || Math.abs(nx - from.x) < 1) continue;
    const dx = nx - single.end.x;
    edits.set(single.line.tag, single.line.tag.replace(/ x1="[^"]*"/u, ` x1="${fmt(nx)}"`).replace(/ x2="[^"]*"/u, ` x2="${fmt(nx)}"`));
    edits.set(jog.tag, setX(jog, corner, nx));
    for (const [head] of svg.matchAll(/<polyline\b[^>]*>/gu)) {
      const n = (attrs(head).points ?? '').split(/[ ,]+/u).filter(Boolean).map(Number);
      if (n.length !== 6 || !at({ x: n[2]!, y: n[3]! }, single.end)) continue;
      edits.set(head, head.replace(/ points="[^"]*"/u, ` points="${[0, 2, 4].map(i => `${fmt(n[i]! + dx)},${fmt(n[i + 1]!)}`).join(' ')}"`));
    }
  }
  return edits.size > 0 ? svg.replaceAll(/<(?:line|polyline)\b[^>]*>/gu, tag => edits.get(tag) ?? tag) : svg;
}

/** Overhang of a fork or join bar beyond its outermost flow (each side), and its minimum length. */
const BAR_OVERHANG = 16,
  BAR_MIN = 48;

/**
 * PlantUML stretches fork and join bars across the whole block, often to the
 * swimlane borders and under notes. A bar is shortened to its flows plus a small
 * overhang on each side (never lengthened).
 */
function trimBars(svg: string): string {
  const lines: { p: Point; q: Point }[] = [];
  for (const [tag] of svg.matchAll(/<line\b[^>]*>/gu)) {
    if (!tag.includes(`stroke:${theme.color.edge};`)) continue;
    const a = attrs(tag);
    lines.push({ p: { x: Number(a.x1), y: Number(a.y1) }, q: { x: Number(a.x2), y: Number(a.y2) } });
  }
  const ends = lines.flatMap(l => [l.p, l.q]);
  /** Direction (-1 left, 1 right, 0 none) of a horizontal line starting within 12 px of the bar at a flow end. */
  const turn = (end: Point, bar: Rect): number => {
    for (const l of lines) {
      if (l.p.y !== l.q.y || Math.abs(l.p.y - (bar.y + bar.height / 2)) > 12) continue;
      for (const [a, b] of [
        [l.p, l.q],
        [l.q, l.p],
      ] as const)
        if (Math.abs(a.x - end.x) < 0.5) return Math.sign(b.x - a.x);
    }
    return 0;
  };
  return svg.replaceAll(/<rect\b[^>]*>/gu, tag => {
    const a = attrs(tag);
    if (a.fill !== theme.color.edge) return tag;
    const bar = { x: Number(a.x), y: Number(a.y), width: Number(a.width), height: Number(a.height) };
    if (!(bar.height <= 10 && bar.width > bar.height)) return tag;
    const touching = ends.filter(p => p.x >= bar.x - 0.5 && p.x <= bar.x + bar.width + 0.5 && p.y >= bar.y - 1.5 && p.y <= bar.y + bar.height + 1.5);
    if (touching.length === 0) return tag;
    const low = Math.min(...touching.map(p => p.x)),
      high = Math.max(...touching.map(p => p.x));
    // A flow that turns sideways right at the bar would run along the overhang: none there.
    const overhang = (x: number, side: number): number => (touching.some(p => Math.abs(p.x - x) < 0.5 && turn(p, bar) === side) ? 2 : BAR_OVERHANG);
    let left = low - overhang(low, -1),
      right = high + overhang(high, 1);
    if (right - left < BAR_MIN) {
      const c = (left + right) / 2;
      left = c - BAR_MIN / 2;
      right = c + BAR_MIN / 2;
    }
    left = Math.max(left, bar.x);
    right = Math.min(right, bar.x + bar.width);
    return tag.replace(/ x="[^"]*"/u, ` x="${fmt(left)}"`).replace(/ width="[^"]*"/u, ` width="${fmt(right - left)}"`);
  });
}

/**
 * PlantUML attaches notes with a speech-bubble pointer; UML 7.2.4 attaches a
 * comment with a dashed line. The pointer is cut off the note outline and a
 * dashed anchor line drawn from the note to the node the pointer touched.
 */
function anchorNotes(svg: string): string {
  return svg.replaceAll(/<path\b[^>]*>/gu, tag => {
    const a = attrs(tag);
    if (a.fill !== theme.color.noteFill || !a.d) return tag;
    const m = /^M([\d.]+),([\d.]+) L([\d.]+),([\d.]+) L([\d.]+),([\d.]+) L([\d.]+),([\d.]+) L([\d.]+),([\d.]+) (.*)$/u.exec(a.d);
    if (!m) return tag;
    const [x0, y0, x1, y1, tx, ty, x2, y2, x3, y3] = m.slice(1, 11).map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    // Pointer on the left edge (note right of its node): x0 = x1 = x2 = x3 and the tip further left.
    if (!(x0 === x1 && x1 === x2 && x2 === x3 && tx < x0 && y0 < y1 && y1 < ty && ty < y2 && y2 < y3)) return tag;
    const outline = tag.replace(/ d="[^"]*"/u, ` d="M${fmt(x0)},${fmt(y0)} L${fmt(x3)},${fmt(y3)} ${m[11]}"`);
    const anchor = `<line x1="${fmt(x0)}" y1="${fmt(ty)}" x2="${fmt(tx)}" y2="${fmt(ty)}" style="stroke:${theme.color.edge};stroke-width:${theme.stroke.edge};stroke-dasharray:${theme.stroke.dash.replace(' ', ',')};"/>`;
    return `${anchor}${outline}`;
  });
}

// Inter's ascent and descent per px of font size (assets/fonts, hhea table).
const ASCENT = 0.97,
  DESCENT = 0.25;

interface Segment {
  p: Point;
  q: Point;
  flow: boolean;
}

function moveCrossedLabels(svg: string, depth: number): string {
  const segments: Segment[] = [];
  const obstacles: Rect[] = [];
  const bars = new Set<Rect>();
  const arms: [Point, Point][] = [];
  const diamonds = new Set<Rect>();
  const pairs = (s: string | undefined): number[] => (s ?? '').split(/[ ,]+/u).filter(Boolean).map(Number);
  for (const [element] of svg.matchAll(/<(?:line|rect|polygon|polyline|ellipse|path)\b[^>]*>/gu)) {
    const a = attrs(element);
    if (element.startsWith('<line')) {
      // Flow lines and swimlane borders.
      const flow = element.includes(`stroke:${theme.color.edge};`);
      if (flow || element.includes(`stroke:${theme.color.frameStroke};`))
        segments.push({ p: { x: Number(a.x1), y: Number(a.y1) }, q: { x: Number(a.x2), y: Number(a.y2) }, flow });
    } else if (element.startsWith('<rect') && (a.fill === theme.color.nodeFill || a.fill === theme.color.edge)) {
      const r = { x: Number(a.x), y: Number(a.y), width: Number(a.width), height: Number(a.height) };
      obstacles.push(r);
      // Fork and join bars may be stretched by a new column.
      if (a.fill === theme.color.edge) bars.add(r);
    } else if (element.startsWith('<polyline') || (element.startsWith('<polygon') && a.fill === theme.color.nodeFill)) {
      const b = bounds(pairs(a.points));
      if (element.startsWith('<polyline')) {
        // Arrowheads are checked against their two strokes, not their bounding box.
        const n = pairs(a.points);
        for (let i = 2; i + 1 < n.length; i += 2)
          arms.push([
            { x: n[i - 2]!, y: n[i - 1]! },
            { x: n[i]!, y: n[i + 1]! },
          ]);
        continue;
      }
      obstacles.push(b);
      // Diamonds: a guard may come closer to them (the QA gates use their bounding box).
      if (
        new Set(
          pairs(a.points)
            .map((v, i, n) => (i % 2 ? '' : `${v},${n[i + 1]}`))
            .filter(Boolean),
        ).size === 4
      )
        diamonds.add(b);
    } else if (element.startsWith('<ellipse')) {
      obstacles.push({ x: Number(a.cx) - Number(a.rx), y: Number(a.cy) - Number(a.ry), width: 2 * Number(a.rx), height: 2 * Number(a.ry) });
    } else if (element.startsWith('<path') && a.fill === theme.color.noteFill) {
      obstacles.push(bounds(pathCoordinates(a.d ?? '').flat()));
    }
  }
  const box = (a: Record<string, string>): Rect => {
    const size = Number(a['font-size']);
    return { x: Number(a.x), y: Number(a.y) - size * ASCENT, width: Number(a.textLength), height: size * (ASCENT + DESCENT) };
  };
  const texts = [...svg.matchAll(/<text\b[^>]*>/gu)].map(m => ({ tag: m[0], rect: box(attrs(m[0])) }));
  const crossing = (r: Rect, only?: (s: Segment) => boolean): Segment | undefined =>
    segments.find(s => (!only || only(s)) && segmentIntersectsRect(s.p, s.q, inflate(r, 1)));
  const view = / viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/u.exec(svg)?.slice(1).map(Number) ?? [0, 0, Infinity, Infinity];
  const inView = (r: Rect): boolean =>
    r.x >= view[0]! + 2 && r.y >= view[1]! + 2 && r.x + r.width <= view[0]! + view[2]! - 2 && r.y + r.height <= view[1]! + view[3]! - 2;
  const free = (r: Rect, self: Rect): boolean =>
    inView(r) &&
    !crossing(r) &&
    !obstacles.some(o => overlapArea(inflate(r, diamonds.has(o) ? 1 : 2), o) > 0) &&
    !arms.some(([p, q]) => segmentIntersectsRect(p, q, r)) &&
    !texts.some(t => t.rect !== self && overlapArea(inflate(r, 2), t.rect) > 0);
  const moved = new Map<string, string>();
  const place = (tag: string, from: Rect, to: Rect): string => {
    const a = attrs(tag);
    return tag.replace(/ x="[^"]*"/u, ` x="${fmt(Number(a.x) + to.x - from.x)}"`).replace(/ y="[^"]*"/u, ` y="${fmt(Number(a.y) + to.y - from.y)}"`);
  };
  for (const t of texts) {
    // Guards crossed by a flow line, or touching a node (a bar right under them).
    const touching = obstacles.some(o => overlapArea(inflate(t.rect, 1), o) > 0);
    if (!t.tag.includes(`fill="${theme.color.edgeText}"`) || (!crossing(t.rect, s => s.flow) && !touching)) continue;
    // Nearest free spot first: straight moves, then small diagonal ones.
    const offsets: [number, number][] = [];
    for (let dx = -48; dx <= 48; dx += 2) for (let dy = -36; dy <= 36; dy += 3) if (dx || dy) offsets.push([dx, dy]);
    for (let dx = -12; dx <= 12; dx++) for (let dy = -9; dy <= 9; dy++) if ((dx % 2 || dy % 3) && (dx || dy)) offsets.push([dx, dy]);
    offsets.sort((a, b) => Math.hypot(a[0], a[1] * 1.5) - Math.hypot(b[0], b[1] * 1.5) || a[0] - b[0] || a[1] - b[1]);
    const candidates = offsets.map(([dx, dy]) => ({ ...t.rect, x: t.rect.x + dx, y: t.rect.y + dy }));
    // A spot right beside the original one keeps the guard next to its own line.
    const near = (c: Rect): boolean => Math.abs(c.x - t.rect.x) <= 12 && Math.abs(c.y - t.rect.y) <= 9;
    let spot = candidates.find(c => near(c) && free(c, t.rect));
    // Otherwise, when a vertical line on the right cuts through the guard (a narrow
    // loop), move that line and everything right of it to make room in place.
    const cut = spot ? undefined : crossing(t.rect, s => s.flow && s.p.x === s.q.x && s.p.x > t.rect.x + t.rect.width / 2);
    if (cut && depth <= 8) {
      const x0 = cut.p.x - 0.5,
        width = Math.ceil(t.rect.x + t.rect.width + 6 - cut.p.x);
      const banded = shiftBand(svg, x0, width, Math.min(cut.p.y, cut.q.y), Math.max(cut.p.y, cut.q.y), t.tag);
      const clear = (x: number): boolean =>
        !obstacles.some(o => o.x < x && o.x + o.width > x && !bars.has(o)) && !texts.some(o => o !== t && o.rect.x < x && o.rect.x + o.rect.width > x);
      // Within the loop's band; if a swimlane border is in the way, widen that swimlane
      // first; else a full-height column, when nothing but bars and lines spans it.
      const widened =
        typeof banded === 'string'
          ? banded
          : typeof banded === 'number' && clear(banded - 0.5)
            ? insertColumn(svg, banded - 0.5, width + 8)
            : clear(x0)
              ? insertColumn(svg, x0, width)
              : undefined;
      if (widened) return moveCrossedLabels(widened, depth + 1);
    }
    spot ??= candidates.find(c => free(c, t.rect));
    if (spot) {
      moved.set(t.tag, place(t.tag, t.rect, spot));
      t.rect = spot;
      continue;
    }
    // No room (a narrow loop inside a swimlane): open a column right of the
    // crossing vertical flow line and put the label there, beside that line.
    const line = crossing(t.rect, s => s.flow && s.p.x === s.q.x);
    if (!line || depth > 8) continue;
    const x0 = line.p.x + 0.5;
    const spans = (r: Rect): boolean => r.x < x0 && r.x + r.width > x0;
    // Texts that span the column keep their position; shapes would be torn apart.
    if (obstacles.some(o => spans(o) && !bars.has(o))) continue;
    const width = Math.ceil(t.rect.width + 10);
    const widened = insertColumn(svg, x0, width);
    const target = { ...t.rect, x: line.p.x + 5 };
    return moveCrossedLabels(widened.replace(t.tag, place(t.tag, t.rect, target)), depth + 1);
  }
  return moved.size > 0 ? svg.replaceAll(/<text\b[^>]*>/gu, tag => moved.get(tag) ?? tag) : svg;
}

/** Bounding box of a drawing element (text: its glyph box), or undefined for other tags. */
function elementBox(name: string, a: Record<string, string>): Rect | undefined {
  const n = (k: string): number => Number(a[k]);
  switch (name) {
    case 'rect':
      return { x: n('x'), y: n('y'), width: n('width'), height: n('height') };
    case 'text':
      return { x: n('x'), y: n('y') - n('font-size') * ASCENT, width: n('textLength'), height: n('font-size') * (ASCENT + DESCENT) };
    case 'line':
      return { x: Math.min(n('x1'), n('x2')), y: Math.min(n('y1'), n('y2')), width: Math.abs(n('x2') - n('x1')), height: Math.abs(n('y2') - n('y1')) };
    case 'ellipse':
      return { x: n('cx') - n('rx'), y: n('cy') - n('ry'), width: 2 * n('rx'), height: 2 * n('ry') };
    case 'polygon':
    case 'polyline':
      return bounds((a.points ?? '').split(/[ ,]+/u).filter(Boolean).map(Number));
    case 'path':
      return bounds(pathCoordinates(a.d ?? '').flat());
    default:
      return undefined;
  }
}

/**
 * Opens room inside a loop: moves the vertical flow line at `x0` (spanning
 * `y0..y1`) and everything right of it within that band `width` px to the right,
 * stretching the horizontal flow lines that connect to it. Returns undefined
 * when something right of `x0` reaches out of the band (it would be torn apart),
 * or, when only a swimlane border or the frame is in the way, the x of that
 * border, so the caller can widen it first. The label `keep` stays where it is.
 */
function shiftBand(svg: string, x0: number, width: number, y0: number, y1: number, keep: string): string | number | undefined {
  const within = (r: Rect): boolean => r.y >= y0 - 0.5 && r.y + r.height <= y1 + 0.5;
  const outline = (tag: string): boolean => tag.includes(`stroke:${theme.color.frameStroke};`) || tag.includes(' fill="#FFFFFF"');
  let right = -Infinity,
    limit = Infinity,
    unsafe = false;
  for (const [tag, name] of svg.matchAll(/<(rect|text|line|ellipse|polygon|polyline|path)\b[^>]*>/gu)) {
    const r = elementBox(name!, attrs(tag));
    if (!r || r.x + r.width <= x0 || tag === keep) continue;
    // Frame and swimlane borders right of the loop bound how far it may grow.
    if (outline(tag)) {
      if (r.x > x0 && r.y <= y1 && r.y + r.height >= y0) limit = Math.min(limit, r.x);
      continue;
    }
    const touches = r.y <= y1 + 0.5 && r.y + r.height >= y0 - 0.5;
    if (r.x < x0) {
      // Only horizontal flow lines inside the band may span x0 (they are stretched).
      if (touches && !(name === 'line' && r.height === 0 && within(r))) unsafe = true;
      continue;
    }
    if (within(r)) right = Math.max(right, r.x + r.width);
    else if (touches) unsafe = true;
  }
  if (unsafe) return undefined;
  if (right + width > limit - 8) return limit;
  const shift = (x: number): number => (x > x0 ? x + width : x);
  return svg.replaceAll(/<(rect|text|line|ellipse|polygon|polyline|path)\b[^>]*>/gu, (tag, name: string) => {
    const a = attrs(tag);
    const r = elementBox(name, a);
    if (!r || r.x + r.width <= x0 || (r.x < x0 && name !== 'line') || outline(tag) || !within(r) || tag === keep) return tag;
    let out = tag;
    const set = (key: string, value: number): void => {
      out = out.replace(new RegExp(` ${key}="[^"]*"`, 'u'), ` ${key}="${fmt(value)}"`);
    };
    if (name === 'rect' || name === 'text') set('x', shift(Number(a.x)));
    if (name === 'line') {
      set('x1', shift(Number(a.x1)));
      set('x2', shift(Number(a.x2)));
    }
    if (name === 'ellipse') set('cx', shift(Number(a.cx)));
    if ((name === 'polygon' || name === 'polyline') && a.points) {
      const n = a.points.split(/[ ,]+/u).filter(Boolean).map(Number);
      const moved = [];
      for (let i = 0; i + 1 < n.length; i += 2) moved.push(`${fmt(shift(n[i]!))},${fmt(n[i + 1]!)}`);
      out = out.replace(/ points="[^"]*"/u, ` points="${moved.join(name === 'polygon' ? ',' : ' ')}"`);
    }
    if (name === 'path' && a.d) out = out.replace(/ d="[^"]*"/u, ` d="${shiftPath(a.d, shift)}"`);
    return out;
  });
}

/** Shifts everything right of `x0` by `width` px, stretching what spans `x0` (frame, lines); nothing above `heading` moves. */
function insertColumn(svg: string, x0: number, width: number, heading = -Infinity): string {
  const shift = (x: number): number => (x > x0 ? x + width : x);
  return svg.replaceAll(/<(\w+)\b[^>]*>/gu, (tag, name: string) => {
    // The frame heading (everything above `heading`) keeps its place and shape.
    const box = name === 'rect' ? undefined : elementBox(name, attrs(tag));
    if (box && box.y + box.height <= heading) return tag;
    if (name === 'svg') {
      return tag
        .replace(/ width="([\d.]+)px"/u, (_, w: string) => ` width="${fmt(Number(w) + width)}px"`)
        .replace(/width:([\d.]+)px;/u, (_, w: string) => `width:${fmt(Number(w) + width)}px;`)
        .replace(
          / viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/u,
          (_, x: string, y: string, w: string, h: string) => ` viewBox="${x} ${y} ${fmt(Number(w) + width)} ${h}"`,
        );
    }
    const a = attrs(tag);
    let out = tag;
    const set = (key: string, value: number): void => {
      out = out.replace(new RegExp(` ${key}="[^"]*"`, 'u'), ` ${key}="${fmt(value)}"`);
    };
    if (name === 'rect' || name === 'text') {
      const x = Number(a.x);
      if (name === 'rect' && x < x0 && x + Number(a.width) > x0) set('width', Number(a.width) + width);
      else set('x', shift(x));
    }
    if (name === 'line') {
      set('x1', shift(Number(a.x1)));
      set('x2', shift(Number(a.x2)));
    }
    if (name === 'ellipse') set('cx', shift(Number(a.cx)));
    if ((name === 'polygon' || name === 'polyline') && a.points) {
      const n = a.points.split(/[ ,]+/u).filter(Boolean).map(Number);
      const moved = [];
      for (let i = 0; i + 1 < n.length; i += 2) moved.push(`${fmt(shift(n[i]!))},${fmt(n[i + 1]!)}`);
      out = out.replace(/ points="[^"]*"/u, ` points="${moved.join(name === 'polygon' ? ',' : ' ')}"`);
    }
    if (name === 'path' && a.d) out = out.replace(/ d="[^"]*"/u, ` d="${shiftPath(a.d, shift)}"`);
    return out;
  });
}

/** Absolute M/L/H/V/A path data with every x coordinate passed through `shift`. */
function shiftPath(d: string, shift: (x: number) => number): string {
  return d
    .replaceAll(/([MLHVA])([^MLHVAZz]*)/gu, (_, command: string, args: string) => {
      const n = args.split(/[ ,]+/u).filter(Boolean).map(Number);
      if (command === 'H') return `H${n.map(x => fmt(shift(x))).join(' ')} `;
      if (command === 'V') return `V${args}`;
      if (command === 'A') {
        const out: string[] = [];
        for (let i = 0; i + 6 < n.length; i += 7) out.push(`${n[i]},${n[i + 1]} ${n[i + 2]} ${n[i + 3]} ${n[i + 4]} ${fmt(shift(n[i + 5]!))},${n[i + 6]}`);
        return `A${out.join(' ')} `;
      }
      const out: string[] = [];
      for (let i = 0; i + 1 < n.length; i += 2) out.push(`${fmt(shift(n[i]!))},${fmt(n[i + 1]!)}`);
      return `${command}${out.join(' ')} `;
    })
    .trim();
}

/** Coordinate pairs of absolute M/L/A path data (PlantUML's note outlines). */
function pathCoordinates(d: string): [number, number][] {
  const out: [number, number][] = [];
  for (const [, command, args] of d.matchAll(/([MLA])([^MLAZz]*)/gu)) {
    const n = args!.split(/[ ,]+/u).filter(Boolean).map(Number);
    if (command === 'A') {
      for (let i = 0; i + 6 < n.length; i += 7) out.push([n[i + 5]!, n[i + 6]!]);
    } else for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i]!, n[i + 1]!]);
  }
  return out;
}

function bounds(n: number[]): Rect {
  const xs = n.filter((_, i) => i % 2 === 0),
    ys = n.filter((_, i) => i % 2 === 1);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of tag.matchAll(/([\w:-]+)="([^"]*)"/gu)) out[name!] = value!;
  return out;
}
