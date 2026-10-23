import { pointer, type Diagnostic } from '../../core/errors.js';
import { reference, uniqueIds } from '../../model/rules.js';
import type { Lifeline, TimingDiagram } from './model.js';
import { MAX_WIDTH, timeScale } from './scale.js';
import { checkLength } from '../sequence/validate.js';
import { lifelineLabel } from '../sequence/format.js';

/**
 * Semantic rules of timing diagrams (UML 2.5.1 clause 17.7). Each rule has a
 * stable code; docs/kinds/timing.md lists them with their fixtures.
 */
export function validateTimingDiagram(model: TimingDiagram): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const add = (code: string, path: string, message: string, details?: unknown): void => {
    diagnostics.push({ code, path, message, ...(details === undefined ? {} : { details }) });
  };
  const lists = ['messages', 'durationConstraints', 'timeConstraints', 'highlights', 'notes'] as const;
  uniqueIds([
    ...model.lifelines.map((l, i) => ({ id: l.id, path: pointer('', 'lifelines', i) })),
    ...lists.flatMap(list => (model[list] ?? []).flatMap((item, i) => item.id === undefined ? [] : [{ id: item.id, path: pointer('', list, i) }])),
  ], diagnostics);
  const lifelines = new Map<string, Lifeline>(model.lifelines.map(l => [l.id, l]));

  for (const [i, l] of model.lifelines.entries()) {
    const at = pointer('', 'lifelines', i);
    if (l.name === undefined && l.classifier === undefined) add('LIFELINE_NAME_REQUIRED', at, `Lifeline "${l.id}" needs a name, a classifier or both`);
    else checkLength(lifelineLabel(l), at, add);
    const states = new Set<string>();
    for (const [j, s] of l.states.entries()) {
      checkLength(s, pointer(at, 'states', j), add);
      if (states.has(s)) add('DUPLICATE_STATE', pointer(at, 'states', j), `State "${s}" is declared twice on lifeline "${l.id}"`);
      states.add(s);
    }
    for (const [j, c] of l.changes.entries()) {
      if (!states.has(c.state)) add('UNKNOWN_STATE', pointer(at, 'changes', j, 'state'), `"${c.state}" is not a declared state of lifeline "${l.id}"`, { lifeline: l.id, states: l.states });
      const previous = l.changes[j - 1];
      if (previous && c.at <= previous.at) add('TIME_NOT_INCREASING', pointer(at, 'changes', j, 'at'), `State changes of "${l.id}" must have strictly increasing times (${c.at} after ${previous.at})`);
      else if (c.state === previous?.state) add('REDUNDANT_STATE_CHANGE', pointer(at, 'changes', j, 'state'), `Lifeline "${l.id}" is already in state "${c.state}"`);
    }
  }

  /** The lifeline exists and already has a state at `time`. */
  const during = (id: string, idPath: string, time: number, timePath: string): Lifeline | undefined => {
    if (!reference(id, idPath, lifelines, diagnostics, 'lifeline')) return undefined;
    const l = lifelines.get(id)!;
    const start = l.changes[0]!.at;
    if (time < start) { add('TIME_BEFORE_FIRST_STATE', timePath, `Lifeline "${id}" has no state before its first change at ${start}`); return undefined; }
    return l;
  };

  for (const [i, m] of (model.messages ?? []).entries()) {
    const at = pointer('', 'messages', i);
    during(m.from, pointer(at, 'from'), m.fromTime, pointer(at, 'fromTime'));
    during(m.to, pointer(at, 'to'), m.toTime, pointer(at, 'toTime'));
    checkLength(m.arguments === undefined ? m.name : `${m.name}(${m.arguments.join(', ')})`, at, add);
    if (m.toTime < m.fromTime) add('MESSAGE_BACKWARDS_IN_TIME', pointer(at, 'toTime'), `A message cannot be received (${m.toTime}) before it is sent (${m.fromTime})`);
    else if (m.from === m.to && m.toTime === m.fromTime) add('ZERO_LENGTH_MESSAGE', pointer(at, 'toTime'), 'A message to the same lifeline needs a later receive time');
  }
  for (const [i, c] of (model.durationConstraints ?? []).entries()) {
    const at = pointer('', 'durationConstraints', i);
    during(c.lifeline, pointer(at, 'lifeline'), c.from, pointer(at, 'from'));
    if (c.to <= c.from) add('INVALID_TIME_INTERVAL', pointer(at, 'to'), `The constrained duration must end after it starts (${c.from}..${c.to})`);
  }
  for (const [i, c] of (model.timeConstraints ?? []).entries()) {
    const at = pointer('', 'timeConstraints', i);
    const l = during(c.lifeline, pointer(at, 'lifeline'), c.at, pointer(at, 'at'));
    if (l && !l.changes.some(ch => ch.at === c.at)) add('UNKNOWN_EVENT', pointer(at, 'at'), `Lifeline "${c.lifeline}" has no state change at ${c.at}`, { times: l.changes.map(ch => ch.at) });
    if (c.to <= c.from) add('INVALID_TIME_INTERVAL', pointer(at, 'to'), `The time window must end after it starts (${c.from}..${c.to})`);
  }
  for (const [i, h] of (model.highlights ?? []).entries()) {
    if (h.label !== undefined) checkLength(h.label, pointer('', 'highlights', i, 'label'), add);
    if (h.to <= h.from) add('INVALID_TIME_INTERVAL', pointer('', 'highlights', i, 'to'), `A highlighted interval must end after it starts (${h.from}..${h.to})`);
  }
  for (const [i, n] of (model.notes ?? []).entries()) {
    const at = pointer('', 'notes', i);
    const l = during(n.lifeline, pointer(at, 'lifeline'), n.at, pointer(at, 'at'));
    if (l && l.notation !== 'concise') add('UNSUPPORTED_NOTE_TARGET', pointer(at, 'lifeline'), `Notes can be attached to concise lifelines only; "${n.lifeline}" is robust`);
  }
  if (diagnostics.length === 0) {
    const scale = timeScale(model);
    const most = MAX_WIDTH / Math.max(1, scale.end - scale.start);
    for (const n of scale.tooDense) {
      const span = n.to - n.from;
      add('TIMELINE_TOO_DENSE', n.path,
        `The ${n.what} from ${n.from} to ${n.to} needs about ${n.px} px, but this time axis (${scale.start} to ${scale.end} ${model.timeUnit}) can be at most ${MAX_WIDTH} px wide, which leaves it ${Math.floor(span * most)} px; `
        + 'shorten the text, give it a longer interval, or split the diagram into shorter time windows. Text is never drawn over other text',
        { from: n.from, to: n.to, neededPx: n.px, availablePx: Math.floor(span * most) });
    }
  }
  return diagnostics;
}
