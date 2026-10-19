import { pointer, type Diagnostic } from '../../core/errors.js';
import { reference, uniqueIds } from '../../model/rules.js';
import { CONTROL_TYPES, isFinal, type ActivityDiagram, type ActivityNode } from './model.js';
import { blockPartitions, structure, StructureError, type Block } from './structure.js';

const DEGREE: Record<string, { code: string; inMin: number; inMax: number; outMin: number; outMax: number; text: string }> = {
  decision: { code: 'DECISION_DEGREE', inMin: 1, inMax: 1, outMin: 2, outMax: Infinity, text: 'one incoming and at least two outgoing flows' },
  merge: { code: 'MERGE_DEGREE', inMin: 2, inMax: Infinity, outMin: 1, outMax: 1, text: 'at least two incoming flows and one outgoing flow' },
  fork: { code: 'FORK_DEGREE', inMin: 1, inMax: 1, outMin: 2, outMax: Infinity, text: 'one incoming and at least two outgoing flows' },
  join: { code: 'JOIN_DEGREE', inMin: 2, inMax: Infinity, outMin: 1, outMax: 1, text: 'at least two incoming flows and one outgoing flow' },
};

/**
 * Semantic rules of activity diagrams (UML 2.5.1 clauses 15 and 16). Each rule has
 * a stable code; docs/kinds/activity.md lists them with their fixtures. The
 * structure check (UNSTRUCTURED_FLOW) runs only when every other rule passed.
 */
export function validateActivityDiagram(model: ActivityDiagram): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const partitions = model.partitions ?? [];
  uniqueIds([
    ...partitions.map((p, i) => ({ id: p.id, path: pointer('', 'partitions', i) })),
    ...model.nodes.map((n, i) => ({ id: n.id, path: pointer('', 'nodes', i) })),
    ...model.edges.flatMap((e, i) => e.id === undefined ? [] : [{ id: e.id, path: pointer('', 'edges', i) }]),
  ], diagnostics);
  const nodes = new Map<string, ActivityNode>(model.nodes.map(n => [n.id, n]));
  const nodeIndex = new Map(model.nodes.map((n, i) => [n.id, i]));
  const partitionIds = new Map(partitions.map(p => [p.id, p]));

  model.nodes.forEach((n, i) => {
    const at = pointer('', 'nodes', i);
    if ('partition' in n && n.partition !== undefined) reference(n.partition, pointer(at, 'partition'), partitionIds, diagnostics, 'partition');
    else if (partitions.length && n.type !== 'merge' && n.type !== 'join') {
      diagnostics.push({ code: 'MISSING_PARTITION', path: pointer(at, 'partition'), message: `Node "${n.id}" must name its partition: the diagram has partitions` });
    }
  });

  const initials = model.nodes.filter(n => n.type === 'initial');
  if (!initials.length) diagnostics.push({ code: 'MISSING_INITIAL_NODE', path: '/nodes', message: 'An activity needs exactly one initial node' });
  initials.slice(1).forEach(n => diagnostics.push({ code: 'MULTIPLE_INITIAL_NODES', path: pointer('', 'nodes', nodeIndex.get(n.id)!), message: `Second initial node "${n.id}"; an activity has exactly one initial node` }));

  const incoming = new Map<string, number[]>(), outgoing = new Map<string, number[]>();
  for (const n of model.nodes) { incoming.set(n.id, []); outgoing.set(n.id, []); }
  const guards = new Map<string, Map<string, string>>();
  let referencesOk = true;
  model.edges.forEach((e, i) => {
    const at = pointer('', 'edges', i);
    const fromOk = reference(e.from, pointer(at, 'from'), nodes, diagnostics, 'node', { from: e.from, to: e.to });
    const toOk = reference(e.to, pointer(at, 'to'), nodes, diagnostics, 'node', { from: e.from, to: e.to });
    if (!fromOk || !toOk) { referencesOk = false; return; }
    const from = nodes.get(e.from)!, to = nodes.get(e.to)!;
    outgoing.get(e.from)!.push(i);
    incoming.get(e.to)!.push(i);
    if (to.type === 'initial') diagnostics.push({ code: 'INITIAL_NODE_HAS_INCOMING', path: pointer(at, 'to'), message: `Initial node "${e.to}" cannot have incoming flows` });
    if (isFinal(from)) diagnostics.push({ code: 'FINAL_NODE_HAS_OUTGOING', path: pointer(at, 'from'), message: `Final node "${e.from}" cannot have outgoing flows` });
    if (from.type === 'decision') {
      if (e.guard === undefined) diagnostics.push({ code: 'MISSING_GUARD', path: pointer(at, 'guard'), message: `Flows leaving decision "${e.from}" need a guard (use "else" for the default flow)` });
      else {
        const seen = guards.get(e.from) ?? new Map<string, string>();
        const first = seen.get(e.guard);
        if (first !== undefined) diagnostics.push({ code: 'DUPLICATE_GUARD', path: pointer(at, 'guard'), message: `Decision "${e.from}" already has a flow with guard [${e.guard}] (${first})` });
        else seen.set(e.guard, at);
        guards.set(e.from, seen);
      }
    } else if (e.guard !== undefined) {
      diagnostics.push({ code: 'UNEXPECTED_GUARD', path: pointer(at, 'guard'), message: `Only flows leaving a decision node carry guards here; "${e.from}" is a ${from.type} node` });
    }
    // Without an explicit type, a flow touching an object node is an object flow.
    const type = e.type ?? (from.type === 'object' || to.type === 'object' ? 'object' : 'control');
    if (type === 'object') {
      const passes = (n: ActivityNode) => n.type === 'object' || CONTROL_TYPES.has(n.type) && n.type !== 'initial';
      if (from.type === 'initial' || to.type === 'initial' || (!passes(from) && !passes(to))) {
        diagnostics.push({ code: 'INVALID_OBJECT_FLOW', path: pointer(at, 'type'), message: `An object flow must start or end at an object node (or pass through a control node other than the initial node); "${e.from}" to "${e.to}" does not` });
      }
    } else if (from.type === 'object' || to.type === 'object') {
      diagnostics.push({ code: 'INVALID_CONTROL_FLOW', path: pointer(at, 'type'), message: `Flows into or out of object node "${from.type === 'object' ? e.from : e.to}" must be object flows` });
    }
  });

  model.nodes.forEach((n, i) => {
    const at = pointer('', 'nodes', i);
    const ins = incoming.get(n.id)!, outs = outgoing.get(n.id)!;
    const degree = DEGREE[n.type];
    if (degree) {
      if (ins.length < degree.inMin || ins.length > degree.inMax || outs.length < degree.outMin || outs.length > degree.outMax) {
        diagnostics.push({ code: degree.code, path: at, message: `${cap(n.type)} node "${n.id}" needs ${degree.text}; it has ${ins.length} incoming and ${outs.length} outgoing`, details: { incoming: ins.length, outgoing: outs.length } });
      }
      return;
    }
    if (ins.length > 1) diagnostics.push({ code: 'IMPLICIT_MERGE', path: pointer('', 'edges', ins[1]!, 'to'), message: `Node "${n.id}" has several incoming flows; join them with an explicit merge (or join) node` });
    if (outs.length > 1) diagnostics.push({ code: 'IMPLICIT_FORK', path: pointer('', 'edges', outs[1]!, 'from'), message: `Node "${n.id}" has several outgoing flows; split them with an explicit decision (or fork) node` });
    if (!outs.length && !isFinal(n)) diagnostics.push({ code: 'MISSING_OUTGOING_FLOW', path: at, message: `Node "${n.id}" has no outgoing flow; end the flow with an activity final or flow final node` });
  });

  if (initials.length && referencesOk) {
    const reached = new Set<string>([initials[0]!.id]);
    const queue = [initials[0]!.id];
    while (queue.length) {
      const id = queue.shift()!;
      for (const j of outgoing.get(id)!) {
        const to = model.edges[j]!.to;
        if (!reached.has(to)) { reached.add(to); queue.push(to); }
      }
    }
    model.nodes.forEach((n, i) => {
      if (!reached.has(n.id) && n.type !== 'initial') diagnostics.push({ code: 'UNREACHABLE_NODE', path: pointer('', 'nodes', i), message: `Node "${n.id}" cannot be reached from the initial node` });
    });
  }

  if (!diagnostics.length) {
    let blocks: Block | undefined;
    try { blocks = structure(model); }
    catch (error) {
      if (!(error instanceof StructureError)) throw error;
      diagnostics.push({ code: 'UNSTRUCTURED_FLOW', path: pointer('', 'nodes', nodeIndex.get(error.nodeId) ?? 0), message: `${error.message}. Activity diagrams must be well structured (see docs/kinds/activity.md)`, details: { node: error.nodeId } });
    }
    if (blocks && partitions.length) checkMultiwayDecisions(blocks, nodeIndex, diagnostics);
  }
  return diagnostics;
}

