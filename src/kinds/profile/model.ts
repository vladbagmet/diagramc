/** Types of a validated profile-diagram document (see schema.ts for the contract). */

export interface TaggedValue {
  name: string;
  type?: string;
  multiplicity?: string;
  default?: string;
}

export interface Profile {
  id: string;
  type: 'profile';
  name: string;
  members?: string[];
}
export interface Package {
  id: string;
  type: 'package';
  name: string;
  members?: string[];
}
export interface Stereotype {
  id: string;
  type: 'stereotype';
  name: string;
  abstract?: boolean;
  attributes?: TaggedValue[];
}
export interface Metaclass {
  id: string;
  type: 'metaclass';
  name: string;
}
export interface Enumeration {
  id: string;
  type: 'enumeration';
  name: string;
  literals?: string[];
}
export interface Class {
  id: string;
  type: 'class';
  name: string;
  stereotypes?: string[];
}
export interface Note {
  id: string;
  type: 'note';
  text: string;
  attachedTo?: string[];
}
export type Element = Profile | Package | Stereotype | Metaclass | Enumeration | Class | Note;

export type RelationshipType = 'extension' | 'generalization' | 'apply' | 'reference';
export interface Relationship {
  id?: string;
  type: RelationshipType;
  from: string;
  to: string;
  required?: boolean;
}

export interface ProfileDiagram {
  kind: 'profile';
  title?: string;
  elements: Element[];
  relationships?: Relationship[];
}

export const isNote = (e: Element): e is Note => e.type === 'note';
export const isContainer = (e: Element): e is Profile | Package => e.type === 'profile' || e.type === 'package';
