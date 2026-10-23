import { pointer, type Diagnostic } from '../../core/errors.js';
import { reference, uniqueIds } from '../../model/rules.js';
import { isNote, isState, placements, type Element, type Placement, type State, type StateMachineDiagram } from './model.js';

const MAX_DEPTH = 6;
const PSEUDO = new Set(['initial', 'choice', 'junction', 'fork', 'join', 'shallowHistory', 'deepHistory', 'terminate', 'entryPoint', 'exitPoint']);

/**
 * Semantic rules of state machine diagrams (UML 2.5.1 clause 14). Each rule has a
 * stable code; docs/kinds/state-machine.md lists them with their fixtures.
 */
export function validateStateMachine(model: StateMachineDiagram): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const transitions = model.transitions ?? [];
  const ids: { id: string; path: string }[] = [];
  const notes = new Map<string, { path: string; attachedTo: string[] }>();
  const visit = (elements: readonly Element[], base: string, depth: number): void => {
    for (const [i, e] of elements.entries()) {
      const path = `${base}/${i}`;
      ids.push({ id: e.id, path });
      if (isNote(e)) {
        notes.set(e.id, { path, attachedTo: e.attachedTo ?? [] });
        continue;
      }
      if (!isState(e)) continue;
      checkState(e, path, depth, diagnostics);
      for (const [j, p] of (e.connectionPoints ?? []).entries()) ids.push({ id: p.id, path: `${path}/connectionPoints/${j}` });
      for (const [j, r] of (e.regions ?? []).entries()) {
        if (r.id !== undefined) ids.push({ id: r.id, path: `${path}/regions/${j}` });
        visit(r.elements, `${path}/regions/${j}/elements`, depth + 1);
      }
    }
  };
  visit(model.elements, '/elements', 1);
  for (const [i, t] of transitions.entries()) {
    if (t.id !== undefined) ids.push({ id: t.id, path: pointer('', 'transitions', i) });
  }
  uniqueIds(ids, diagnostics);

  const where = placements(model);
  const elements = new Map<string, unknown>([...where.keys(), ...notes.keys()].map(id => [id, true]));

  for (const [id, note] of notes) {
    for (const [j, target] of note.attachedTo.entries()) {
      const path = pointer(note.path, 'attachedTo', j);
      if (!reference(target, path, elements, diagnostics)) continue;
      if (notes.has(target)) diagnostics.push({ code: 'INVALID_ATTACHMENT', path, message: `Note "${id}" cannot be attached to another note ("${target}")` });
      else if (where.get(target)?.owner)
        diagnostics.push({
          code: 'INVALID_ATTACHMENT',
          path,
          message: `Note "${id}" cannot be attached to connection point "${target}"; attach it to its state`,
        });
    }
  }

  // Regions: at most one initial, one shallow and one deep history each; history only inside composite states.
  const perRegion = new Map<string, Map<string, Placement[]>>();
  for (const p of where.values()) {
    if (p.owner) continue;
    const byType = perRegion.get(p.region) ?? new Map<string, Placement[]>();
    byType.set(p.vertex.type, [...(byType.get(p.vertex.type) ?? []), p]);
    perRegion.set(p.region, byType);
    if ((p.vertex.type === 'shallowHistory' || p.vertex.type === 'deepHistory') && p.region === '') {
      diagnostics.push({
        code: 'HISTORY_AT_TOP_LEVEL',
        path: p.path,
        message: `History pseudostate "${p.vertex.id}" must be inside a composite state's region`,
      });
    }
  }
  for (const byType of perRegion.values()) {
    for (const [type, code] of [
      ['initial', 'MULTIPLE_INITIAL'],
      ['shallowHistory', 'MULTIPLE_HISTORY'],
      ['deepHistory', 'MULTIPLE_HISTORY'],
    ] as const) {
      for (const p of (byType.get(type) ?? []).slice(1))
        diagnostics.push({ code, path: p.path, message: `A region has at most one ${type} pseudostate; "${p.vertex.id}" is the second` });
    }
  }

  const incoming = new Map<string, number[]>(),
    outgoing = new Map<string, number[]>();
  for (const [i, t] of transitions.entries()) {
    const at = pointer('', 'transitions', i);
    const fromOk = reference(t.from, pointer(at, 'from'), elements, diagnostics, 'vertex', { from: t.from, to: t.to });
    const toOk = reference(t.to, pointer(at, 'to'), elements, diagnostics, 'vertex', { from: t.from, to: t.to });
    if (!fromOk || !toOk) continue;
    for (const [end, id] of [
      ['from', t.from],
      ['to', t.to],
    ] as const) {
      if (notes.has(id))
        diagnostics.push({
          code: 'NOTE_IN_TRANSITION',
          path: pointer(at, end),
          message: `Transitions connect vertices; note "${id}" uses "attachedTo" instead`,
        });
    }
    if (notes.has(t.from) || notes.has(t.to)) continue;
    outgoing.set(t.from, [...(outgoing.get(t.from) ?? []), i]);
    incoming.set(t.to, [...(incoming.get(t.to) ?? []), i]);
    const from = where.get(t.from)!,
      to = where.get(t.to)!;
    const source = from.vertex.type,
      target = to.vertex.type;
    if (target === 'initial')
      diagnostics.push({ code: 'INITIAL_HAS_INCOMING', path: pointer(at, 'to'), message: `Initial pseudostate "${t.to}" cannot have incoming transitions` });
    if (source === 'final')
      diagnostics.push({ code: 'FINAL_STATE_HAS_OUTGOING', path: pointer(at, 'from'), message: `Final state "${t.from}" cannot have outgoing transitions` });
    if (source === 'terminate')
      diagnostics.push({
        code: 'TERMINATE_HAS_OUTGOING',
        path: pointer(at, 'from'),
        message: `Terminate pseudostate "${t.from}" cannot have outgoing transitions`,
      });
    if (source === 'initial') {
      if (t.trigger !== undefined)
        diagnostics.push({
          code: 'INITIAL_TRANSITION_TRIGGER',
          path: pointer(at, 'trigger'),
          message: `The transition from initial pseudostate "${t.from}" cannot have a trigger`,
        });
      if (t.guard !== undefined)
        diagnostics.push({
          code: 'INITIAL_TRANSITION_GUARD',
          path: pointer(at, 'guard'),
          message: `The transition from initial pseudostate "${t.from}" cannot have a guard`,
        });
    } else if (PSEUDO.has(source) && t.trigger !== undefined) {
      diagnostics.push({
        code: 'TRIGGER_ON_PSEUDOSTATE_TRANSITION',
        path: pointer(at, 'trigger'),
        message: `Transitions leaving ${source} "${t.from}" cannot have triggers; only transitions leaving states can`,
      });
    }
    if ((source === 'fork' || target === 'join') && t.guard !== undefined) {
      diagnostics.push({
        code: 'GUARD_ON_FORK_OR_JOIN',
        path: pointer(at, 'guard'),
        message: `Transitions leaving a fork or entering a join cannot have guards`,
      });
    }
    if (t.from === t.to && source !== 'state')
      diagnostics.push({ code: 'PSEUDOSTATE_SELF_TRANSITION', path: at, message: `Only states can have self-transitions; "${t.from}" is a ${source}` });
    // Orthogonal regions: no transition between two regions of the same state.
    const crossing = orthogonal(from, to);
    if (crossing)
      diagnostics.push({
        code: 'TRANSITION_ACROSS_REGIONS',
        path: at,
        message: `Transition from "${t.from}" to "${t.to}" crosses between orthogonal regions of state "${crossing}"`,
      });
    if (source === 'entryPoint' && !to.ancestors.includes(from.owner!))
      diagnostics.push({
        code: 'INVALID_ENTRY_POINT_TRANSITION',
        path: pointer(at, 'to'),
        message: `Transitions leaving entry point "${t.from}" must target a vertex inside state "${from.owner}"`,
      });
    if (target === 'entryPoint' && from.ancestors.includes(to.owner!))
      diagnostics.push({
        code: 'INVALID_ENTRY_POINT_TRANSITION',
        path: pointer(at, 'from'),
        message: `Transitions into entry point "${t.to}" must come from outside state "${to.owner}"`,
      });
    if (target === 'exitPoint' && !from.ancestors.includes(to.owner!))
      diagnostics.push({
        code: 'INVALID_EXIT_POINT_TRANSITION',
        path: pointer(at, 'from'),
        message: `Transitions into exit point "${t.to}" must come from a vertex inside state "${to.owner}"`,
      });
    if (source === 'exitPoint' && to.ancestors.includes(from.owner!))
      diagnostics.push({
        code: 'INVALID_EXIT_POINT_TRANSITION',
        path: pointer(at, 'to'),
        message: `Transitions leaving exit point "${t.from}" must target a vertex outside state "${from.owner}"`,
      });
  }

  for (const p of where.values()) {
    const id = p.vertex.id,
      ins = incoming.get(id)?.length ?? 0,
      outs = outgoing.get(id) ?? [];
    const degree = (code: string, ok: boolean, text: string): void => {
      if (!ok)
        diagnostics.push({
          code,
          path: p.path,
          message: `${p.vertex.type} "${id}" needs ${text}; it has ${ins} incoming and ${outs.length} outgoing`,
          details: { incoming: ins, outgoing: outs.length },
        });
    };
    switch (p.vertex.type) {
      case 'initial':
        degree('INITIAL_OUTGOING', outs.length === 1, 'exactly one outgoing transition');
        break;
      case 'choice':
        degree('CHOICE_DEGREE', ins >= 1 && outs.length > 0, 'at least one incoming and one outgoing transition');
        if (outs.length > 0 && !outs.some(i => transitions[i]!.guard !== undefined))
          diagnostics.push({ code: 'CHOICE_WITHOUT_GUARD', path: p.path, message: `Choice "${id}" needs a guard on at least one outgoing transition` });
        break;
      case 'junction':
        degree('JUNCTION_DEGREE', ins >= 1 && outs.length > 0, 'at least one incoming and one outgoing transition');
        break;
      case 'fork':
        degree('FORK_DEGREE', ins === 1 && outs.length >= 2, 'one incoming and at least two outgoing transitions');
        break;
      case 'join':
        degree('JOIN_DEGREE', ins >= 2 && outs.length === 1, 'at least two incoming transitions and one outgoing transition');
        break;
      case 'shallowHistory':
      case 'deepHistory':
        degree('HISTORY_DEGREE', outs.length <= 1, 'at most one outgoing (default history) transition');
        break;
    }
  }
  return diagnostics;
}