const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

/**
 * PlantUML draws a decision with more than two branches (switch/case) only when
 * the whole decision stays in one swimlane: a swimlane change inside a case loses
 * flows and guards. Two-way decisions (if/else) may span swimlanes freely.
 */
function checkMultiwayDecisions(blocks: Block, nodeIndex: ReadonlyMap<string, number>, diagnostics: Diagnostic[]): void {
  for (const step of blocks) {
    if (step.kind === 'decision') {
      if (step.branches.length > 2) {
        const own = step.node.partition;
        const others = [...new Set(step.branches.flatMap(b => [...blockPartitions(b.body)]))].filter(p => p !== own);
        if (others.length) {
          diagnostics.push({
            code: 'DECISION_SPANS_PARTITIONS', path: pointer('', 'nodes', nodeIndex.get(step.node.id) ?? 0, 'partition'),
            message: `Decision "${step.node.id}" has ${step.branches.length} branches and some of their nodes are in partition${others.length > 1 ? 's' : ''} ${others.map(p => `"${p}"`).join(', ')}, not in its own partition "${own}". `
              + `A decision with more than two branches must keep all nodes up to its merge (or its final nodes) in its own partition; otherwise split it into nested two-way decisions, which may cross partitions`,
            details: { node: step.node.id, partition: own, others },
          });
        }
      }
      for (const b of step.branches) checkMultiwayDecisions(b.body, nodeIndex, diagnostics);
    } else if (step.kind === 'fork') for (const b of step.branches) checkMultiwayDecisions(b, nodeIndex, diagnostics);
    else if (step.kind === 'while' || step.kind === 'repeat') checkMultiwayDecisions(step.body, nodeIndex, diagnostics);
  }
}
