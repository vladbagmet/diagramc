/** Types of a validated class-diagram document (see schema.ts for the contract). */

export type Visibility = 'public' | 'private' | 'protected' | 'package';

export interface Attribute {
  name: string;
  type?: string;
  visibility?: Visibility;
  multiplicity?: string;
  default?: string;
  static?: boolean;
  derived?: boolean;
  readOnly?: boolean;
}
export interface Parameter {
  name: string;
  type?: string;
  direction?: 'in' | 'out' | 'inout';
  multiplicity?: string;
  default?: string;
}
export interface Operation {
  name: string;
  parameters?: Parameter[];
  returnType?: string;
  visibility?: Visibility;
  static?: boolean;
  abstract?: boolean;
  query?: boolean;
}
/** A member taken verbatim from a v1 document ("id: UUID"); not available in v2 input. */
export interface LegacyMember {
  text: string;
}

export type ClassifierType = 'class' | 'interface' | 'enumeration' | 'datatype' | 'primitive';
export interface Classifier {
  id: string;
  type: ClassifierType;
  name: string;
  abstract?: boolean;
  stereotypes?: string[];
  attributes?: (Attribute | LegacyMember)[];
  operations?: (Operation | LegacyMember)[];
  literals?: string[];
}
export interface Note {
  id: string;
  type: 'note';
  text: string;
  attachedTo?: string[];
}
export type Element = Classifier | Note;

export interface End {
  role?: string;
  multiplicity?: string;
  navigable?: boolean;
}
export type RelationshipType = 'generalization' | 'realization' | 'association' | 'aggregation' | 'composition' | 'dependency' | 'containment';
export interface Relationship {
  id?: string;
  type: RelationshipType;
  from: string;
  to: string;
  name?: string;
  keyword?: string;
  fromEnd?: End;
  toEnd?: End;
}

export interface ClassDiagram {
  kind: 'class';
  title?: string;
  elements: Element[];
  relationships?: Relationship[];
}

export const isNote = (e: Element): e is Note => e.type === 'note';
export const isLegacy = (m: object): m is LegacyMember => 'text' in m;
