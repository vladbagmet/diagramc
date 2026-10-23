/** Types of a validated activity-diagram document (see schema.ts for the contract). */

export interface Partition {
  id: string;
  name: string;
}

interface Base {
  id: string;
  partition?: string;
}
/** Nodes that do work or hold tokens and may carry a note. */
interface Executable extends Base {
  name: string;
  note?: string;
}

export interface Action extends Executable {
  type: 'action';
}
export interface CallBehaviorAction extends Executable {
  type: 'callBehavior';
}
export interface SendSignalAction extends Executable {
  type: 'sendSignal';
}
export interface AcceptEventAction extends Executable {
  type: 'acceptEvent';
}
export interface ObjectNode extends Executable {
  type: 'object';
  state?: string;
}
export interface InitialNode extends Base {
  type: 'initial';
}
export interface ActivityFinalNode extends Base {
  type: 'activityFinal';
}
export interface FlowFinalNode extends Base {
  type: 'flowFinal';
}
export interface DecisionNode extends Base {
  type: 'decision';
}
export interface ForkNode extends Base {
  type: 'fork';
}
export interface MergeNode {
  id: string;
  type: 'merge';
}
export interface JoinNode {
  id: string;
  type: 'join';
}

export type ActivityNode =
  | Action
  | CallBehaviorAction
  | SendSignalAction
  | AcceptEventAction
  | ObjectNode
  | InitialNode
  | ActivityFinalNode
  | FlowFinalNode
  | DecisionNode
  | MergeNode
  | ForkNode
  | JoinNode;
export type ExecutableNode = Action | CallBehaviorAction | SendSignalAction | AcceptEventAction | ObjectNode;

export interface ActivityEdge {
  id?: string;
  /** Inferred when omitted: object flow when either end is an object node, else control flow. */
  type?: 'control' | 'object';
  from: string;
  to: string;
  guard?: string;
}

export interface ActivityDiagram {
  kind: 'activity';
  title?: string;
  partitions?: Partition[];
  nodes: ActivityNode[];
  edges: ActivityEdge[];
}

export const EXECUTABLE_TYPES = new Set(['action', 'callBehavior', 'sendSignal', 'acceptEvent', 'object']);
export const CONTROL_TYPES = new Set(['initial', 'activityFinal', 'flowFinal', 'decision', 'merge', 'fork', 'join']);
export const isExecutable = (n: ActivityNode): n is ExecutableNode => EXECUTABLE_TYPES.has(n.type);
export const isFinal = (n: ActivityNode): boolean => n.type === 'activityFinal' || n.type === 'flowFinal';
