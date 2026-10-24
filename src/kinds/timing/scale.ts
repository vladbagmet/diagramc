import { pointer } from '../../core/errors.js';
import { wrapLines } from '../../plantuml/wrap.js';
import type { TimingDiagram } from './model.js';

/** Width bounds of the time axis, in px. */
export const MIN_WIDTH = 480,
  MAX_WIDTH = 3200;
/** Smallest distance between two state changes of one lifeline, so every step stays visible. */
export const MIN_STEP_PX = 14;
/** Note text wrap width in graphemes (to-plantuml.ts). */
export const NOTE_WRAP = 32;

/** Advance widths of printable ASCII (U+0020 to U+007E) in Inter Regular, in thousandths of an em, rounded up. */
const ASCII_ADVANCE = [
  282, 288, 466, 634, 642, 982, 645, 300, 365, 365, 501, 662, 289, 460, 289, 361, 631, 407, 610, 618, 646, 594, 621, 566, 619, 621, 289, 302, 662, 662, 662,
  512, 966, 690, 655, 731, 722, 602, 591, 747, 744, 269, 571, 672, 566, 904, 754, 765, 639, 765, 644, 642, 646, 745, 690, 986, 683, 679, 629, 365, 361, 365,
  472, 457, 323, 562, 613, 572, 613, 584, 371, 614, 592, 243, 243, 549, 243, 876, 591, 600, 613, 613, 377, 528, 328, 592, 563, 819, 546, 563, 553, 427, 333,
  427, 662,
];

/**
 * Advance width of display text in Inter at `size` px, without kerning (which
 * only narrows text). The time scale is decided during validation, before the
 * fonts are loaded, so ASCII uses the font's advance table above and every other
 * character a generous estimate (wide for CJK and emoji). Deterministic.
 */
export function estimateWidth(text: string, size = 13): number {
  let em = 0;
  for (const c of text) {
    const code = c.codePointAt(0)!;
    if (code >= 0x20 && code <= 0x7e) em += ASCII_ADVANCE[code - 0x20]! / 1000;
    else if (/[\u{1100}-\u{11FF}\u{2E80}-\u{A4CF}\u{AC00}-\u{D7AF}\u{F900}-\u{FAFF}\u{FE30}-\u{FE4F}\u{FF00}-\u{FFEF}]|\p{Extended_Pictographic}/u.test(c))
      em += 1.05;
    else em += 0.8;
  }
  return Math.ceil(em * size);
}

/** Room a concise value needs besides its text: the hexagon ends (12 px each) and 2 px on each side. */
export const VALUE_PAD = 28;

/** Something drawn between two times that needs `px` of horizontal room. */
export interface SpaceNeed {
  /** JSON Pointer of the text (or element) that needs the room. */
  path: string;
  /** What it is, for messages, e.g. `value "Busy" of lifeline "cpu"`. */
  what: string;
  from: number;
  to: number;
  px: number;
  /** Text needs fail validation when they cannot be met; step needs only push the scale. */
  text: boolean;
}

export interface TimeScale {
  /** First and last time on the axis (`end` may extend past the last time to show a value that starts there). */
  start: number;
  end: number;
  /** Pixels per time unit. */
  perUnit: number;
  /** Axis width in px. */
  width: number;
  /** Text that cannot get its room even at MAX_WIDTH. */
  tooDense: SpaceNeed[];
}

/** Every time the diagram mentions, sorted. */
export function diagramTimes(model: TimingDiagram): number[] {
  const times = new Set<number>();
  for (const l of model.lifelines) for (const c of l.changes) times.add(c.at);
  for (const m of model.messages ?? []) {
    times.add(m.fromTime);
    times.add(m.toTime);
  }
  for (const c of model.durationConstraints ?? []) {
    times.add(c.from);
    times.add(c.to);
  }
  for (const c of model.timeConstraints ?? []) {
    times.add(c.from);
    times.add(c.to);
  }
  for (const h of model.highlights ?? []) {
    times.add(h.from);
    times.add(h.to);
  }
  for (const n of model.notes ?? []) times.add(n.at);
  return [...times].sort((a, b) => a - b);
}

/**
 * Chooses the horizontal scale from what has to fit between two times: concise
 * values (with room for their hexagon ends), notes next to the following note
 * on the same lifeline and side, highlight captions, duration constraint arrows,
 * and a minimum step between changes of one lifeline. The axis is never
 * narrower than MIN_WIDTH nor wider than MAX_WIDTH; text that still does not
 * fit is reported (TIMELINE_TOO_DENSE) instead of being drawn over other text.
 */
