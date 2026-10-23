import { pointer, type Diagnostic } from '../../core/errors.js';
import { reference, uniqueIds } from '../../model/rules.js';
import { MAX_FRAGMENT_DEPTH, MAX_LABEL_UNITS, MAX_TOTAL_ITEMS } from './limits.js';
import { lifelineLabel, messageLabel, refLabel } from './format.js';
import { isMessage, type Fragment, type Item, type Lifeline, type SequenceDiagram } from './model.js';

/**
 * Semantic rules of sequence diagrams (UML 2.5.1 clause 17). Each rule has a
 * stable code; docs/kinds/sequence.md lists them with their fixtures.
 *
 * The interaction is checked in document order (time order). Alternative
 * operands of an `alt` start from the same creations and activations; a
 * destruction is final in document order, whichever operand it is in.
 */
export function validateSequenceDiagram(model: SequenceDiagram): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const add = (code: string, path: string, message: string, details?: unknown): void => {
    diagnostics.push({ code, path, message, ...(details === undefined ? {} : { details }) });
  };
  const identified: { id: string; path: string }[] = model.lifelines.map((l, i) => ({ id: l.id, path: pointer('', 'lifelines', i) }));
  forEachItem(model.items, '/items', (item, path) => { if ('id' in item && item.id !== undefined) identified.push({ id: item.id, path }); });
  uniqueIds(identified, diagnostics);

  const lifelines = new Map<string, Lifeline>(model.lifelines.map(l => [l.id, l]));
  const order = new Map(model.lifelines.map((l, i) => [l.id, i]));
  for (const [i, l] of model.lifelines.entries()) {
    if (l.name === undefined && l.classifier === undefined) add('LIFELINE_NAME_REQUIRED', pointer('', 'lifelines', i), `Lifeline "${l.id}" needs a name, a classifier or both`);
    else checkLength(lifelineLabel(l), pointer('', 'lifelines', i), add);
  }

  // Lifelines that some create message creates, with the path of the first one.
  const creations = new Map<string, string>();
  let total = 0;
  forEachItem(model.items, '/items', (item, path, depth) => {
    total++;
    if (total === MAX_TOTAL_ITEMS + 1) add('TOO_MANY_ITEMS', path, `A sequence diagram may contain at most ${MAX_TOTAL_ITEMS} items, nested ones included`);
    if (item.type === 'fragment' && depth >= MAX_FRAGMENT_DEPTH) add('FRAGMENT_TOO_DEEP', path, `Combined fragments may be nested at most ${MAX_FRAGMENT_DEPTH} levels deep`);
    if (item.type === 'message' && item.sort === 'create') {
      if (creations.has(item.to)) add('LIFELINE_ALREADY_CREATED', pointer(path, 'to'), `Lifeline "${item.to}" is already created at ${creations.get(item.to)}`, { lifeline: item.to });
      else creations.set(item.to, path);
    }
  });

  interface Open { path: string; scope: number }
  interface State { alive: Set<string>; destroyed: Map<string, string>; activations: Map<string, Open[]> }
  const state: State = { alive: new Set(model.lifelines.filter(l => !creations.has(l.id)).map(l => l.id)), destroyed: new Map(), activations: new Map() };
  let scopes = 0;

  /** Checks that `id` exists and is alive at this point. */
  const use = (id: string, path: string): boolean => {
    if (!reference(id, path, lifelines, diagnostics, 'lifeline')) return false;
    const destroyed = state.destroyed.get(id);
    if (destroyed !== undefined) { add('LIFELINE_DESTROYED', path, `Lifeline "${id}" was destroyed at ${destroyed} and cannot take part afterwards`, { lifeline: id, destroyedAt: destroyed }); return false; }
    if (!state.alive.has(id)) { add('LIFELINE_USED_BEFORE_CREATION', path, `Lifeline "${id}" is used before its create message at ${creations.get(id)}`, { lifeline: id, createdAt: creations.get(id) }); return false; }
    return true;
  };
  const activate = (id: string, path: string, scope: number): void => {
    state.activations.set(id, [...(state.activations.get(id) ?? []), { path, scope }]);
  };
  const deactivate = (id: string, path: string, scope: number): void => {
    const stack = state.activations.get(id) ?? [];
    const top = stack.at(-1);
    if (!top) { add('DEACTIVATION_WITHOUT_ACTIVATION', path, `Lifeline "${id}" has no open activation to end`, { lifeline: id }); return; }
    if (top.scope !== scope) {
      add('ACTIVATION_CROSSES_FRAGMENT', path,
        `The activation of "${id}" started at ${top.path}, outside this interaction operand, so it cannot end inside it (each operand would end it again). `
        + `Remove this deactivation and end the activation once after the fragment with {"type": "deactivate", "lifeline": "${id}"}, or activate "${id}" inside this operand`,
        { lifeline: id, start: top.path, fix: { remove: path, addAfterFragment: { type: 'deactivate', lifeline: id } } });
    }
    state.activations.set(id, stack.slice(0, -1));
  };
  const destroy = (id: string, path: string): void => {
    state.destroyed.set(id, path);
    state.alive.delete(id);
    state.activations.delete(id); // A destruction ends the lifeline's activations.
  };

  const visit = (items: readonly Item[], base: string, scope: number): void => {
    for (const [i, item] of items.entries()) {
      const at = pointer(base, i);
      if (isMessage(item)) {
        checkLabel(item, at, add);
        checkLength(messageLabel(item), at, add);
        if (item.type === 'found') {
          if (use(item.to, pointer(at, 'to')) && item.activate) activate(item.to, pointer(at, 'activate'), scope);
          continue;
        }
        if (item.type === 'lost') {
          if (use(item.from, pointer(at, 'from')) && item.deactivate) deactivate(item.from, pointer(at, 'deactivate'), scope);
          continue;
        }
        if (item.sort === 'create' && item.from === item.to) { add('INVALID_SELF_MESSAGE', pointer(at, 'to'), 'A lifeline cannot create itself'); continue; }
        if (item.sort === 'delete' && item.from === item.to) { add('INVALID_SELF_MESSAGE', pointer(at, 'to'), 'Use a destroy item for a lifeline that ends itself'); continue; }
        const fromOk = use(item.from, pointer(at, 'from'));
        let toOk: boolean;
        if (item.sort === 'create') {
          toOk = reference(item.to, pointer(at, 'to'), lifelines, diagnostics, 'lifeline');
          if (toOk && creations.get(item.to) === at) state.alive.add(item.to);
          else if (toOk) toOk = false; // a repeated create, reported above
        } else toOk = use(item.to, pointer(at, 'to'));
        if (fromOk && item.deactivate) deactivate(item.from, pointer(at, 'deactivate'), scope);
        if (toOk && item.activate) activate(item.to, pointer(at, 'activate'), scope);
        if (toOk && item.sort === 'delete') destroy(item.to, at);
        continue;
      }
      switch (item.type) {
        case 'activate': if (use(item.lifeline, pointer(at, 'lifeline'))) activate(item.lifeline, at, scope); break;
        case 'deactivate': if (use(item.lifeline, pointer(at, 'lifeline'))) deactivate(item.lifeline, at, scope); break;
        case 'destroy': if (use(item.lifeline, pointer(at, 'lifeline'))) destroy(item.lifeline, at); break;
        case 'stateInvariant': use(item.lifeline, pointer(at, 'lifeline')); checkLength(item.constraint, pointer(at, 'constraint'), add); break;
        case 'note': {
          if (item.position !== 'over' && item.lifelines.length !== 1) add('NOTE_LIFELINE_COUNT', pointer(at, 'lifelines'), `A note ${item.position} of a lifeline names exactly one lifeline`);
          checkList(item.lifelines, pointer(at, 'lifelines'));
          break;
        }
        case 'ref': {
          checkLength(refLabel(item.name, item.arguments), at, add);
          if (checkList(item.covered, pointer(at, 'covered'))) {
            // PlantUML draws the frame across every column between the outermost covered lifelines.
            const positions = item.covered.map(id => order.get(id)!);
            const [low, high] = [Math.min(...positions), Math.max(...positions)];
            const gap = model.lifelines.slice(low, high + 1).find(l => state.alive.has(l.id) && !item.covered.includes(l.id));
            if (gap) add('REF_COVERAGE_GAP', pointer(at, 'covered'), `The interaction use would be drawn across lifeline "${gap.id}", which it does not cover; reorder the lifelines or cover it`, { lifeline: gap.id });
          }
          break;
        }
        case 'fragment': visitFragment(item, at); break;
      }
    }
  };

  /** Duplicate-free list of live lifelines; true when every entry is usable. */
  const checkList = (ids: readonly string[], path: string): boolean => {
    let ok = true;
    const seen = new Set<string>();
    for (const [j, id] of ids.entries()) {
      if (seen.has(id)) { add('DUPLICATE_REFERENCE', pointer(path, j), `Lifeline "${id}" is listed twice`); ok = false; }
      seen.add(id);
      if (!use(id, pointer(path, j))) ok = false;
    }
    return ok;
  };

  const visitFragment = (f: Fragment, at: string): void => {
    const count = f.operands.length;
    const expected = f.operator === 'alt' ? 'at least one' : ['par', 'strict', 'seq'].includes(f.operator) ? 'at least two' : 'exactly one';
    if ((expected === 'at least two' && count < 2) || (expected === 'exactly one' && count !== 1)) {
      add('FRAGMENT_OPERAND_COUNT', pointer(at, 'operands'), `A ${f.operator} fragment has ${expected} operand${expected === 'exactly one' ? '' : 's'}, not ${count}`);
    }
    if (f.operator !== 'loop' && (f.min !== undefined || f.max !== undefined)) {
      add('INVALID_LOOP_BOUNDS', pointer(at, f.min === undefined ? 'max' : 'min'), 'Only loop fragments have iteration bounds');
    } else if (f.max !== undefined && f.min === undefined) {
      add('INVALID_LOOP_BOUNDS', pointer(at, 'max'), 'A loop maximum requires a minimum');
    } else if (typeof f.max === 'number' && f.min !== undefined && f.min > f.max) {
      add('INVALID_LOOP_BOUNDS', pointer(at, 'max'), `Loop maximum ${f.max} is below its minimum ${f.min}`);
    } else if (f.max === 0) {
      add('INVALID_LOOP_BOUNDS', pointer(at, 'max'), 'A loop maximum of 0 never runs; use a neg fragment or remove the loop');
    }
    for (const [j, operand] of f.operands.entries()) {
      if (operand.guard !== undefined) checkLength(operand.guard, pointer(at, 'operands', j, 'guard'), add);
      if (operand.guard === 'else' && !(f.operator === 'alt' && j === count - 1)) {
        add('MISPLACED_ELSE', pointer(at, 'operands', j, 'guard'), 'The "else" guard belongs to the last operand of an alt fragment');
      }
    }
    const alternatives = f.operator === 'alt';
    const before: State = { alive: new Set(state.alive), destroyed: new Map(state.destroyed), activations: new Map(state.activations) };
    const destroyedAfter = new Map(state.destroyed);
    const aliveAfter = new Set(state.alive);
    for (const [j, operand] of f.operands.entries()) {
      if (alternatives) {
        // Each alternative starts from the state before the fragment, except that a
        // destruction is final in drawing order (PlantUML cannot destroy a lifeline twice).
        state.alive = new Set([...before.alive].filter(id => !state.destroyed.has(id)));
        state.activations = new Map([...before.activations].filter(([id]) => !state.destroyed.has(id)));
      }
      const scope = ++scopes;
      const operandPath = pointer(at, 'operands', j, 'items');
      visit(operand.items, operandPath, scope);
      for (const [id, stack] of state.activations) {
        const open = stack.filter(a => a.scope === scope);
        for (const a of open) add('ACTIVATION_CROSSES_FRAGMENT', a.path, `The activation of "${id}" must end in the interaction operand where it starts (${operandPath})`, { lifeline: id });
        if (open.length > 0) state.activations.set(id, stack.filter(a => a.scope !== scope));
      }
      for (const [id, path] of state.destroyed) if (!destroyedAfter.has(id)) destroyedAfter.set(id, path);
      for (const id of state.alive) aliveAfter.add(id);
    }
    if (alternatives) {
      // Creations made in any operand persist (a lifeline is created once); destructions in any operand end it.
      state.alive = aliveAfter;
      for (const id of destroyedAfter.keys()) state.alive.delete(id);
      state.destroyed = destroyedAfter;
      for (const id of destroyedAfter.keys()) state.activations.delete(id);
    }
  };

  visit(model.items, '/items', 0);
  for (const [id, stack] of state.activations) {
    for (const a of stack) add('ACTIVATION_NOT_CLOSED', a.path, `The activation of "${id}" is never ended; add a deactivate item or "deactivate": true on the reply`, { lifeline: id });
  }
  return diagnostics;
}

