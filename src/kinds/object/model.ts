/** Types of a validated object-diagram document (see schema.ts for the contract). */

export interface Slot { feature: string; type?: string; value: string }
export interface Instance {
  id: string;
  type: 'instance';
  name?: string;
  classifier?: string;
  stereotypes?: string[];
  slots?: Slot[];
}
export interface Note { id: string; type: 'note'; text: string; attachedTo?: string[] }
export type Element = Instance | Note;

export interface LinkEnd { role?: string; navigable?: boolean }
export interface Link {
  id?: string;
  type: 'link';
  from: string;
  to: string;
  name?: string;
  association?: string;
  fromEnd?: LinkEnd;
  toEnd?: LinkEnd;
}

/** A classifier the instances may refer to; declarations are checked, never drawn. */
export interface ClassifierDeclaration { name: string; attributes?: string[] }

export interface ObjectDiagram {
  kind: 'object';
  title?: string;
  classifiers?: ClassifierDeclaration[];
  elements: Element[];
  relationships?: Link[];
}

export const isNote = (e: Element): e is Note => e.type === 'note';
