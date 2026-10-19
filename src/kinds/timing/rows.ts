import { theme } from '../../core/theme.js';
import type { TimingDiagram } from './model.js';
import { plantUmlScale, timeScale } from './scale.js';

/**
 * Row-level fix-ups of PlantUML's timing SVG, driven by the model (lifelines
 * are drawn top to bottom in model order, one row each). Only PlantUML's own
 * primitives are moved, restyled or added; no input text is introduced.
 *
 * - Vertical room: at least ROW_PAD px between a lifeline's name tab and its
 *   first state label, at least LEVEL_GAP px between robust state levels, and a
 *   band per duration constraint and time constraint of the lifeline (UML
 *   17.7.4: constraints belong to their lifeline).
 * - Duration constraints become double-headed arrows in their band above the
 *   lifeline, with dotted extension lines down to the constrained changes, so they
 *   never read as a state line.
 * - Time constraints: the shaded window and its {from..to} label are confined
 *   to the constrained lifeline's row, the label in its own band.
 * - Robust state labels are left-aligned with the lifeline name in every row,
 *   the last concise value is centered in its open band, the time axis runs to
 *   the end of the state lines, and PlantUML's inner box (a second border just
 *   inside the frame) is dropped: rows are separated by full-width lines.
 */

/** Marker fill of time-constraint highlights in the PlantUML source, restyled here. */
export const TIME_CONSTRAINT_MARK = '#F1F5F8';
/** Minimum gap between a name tab and the first state label below it. */
export const ROW_PAD = 8;
/** Minimum distance between two robust state levels. */
export const LEVEL_GAP = 26;
/** Height of one constraint band (label above a double-headed arrow). */
export const BAND = 26;

const NUM = '-?[\\d.]+';
const round = (n: number): string => String(Math.round(n * 1000) / 1000);
const num = (tag: string, name: string): number => Number(tag.match(new RegExp(`\\s${name}="(${NUM})"`, 'u'))?.[1] ?? NaN);
const setAttr = (tag: string, name: string, value: number): string => tag.replace(new RegExp(`(\\s${name}=")${NUM}(")`, 'u'), `$1${round(value)}$2`);

interface Line { tag: string; x1: number; x2: number; y1: number; y2: number; width: number; dashed: boolean }
interface Text { tag: string; full: string; x: number; y: number; size: number; length: number; bold: boolean }

function lines(svg: string): Line[] {
  return [...svg.matchAll(/<line style="([^"]*)" x1="(-?[\d.]+)" x2="(-?[\d.]+)" y1="(-?[\d.]+)" y2="(-?[\d.]+)"\/>/gu)].map(m => ({
    tag: m[0], x1: Number(m[2]), x2: Number(m[3]), y1: Number(m[4]), y2: Number(m[5]),
    width: Number(m[1]!.match(/stroke-width:([\d.]+)/u)?.[1] ?? 1), dashed: m[1]!.includes('dasharray'),
  }));
}

function texts(svg: string): Text[] {
  return [...svg.matchAll(/<text [^>]*>[^<]*<\/text>/gu)].map(m => {
    const tag = m[0].slice(0, m[0].indexOf('>') + 1);
    return { tag, full: m[0], x: num(tag, 'x'), y: num(tag, 'y'), size: num(tag, 'font-size'), length: num(tag, 'textLength'), bold: tag.includes('font-weight="bold"') };
  });
}

