import type { Lifeline, Message } from './model.js';

/** Lifeline label (UML 2.5.1 17.3.4): `name[selector] : Type`, `name` or `: Type`. */
export function lifelineLabel(l: Lifeline): string {
  const name = l.name === undefined ? '' : l.selector === undefined ? l.name : `${l.name}[${l.selector}]`;
  if (l.type === undefined) return name;
  return name ? `${name} : ${l.type}` : `: ${l.type}`;
}

/**
 * Message label (UML 2.5.1 17.9.4 sequence expression and 17.4.4 message
 * signature): `seq [guard]: x = name(args): value`, or `seq *[clause]: ...`
 * for iteration (`*||[clause]` when the iterations run concurrently).
 */
export function messageLabel(m: Message): string {
  let recurrence = '';
  if (m.guard !== undefined) recurrence = ` [${m.guard}]`;
  else if (m.iteration !== undefined) recurrence = ` ${m.parallel ? '*||' : '*'}[${m.iteration}]`;
  const call = `${m.assignTo === undefined ? '' : `${m.assignTo} = `}${m.name}${m.arguments === undefined ? '' : `(${m.arguments.join(', ')})`}`;
  return `${m.sequence}${recurrence}: ${call}${m.returnValue === undefined ? '' : `: ${m.returnValue}`}`;
}

export interface SequenceTerm { number: number; thread: string }

const TERM = /^([1-9][0-9]{0,5})([a-z]?)$/u;

/** Parses "1.2b.3" into terms; undefined when malformed. */
export function parseSequence(text: string): SequenceTerm[] | undefined {
  const terms: SequenceTerm[] = [];
  for (const part of text.split('.')) {
    const match = TERM.exec(part);
    if (!match) return undefined;
    terms.push({ number: Number(match[1]), thread: match[2]! });
  }
  return terms;
}

/** Orders sequence numbers as UML reads them: 1 < 1.1 < 1.2 < 1.10 < 2 < 2a < 2b. */
export function compareSequence(a: string, b: string): number {
  const x = parseSequence(a) ?? [], y = parseSequence(b) ?? [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.number - y[i]!.number || x[i]!.thread.localeCompare(y[i]!.thread);
    if (d) return d;
  }
  return x.length - y.length || a.localeCompare(b);
}
