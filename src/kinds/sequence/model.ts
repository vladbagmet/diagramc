/** Types of a validated sequence-diagram document (see schema.ts for the contract). */

export type LifelineSymbol = 'rectangle' | 'actor' | 'boundary' | 'control' | 'entity';

export interface Lifeline {
  id: string;
  /** Name of the connectable element; drawn `name : classifier`. */
  name?: string;
  /** Type of the represented element; drawn after a colon. */
  classifier?: string;
  /** Head symbol; `rectangle` (default) or a stereotype icon. */
  symbol?: LifelineSymbol;
}

/** UML MessageSort, plus `delete` (a message whose receive event is a destruction). */
export type MessageSort = 'synchronous' | 'asynchronous' | 'reply' | 'create' | 'delete';

interface MessageBase {
  id?: string;
  /** Operation or signal name. */
  name?: string;
  /** Argument texts, drawn `name(a, b)`. An empty array draws `name()`. */
  arguments?: string[];
  /** Reply only: the assignment target, drawn `target = name(...)`. */
  assignment?: string;
  /** Reply only: the return value, drawn `name(...) : value`. */
  returnValue?: string;
}
/** Starts an activation on the receiving lifeline. */
interface Activates {
  activate?: boolean;
}
/** Ends the innermost activation of the sending lifeline. */
interface Deactivates {
  deactivate?: boolean;
}

export interface Message extends MessageBase, Activates, Deactivates {
  type: 'message';
  sort: MessageSort;
  from: string;
  to: string;
}
/** A message whose sender is unknown (filled circle at its start). */
export interface FoundMessage extends MessageBase, Activates {
  type: 'found';
  sort: 'synchronous' | 'asynchronous';
  to: string;
}
/** A message whose receiver is unknown (filled circle at its end). */
export interface LostMessage extends MessageBase, Deactivates {
  type: 'lost';
  sort: 'synchronous' | 'asynchronous';
  from: string;
}

export interface Activation {
  type: 'activate' | 'deactivate';
  lifeline: string;
}
export interface Destruction {
  type: 'destroy';
  lifeline: string;
}
export interface StateInvariant {
  type: 'stateInvariant';
  id?: string;
  lifeline: string;
  constraint: string;
}
export interface Note {
  type: 'note';
  id?: string;
  position: 'over' | 'left' | 'right';
  lifelines: string[];
  text: string;
}
export interface InteractionUse {
  type: 'ref';
  id?: string;
  covered: string[];
  name: string;
  arguments?: string[];
}

export type Operator = 'alt' | 'opt' | 'loop' | 'par' | 'break' | 'critical' | 'neg' | 'strict' | 'seq' | 'assert';
export interface Operand {
  guard?: string;
  items: Item[];
}
export interface Fragment {
  type: 'fragment';
  id?: string;
  operator: Operator;
  /** loop only: minimum and maximum iterations, drawn loop(min,max). */
  min?: number;
  max?: number | '*';
  operands: Operand[];
}

export type Item = Message | FoundMessage | LostMessage | Activation | Destruction | StateInvariant | Note | InteractionUse | Fragment;

export interface SequenceDiagram {
  kind: 'sequence';
  title?: string;
  /** Numbers every message in order. */
  autonumber?: boolean;
  lifelines: Lifeline[];
  items: Item[];
}

export const isMessage = (item: Item): item is Message | FoundMessage | LostMessage => item.type === 'message' || item.type === 'found' || item.type === 'lost';
