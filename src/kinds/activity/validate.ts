import { pointer, type Diagnostic } from '../../core/errors.js';
import { reference, uniqueIds } from '../../model/rules.js';
import { CONTROL_TYPES, isFinal, type ActivityDiagram, type ActivityNode } from './model.js';
import { blockPartitions, blockSpan, orderBySpan, spansApart, structure, StructureError, type Block, type Span } from './structure.js';

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
  uniqueIds(
    [
      ...partitions.map((p, i) => ({ id: p.id, path: pointer('', 'partitions', i) })),
      ...model.nodes.map((n, i) => ({ id: n.id, path: pointer('', 'nodes', i) })),
      ...model.edges.flatMap((e, i) => (e.id === undefined ? [] : [{ id: e.id, path: pointer('', 'edges', i) }])),
    ],
    diagnostics,
  );
  const nodes = new Map<string, ActivityNode>(model.nodes.map(n => [n.id, n]));
  const nodeIndex = new Map(model.nodes.map((n, i) => [n.id, i]));
  const partitionIds = new Map(partitions.map(p => [p.id, p]));

  for (const [i, n] of model.nodes.entries()) {
    const at = pointer('', 'nodes', i);
    if ('partition' in n) reference(n.partition, pointer(at, 'partition'), partitionIds, diagnostics, 'partition');
    else if (partitions.length > 0 && n.type !== 'merge' && n.type !== 'join') {
      diagnostics.push({
        code: 'MISSING_PARTITION',
        path: pointer(at, 'partition'),
        message: `Node "${n.id}" must name its partition: the diagram has partitions`,
      });
    }
  }

  const initials = model.nodes.filter(n => n.type === 'initial');
  if (initials.length === 0) diagnostics.push({ code: 'MISSING_INITIAL_NODE', path: '/nodes', message: 'An activity needs exactly one initial node' });
  for (const n of initials.slice(1))
    diagnostics.push({
      code: 'MULTIPLE_INITIAL_NODES',
      path: pointer('', 'nodes', nodeIndex.get(n.id)!),
      message: `Second initial node "${n.id}"; an activity has exactly one initial node`,
    });

  const incoming = new Map<string, number[]>(),
    outgoing = new Map<string, number[]>();
  for (const n of model.nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  const guards = new Map<string, Map<string, string>>();
  let referencesOk = true;
  for (const [i, e] of model.edges.entries()) {
    const at = pointer('', 'edges', i);
    const fromOk = reference(e.from, pointer(at, 'from'), nodes, diagnostics, 'node', { from: e.from, to: e.to });
    const toOk = reference(e.to, pointer(at, 'to'), nodes, diagnostics, 'node', { from: e.from, to: e.to });
    if (!fromOk || !toOk) {
      referencesOk = false;
      continue;
    }
    const from = nodes.get(e.from)!,
      to = nodes.get(e.to)!;
    outgoing.get(e.from)!.push(i);
    incoming.get(e.to)!.push(i);
    if (to.type === 'initial')
      diagnostics.push({ code: 'INITIAL_NODE_HAS_INCOMING', path: pointer(at, 'to'), message: `Initial node "${e.to}" cannot have incoming flows` });
    if (isFinal(from))
      diagnostics.push({ code: 'FINAL_NODE_HAS_OUTGOING', path: pointer(at, 'from'), message: `Final node "${e.from}" cannot have outgoing flows` });
    if (from.type === 'decision') {
      if (e.guard === undefined)
        diagnostics.push({
          code: 'MISSING_GUARD',
          path: pointer(at, 'guard'),
          message: `Flows leaving decision "${e.from}" need a guard (use "else" for the default flow)`,
        });
      else {
        const seen = guards.get(e.from) ?? new Map<string, string>();
        const first = seen.get(e.guard);
        if (first === undefined) {
          seen.set(e.guard, at);
        } else {
          diagnostics.push({
            code: 'DUPLICATE_GUARD',
            path: pointer(at, 'guard'),
            message: `Decision "${e.from}" already has a flow with guard [${e.guard}] (${first})`,
          });
        }
        guards.set(e.from, seen);
      }
    } else if (e.guard !== undefined) {
      diagnostics.push({
        code: 'UNEXPECTED_GUARD',
        path: pointer(at, 'guard'),
        message: `Only flows leaving a decision node carry guards here; "${e.from}" is a ${from.type} node`,
      });
    }
    // Without an explicit type, a flow touching an object node is an object flow.
    const type = e.type ?? (from.type === 'object' || to.type === 'object' ? 'object' : 'control');
    if (type === 'object') {
      const passes = (n: ActivityNode) => n.type === 'object' || (CONTROL_TYPES.has(n.type) && n.type !== 'initial');
      if (from.type === 'initial' || to.type === 'initial' || (!passes(from) && !passes(to))) {
        diagnostics.push({
          code: 'INVALID_OBJECT_FLOW',
          path: pointer(at, 'type'),
          message: `An object flow must start or end at an object node (or pass through a control node other than the initial node); "${e.from}" to "${e.to}" does not`,
        });
      }
    } else if (from.type === 'object' || to.type === 'object') {
      diagnostics.push({
        code: 'INVALID_CONTROL_FLOW',
        path: pointer(at, 'type'),
        message: `Flows into or out of object node "${from.type === 'object' ? e.from : e.to}" must be object flows`,
      });
    }
  }

  for (const [i, n] of model.nodes.entries()) {
    const at = pointer('', 'nodes', i);
    const ins = incoming.get(n.id)!,
      outs = outgoing.get(n.id)!;
    const degree = DEGREE[n.type];
    if (degree) {
      if (ins.length < degree.inMin || ins.length > degree.inMax || outs.length < degree.outMin || outs.length > degree.outMax) {
        diagnostics.push({
          code: degree.code,
          path: at,
          message: `${cap(n.type)} node "${n.id}" needs ${degree.text}; it has ${ins.length} incoming and ${outs.length} outgoing`,
          details: { incoming: ins.length, outgoing: outs.length },
        });
      }
      continue;
    }
    if (ins.length > 1)
      diagnostics.push({
        code: 'IMPLICIT_MERGE',
        path: pointer('', 'edges', ins[1]!, 'to'),
        message: `Node "${n.id}" has several incoming flows; join them with an explicit merge (or join) node`,
      });
    if (outs.length > 1)
      diagnostics.push({
        code: 'IMPLICIT_FORK',
        path: pointer('', 'edges', outs[1]!, 'from'),
        message: `Node "${n.id}" has several outgoing flows; split them with an explicit decision (or fork) node`,
      });
    if (outs.length === 0 && !isFinal(n))
      diagnostics.push({
        code: 'MISSING_OUTGOING_FLOW',
        path: at,
        message: `Node "${n.id}" has no outgoing flow; end the flow with an activity final or flow final node`,
      });
  }

  if (initials.length > 0 && referencesOk) {
    const reached = new Set<string>([initials[0]!.id]);
    const queue = [initials[0]!.id];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const j of outgoing.get(id)!) {
        const to = model.edges[j]!.to;
        if (!reached.has(to)) {
          reached.add(to);
          queue.push(to);
        }
      }
    }
    for (const [i, n] of model.nodes.entries()) {
      if (!reached.has(n.id) && n.type !== 'initial')
        diagnostics.push({ code: 'UNREACHABLE_NODE', path: pointer('', 'nodes', i), message: `Node "${n.id}" cannot be reached from the initial node` });
    }
  }

  if (diagnostics.length === 0) {
    let blocks: Block | undefined;
    try {
      blocks = structure(model);
    } catch (error) {
      if (!(error instanceof StructureError)) throw error;
      diagnostics.push({
        code: 'UNSTRUCTURED_FLOW',
        path: pointer('', 'nodes', nodeIndex.get(error.nodeId) ?? 0),
        message: `${error.message}. Activity diagrams must be well structured (see docs/kinds/activity.md)`,
        details: { node: error.nodeId },
      });
    }
    if (blocks && partitions.length > 0) checkSwimlanes(blocks, model, nodeIndex, diagnostics);
  }
  return diagnostics;
}

