import { theme } from '../../core/theme.js';
import { aliases, displayText } from '../../plantuml/encode.js';
import { plantUmlDocument } from '../../plantuml/skin.js';
import { wrapLines, wrappedDisplayText } from '../../plantuml/wrap.js';
import { lifelineLabel } from '../sequence/format.js';
import type { TimingDiagram } from './model.js';

/** Horizontal scale bounds, in px per diagram (PlantUML `scale <span> as <px> pixels`). */
const MIN_WIDTH = 480, MAX_WIDTH = 3200, PX_PER_UNIT = 12;
/** Rough upper bound of a 13px Inter glyph advance, used to give concise values room. */
const CHAR_PX = 8;

/** Timing-specific styling from the shared theme (PlantUML's timing diagram uses the style system). */
export function timingStyle(): string[] {
  const { color, font, stroke } = theme;
  return [
    `skinparam footerFontSize ${font.size.label}`,
    `skinparam footerFontColor ${color.mutedText}`,
    '<style>',
    'mainframe {',
    `  LineColor ${color.frameStroke}`,
    `  LineThickness ${stroke.frame}`,
    `  FontSize ${font.size.body}`,
    '}',
    'timingDiagram {',
    `  FontSize ${font.size.body}`,
    `  FontColor ${color.text}`,
    `  LineColor ${color.edge}`,
    `  LineThickness ${stroke.edge}`,
    '  robust {',
    `    LineColor ${color.edge}`,
    `    LineThickness ${stroke.node + 0.25}`,
    '  }',
    '  concise {',
    `    LineColor ${color.nodeStroke}`,
    `    BackgroundColor ${color.nodeHeaderFill}`,
    `    LineThickness ${stroke.node}`,
    '    FontStyle plain',
    '  }',
    '  constraintArrow {',
    `    LineColor ${color.edge}`,
    `    FontColor ${color.edgeText}`,
    `    FontSize ${font.size.label}`,
    '  }',
    '  arrow {',
    `    LineColor ${color.edge}`,
    `    FontColor ${color.edgeText}`,
    `    FontSize ${font.size.label}`,
    '  }',
    '  highlight {',
    `    BackgroundColor ${color.frameHeadingFill}`,
    `    FontSize ${font.size.label}`,
    `    FontColor ${color.mutedText}`,
    '  }',
    '  note {',
    `    BackgroundColor ${color.noteFill}`,
    `    LineColor ${color.noteStroke}`,
    `    LineThickness ${stroke.note}`,
    '    FontStyle plain',
    '  }',
    '}',
    '</style>',
  ];
}

/**
 * Timing diagram to PlantUML. Every display string is encoded; lifelines and
 * states map to private aliases. The horizontal scale gives each concise value
 * enough room for its text between two changes.
 */
