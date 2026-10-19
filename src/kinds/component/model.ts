import type { Operation } from '../class/model.js';

/** Types of a validated component-diagram document (see schema.ts for the contract). */

export interface Port {
  id: string;
  name?: string;
  type?: string;
  /** Interface IDs this port provides (lollipops). */
  provides?: string[];
  /** Interface IDs this port requires (sockets). */
  requires?: string[];
}

export interface Component {
  id: string;
  type: 'component';
  name: string;
  stereotypes?: string[];
  ports?: Port[];
  provides?: string[];
  requires?: string[];
  /** Nested components and classes (the component's internal parts). */
  elements?: Nested[];
}

/** A class realizing (part of) a component, drawn inside it. */
export interface ClassElement {
  id: string;
  type: 'class';
  name: string;
  stereotypes?: string[];
  ports?: Port[];
  provides?: string[];
  requires?: string[];
}

export interface Interface {
  id: string;
  type: 'interface';
  name: string;
  stereotypes?: string[];
  operations?: Operation[];
}

export interface Artifact {
  id: string;
  type: 'artifact';
  name: string;
  stereotypes?: string[];
}

export interface Note {
  id: string;
  type: 'note';
  text: string;
  attachedTo?: string[];
}

export type Nested = Component | ClassElement;
export type Element = Component | ClassElement | Interface | Artifact | Note;

interface Base { id?: string; from: string; to: string }
export interface Assembly extends Base { type: 'assembly'; interface: string; name?: string }
export interface Delegation extends Base { type: 'delegation'; name?: string }
export interface Realization extends Base { type: 'realization' }
export interface Usage extends Base { type: 'usage' }
export interface Manifest extends Base { type: 'manifest' }
export interface Dependency extends Base { type: 'dependency'; keyword?: string; name?: string }
export type Relationship = Assembly | Delegation | Realization | Usage | Manifest | Dependency;

export interface ComponentDiagram {
  kind: 'component';
  title?: string;
  elements: Element[];
  relationships?: Relationship[];
}
