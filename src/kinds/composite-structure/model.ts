/** Types of a validated composite-structure-diagram document (see schema.ts for the contract). */

export interface Port {
  id: string;
  name?: string;
  type?: string;
  multiplicity?: string;
  /** Conjugated port: its type is drawn with a tilde, `~Type`. */
  conjugated?: boolean;
}

export interface Part {
  id: string;
  name: string;
  type?: string;
  multiplicity?: string;
  /** "composite" (default): solid outline; "shared" or "none": a reference property, dashed outline. */
  aggregation?: 'composite' | 'shared' | 'none';
  ports?: Port[];
  /** The part's own internal structure. */
  parts?: Part[];
}

export interface RoleBinding { role: string; part: string }

export interface CollaborationUse {
  id: string;
  name: string;
  /** ID of the collaboration this use applies. */
  collaboration: string;
  bindings?: RoleBinding[];
}

export interface StructuredClass {
  id: string;
  type: 'class';
  name: string;
  stereotypes?: string[];
  ports?: Port[];
  parts?: Part[];
  collaborationUses?: CollaborationUse[];
}

export interface Role { id: string; name: string; type?: string; multiplicity?: string }

export interface Collaboration {
  id: string;
  type: 'collaboration';
  name: string;
  roles: Role[];
}

export interface Note {
  id: string;
  type: 'note';
  text: string;
  attachedTo?: string[];
}

export type Element = StructuredClass | Collaboration | Note;

export interface ConnectorEnd { role?: string; multiplicity?: string }
interface Base { id?: string; from: string; to: string }
export interface Connector extends Base { type: 'connector'; name?: string; association?: string; fromEnd?: ConnectorEnd; toEnd?: ConnectorEnd }
export interface Dependency extends Base { type: 'dependency'; keyword?: string; name?: string }
export type Relationship = Connector | Dependency;

export interface CompositeStructureDiagram {
  kind: 'composite-structure';
  title?: string;
  elements: Element[];
  relationships?: Relationship[];
}
