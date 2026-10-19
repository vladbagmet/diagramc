/** Types of a validated state-machine document (see schema.ts for the contract). */

export interface Behavior { trigger: string; guard?: string; effect?: string }

export interface Region { id?: string; name?: string; elements: Vertex[] }
export interface ConnectionPoint { id: string; type: 'entryPoint' | 'exitPoint'; name?: string }

export interface State {
  id: string;
  type: 'state';
  name: string;
  entry?: string;
  doActivity?: string;
  exit?: string;
  internal?: Behavior[];
  regions?: Region[];
  submachine?: string;
  connectionPoints?: ConnectionPoint[];
}

export type PseudostateType = 'initial' | 'final' | 'choice' | 'junction' | 'fork' | 'join' | 'shallowHistory' | 'deepHistory' | 'terminate';
export interface Pseudostate { id: string; type: PseudostateType }
export interface Note { id: string; type: 'note'; text: string; attachedTo?: string[] }

export type Vertex = State | Pseudostate;
export type Element = Vertex | Note;

export interface Transition {
  id?: string;
  from: string;
  to: string;
  trigger?: string;
  guard?: string;
  effect?: string;
}

export interface StateMachineDiagram {
  kind: 'state-machine';
  title?: string;
  elements: Element[];
  transitions?: Transition[];
}

export const isState = (v: Element | ConnectionPoint): v is State => v.type === 'state';
export const isNote = (v: Element): v is Note => v.type === 'note';

/** Where a vertex lives: its region (by path) and the chain of enclosing states. */
export interface Placement {
  vertex: Vertex | ConnectionPoint;
  /** JSON Pointer of the vertex. */
  path: string;
  /** Key of the owning region: "" for the top level, otherwise "<stateId>#<regionIndex>". Connection points: the state's key "<stateId>". */
  region: string;
  /** Enclosing states, outermost first. */
  ancestors: string[];
  /** Keys of the enclosing regions, outermost first, ending with `region`. */
  regions: string[];
  /** For connection points: the state on whose border they sit. */
  owner?: string;
}

/** Indexes every vertex and connection point of the document with its placement. Depth-first, document order. */
export function placements(model: StateMachineDiagram): Map<string, Placement> {
  const out = new Map<string, Placement>();
  const visit = (elements: readonly Element[], base: string, regions: string[], ancestors: string[]): void => {
    const region = regions.at(-1)!;
    elements.forEach((e, i) => {
      const path = `${base}/${i}`;
      if (isNote(e)) return;
      if (!out.has(e.id)) out.set(e.id, { vertex: e, path, region, ancestors, regions });
      if (!isState(e)) return;
      (e.connectionPoints ?? []).forEach((p, j) => {
        if (!out.has(p.id)) out.set(p.id, { vertex: p, path: `${path}/connectionPoints/${j}`, region: e.id, ancestors: [...ancestors, e.id], regions, owner: e.id });
      });
      (e.regions ?? []).forEach((r, j) => visit(r.elements, `${path}/regions/${j}/elements`, [...regions, `${e.id}#${j}`], [...ancestors, e.id]));
    });
  };
  visit(model.elements, '/elements', [''], []);
  return out;
}

/** Display form of a transition or internal behavior: `trigger [guard] / effect`. */
export function behaviorLabel(b: { trigger?: string | undefined; guard?: string | undefined; effect?: string | undefined }): string {
  return [b.trigger, b.guard === undefined ? undefined : `[${b.guard}]`, b.effect === undefined ? undefined : `/ ${b.effect}`]
    .filter((p): p is string => p !== undefined).join(' ');
}