const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

/** The node a branch starts with (for messages). */
function firstNode(block: Block): string | undefined {
  const step = block[0];
  if (!step) return undefined;
  switch (step.kind) {
    case 'node':
    case 'decision':
    case 'fork':
      return step.node.id;
    default:
      return step.merge.id;
  }
}

/**
 * Swimlane rules of PlantUML's activity layout, checked on the structured blocks:
 *
 * - PlantUML places the branches of a decision or fork side by side within every
 *   swimlane, and runs the flows to them along shared rows. Branches whose lanes
 *   interleave (two branches both using lanes 1 to 3) get flows drawn through each
 *   other's nodes and diamonds, so each branch must occupy its own run of adjacent
 *   lanes; neighbours may meet in one lane (BRANCHES_SHARE_PARTITIONS).
 * - A decision with more than two branches (switch/case) is drawn only when the
 *   whole decision stays in one swimlane: a swimlane change inside a case loses
 *   flows and guards (DECISION_SPANS_PARTITIONS). The message spells out the
 *   equivalent nested two-way decisions, which may cross lanes.
 */
function checkSwimlanes(blocks: Block, model: ActivityDiagram, nodeIndex: ReadonlyMap<string, number>, diagnostics: Diagnostic[]): void {
  const index = new Map((model.partitions ?? []).map((p, i) => [p.id, i]));
  const ids = new Set([...model.nodes.map(n => n.id), ...(model.partitions ?? []).map(p => p.id)]);
  const fresh = (base: string): string => {
    let k = 2;
    while (ids.has(`${base}_${k}`)) k++;
    const id = `${base}_${k}`;
    ids.add(id);
    return id;
  };
  const lanes = (s: Span): string => {
    const name = (i: number): string => `"${model.partitions![i]!.id}"`;
    return s.min === s.max ? `partition ${name(s.min)}` : `partitions ${name(s.min)} to ${name(s.max)}`;
  };
  const label = (guard: string | undefined, block: Block): string =>
    `${guard === undefined ? 'branch' : `branch [${guard}]`}${firstNode(block) ? ` (from node "${firstNode(block)}")` : ''}`;
  const visit = (blocks: Block): void => {
    for (const step of blocks) {
      if (step.kind === 'decision' || step.kind === 'fork') {
        const branches = step.kind === 'decision' ? step.branches : step.branches.map(body => ({ guard: undefined as string | undefined, body }));
        const what = `${step.kind} "${step.node.id}"`;
        const spans = branches.map(b => blockSpan(b.body, index));
        let clash = false;
        for (let i = 0; i < branches.length && !clash; i++)
          for (let j = i + 1; j < branches.length && !clash; j++) {
            const a = spans[i],
              b = spans[j];
            if (!a || !b || spansApart(a, b)) continue;
            clash = true;
            diagnostics.push({
              code: 'BRANCHES_SHARE_PARTITIONS',
              path: pointer('', 'nodes', nodeIndex.get(step.node.id) ?? 0),
              message:
                `The branches of ${what} overlap in swimlanes: ${label(branches[i]!.guard, branches[i]!.body)} uses ${lanes(a)} and ${label(branches[j]!.guard, branches[j]!.body)} uses ${lanes(b)}. ` +
                'The branches of a decision or fork are drawn side by side in every swimlane they use, so branches that share more than one swimlane, or interleave, would have their flows drawn through each other. ' +
                'Give each branch its own run of adjacent partitions (neighbouring branches may share one partition at their boundary): move nodes, including nested decisions, to other partitions, reorder "partitions", or split the diagram',
              details: {
                node: step.node.id,
                branches: [i, j].map(k => ({
                  ...(branches[k]!.guard === undefined ? {} : { guard: branches[k]!.guard }),
                  first: firstNode(branches[k]!.body),
                  partitions: [model.partitions![spans[k]!.min]!.id, model.partitions![spans[k]!.max]!.id],
                })),
              },
            });
          }
        if (step.kind === 'decision' && step.branches.length > 2 && !clash) {
          const own = step.node.partition;
          const others = [...new Set(step.branches.flatMap(b => [...blockPartitions(b.body)]))].filter(p => p !== own);
          if (others.length > 0) diagnostics.push(multiway(step, others, fresh, index));
        }
        for (const b of branches) visit(b.body);
      } else if (step.kind === 'while' || step.kind === 'repeat') visit(step.body);
    }
  };
  const multiway = (
    step: Extract<Block[number], { kind: 'decision' }>,
    others: string[],
    fresh: (base: string) => string,
    index: ReadonlyMap<string, number>,
  ): Diagnostic => {
    // The equivalent nested two-way decisions, in lane order: each one keeps the
    // leftmost remaining branch (the rightmost when the leftmost is [else], which
    // must stay with the passed-on ones) and passes the others on through [else].
    let rest = orderBySpan(step.branches, b => b.body, index);
    const id = step.node.id,
      merge = step.merge?.id;
    const steps: string[] = [];
    let decision = id,
      mergeInto = merge;
    while (rest.length > 2) {
      const right = rest[0]!.guard === 'else';
      const kept = right ? rest.at(-1)! : rest[0]!;
      const passed = right ? rest.slice(0, -1) : rest.slice(1);
      const next = fresh(id);
      // Nested decisions sit in the first lane of the branches they lead to.
      const first = Math.min(...passed.map(b => blockSpan(b.body, index)?.min ?? Infinity));
      const lane = Number.isFinite(first) ? model.partitions![first]!.id : step.node.partition;
      const nextMerge = merge === undefined ? undefined : fresh(merge);
      steps.push(
        `decision "${decision}" keeps [${kept.guard}] to "${firstNode(kept.body) ?? mergeInto}" and gets a flow [else] to a new decision "${next}" in partition "${lane}"` +
          (nextMerge === undefined ? '' : `, whose branches meet at a new merge "${nextMerge}" that flows into "${mergeInto}"`),
      );
      decision = next;
      mergeInto = nextMerge;
      rest = passed;
    }
    steps.push(
      `decision "${decision}" gets [${rest[0]!.guard}] to "${firstNode(rest[0]!.body) ?? mergeInto}" and [${rest[1]!.guard}] to "${firstNode(rest[1]!.body) ?? mergeInto}"`,
    );
    return {
      code: 'DECISION_SPANS_PARTITIONS',
      path: pointer('', 'nodes', nodeIndex.get(id) ?? 0, 'partition'),
      message:
        `Decision "${id}" has ${step.branches.length} branches and some of their nodes are in partition${others.length > 1 ? 's' : ''} ${others.map(p => `"${p}"`).join(', ')}, not in its own partition "${step.node.partition}". ` +
        'A decision with more than two branches can only be drawn when all its nodes up to its merge (or its final nodes) stay in its own partition. ' +
        `Rewrite it as nested two-way decisions, which may cross partitions: ${steps.join('; ')}`,
      details: { node: id, partition: step.node.partition, others, rewrite: steps },
    };
  };
  visit(blocks);
}
