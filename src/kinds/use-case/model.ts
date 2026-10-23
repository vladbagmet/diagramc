/** Types of a validated use case diagram document (see schema.ts for the contract). */

export interface Actor {
  id: string;
  type: 'actor';
  name: string;
  stereotypes?: string[];
}
export interface UseCase {
  id: string;
  type: 'useCase';
  name: string;
  extensionPoints?: string[];
  subject?: string;
}
export interface Subject {
  id: string;
  type: 'subject';
  name: string;
  stereotypes?: string[];
}
export interface Note {
  id: string;
  type: 'note';
  text: string;
  attachedTo?: string[];
}
export type Element = Actor | UseCase | Subject | Note;

export interface End {
  multiplicity?: string;
}
interface Base {
  id?: string;
  from: string;
  to: string;
}
export interface Association extends Base {
  type: 'association';
  name?: string;
  fromEnd?: End;
  toEnd?: End;
}
export interface Include extends Base {
  type: 'include';
}
export interface Extend extends Base {
  type: 'extend';
  extensionPoint: string;
  condition?: string;
}
export interface Generalization extends Base {
  type: 'generalization';
}
export type Relationship = Association | Include | Extend | Generalization;

export interface UseCaseDiagram {
  kind: 'use-case';
  title?: string;
  elements: Element[];
  relationships?: Relationship[];
}
