/** Types of a validated communication-diagram document (see schema.ts for the contract). */

export interface Lifeline {
  id: string;
  /** Connectable element name, e.g. "order". */
  name?: string;
  /** Classifier name, drawn after " : ". */
  type?: string;
  /** Selector of a multivalued part, drawn name[selector]. */
  selector?: string;
  /** Drawn as a stack of two rectangles (a set of instances). */
  multiObject?: boolean;
}

export interface Link {
  id?: string;
  from: string;
  to: string;
}

export type MessageSort = 'synchronous' | 'asynchronous' | 'reply';

export interface Message {
  id?: string;
  /** Decimal sequence number: "1", "1.2", "2a", "1.2b.1". */
  sequence: string;
  from: string;
  to: string;
  name: string;
  arguments?: string[];
  assignTo?: string;
  returnValue?: string;
  guard?: string;
  iteration?: string;
  parallel?: boolean;
  sort?: MessageSort;
}

export interface CommunicationDiagram {
  kind: 'communication';
  title?: string;
  lifelines: Lifeline[];
  links?: Link[];
  messages?: Message[];
}