export function timingToPlantUml(model: TimingDiagram): string {
  const ids = aliases(model.lifelines.map(l => l.id), 't');
  const lines: string[] = [...timingStyle()];
  if (model.title !== undefined) lines.push(`mainframe **sd** ${displayText(model.title)}`);
  lines.push(`footer ${displayText(`time (${model.timeUnit})`)}`);

  const times = new Set<number>();
  for (const l of model.lifelines) for (const c of l.changes) times.add(c.at);
  for (const m of model.messages ?? []) { times.add(m.fromTime); times.add(m.toTime); }
  for (const c of model.durationConstraints ?? []) { times.add(c.from); times.add(c.to); }
  for (const c of model.timeConstraints ?? []) { times.add(c.from); times.add(c.to); }
  for (const h of model.highlights ?? []) { times.add(h.from); times.add(h.to); }
  const sorted = [...times].sort((a, b) => a - b);
  const span = Math.max(1, sorted.at(-1)! - sorted[0]!);
  // Texts that must fit between two times: concise values (the last one runs to the
  // end of the axis), highlight and time-constraint captions.
  const end = sorted.at(-1)!;
  const spans: { from: number; to: number; text: string; pad: number }[] = [];
  for (const l of model.lifelines) {
    if (l.notation !== 'concise') continue;
    l.changes.forEach((c, j) => spans.push({ from: c.at, to: l.changes[j + 1]?.at ?? end, text: c.state, pad: 32 }));
  }
  for (const h of model.highlights ?? []) if (h.label !== undefined) spans.push({ from: h.from, to: h.to, text: h.label, pad: 16 });
  for (const c of model.timeConstraints ?? []) spans.push({ from: c.from, to: c.to, text: `{${c.from}..${c.to}}`, pad: 16 });
  let perUnit = PX_PER_UNIT;
  for (const s of spans) if (s.to > s.from) perUnit = Math.max(perUnit, ([...s.text].length * CHAR_PX + s.pad) / (s.to - s.from));
  // PlantUML labels one axis tick per `scale` step: choose a round step (1, 2 or 5 x 10^k) giving about ten ticks.
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, span * perUnit));
  const step = niceStep(span / 10);
  lines.push(`scale ${step} as ${Math.max(1, Math.round(step * width / span))} pixels`);

  const stateAlias = new Map<string, string>();
  model.lifelines.forEach(l => {
    const alias = ids.get(l.id)!;
    lines.push(`${l.notation} "${wrappedDisplayText(lifelineLabel(l), 40)}" as ${alias}`);
    l.states.forEach((s, j) => {
      const sa = `${alias}s${j}`;
      stateAlias.set(`${l.id}\u0000${s}`, sa);
      lines.push(`${alias} has "${displayText(s)}" as ${sa}`);
    });
  });

  // State changes and notes grouped by time.
  const events = new Map<number, string[]>();
  const at = (t: number): string[] => { if (!events.has(t)) events.set(t, []); return events.get(t)!; };
  for (const l of model.lifelines) for (const c of l.changes) at(c.at).push(`${ids.get(l.id)} is ${stateAlias.get(`${l.id}\u0000${c.state}`)}`);
  // Block form: one source line per wrapped line keeps long notes under PlantUML's line limit.
  for (const n of model.notes ?? []) at(n.at).push(`note ${n.position ?? 'top'} of ${ids.get(n.lifeline)}`, ...wrapLines(n.text, 32).map(displayText), 'end note');
  // PlantUML draws robust state lines only up to the last state change; messages,
  // constraints and highlights after it would point into empty space. Restating each
  // robust lifeline's final state at the last time used anywhere extends its line
  // without a visible change (concise values already run to the end of the axis).
  if (!events.has(end)) {
    for (const l of model.lifelines) if (l.notation === 'robust') at(end).push(`${ids.get(l.id)} is ${stateAlias.get(`${l.id}\u0000${l.changes.at(-1)!.state}`)}`);
  }
  if (!events.has(end)) at(end);
  for (const t of [...events.keys()].sort((a, b) => a - b)) lines.push(`@${t}`, ...events.get(t)!);

  for (const c of model.durationConstraints ?? []) {
    lines.push(`${ids.get(c.lifeline)}@${c.from} <-> @${c.to} : ${displayText(`{${c.min}..${c.max}}`)}`);
  }
  for (const m of model.messages ?? []) {
    const label = m.arguments === undefined ? m.name : `${m.name}(${m.arguments.join(', ')})`;
    lines.push(`${ids.get(m.from)}@${m.fromTime} -> ${ids.get(m.to)}@${m.toTime} : ${wrappedDisplayText(label, 40)}`);
  }
  for (const c of model.timeConstraints ?? []) lines.push(`highlight ${c.from} to ${c.to} : ${displayText(`{${c.from}..${c.to}}`)}`);
  for (const h of model.highlights ?? []) lines.push(`highlight ${h.from} to ${h.to}${h.label === undefined ? '' : ` : ${displayText(h.label)}`}`);
  return plantUmlDocument(lines);
}

/** Smallest 1, 2 or 5 x 10^k that is at least `raw` (and at least 1). */
export function niceStep(raw: number): number {
  if (raw <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map(m => m * power).find(v => v >= raw)!;
}
