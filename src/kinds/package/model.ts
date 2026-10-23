/** Types of a validated package-diagram document (see schema.ts for the contract). */

export interface Package {
  id: string;
  type: 'package';
  name: string;
  stereotypes?: string[];
  members?: string[];
}
export type ClassifierType = 'class' | 'interface' | 'enumeration' | 'datatype';
export interface Classifier {
  id: string;
  type: ClassifierType;
  name: string;
  abstract?: boolean;
  stereotypes?: string[];
}
export interface Note {
  id: string;
  type: 'note';
  text: string;
  attachedTo?: string[];
}
export type Element = Package | Classifier | Note;

export type RelationshipType = 'import' | 'access' | 'merge' | 'dependency' | 'containment';
export interface Relationship {
  id?: string;
  type: RelationshipType;
  from: string;
  to: string;
  name?: string;
  keyword?: string;
}

export interface PackageDiagram {
  kind: 'package';
  title?: string;
  elements: Element[];
  relationships?: Relationship[];
}

export const isNote = (e: Element): e is Note => e.type === 'note';
export const isPackage = (e: Element): e is Package => e.type === 'package';