/** The state whose two different regions hold `a` and `b`, if any (connection points count as on their state's border). */
function orthogonal(a: Placement, b: Placement): string | undefined {
  const ra = a.regions,
    rb = b.regions;
  for (let i = 0; i < Math.min(ra.length, rb.length); i++) {
    if (ra[i] === rb[i]) continue;
    const [sa] = ra[i]!.split('#'),
      [sb] = rb[i]!.split('#');
    return sa === sb ? sa : undefined;
  }
  return undefined;
}

function checkState(state: State, path: string, depth: number, diagnostics: Diagnostic[]): void {
  if (depth > MAX_DEPTH)
    diagnostics.push({
      code: 'NESTING_TOO_DEEP',
      path,
      message: `State "${state.id}" is nested ${depth} levels deep; at most ${MAX_DEPTH} levels are supported`,
    });
  if (state.submachine !== undefined && state.regions)
    diagnostics.push({
      code: 'SUBMACHINE_WITH_REGIONS',
      path: pointer(path, 'submachine'),
      message: `State "${state.id}" is either a submachine state or a composite state, not both`,
    });
  if (state.connectionPoints?.length && !state.regions && state.submachine === undefined) {
    diagnostics.push({
      code: 'CONNECTION_POINT_ON_SIMPLE_STATE',
      path: pointer(path, 'connectionPoints'),
      message: `Entry and exit points belong to composite or submachine states; "${state.id}" has neither regions nor a submachine`,
    });
  }
}