export function timeScale(model: TimingDiagram): TimeScale {
  const times = diagramTimes(model);
  const start = times[0]!,
    end = times.at(-1)!;
  const span = Math.max(1, end - start);
  const needs: SpaceNeed[] = [];
  for (const [i, l] of model.lifelines.entries()) {
    for (const [j, c] of l.changes.entries()) {
      const next = l.changes[j + 1]?.at ?? end;
      if (l.notation === 'concise') {
        needs.push({
          path: pointer('', 'lifelines', i, 'changes', j, 'state'),
          what: `value "${c.state}" of lifeline "${l.id}"`,
          from: c.at,
          to: next,
          px: estimateWidth(c.state) + VALUE_PAD,
          text: true,
        });
      } else if (j + 1 < l.changes.length) {
        needs.push({
          path: pointer('', 'lifelines', i, 'changes', j + 1, 'at'),
          what: `state change of lifeline "${l.id}"`,
          from: c.at,
          to: next,
          px: MIN_STEP_PX,
          text: false,
        });
      }
    }
  }
  // Notes on one lifeline and side must not run into the next one.
  const notes = (model.notes ?? []).map((n, i) => ({ n, i })).sort((a, b) => a.n.at - b.n.at || a.i - b.i);
  for (const [k, { n, i }] of notes.entries()) {
    const next = notes.slice(k + 1).find(o => o.n.lifeline === n.lifeline && (o.n.position ?? 'top') === (n.position ?? 'top'));
    if (!next) continue;
    const width = Math.max(...wrapLines(n.text, NOTE_WRAP).map(line => estimateWidth(line))) + 30;
    needs.push({
      path: pointer('', 'notes', i, 'text'),
      what: `note on lifeline "${n.lifeline}" at ${n.at}`,
      from: n.at,
      to: next.n.at,
      px: width,
      text: true,
    });
  }
  // Highlight captions sit at the top: each needs its interval, and room before the next caption.
  const highlights = (model.highlights ?? [])
    .map((h, i) => ({ h, i }))
    .filter(x => x.h.label !== undefined)
    .sort((a, b) => a.h.from - b.h.from || a.i - b.i);
  for (const [k, { h, i }] of highlights.entries()) {
    const next = highlights[k + 1];
    const until = next && next.h.from < h.to ? next.h.from : h.to;
    needs.push({
      path: pointer('', 'highlights', i, 'label'),
      what: `highlight caption "${h.label}"`,
      from: h.from,
      to: until,
      px: estimateWidth(h.label!, 12) + 12,
      text: true,
    });
  }
  for (const [i, c] of (model.durationConstraints ?? []).entries()) {
    needs.push({ path: pointer('', 'durationConstraints', i), what: `duration constraint {${c.min}..${c.max}}`, from: c.from, to: c.to, px: 36, text: true });
  }
  const max = MAX_WIDTH / span;
  let perUnit = MIN_WIDTH / span;
  for (const n of needs) if (n.to > n.from) perUnit = Math.max(perUnit, n.px / (n.to - n.from));
  const tooDense = needs.filter(n => n.text && n.to > n.from && n.px / (n.to - n.from) > max + 1e-9);
  perUnit = Math.min(perUnit, max);
  // A concise value that starts at the last time still needs room for its text.
  const tail = Math.max(
    0,
    ...model.lifelines.filter(l => l.notation === 'concise' && l.changes.at(-1)!.at === end).map(l => estimateWidth(l.changes.at(-1)!.state) + VALUE_PAD),
  );
  const axisEnd = tail ? end + Math.ceil(tail / perUnit) : end;
  return { start, end: axisEnd, perUnit, width: (axisEnd - start) * perUnit, tooDense };
}

/** Smallest 1, 2 or 5 x 10^k that is at least `raw` (and at least 1). */
export function niceStep(raw: number): number {
  if (raw <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map(m => m * power).find(v => v >= raw)!;
}

/**
 * PlantUML's `scale <step> as <px> pixels`: one labelled axis tick per round step
 * (1, 2 or 5 x 10^k, about ten ticks), whole pixels per step, and the resulting
 * pixels per time unit that the drawing really uses.
 */
export function plantUmlScale(scale: TimeScale): { step: number; px: number; perUnit: number } {
  const step = niceStep(Math.max(1, scale.end - scale.start) / 10);
  const px = Math.max(1, Math.round(step * scale.perUnit));
  return { step, px, perUnit: px / step };
}
