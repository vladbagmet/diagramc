import { isExecutable, type ActivityDiagram, type ActivityEdge, type ActivityNode, type DecisionNode, type ExecutableNode, type ForkNode, type JoinNode, type MergeNode } from './model.js';

/**
 * Recovers the structured form of an activity flow graph: sequences, decisions
 * closed by a merge, forks closed by a join, and loops. PlantUML's activity
 * syntax is structured (switch/fork/while/repeat), so this is how an arbitrary
 * JSON graph is drawn. Graphs that are not well structured (flows that jump
 * into or out of a decision, fork or loop) are rejected with UNSTRUCTURED_FLOW
 * instead of being drawn wrongly; PlantUML's goto/label extension is not used
 * because it is experimental and draws unlabeled connectors.
 *
 * Preconditions (checked by validate.ts first): references resolve, exactly one
 * initial node, only merge and join nodes have more than one incoming flow, only
 * decision and fork nodes more than one outgoing flow, every non-final node has
 * an outgoing flow, every node is reachable from the initial node.
 */

export type Block = Step[];
export interface Branch { guard: string; body: Block }
export type Step =
  | { kind: 'node'; node: ActivityNode }
  | { kind: 'decision'; node: DecisionNode; branches: Branch[]; merge?: MergeNode }
  | { kind: 'fork'; node: ForkNode; branches: Block[]; join: JoinNode }
  /** Merge then decision (drawn as one combined diamond): test first, body after. */
  | { kind: 'while'; merge: MergeNode; decision: DecisionNode; guard: string; body: Block; exitGuard: string }
  /** Merge, body, then decision: body first, test after; `backward` sits on the returning flow. */
  | { kind: 'repeat'; merge: MergeNode; decision: DecisionNode; body: Block; backGuard: string; exitGuard: string; backward?: ExecutableNode };

export class StructureError extends Error {
  constructor(readonly nodeId: string, message: string) { super(message); }
}

interface SeqResult { block: Block; end: string | null }

