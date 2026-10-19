import type { FoundMessage, Lifeline, LostMessage, Message } from './model.js';

/** Lifeline head text in UML 2.5.1 notation (17.3.4): `name : Classifier`, `name` or `: Classifier`. */
export function lifelineLabel(l: Lifeline): string {
  if (l.classifier === undefined) return l.name ?? '';
  return l.name === undefined ? `: ${l.classifier}` : `${l.name} : ${l.classifier}`;
}

/**
 * Message label in UML 2.5.1 notation (17.4.4):
 * `[assignment =] name[(arguments)] [: returnValue]`. Empty when there is no name.
 */
export function messageLabel(m: Message | FoundMessage | LostMessage): string {
  if (m.name === undefined) return '';
  const call = `${m.name}${m.arguments === undefined ? '' : `(${m.arguments.join(', ')})`}`;
  if (m.type !== 'message' || m.sort !== 'reply') return call;
  return `${m.assignment === undefined ? '' : `${m.assignment} = `}${call}${m.returnValue === undefined ? '' : ` : ${m.returnValue}`}`;
}

/** Interaction use text: `name(arguments)`. */
export function refLabel(name: string, args: readonly string[] | undefined): string {
  return args === undefined ? name : `${name}(${args.join(', ')})`;
}

/** Loop operator heading: `loop`, `loop(min)` or `loop(min,max)` (17.6.3). */
export function loopHeading(min: number | undefined, max: number | '*' | undefined): string {
  if (min === undefined) return 'loop';
  return max === undefined ? `loop(${min})` : `loop(${min},${max})`;
}