/** Applies `f` to every y coordinate of the drawing (and the canvas height). */
function mapY(svg: string, f: (y: number) => number): string {
  return svg.replace(/<(svg|line|rect|polygon|polyline|path|text|ellipse)\b[^>]*>/gu, (tag, name: string) => {
    switch (name) {
      case 'svg': {
        const h = Number(tag.match(/ viewBox="[-\d.]+ [-\d.]+ [\d.]+ ([\d.]+)"/u)?.[1] ?? NaN);
        if (!Number.isFinite(h)) return tag;
        const grown = Math.ceil(f(h));
        return tag.replace(/ height="[\d.]+px"/u, ` height="${grown}px"`).replace(/height:[\d.]+px;/u, `height:${grown}px;`)
          .replace(/( viewBox="[-\d.]+ [-\d.]+ [\d.]+ )[\d.]+"/u, `$1${grown}"`);
      }
      case 'line': return setAttr(setAttr(tag, 'y1', f(num(tag, 'y1'))), 'y2', f(num(tag, 'y2')));
      case 'rect': { const y = num(tag, 'y'), h = num(tag, 'height'); return setAttr(setAttr(tag, 'y', f(y)), 'height', f(y + h) - f(y)); }
      case 'text': return setAttr(tag, 'y', f(num(tag, 'y')));
      case 'ellipse': return setAttr(tag, 'cy', f(num(tag, 'cy')));
      case 'polygon': case 'polyline':
        return tag.replace(/ points="([^"]*)"/u, (_, p: string) => {
          const n = p.split(/[ ,]+/u).filter(Boolean).map(Number);
          // Arrowheads (triangles) move as a whole, with their tip.
          if (n.length === 6) {
            const pts = [0, 1, 2].map(i => ({ x: n[2 * i]!, y: n[2 * i + 1]! }));
            const side = (i: number): number => Math.hypot(pts[(i + 1) % 3]!.x - pts[(i + 2) % 3]!.x, pts[(i + 1) % 3]!.y - pts[(i + 2) % 3]!.y);
            const tip = pts[[0, 1, 2].sort((a, b) => side(a) - side(b))[0]!]!;
            const dy = f(tip.y) - tip.y;
            return ` points="${pts.map(q => `${round(q.x)},${round(q.y + dy)}`).join(',')}"`;
          }
          return ` points="${p.split(/([ ,]+)/u).map((v, i) => i % 4 === 2 && v.trim() ? round(f(Number(v))) : v).join('')}"`;
        });
      case 'path':
        return tag.replace(/ d="([^"]*)"/u, (_, d: string) => ` d="${d.replace(/([MLA])([^MLAZz]*)/gu, (_m, c: string, args: string) => {
          const n = args.trim().split(/[ ,]+/u).filter(Boolean).map(Number);
          if (c === 'A') { for (let i = 6; i < n.length; i += 7) n[i] = f(n[i]!); return `A${n[0]},${n[1]} ${n[2]} ${n[3]} ${n[4]} ${n.slice(5).map(round).join(',')} `; }
          for (let i = 1; i < n.length; i += 2) n[i] = f(n[i]!);
          return `${c}${n.map(round).join(',')} `;
        }).trim()}"`);
      default: return tag;
    }
  });
}

interface Row { index: number; top: number; bottom: number; tabBottom: number; tabRight: number; header: Text | undefined; labels: Text[] }

