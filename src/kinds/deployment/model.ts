/** Types of a validated deployment-diagram document (see schema.ts for the contract). */

export type NodeType = 'node' | 'device' | 'executionEnvironment';

export interface DeploymentNode {
  id: string;
  type: NodeType;
  name: string;
  stereotypes?: string[];
  /** Nested nodes, execution environments and deployed artifacts. */
  elements?: Nested[];
}

export interface Artifact {
  id: string;
  type: 'artifact';
  name: string;
  stereotypes?: string[];
}

export interface Property { name: string; type?: string; value?: string }

export interface DeploymentSpecification {
  id: string;
  type: 'deploymentSpecification';
  name: string;
  properties?: Property[];
}

export interface Component {
  id: string;
  type: 'component';
  name: string;
  stereotypes?: string[];
}

export interface Note {
  id: string;
  type: 'note';
  text: string;
  attachedTo?: string[];
}

export type Nested = DeploymentNode | Artifact | DeploymentSpecification | Component;
export type Element = Nested | Note;

export interface End { multiplicity?: string }
interface Base { id?: string; from: string; to: string }
export interface CommunicationPath extends Base { type: 'communicationPath'; name?: string; protocol?: string; fromEnd?: End; toEnd?: End }
export interface Deploy extends Base { type: 'deploy' }
export interface Manifest extends Base { type: 'manifest' }
export interface Dependency extends Base { type: 'dependency'; keyword?: string; name?: string }
export type Relationship = CommunicationPath | Deploy | Manifest | Dependency;

export interface DeploymentDiagram {
  kind: 'deployment';
  title?: string;
  elements: Element[];
  relationships?: Relationship[];
}

export const isNodeType = (type: string | undefined): type is NodeType => type === 'node' || type === 'device' || type === 'executionEnvironment';
