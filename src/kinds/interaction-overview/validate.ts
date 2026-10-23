import { pointer, type Diagnostic } from '../../core/errors.js';
import { reference, uniqueIds } from '../../model/rules.js';
import { isInline, type InteractionOverviewDiagram, type OverviewNode } from './model.js';

/**
 * Semantic rules of interaction overview diagrams (UML 2.5.1 clauses 15.3 and
 * 17.10). All rules are errors; docs/kinds/interaction-overview.md lists them.
 */
export function validateInteractionOverview(model: InteractionOverviewDiagram): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const flows = model.flows ?? [];
  uniqueIds([
    ...model.nodes.flatMap((n, i) => {
      const at = pointer('', 'nodes', i);
      const own = [{ id: n.id, path: at }];
      if (!isInline(n)) return own;
      return [
        ...own,
        ...n.lifelines.map((l, j) => ({ id: l.id, path: pointer(at, 'lifelines', j) })),
        ...n.messages.flatMap((m, j) => m.id === undefined ? [] : [{ id: m.id, path: pointer(at, 'messages', j) }]),
      ];
    }),
    ...flows.flatMap((f, i) => f.id === undefined ? [] : [{ id: f.id, path: pointer('', 'flows', i) }]),
  ], diagnostics);
  const nodes = new Map<string, OverviewNode>(model.nodes.map(n => [n.id, n]));

  // Inline interactions: names and message ends.
  for (const [i, n] of model.nodes.entries()) {
    if (!isInline(n)) continue;
    const at = pointer('', 'nodes', i);
    const lifelines = new Map(n.lifelines.map(l => [l.id, l]));
    for (const [j, l] of n.lifelines.entries()) {
      if (l.name === undefined && l.type === undefined) diagnostics.push({ code: 'LIFELINE_WITHOUT_NAME', path: pointer(at, 'lifelines', j), message: `Lifeline "${l.id}" needs a name, a type, or both` });
    }
    for (const [j, m] of n.messages.entries()) {
      for (const end of ['from', 'to'] as const) reference(m[end], pointer(at, 'messages', j, end), lifelines, diagnostics, `lifeline of interaction "${n.id}"`);
    }
  }

  // Flows: references and node kinds at their ends.
  const incoming = new Map<string, number[]>(), outgoing = new Map<string, number[]>();
  const seen = new Map<string, string>();
  for (const [i, f] of flows.entries()) {
    const at = pointer('', 'flows', i);
    const ok = [reference(f.from, pointer(at, 'from'), nodes, diagnostics, 'node'), reference(f.to, pointer(at, 'to'), nodes, diagnostics, 'node')].every(Boolean);
    if (!ok) continue;
    if (f.from === f.to) { diagnostics.push({ code: 'SELF_FLOW', path: pointer(at, 'to'), message: `Flow from "${f.from}" to itself; loop back through a merge node instead` }); continue; }
    const key = `${f.from}\u0000${f.to}`, first = seen.get(key);
    if (first !== undefined) { diagnostics.push({ code: 'DUPLICATE_FLOW', path: at, message: `A flow from "${f.from}" to "${f.to}" already exists (${first})` }); continue; }
    seen.set(key, at);
    outgoing.set(f.from, [...(outgoing.get(f.from) ?? []), i]);
    incoming.set(f.to, [...(incoming.get(f.to) ?? []), i]);
    const source = nodes.get(f.from)!, target = nodes.get(f.to)!;
    if (target.type === 'initial') diagnostics.push({ code: 'INITIAL_NODE_HAS_INCOMING', path: pointer(at, 'to'), message: `Initial node "${f.to}" cannot have incoming flows` });
    if (source.type === 'final' || source.type === 'flow-final') diagnostics.push({ code: 'FINAL_NODE_HAS_OUTGOING', path: pointer(at, 'from'), message: `${source.type === 'final' ? 'Activity final' : 'Flow final'} node "${f.from}" cannot have outgoing flows` });
    if (f.guard !== undefined && source.type !== 'decision') diagnostics.push({ code: 'GUARD_OUTSIDE_DECISION', path: pointer(at, 'guard'), message: `Only flows leaving a decision node carry guards; "${f.from}" is ${article(source.type)}` });
  }

  // Exactly one initial node.
  const initials = model.nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.type === 'initial');
  if (initials.length === 0) diagnostics.push({ code: 'MISSING_INITIAL_NODE', path: '/nodes', message: 'An interaction overview needs exactly one initial node (type "initial")' });
  for (const extra of initials.slice(1)) diagnostics.push({ code: 'MULTIPLE_INITIAL_NODES', path: pointer('', 'nodes', extra.i), message: `Initial node "${extra.n.id}" is the second one; use exactly one initial node and a fork for concurrent starts` });

  // Degree rules per node type.
  for (const [i, n] of model.nodes.entries()) {
    const at = pointer('', 'nodes', i);
    const ins = incoming.get(n.id)?.length ?? 0, outs = outgoing.get(n.id)?.length ?? 0;
    const fail = (code: string, message: string) => diagnostics.push({ code, path: at, message, details: { incoming: ins, outgoing: outs } });
    switch (n.type) {
      case 'decision':
        if (ins !== 1 || outs < 2) fail('INVALID_DECISION', `Decision "${n.id}" needs exactly one incoming and at least two outgoing flows (has ${ins} and ${outs})`);
        break;
      case 'merge':
        if (ins < 2 || outs !== 1) fail('INVALID_MERGE', `Merge "${n.id}" needs at least two incoming and exactly one outgoing flow (has ${ins} and ${outs})`);
        break;
      case 'fork':
        if (ins !== 1 || outs < 2) fail('INVALID_FORK', `Fork "${n.id}" needs exactly one incoming and at least two outgoing flows (has ${ins} and ${outs})`);
        break;
      case 'join':
        if (ins < 2 || outs !== 1) fail('INVALID_JOIN', `Join "${n.id}" needs at least two incoming and exactly one outgoing flow (has ${ins} and ${outs})`);
        break;
      case 'final': case 'flow-final':
        break;
      default:
        // Initial nodes, interaction uses and inline interactions.
        if (outs > 1) fail('IMPLICIT_FORK', `"${n.id}" has ${outs} outgoing flows; use a decision (alternatives) or a fork (concurrency)`);
        if (ins > 1) fail('IMPLICIT_JOIN', `"${n.id}" has ${ins} incoming flows, which would wait for all of them; use a merge (alternatives) or a join (concurrency)`);
        if (outs === 0) fail('DEAD_END', `"${n.id}" has no outgoing flow; end every path in a final or flow final node`);
    }
  }

  // Guards on decision branches: present, distinct, at most one else.
  for (const n of model.nodes) {
    if (n.type !== 'decision') continue;
    const guards = new Map<string, number>();
    for (const i of outgoing.get(n.id) ?? []) {
      const f = flows[i]!, at = pointer('', 'flows', i);
      if (f.guard === undefined) { diagnostics.push({ code: 'MISSING_GUARD', path: at, message: `Flow ${f.from} -> ${f.to} leaves decision "${n.id}" without a guard` }); continue; }
      const key = f.guard.trim(), first = guards.get(key);
      if (first === undefined) {guards.set(key, i);}
      else {diagnostics.push({ code: 'DUPLICATE_GUARD', path: pointer(at, 'guard'), message: `Guard [${f.guard}] is already used on ${pointer('', 'flows', first)}; branches of a decision need distinct guards` });}
    }
  }

  // Every node reachable from the initial node.
  if (initials.length > 0) {
    const reached = new Set<string>([initials[0]!.n.id]);
    const queue = [initials[0]!.n.id];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const i of outgoing.get(id) ?? []) {
        const to = flows[i]!.to;
        if (!reached.has(to)) { reached.add(to); queue.push(to); }
      }
    }
    for (const [i, n] of model.nodes.entries()) {
      if (!reached.has(n.id) && n.type !== 'initial') diagnostics.push({ code: 'UNREACHABLE_NODE', path: pointer('', 'nodes', i), message: `"${n.id}" cannot be reached from the initial node` });
    }
  }
  return diagnostics;
}

const article = (type: string): string => `${/^[aeiou]/u.test(type) ? 'an' : 'a'} ${type} node`;