export function fixTimingRows(svg: string, model: TimingDiagram): string {
  const { color } = theme;
  const all = lines(svg);
  const solid = all.filter(l => !l.dashed && l.width === theme.stroke.edge);
  const verticals = solid.filter(l => l.x1 === l.x2 && l.y1 !== l.y2);
  const candidates = solid.filter(l => l.y1 === l.y2 && verticals.some(v => v.x1 === l.x1) && verticals.some(v => v.x1 === l.x2) && l.x2 - l.x1 > 100);
  // Row separators start at the inner box's left side (the time axis starts further right).
  const separators = candidates.filter(l => l.x1 === Math.min(...candidates.map(c => c.x1)));
  if (!separators.length) return svg;
  const innerLeft = separators[0]!.x1, innerRight = separators[0]!.x2;
  const boxSides = verticals.filter(v => (v.x1 === innerLeft || v.x1 === innerRight) && v.y1 <= separators[0]!.y1 + 0.5);
  if (boxSides.length !== 2) return svg;
  const axisY = Math.max(...boxSides.map(v => v.y2));
  const axis = solid.find(l => l.y1 === axisY && l.y2 === axisY && l.x1 > innerLeft && l.x2 - l.x1 > 50);
  if (!axis) return svg;
  const tops = separators.map(l => l.y1).sort((a, b) => a - b);
  if (tops.length !== model.lifelines.length) return svg;
  const allTexts = texts(svg);
  const rows: Row[] = tops.map((top, index) => {
    const bottom = tops[index + 1] ?? axisY;
    const tab = solid.find(l => l.y1 === l.y2 && l.x1 === innerLeft && l.y1 > top && l.y1 < bottom && l.x2 - l.x1 < (innerRight - innerLeft) / 2);
    const header = allTexts.find(t => t.bold && t.y > top && t.y < (tab?.y1 ?? bottom));
    const labels = model.lifelines[index]!.notation === 'robust'
      ? allTexts.filter(t => !t.bold && t.x < axis.x1 && t.y > (tab?.y1 ?? top) && t.y < bottom).sort((a, b) => a.y - b.y) : [];
    // The tab's slanted right side reaches 10 px further than its bottom line.
    return { index, top, bottom, tabBottom: tab?.y1 ?? top, tabRight: (tab?.x2 ?? innerLeft) + 10, header, labels };
  });
  if (rows.some(r => !r.header)) return svg;

  // Time to x: the axis starts at the first time; PlantUML's scale is the rounded `scale` step.
  const scale = timeScale(model);
  const perUnit = plantUmlScale(scale).perUnit;
  const x = (t: number): number => axis.x1 + (t - scale.start) * perUnit;

  // 1. Vertical room, computed on the original geometry, applied as one y mapping.
  const durations = (model.durationConstraints ?? []).map((c, i) => ({ c, i }));
  const timeConstraints = model.timeConstraints ?? [];
  const inserts: { at: number; dy: number }[] = [];
  // Arrowheads must move as a whole: room is never opened through one.
  const heads = [...svg.matchAll(new RegExp(`<polygon fill="${color.edge}" points="([^"]*)"`, 'gu'))].map(m => {
    const ys = m[1]!.split(/[ ,]+/u).filter(Boolean).map(Number).filter((_, i) => i % 2 === 1);
    return [Math.min(...ys), Math.max(...ys)] as const;
  });
  for (const row of rows) {
    const id = model.lifelines[row.index]!.id;
    const bands = durations.filter(d => d.c.lifeline === id).length + (timeConstraints.some(c => c.lifeline === id) ? 1 : 0);
    const firstTop = contentTop(svg, row, allTexts);
    const pad = Math.max(0, ROW_PAD - (firstTop - row.tabBottom));
    if (pad + bands * BAND > 0) inserts.push({ at: freeY(row.tabBottom, Math.max(firstTop, row.tabBottom + 0.02), heads, row.tabBottom + 0.01), dy: pad + bands * BAND });
    for (let k = 1; k < row.labels.length; k++) {
      const gap = row.labels[k]!.y - row.labels[k - 1]!.y;
      if (gap < LEVEL_GAP) inserts.push({ at: freeY(row.labels[k - 1]!.y - row.labels[k]!.size * 0.44, row.labels[k]!.y - row.labels[k]!.size * 0.44, heads), dy: LEVEL_GAP - gap });
    }
  }
  const f = (y: number): number => y + inserts.reduce((sum, s) => sum + (y > s.at ? s.dy : 0), 0);
  // Duration constraint groups are removed before the mapping and redrawn after it.
  const groups = durationGroups(svg);
  for (const g of groups) svg = svg.replace(g.full, '');
  if (inserts.length) svg = mapY(svg, f);

  // 2. Inner box: drop its sides; separators, tabs and the axis line span the frame.
  const frame = svg.match(/<rect fill="#FFFFFF" height="([\d.]+)" style="[^"]*" width="([\d.]+)" x="([\d.]+)" y="([\d.]+)"\/>/u);
  const frameLeft = frame ? Number(frame[3]) : innerLeft, frameRight = frame ? Number(frame[3]) + Number(frame[2]) : innerRight;
  const right = Math.max(...lines(svg).filter(l => l.width === theme.stroke.node + 0.25).map(l => Math.max(l.x1, l.x2)),
    ...[...svg.matchAll(/<(?:polygon|path)\b[^>]*fill="#EAF0F6"[^>]*>/gu)].map(m => Math.max(...(m[0].match(/(?:points|d)="([^"]*)"/u)?.[1]?.match(/-?\d+(?:\.\d+)?/gu) ?? ['0']).filter((_, i) => i % 2 === 0).map(Number))), axis.x2);
  svg = svg.replace(/<line [^>]*\/>/gu, tag => {
    const l = lines(tag)[0];
    if (!l || l.dashed) return tag;
    if (l.width === theme.stroke.edge && l.x1 === l.x2 && (l.x1 === innerLeft || l.x1 === innerRight) && l.y1 <= f(tops[0]!) + 0.5) return '';
    if (l.y1 === l.y2 && l.x1 === innerLeft && l.x2 === innerRight) return setAttr(setAttr(tag, 'x1', frameLeft), 'x2', frameRight);
    if (l.y1 === l.y2 && l.x1 === innerLeft) return setAttr(tag, 'x1', frameLeft);
    if (l.y1 === l.y2 && Math.abs(l.y1 - f(axisY)) < 0.01 && l.x1 === axis.x1) return setAttr(tag, 'x2', right);
    return tag;
  });

  // Time grid lines never run through a lifeline's name tab.
  const tabs = rows.map(r => ({ x: r.tabRight, top: f(r.top), bottom: f(r.tabBottom) }));
  svg = svg.replace(/<line style="([^"]*dasharray:3,5;[^"]*)" x1="(-?[\d.]+)" x2="\2" y1="(-?[\d.]+)" y2="(-?[\d.]+)"\/>/gu, (tag, style: string, gx: string, y1: string, y2: string) => {
    const cut = tabs.filter(t => Number(gx) <= t.x + 2 && t.bottom > Number(y1) && t.top < Number(y2)).sort((p, q) => p.top - q.top);
    if (!cut.length) return tag;
    const parts: string[] = [];
    let from = Number(y1);
    for (const t of cut) { if (t.top > from) parts.push(`<line style="${style}" x1="${gx}" x2="${gx}" y1="${round(from)}" y2="${round(t.top)}"/>`); from = Math.max(from, t.bottom); }
    if (from < Number(y2)) parts.push(`<line style="${style}" x1="${gx}" x2="${gx}" y1="${round(from)}" y2="${y2}"/>`);
    return parts.join('');
  });

  // 3. Robust state labels left-aligned with the lifeline names.
  const nameX = rows[0]!.header!.x;
  const labelTop = f(tops[0]!), labelBottom = f(axisY);
  svg = svg.replace(/<text [^>]*>/gu, tag => {
    const tx = num(tag, 'x'), ty = num(tag, 'y');
    return !tag.includes('font-weight="bold"') && tx < axis.x1 && ty > labelTop && ty < labelBottom ? setAttr(tag, 'x', nameX) : tag;
  });

  // 4. Duration constraints in their bands, with extension lines to the constrained changes.
  const used = new Map<number, number>();
  const { edge, edgeText } = color;
  let added = '';
  for (const { c } of durations) {
    const index = model.lifelines.findIndex(l => l.id === c.lifeline);
    const row = rows[index]!;
    const k = used.get(index) ?? 0;
    used.set(index, k + 1);
    const y = f(row.tabBottom) + k * BAND + BAND - 6;
    const a = x(c.from), b = x(c.to);
    const group = groups.find(g => Math.abs(g.x1 - a) < 4 && Math.abs(g.x2 - b) < 4 && g.y > row.top && g.y < row.bottom);
    const label = group?.text ?? '';
    const head = (tip: number, dir: number): string => `<polygon fill="${edge}" points="${round(tip)},${round(y)},${round(tip + 8 * dir)},${round(y - 4)},${round(tip + 8 * dir)},${round(y + 4)}" style="stroke:${edge};stroke-width:1;"/>`;
    const target = (t: number): number => f(levelY(model, index, t, row, svg));
    const dotted = (px: number): string => `<line style="stroke:${edge};stroke-width:0.75;stroke-dasharray:2,2;" x1="${round(px)}" x2="${round(px)}" y1="${round(y)}" y2="${round(target(px === a ? c.from : c.to))}"/>`;
    added += dotted(a) + dotted(b)
      + `<line style="stroke:${edge};stroke-width:${theme.stroke.edge};" x1="${round(a)}" x2="${round(b)}" y1="${round(y)}" y2="${round(y)}"/>${head(a, 1)}${head(b, -1)}`;
    if (label) {
      const w = num(label, 'textLength');
      added += setAttr(setAttr(label, 'x', (a + b) / 2 - w / 2), 'y', y - 5).replace(/fill="#[0-9A-Fa-f]{6}"/u, `fill="${edgeText}"`);
    }
  }

  // 5. Time constraints: window and label inside the constrained row.
  for (const c of timeConstraints) {
    const index = model.lifelines.findIndex(l => l.id === c.lifeline);
    const row = rows[index]!;
    // The window starts at its label band, below the duration constraint bands of the row.
    const k = used.get(index) ?? 0;
    const top = f(row.tabBottom) + k * BAND, bottom = f(row.bottom);
    const a = x(c.from), b = x(c.to);
    svg = svg.replace(new RegExp(`<rect fill="${TIME_CONSTRAINT_MARK}"[^>]*>`, 'gu'), tag => {
      if (Math.abs(num(tag, 'x') - a) > 2) return tag;
      return setAttr(setAttr(tag, 'y', top), 'height', bottom - top).replace(TIME_CONSTRAINT_MARK, color.frameHeadingFill);
    });
    // Its dashed borders and caption, drawn by PlantUML across every row.
    svg = svg.replace(/<line style="[^"]*dasharray:4,4;[^"]*" [^>]*\/>/gu, tag => {
      const l = lines(tag)[0]!;
      return Math.abs(l.x1 - a) < 0.5 || Math.abs(l.x1 - b) < 0.5 ? setAttr(setAttr(tag, 'y1', top), 'y2', bottom) : tag;
    });
    const caption = `{${c.from}..${c.to}}`;
    svg = svg.replace(/<text [^>]*>([^<]*)<\/text>/gu, (whole, content: string) => {
      if (content.replace(/&#8203;|\u200b/gu, '') !== escapeText(caption) || Math.abs(num(whole, 'x') - a) > 12) return whole;
      return setAttr(setAttr(whole, 'y', f(row.tabBottom) + k * BAND + 16), 'x', a + 4);
    });
  }

  // 6. The last concise value is centered in its open band, like every other value.
  svg = centerOpenValues(added ? svg.replace(/<\/g>(?![\s\S]*<\/g>)/u, `${added}</g>`) : svg);

  // 7. At least LABEL_GAP px between the widest state label and the start of the time axis.
  const widest = Math.max(0, ...texts(svg).filter(t => !t.bold && t.x === nameX && t.y > labelTop && t.y < labelBottom).map(t => t.x + t.length));
  const missing = LABEL_GAP - (axis.x1 - widest);
  return widest && missing > 0 ? mapX(svg, axis.x1 - 0.5, Math.ceil(missing), labelTop) : svg;
}

/** Minimum gap between a state label and the time axis start. */
export const LABEL_GAP = 10;

/**
 * Shifts everything that starts right of `x0` by `dx` px; lines and rectangles
 * that span `x0` (row separators, tabs, the frame) are stretched. Texts move
 * when their center is right of `x0` (tick labels), so state labels stay;
 * lifeline names and texts above `top` (the frame heading) never move.
 */
function mapX(svg: string, x0: number, dx: number, top: number): string {
  const f = (x: number): number => x > x0 ? x + dx : x;
  return svg.replace(/<(svg|line|rect|polygon|polyline|path|text|ellipse)\b[^>]*>/gu, (tag, name: string) => {
    switch (name) {
      case 'svg': {
        const w = Number(tag.match(/ viewBox="[-\d.]+ [-\d.]+ ([\d.]+) [\d.]+"/u)?.[1] ?? NaN);
        if (!Number.isFinite(w)) return tag;
        const grown = Math.ceil(w + dx);
        return tag.replace(/ width="[\d.]+px"/u, ` width="${grown}px"`).replace(/width:[\d.]+px;/u, `width:${grown}px;`)
          .replace(/( viewBox="[-\d.]+ [-\d.]+ )[\d.]+/u, `$1${grown}`);
      }
      case 'line': return setAttr(setAttr(tag, 'x1', f(num(tag, 'x1'))), 'x2', f(num(tag, 'x2')));
      case 'rect': { const x = num(tag, 'x'), w = num(tag, 'width'); return setAttr(setAttr(tag, 'x', f(x)), 'width', f(x + w) - f(x)); }
      case 'text': {
        // Lifeline names (bold) and the frame heading (above `top`) stay with the tabs.
        const tx = num(tag, 'x'), center = tx + num(tag, 'textLength') / 2;
        return center > x0 && !tag.includes('font-weight="bold"') && num(tag, 'y') > top ? setAttr(tag, 'x', tx + dx) : tag;
      }
      case 'ellipse': return setAttr(tag, 'cx', f(num(tag, 'cx')));
      case 'polygon': case 'polyline':
        return tag.replace(/ points="([^"]*)"/u, (_, p: string) => ` points="${p.split(/([ ,]+)/u).map((v, i) => i % 4 === 0 && v.trim() ? round(f(Number(v))) : v).join('')}"`);
      case 'path':
        return tag.replace(/ d="([^"]*)"/u, (_, d: string) => ` d="${d.replace(/([MLA])([^MLAZz]*)/gu, (_m, c: string, args: string) => {
          const n = args.trim().split(/[ ,]+/u).filter(Boolean).map(Number);
          if (c === 'A') { for (let i = 5; i < n.length; i += 7) n[i] = f(n[i]!); return `A${n[0]},${n[1]} ${n[2]} ${n[3]} ${n[4]} ${n.slice(5).map(round).join(',')} `; }
          for (let i = 0; i < n.length; i += 2) n[i] = f(n[i]!);
          return `${c}${n.map(round).join(',')} `;
        }).trim()}"`);
      default: return tag;
    }
  });
}

/** A y in (upper, lower), nearest `prefer`, that cuts through no arrowhead. */
function freeY(upper: number, lower: number, heads: readonly (readonly [number, number])[], prefer = (upper + lower) / 2): number {
  const inside = (y: number): boolean => y > upper && y < lower && !heads.some(([a, b]) => y >= a - 0.001 && y <= b + 0.001);
  const candidates = [prefer, ...heads.flatMap(([a, b]) => [a - 0.002, b + 0.002])];
  for (let d = 0.25; d < lower - upper; d += 0.25) candidates.push(prefer - d, prefer + d);
  return candidates.filter(inside).sort((p, q) => Math.abs(p - prefer) - Math.abs(q - prefer))[0] ?? prefer;
}

/** Escapes text as PlantUML writes it in SVG text content. */
const escapeText = (s: string): string => s.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

/** Top of the first thing drawn below a row's tab: a state label, a value band or a note. */
function contentTop(svg: string, row: Row, all: Text[]): number {
  let top = row.bottom;
  for (const t of all) if (t !== row.header && t.y > row.tabBottom && t.y < row.bottom && !t.bold) top = Math.min(top, t.y - t.size * 0.97);
  for (const m of svg.matchAll(/<(?:polygon|path)\b[^>]*fill="(?:#EAF0F6|#FFF8DB)"[^>]*>/gu)) {
    const ys = (m[0].match(/(?:points|d)="([^"]*)"/u)?.[1]?.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number).filter((_, i) => i % 2 === 1);
    const y = Math.min(...ys);
    if (y > row.tabBottom && y < row.bottom) top = Math.min(top, y);
  }
  return top;
}

/** y of the state line (robust) or the band top (concise) of a lifeline at time `t`, before remapping. */
function levelY(model: TimingDiagram, index: number, t: number, row: Row, svg: string): number {
  const l = model.lifelines[index]!;
  if (l.notation === 'robust') {
    const state = [...l.changes].reverse().find(c => c.at <= t)?.state ?? l.changes[0]!.state;
    const label = row.labels[l.states.indexOf(state)];
    if (label) return label.y - label.size * 0.44;
  }
  let top = row.bottom;
  for (const m of svg.matchAll(/<(?:polygon|path)\b[^>]*fill="#EAF0F6"[^>]*>/gu)) {
    const ys = (m[0].match(/(?:points|d)="([^"]*)"/u)?.[1]?.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number).filter((_, i) => i % 2 === 1);
    const y = Math.min(...ys);
    if (y > row.top && y < row.bottom) top = Math.min(top, y);
  }
  return top;
}

interface Group { full: string; x1: number; x2: number; y: number; text: string | undefined }

/** PlantUML's duration constraint drawings: a line, a head at each end and the label. */
function durationGroups(svg: string): Group[] {
  const edge = theme.color.edge;
  const pattern = new RegExp(`<line style="stroke:${edge};stroke-width:[\\d.]+;" x1="(${NUM})" x2="(${NUM})" y1="(${NUM})" y2="\\3"/><polygon fill="${edge}" points="[^"]*" style="[^"]*"/><polygon fill="${edge}" points="[^"]*" style="[^"]*"/>(<text [^>]*>[^<]*</text>)?`, 'gu');
  return [...svg.matchAll(pattern)].map(m => ({ full: m[0], x1: Number(m[1]), x2: Number(m[2]), y: Number(m[3]), text: m[4] }));
}

/** Centers the text of open-ended concise values (the last value of a lifeline) in their band. */
function centerOpenValues(svg: string): string {
  const fill = '#EAF0F6';
  for (const m of [...svg.matchAll(new RegExp(`<path d="M(${NUM}),(${NUM}) L(${NUM}),\\2 L(${NUM}),(${NUM}) L\\3,(${NUM}) L\\1,\\6" fill="${fill}"[^>]*>`, 'gu'))]) {
    const right = Number(m[1]), left = Number(m[3]), top = Number(m[2]), bottom = Number(m[6]);
    svg = svg.replace(/<text [^>]*>[^<]*<\/text>/gu, whole => {
      const x = num(whole, 'x'), y = num(whole, 'y'), w = num(whole, 'textLength');
      if (x < left - 0.5 || x > right || y < top || y > bottom + 2) return whole;
      return setAttr(whole, 'x', (left + right) / 2 - w / 2);
    });
  }
  return svg;
}
