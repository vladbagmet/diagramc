/** Types of a validated interaction overview document (see schema.ts for the contract). */

export type ControlNodeType = 'initial' | 'final' | 'flow-final' | 'decision' | 'merge' | 'fork' | 'join';

export interface ControlNode { id: string; type: ControlNodeType }

/** A reference to another interaction (UML InteractionUse), drawn as a `ref` frame. */
export interface InteractionUse { id: string; type: 'interaction-use'; name: string; arguments?: string[] }

export interface FragmentLifeline { id: string; name?: string; type?: string }
export interface FragmentMessage {
  id?: string;
  from: string;
  to: string;
  name: string;
  arguments?: string[];
  sort?: 'synchronous' | 'asynchronous' | 'reply';
}
/** An inline interaction, drawn as a small `sd` frame with its own sequence fragment. */
export interface InlineInteraction {
  id: string;
  type: 'interaction';
  name: string;
  lifelines: FragmentLifeline[];
  messages: FragmentMessage[];
}

export type OverviewNode = ControlNode | InteractionUse | InlineInteraction;

export interface Flow { id?: string; from: string; to: string; guard?: string }

export interface InteractionOverviewDiagram {
  kind: 'interaction-overview';
  title?: string;
  lifelines?: string[];
  nodes: OverviewNode[];
  flows?: Flow[];
}

export const isInline = (n: OverviewNode): n is InlineInteraction => n.type === 'interaction';
export const isUse = (n: OverviewNode): n is InteractionUse => n.type === 'interaction-use';
