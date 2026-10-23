import { lifelineLabel } from '../../kinds/sequence/format.js';
import type { TimingDiagram } from '../../kinds/timing/model.js';
import type { KindFormat, Losses } from '../types.js';
import { document, encode, plantumlAliases, quoted } from './text.js';

/**
 * Timing diagram -> PlantUML timing diagram (export only), the readable form
 * of the renderer's source (src/kinds/timing/to-plantuml.ts): robust and
 * concise lifelines with their declared states, state changes grouped by
 * time (`@t`), notes, duration constraints (`<->`), messages
 * (`a@t1 -> b@t2`) and highlights. The time unit is the footer.
 */

export function exportTiming(model: TimingDiagram, losses: Losses): string {
  const ids = plantumlAliases();
  const lines: string[] = [`footer ${encode(`time (${model.timeUnit})`)}`];
  const stateAlias = new Map<string, string>();
  for (const l of model.lifelines) {
    const alias = ids.get(l.id);
    lines.push(`${l.notation} ${quoted(lifelineLabel(l) || ' ')} as ${alias}`);
    for (const [j, s] of l.states.entries()) {
      const sa = `${alias}_s${j}`;
      stateAlias.set(`${l.id}\u0000${s}`, sa);
      lines.push(`${alias} has ${quoted(s)} as ${sa}`);
    }
  }
  const events = new Map<number, string[]>();
  const at = (t: number): string[] => {
    if (!events.has(t)) events.set(t, []);
    return events.get(t)!;
  };
  for (const l of model.lifelines) for (const c of l.changes) at(c.at).push(`${ids.get(l.id)} is ${stateAlias.get(`${l.id}\u0000${c.state}`)}`);
  for (const n of model.notes ?? []) at(n.at).push(`note ${n.position ?? 'top'} of ${ids.get(n.lifeline)}`, encode(n.text), 'end note');
  for (const t of [...events.keys()].sort((a, b) => a - b)) lines.push(`@${t}`, ...events.get(t)!);
  for (const c of model.durationConstraints ?? []) lines.push(`${ids.get(c.lifeline)}@${c.from} <-> @${c.to} : ${encode(`{${c.min}..${c.max}}`)}`);
  for (const m of model.messages ?? []) {
    const label = m.arguments === undefined ? m.name : `${m.name}(${m.arguments.join(', ')})`;
    lines.push(`${ids.get(m.from)}@${m.fromTime} -> ${ids.get(m.to)}@${m.toTime} : ${encode(label)}`);
  }
  for (const [i, c] of (model.timeConstraints ?? []).entries()) {
    losses.add(`/timeConstraints/${i}`, 'A time constraint is drawn as a highlighted window across every lifeline, not only its own');
    lines.push(`highlight ${c.from} to ${c.to} : ${encode(`{${c.from}..${c.to}}`)}`);
  }
  for (const h of model.highlights ?? []) lines.push(`highlight ${h.from} to ${h.to}${h.label === undefined ? '' : ` : ${encode(h.label)}`}`);
  return document(model.title, lines);
}

export const plantumlTiming: KindFormat<TimingDiagram> = { kind: 'timing', export: exportTiming };
