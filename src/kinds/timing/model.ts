/** Types of a validated timing-diagram document (see schema.ts for the contract). */

export interface StateChange {
  /** Time of the change, in `timeUnit`. */
  at: number;
  /** One of the lifeline's `states`. */
  state: string;
}

export interface Lifeline {
  id: string;
  name?: string;
  classifier?: string;
  /** robust: one row per state and a line that steps between them; concise: values in hexagon-ended bands. */
  notation: 'robust' | 'concise';
  /** Declared states (robust: drawn top to bottom in this order) or values (concise). */
  states: string[];
  /** State changes in time order. */
  changes: StateChange[];
}

export interface Message {
  id?: string;
  from: string;
  fromTime: number;
  to: string;
  toTime: number;
  name: string;
  arguments?: string[];
}

export interface DurationConstraint {
  id?: string;
  lifeline: string;
  /** Start and end of the constrained duration on the time axis. */
  from: number;
  to: number;
  /** Bounds of the allowed duration, drawn {min..max}. */
  min: string | number;
  max: string | number;
}

export interface TimeConstraint {
  id?: string;
  lifeline: string;
  /** The constrained state change of `lifeline`. */
  at: number;
  /** Allowed time window, drawn as a highlighted interval labelled {from..to}. */
  from: number;
  to: number;
}

export interface Highlight {
  id?: string;
  from: number;
  to: number;
  label?: string;
}
export interface Note {
  id?: string;
  lifeline: string;
  at: number;
  position?: 'top' | 'bottom';
  text: string;
}

export interface TimingDiagram {
  kind: 'timing';
  title?: string;
  /** Unit of every time value, shown on the time axis, e.g. "ms". */
  timeUnit: string;
  lifelines: Lifeline[];
  messages?: Message[];
  durationConstraints?: DurationConstraint[];
  timeConstraints?: TimeConstraint[];
  highlights?: Highlight[];
  notes?: Note[];
}