function checkLabel(item: Item & { name?: string; arguments?: string[]; assignment?: string; returnValue?: string; sort: string; type: string }, at: string, add: (code: string, path: string, message: string) => void): void {
  if (item.name === undefined) {
    if (item.sort === 'synchronous' || item.sort === 'asynchronous') add('MESSAGE_NAME_REQUIRED', pointer(at, 'name'), `A ${item.sort} message needs a name (the operation or signal)`);
    else if (item.arguments !== undefined || item.assignment !== undefined || item.returnValue !== undefined) add('MESSAGE_NAME_REQUIRED', pointer(at, 'name'), 'Arguments, assignment and return value need a message name');
  }
  if (item.type === 'message' && item.sort !== 'reply') {
    if (item.assignment !== undefined) add('REPLY_ONLY_PROPERTY', pointer(at, 'assignment'), 'Only reply messages have an assignment target');
    if (item.returnValue !== undefined) add('REPLY_ONLY_PROPERTY', pointer(at, 'returnValue'), 'Only reply messages have a return value');
  }
}

/** A drawn text that PlantUML gets on one source line must fit MAX_LABEL_UNITS UTF-16 code units. */
export function checkLength(label: string, at: string, add: (code: string, path: string, message: string) => void): void {
  if (label.length > MAX_LABEL_UNITS) add('LABEL_TOO_LONG', at, `The drawn text is ${label.length} UTF-16 code units long (characters outside the Basic Multilingual Plane count twice); the limit is ${MAX_LABEL_UNITS}. Shorten it`);
}

/** Visits every item with its JSON Pointer and fragment depth, in document order. */
function forEachItem(items: readonly Item[], base: string, visit: (item: Item, path: string, depth: number) => void, depth = 0): void {
  for (const [i, item] of items.entries()) {
    const path = pointer(base, i);
    visit(item, path, depth);
    if (item.type === 'fragment') for (const [j, o] of item.operands.entries()) forEachItem(o.items, pointer(path, 'operands', j, 'items'), visit, depth + 1);
  }
}