export function structure(model: ActivityDiagram): Block {
  const nodes = new Map(model.nodes.map(n => [n.id, n]));
  const out = new Map<string, ActivityEdge[]>(), into = new Map<string, ActivityEdge[]>();
  for (const n of model.nodes) { out.set(n.id, []); into.set(n.id, []); }
  for (const e of model.edges) { out.get(e.from)!.push(e); into.get(e.to)!.push(e); }
  const initial = model.nodes.find(n => n.type === 'initial')!;

  // Back edges: edges to a node on the depth-first stack (deterministic: input order).
  const back = new Set<ActivityEdge>();
  const state = new Map<string, 'active' | 'done'>([[initial.id, 'active']]);
  const stack: { id: string; next: number }[] = [{ id: initial.id, next: 0 }];
  while (stack.length) {
    const top = stack.at(-1)!;
    const edges = out.get(top.id)!;
    if (top.next >= edges.length) { state.set(top.id, 'done'); stack.pop(); continue; }
    const edge = edges[top.next++]!;
    const s = state.get(edge.to);
    if (s === 'active') back.add(edge);
    else if (s === undefined) { state.set(edge.to, 'active'); stack.push({ id: edge.to, next: 0 }); }
  }
  const isLoopEntry = (id: string): boolean => into.get(id)!.some(e => back.has(e));

  const emitted = new Set<string>();
  const take = (id: string): void => {
    if (emitted.has(id)) throw new StructureError(id, `Node "${id}" is reached from more than one structured block`);
    emitted.add(id);
  };
  const next = (id: string): string => out.get(id)![0]!.to;

  /**
   * Walks a sequence from `start`. Stops at a node in `stops`, at a merge or join
   * that some enclosing decision or fork must close (returned as `end`), or after
   * a final node (`end: null`).
   */
  const seq = (start: string, stops: ReadonlySet<string>): SeqResult => {
    const block: Block = [];
    let cur = start;
    for (;;) {
      if (stops.has(cur)) return { block, end: cur };
      const node = nodes.get(cur)!;
      if (node.type === 'merge' && isLoopEntry(cur)) {
        const loop = loopAt(node);
        block.push(loop.step);
        cur = loop.exit;
        continue;
      }
      if (node.type === 'merge' || node.type === 'join') return { block, end: cur };
      take(cur);
      switch (node.type) {
        case 'activityFinal': case 'flowFinal':
          block.push({ kind: 'node', node });
          return { block, end: null };
        case 'decision': {
          const r = decisionAt(node, stops);
          block.push(r.step);
          if (r.next === null) return { block, end: null };
          if (r.live !== undefined && r.step.kind === 'decision') {
            // No merge node: the one continuing branch carries the rest of the
            // sequence, so PlantUML draws no merge diamond the model does not have.
            const rest = seq(r.next, stops);
            r.step.branches[r.live]!.body.push(...rest.block);
            return { block, end: rest.end };
          }
          cur = r.next;
          continue;
        }
        case 'fork': {
          const r = forkAt(node, stops);
          block.push(r.step);
          cur = r.next;
          continue;
        }
        default:
          block.push({ kind: 'node', node });
          cur = next(cur);
      }
    }
  };

  /** The common end of branches: their single non-null end, if every live branch shares it. */
  const meeting = (owner: string, what: string, ends: (string | null)[]): string | undefined => {
    const live = [...new Set(ends.filter((e): e is string => e !== null))];
    if (live.length > 1) throw new StructureError(owner, `The flows leaving ${what} "${owner}" do not meet again at one node (they reach ${live.map(l => `"${l}"`).join(' and ')})`);
    return live[0];
  };

  const decisionAt = (node: DecisionNode, stops: ReadonlySet<string>): { step: Step; next: string | null; live?: number } => {
    const results = out.get(node.id)!.map(e => ({ edge: e, r: seq(e.to, stops) }));
    const meet = meeting(node.id, 'decision', results.map(x => x.r.end));
    const branches = results.map(x => ({ guard: x.edge.guard!, body: x.r.block }));
    const arrivals = results.filter(x => x.r.end !== null).length;
    if (meet === undefined) return { step: { kind: 'decision', node, branches }, next: null };
    const target = nodes.get(meet)!;
    if (target.type === 'merge' && !stops.has(meet) && arrivals === into.get(meet)!.length) {
      take(meet);
      return { step: { kind: 'decision', node, branches, merge: target }, next: next(meet) };
    }
    if (arrivals > 1) {
      throw new StructureError(node.id, target.type === 'merge'
        ? `Merge "${meet}" combines flows of decision "${node.id}" with other flows; give decision "${node.id}" its own merge node`
        : `The flows leaving decision "${node.id}" must meet at a merge node, not at ${target.type} "${meet}"`);
    }
    // One live branch continues to an enclosing block's merge, join or stop.
    return { step: { kind: 'decision', node, branches }, next: meet, live: results.findIndex(x => x.r.end !== null) };
  };

  const forkAt = (node: ForkNode, stops: ReadonlySet<string>): { step: Step; next: string } => {
    const results = out.get(node.id)!.map(e => seq(e.to, stops));
    const meet = meeting(node.id, 'fork', results.map(r => r.end));
    const target = meet === undefined ? undefined : nodes.get(meet);
    const arrivals = results.filter(r => r.end !== null).length;
    if (!target || target.type !== 'join') throw new StructureError(node.id, `The flows leaving fork "${node.id}" must meet again at one join node`);
    if (arrivals !== into.get(target.id)!.length) throw new StructureError(target.id, `Join "${target.id}" has incoming flows that do not come from fork "${node.id}"`);
    take(target.id);
    return { step: { kind: 'fork', node, branches: results.map(r => r.block), join: target }, next: next(target.id) };
  };

  const loopAt = (merge: MergeNode): { step: Step; exit: string } => {
    take(merge.id);
    const returning = into.get(merge.id)!.filter(e => back.has(e));
    if (returning.length !== 1 || into.get(merge.id)!.length !== 2) {
      throw new StructureError(merge.id, `Loop entry merge "${merge.id}" must have exactly one entry flow and one flow returning from the loop`);
    }
    // Loop body: reachable from the merge without returning, and able to reach the returning flow.
    const reach = new Set<string>();
    const walk = (id: string): void => {
      if (reach.has(id)) return;
      reach.add(id);
      for (const e of out.get(id)!) if (!back.has(e)) walk(e.to);
    };
    walk(merge.id);
    const body = new Set<string>();
    const climb = (id: string): void => {
      if (body.has(id) || !reach.has(id)) return;
      body.add(id);
      if (id !== merge.id) for (const e of into.get(id)!) if (!back.has(e)) climb(e.from);
    };
    climb(returning[0]!.from);
    // Flows leaving the body; flows into paths that only end in final nodes are
    // branches inside the loop, unless such a flow is the only way out.
    const leaving = [...body].flatMap(id => out.get(id)!.filter(e => !back.has(e) && !body.has(e.to)));
    const continuing = leaving.filter(e => !terminates(e.to));
    const exits = continuing.length || leaving.length !== 1 ? continuing : leaving;
    const exit = exits[0];
    const decision = exit && nodes.get(exit.from);
    if (exits.length !== 1 || !decision || decision.type !== 'decision' || out.get(decision.id)!.length !== 2) {
      throw new StructureError(merge.id, `The loop entered at merge "${merge.id}" must be left through exactly one flow, from a two-way decision node`);
    }
    const stay = out.get(decision.id)!.find(e => e !== exit)!;
    const s1 = seq(next(merge.id), new Set([decision.id]));
    if (s1.end !== decision.id) throw new StructureError(merge.id, `The loop entered at merge "${merge.id}" does not reach its exit decision "${decision.id}" in sequence`);
    take(decision.id);
    const s2 = stay.to === merge.id ? { block: [], end: merge.id } : seq(stay.to, new Set([merge.id]));
    if (s2.end !== merge.id) throw new StructureError(decision.id, `The loop flow of decision "${decision.id}" does not return to merge "${merge.id}" in sequence`);
    let step: Step;
    if (!s1.block.length) step = { kind: 'while', merge, decision, guard: stay.guard!, body: s2.block, exitGuard: exit.guard! };
    else if (!s2.block.length) step = { kind: 'repeat', merge, decision, body: s1.block, backGuard: stay.guard!, exitGuard: exit.guard! };
    else {
      const only = s2.block.length === 1 ? s2.block[0]! : undefined;
      if (only?.kind !== 'node' || only.node.type !== 'action' || !isExecutable(only.node)) {
        throw new StructureError(decision.id, `Loop at merge "${merge.id}" has nodes both before and after its exit decision "${decision.id}"; at most one action may sit on the returning flow`);
      }
      step = { kind: 'repeat', merge, decision, body: s1.block, backGuard: stay.guard!, exitGuard: exit.guard!, backward: only.node };
    }
    return { step, exit: exit.to };
  };

  /** True when every path from `id` ends in a final node without meeting a merge or join. */
  const terminating = new Map<string, boolean>();
  const terminates = (id: string): boolean => {
    const known = terminating.get(id);
    if (known !== undefined) return known;
    terminating.set(id, false);
    const node = nodes.get(id)!;
    const result = node.type === 'activityFinal' || node.type === 'flowFinal' ||
      (node.type !== 'merge' && node.type !== 'join' && out.get(id)!.length > 0 && out.get(id)!.every(e => !back.has(e) && terminates(e.to)));
    terminating.set(id, result);
    return result;
  };

  const result = seq(initial.id, new Set());
  if (result.end !== null) throw new StructureError(result.end, `${cap(nodes.get(result.end)!.type)} "${result.end}" does not close a ${nodes.get(result.end)!.type === 'join' ? 'fork' : 'decision'}: its incoming flows come from different blocks`);
  const missing = model.nodes.find(n => !emitted.has(n.id));
  if (missing) throw new StructureError(missing.id, `Node "${missing.id}" is not part of the structured flow from the initial node`);
  return result.block;
}

const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

/** Partitions of every node drawn inside a block, nested blocks included. */
export function blockPartitions(block: Block): Set<string> {
  const out = new Set<string>();
  const add = (node: { partition?: string } | { id: string }): void => { if ('partition' in node && node.partition !== undefined) out.add(node.partition); };
  for (const step of block) {
    switch (step.kind) {
      case 'node': add(step.node); break;
      case 'decision': add(step.node); for (const b of step.branches) for (const p of blockPartitions(b.body)) out.add(p); break;
      case 'fork': add(step.node); for (const b of step.branches) for (const p of blockPartitions(b)) out.add(p); break;
      case 'while': case 'repeat':
        add(step.decision);
        for (const p of blockPartitions(step.body)) out.add(p);
        if (step.kind === 'repeat' && step.backward) add(step.backward);
        break;
    }
  }
  return out;
}
