import type { ActivityDiagram, ActivityEdge, ActivityNode, ExecutableNode, Partition } from '../../kinds/activity/model.js';
import { structure, type Block } from '../../kinds/activity/structure.js';
import { IdMaker } from '../common.js';
import type { KindFormat, Losses, Problems, SourceLine } from '../types.js';
import { decode, document, encode, titleOf, token } from './text.js';

/**
 * Activity diagram <-> PlantUML activity diagram (the current syntax). The flow
 * graph is turned into structured blocks by the activity kind's own
 * structure() (if/else, switch, fork, while, repeat), so any valid model
 * exports; importing rebuilds the graph: a decision with a merge where two or
 * more branches continue, a fork with a join, a merge and decision per loop.
 * PlantUML has no node IDs: imported nodes get IDs made from their names.
 */

const STEREOTYPE: Record<ExecutableNode['type'], string> = { action: '', callBehavior: ' <<procedure>>', sendSignal: ' <<output>>', acceptEvent: ' <<input>>', object: ' <<object>>' };
const BY_STEREOTYPE = new Map<string, ExecutableNode['type']>([['procedure', 'callBehavior'], ['output', 'sendSignal'], ['input', 'acceptEvent'], ['object', 'object']]);

/** `([guard])`: guards are drawn in brackets, as UML writes them. */
const guard = (text: string): string => `([${encode(text, '()[]')}])`;

export function exportActivity(model: ActivityDiagram, losses: Losses): string {
  const lines: string[] = [];
  const partitions = new Map((model.partitions ?? []).map(p => [p.id, p]));
  const lane = (p: Partition): string => `|${encode(p.name, '|')}|`;
  for (const p of model.partitions ?? []) lines.push(lane(p));
  let current = model.partitions?.at(-1)?.id;
  const enter = (node: ActivityNode, pad: string): void => {
    const id = 'partition' in node ? node.partition : undefined;
    if (id !== undefined && id !== current) { lines.push(`${pad}${lane(partitions.get(id)!)}`); current = id; }
  };
  losses.add('/nodes', 'PlantUML activity nodes have no IDs (nor have flows): imported nodes get IDs made from their names');
  if (model.partitions?.length) {
    losses.add('/partitions', 'Swimlanes are named, not identified: imported partitions get IDs made from their names');
    model.nodes.forEach((n, i) => {
      if (n.type !== 'merge' && n.type !== 'join' && n.partition === undefined) losses.add(`/nodes/${i}/partition`, 'With swimlanes, a node outside every partition is drawn in the swimlane current at its place');
    });
  }
  const executable = (n: ExecutableNode, pad: string, keyword = ''): void => {
    const name = encode(n.name, n.type === 'object' ? ';[]' : ';');
    const text = n.type === 'object' && n.state !== undefined ? `${name}\\n[${encode(n.state, ';[]')}]` : name;
    lines.push(`${pad}${keyword}:${text};${STEREOTYPE[n.type]}`);
    if (n.note !== undefined) {
      const note = encode(n.note);
      lines.push(`${pad}note right`, `${pad}  ${/^end\s?note$/iu.test(note) ? token(note[0]!) + note.slice(1) : note}`, `${pad}end note`);
    }
  };
  const block = (steps: Block, pad: string): void => {
    for (const step of steps) {
      switch (step.kind) {
        case 'node': {
          const n = step.node;
          enter(n, pad);
          if (n.type === 'initial') lines.push(`${pad}start`);
          else if (n.type === 'activityFinal') lines.push(`${pad}stop`);
          else if (n.type === 'flowFinal') lines.push(`${pad}end`);
          else executable(n as ExecutableNode, pad);
          break;
        }
        case 'decision':
          enter(step.node, pad);
          if (step.branches.length === 2) {
            lines.push(`${pad}if () then ${guard(step.branches[0]!.guard)}`);
            block(step.branches[0]!.body, `${pad}  `);
            lines.push(`${pad}else ${guard(step.branches[1]!.guard)}`);
            block(step.branches[1]!.body, `${pad}  `);
            lines.push(`${pad}endif`);
          } else {
            lines.push(`${pad}switch ()`);
            for (const b of step.branches) { lines.push(`${pad}case ${guard(b.guard)}`); block(b.body, `${pad}  `); }
            lines.push(`${pad}endswitch`);
          }
          break;
        case 'fork':
          enter(step.node, pad);
          step.branches.forEach((b, i) => { lines.push(`${pad}${i ? 'fork again' : 'fork'}`); block(b, `${pad}  `); });
          lines.push(`${pad}end fork`);
          break;
        case 'while':
          enter(step.decision, pad);
          lines.push(`${pad}while () is ${guard(step.guard)}`);
          block(step.body, `${pad}  `);
          lines.push(`${pad}endwhile ${guard(step.exitGuard)}`);
          break;
        case 'repeat':
          enter(step.decision, pad);
          lines.push(`${pad}repeat`);
          block(step.body, `${pad}  `);
          if (step.backward) { enter(step.backward, `${pad}  `); executable(step.backward, `${pad}  `, 'backward '); }
          enter(step.decision, pad);
          lines.push(`${pad}repeat while () is ${guard(step.backGuard)} not ${guard(step.exitGuard)}`);
          break;
      }
    }
  };
  block(structure(model), '');
  return document(model.title, lines);
}

// ---------------------------------------------------------------- import

/** An open end of the flow: the next node is connected from `from`, with `guard` when it leaves a decision. */
interface End { from: string; guard?: string }
type Frame =
  | { kind: 'if' | 'switch'; line: SourceLine; decision: string; ends: End[]; started: boolean; guards: string[] }
  | { kind: 'fork'; line: SourceLine; fork: string; ends: End[] }
  | { kind: 'while'; line: SourceLine; merge: string; decision: string }
  | { kind: 'repeat'; line: SourceLine; merge: string; backward?: string };

export function importActivity(lines: readonly SourceLine[], problems: Problems): Record<string, unknown> {
  const ids = new IdMaker();
  const nodes: ActivityNode[] = [];
  const edges: ActivityEdge[] = [];
  const partitions: Partition[] = [];
  const stack: Frame[] = [];
  let title: string | undefined;
  let lane: Partition | undefined;
  let pending: End[] | undefined; // undefined: before `start`
  let lastExecutable: ExecutableNode | undefined;
  let note: { line: SourceLine; text: string[]; node: ExecutableNode } | undefined;
  let action: { line: SourceLine; text: string[] } | undefined;

  const node = (type: ActivityNode['type'], line: SourceLine, extra: Record<string, unknown> = {}): ActivityNode | undefined => {
    if (pending === undefined && type !== 'initial') { problems.malformed(line, 'the flow must begin with "start"'); return undefined; }
    if (pending !== undefined && !pending.length) { problems.malformed(line, 'this node cannot be reached: the flow ended before it (stop or end)'); return undefined; }
    const name = typeof extra.name === 'string' ? extra.name : type === 'activityFinal' ? 'final' : type === 'flowFinal' ? 'flow final' : type;
    const n = { id: ids.fresh(name), type, ...extra, ...(lane && type !== 'merge' && type !== 'join' ? { partition: lane.id } : {}) } as ActivityNode;
    nodes.push(n);
    for (const e of pending ?? []) connect(e, n.id);
    pending = type === 'activityFinal' || type === 'flowFinal' ? [] : [{ from: n.id }];
    lastExecutable = 'name' in n ? n as ExecutableNode : undefined;
    return n;
  };
  const connect = (e: End, to: string): void => { edges.push({ from: e.from, to, ...(e.guard === undefined ? {} : { guard: e.guard }) }); };
  /** `([g])` or `(g)` -> g. */
  const guardOf = (text: string | undefined): string | undefined => {
    if (text === undefined) return undefined;
    const t = text.trim();
    const inner = /^\[(.*)\]$/u.exec(t)?.[1] ?? t;
    return inner.trim() ? decode(inner.trim()) : undefined;
  };
  const needGuard = (g: string | undefined, line: SourceLine): g is string => {
    if (g === undefined) problems.unsupported(line, 'every flow leaving a decision needs a guard: write "then ([guard])", "else ([guard])", "case ([guard])"');
    return g !== undefined;
  };
  const executable = (text: string, line: SourceLine, backward: boolean): void => {
    const m = /^:(.*);\s*(?:<<(\w+)>>)?$/u.exec(text);
    if (!m) { problems.unsupported(line, 'an action ends with ";" and an optional <<input>>, <<output>>, <<procedure>> or <<object>> (the obsolete shape endings < > | ] } / are not read)'); return; }
    const type = m[2] === undefined ? 'action' : BY_STEREOTYPE.get(m[2]);
    if (!type) { problems.unsupported(line, `the stereotype <<${m[2]}>> has no node type in the model (input, output, procedure, object)`); return; }
    const parts = m[1]!.split('\\n');
    const extra: Record<string, unknown> = {};
    if (type === 'object' && parts.length > 1 && /^\[.*\]$/u.test(parts.at(-1)!)) extra.state = decode(parts.pop()!.slice(1, -1).trim());
    extra.name = decode(parts.join(' ').trim());
    if (backward) {
      const frame = stack.at(-1);
      if (frame?.kind !== 'repeat' || frame.backward !== undefined || type !== 'action') { problems.malformed(line, '"backward" takes one action, inside a repeat loop'); return; }
      const n = { id: ids.fresh(extra.name as string), type: 'action', name: extra.name, ...(lane ? { partition: lane.id } : {}) } as ExecutableNode;
      nodes.push(n);
      frame.backward = n.id;
      lastExecutable = n;
      return;
    }
    node(type, line, extra);
  };

  for (const line of lines) {
    const t = line.text;
    if (note) {
      if (/^end\s?note$/u.test(t)) { finishNote(); continue; }
      note.text.push(decode(t));
      continue;
    }
    if (action) {
      action.text.push(t);
      if (/;\s*(?:<<\w+>>)?$/u.test(t)) { executable(action.text.join('\\n'), action.line, false); action = undefined; }
      continue;
    }
    const heading = titleOf(line);
    if (heading !== undefined) { title = heading; continue; }
    let m = /^\|([^|]+)\|$/u.exec(t);
    if (m) {
      const name = decode(m[1]!.trim());
      lane = partitions.find(p => p.name === name);
      if (!lane) { lane = { id: ids.fresh(name), name }; partitions.push(lane); }
      continue;
    }
    if (/^\|/u.test(t)) { problems.unsupported(line, 'swimlanes are read as "|Name|" (colors and aliases are not imported)'); continue; }
    if (t === 'start') {
      if (pending !== undefined) { problems.unsupported(line, 'only one "start" is read (one initial node)'); continue; }
      pending = [];
      const n = { id: ids.fresh('initial'), type: 'initial', ...(lane ? { partition: lane.id } : {}) } as ActivityNode;
      nodes.push(n);
      pending = [{ from: n.id }];
      lastExecutable = undefined;
      continue;
    }
    if (t === 'stop') { node('activityFinal', line); continue; }
    if (t === 'end') { node('flowFinal', line); continue; }
    if (/^(?:backward\s*)?:/u.test(t)) {
      const backward = t.startsWith('backward');
      const text = backward ? t.replace(/^backward\s*/u, '') : t;
      if (!backward && !/;\s*(?:<<\w+>>)?$/u.test(text) && !/[<>|\]}/\\]$/u.test(text)) { action = { line, text: [text] }; continue; }
      executable(text, line, backward);
      continue;
    }
    m = /^note\s+(left|right)(?:\s*:\s*(.+))?$/u.exec(t);
    if (m) {
      if (!lastExecutable || lastExecutable.note !== undefined) { problems.unsupported(line, 'a note is read only right after an action, object or event node, one per node'); continue; }
      if (m[2] !== undefined) lastExecutable.note = decode(m[2].trim());
      else note = { line, text: [], node: lastExecutable };
      continue;
    }
    if (/^(?:floating\s+)?note\b/u.test(t)) { problems.unsupported(line, 'only notes on an action ("note right" after it) are read'); continue; }
    m = /^if\s*\((.*?)\)\s*then\s*(?:\((.*)\))?$/u.exec(t);
    if (m) {
      if (m[1]!.trim()) { problems.unsupported(line, 'a decision has no question text in the model; write "if () then ([guard])" and put the condition in the guards'); continue; }
      const g = guardOf(m[2]);
      if (!needGuard(g, line)) continue;
      const d = node('decision', line);
      if (!d) continue;
      stack.push({ kind: 'if', line, decision: d.id, ends: [], started: true, guards: [g] });
      pending = [{ from: d.id, guard: g }];
      continue;
    }
    m = /^else\s*(?:\((.*)\))?$/u.exec(t);
    if (m) {
      const frame = stack.at(-1);
      if (frame?.kind !== 'if') { problems.malformed(line, '"else" outside an if'); continue; }
      const g = guardOf(m[1]);
      if (!needGuard(g, line)) continue;
      frame.ends.push(...(pending ?? []));
      frame.guards.push(g);
      pending = [{ from: frame.decision, guard: g }];
      continue;
    }
    if (/^else\s*if\b|^elseif\b/u.test(t)) { problems.unsupported(line, '"elseif" is not read; use switch/case for more than two branches'); continue; }
    if (t === 'endif' || t === 'end if') { close('if', line); continue; }
    m = /^switch\s*\((.*)\)$/u.exec(t);
    if (m) {
      if (m[1]!.trim()) { problems.unsupported(line, 'a decision has no question text in the model; write "switch ()" and put the condition in the case guards'); continue; }
      const d = node('decision', line);
      if (!d) continue;
      stack.push({ kind: 'switch', line, decision: d.id, ends: [], started: false, guards: [] });
      pending = [];
      continue;
    }
    m = /^case\s*\((.*)\)$/u.exec(t);
    if (m) {
      const frame = stack.at(-1);
      if (frame?.kind !== 'switch') { problems.malformed(line, '"case" outside a switch'); continue; }
      const g = guardOf(m[1]);
      if (!needGuard(g, line)) continue;
      if (frame.started) frame.ends.push(...(pending ?? []));
      frame.started = true;
      frame.guards.push(g);
      pending = [{ from: frame.decision, guard: g }];
      continue;
    }
    if (t === 'endswitch') { close('switch', line); continue; }
    if (t === 'fork') {
      const f = node('fork', line);
      if (!f) continue;
      stack.push({ kind: 'fork', line, fork: f.id, ends: [] });
      continue;
    }
    if (t === 'fork again') {
      const frame = stack.at(-1);
      if (frame?.kind !== 'fork') { problems.malformed(line, '"fork again" outside a fork'); continue; }
      frame.ends.push(...(pending ?? []));
      pending = [{ from: frame.fork }];
      continue;
    }
    if (t === 'end fork' || t === 'endfork') { close('fork', line); continue; }
    if (/^(?:end merge|split|split again|end split|detach|kill|break|goto|label)\b/u.test(t)) { problems.unsupported(line, `"${t.split(/\s/u)[0]}" has no counterpart in the activity model`); continue; }
    m = /^while\s*\((.*?)\)\s*(?:is\s*\((.*)\))?$/u.exec(t);
    if (m) {
      if (m[1]!.trim()) { problems.unsupported(line, 'a loop decision has no question text in the model; write "while () is ([guard])"'); continue; }
      const g = guardOf(m[2]);
      if (!needGuard(g, line)) continue;
      const merge = node('merge', line);
      if (!merge) continue;
      const d = node('decision', line)!;
      stack.push({ kind: 'while', line, merge: merge.id, decision: d.id });
      pending = [{ from: d.id, guard: g }];
      continue;
    }
    m = /^endwhile\s*(?:\((.*)\))?$/u.exec(t);
    if (m) {
      const frame = stack.pop();
      if (frame?.kind !== 'while') { problems.malformed(line, '"endwhile" without a while'); if (frame) stack.push(frame); continue; }
      const g = guardOf(m[1]);
      if (!needGuard(g, line)) continue;
      for (const e of pending ?? []) connect(e, frame.merge);
      pending = [{ from: frame.decision, guard: g }];
      continue;
    }
    if (t === 'repeat') {
      const merge = node('merge', line);
      if (merge) stack.push({ kind: 'repeat', line, merge: merge.id });
      continue;
    }
    m = /^repeat\s+while\s*\((.*?)\)\s*(?:is\s*\((.*?)\))?\s*(?:not\s*\((.*)\))?$/u.exec(t);
    if (m) {
      const frame = stack.pop();
      if (frame?.kind !== 'repeat') { problems.malformed(line, '"repeat while" without a repeat'); if (frame) stack.push(frame); continue; }
      if (m[1]!.trim()) { problems.unsupported(line, 'a loop decision has no question text in the model; write "repeat while () is ([guard]) not ([guard])"'); continue; }
      const back = guardOf(m[2]), exit = guardOf(m[3]);
      if (!needGuard(back, line) || !needGuard(exit, line)) continue;
      const d = node('decision', line);
      if (!d) continue;
      if (frame.backward !== undefined) { connect({ from: d.id, guard: back }, frame.backward); connect({ from: frame.backward }, frame.merge); }
      else connect({ from: d.id, guard: back }, frame.merge);
      pending = [{ from: d.id, guard: exit }];
      continue;
    }
    if (/^-+>/u.test(t)) { problems.unsupported(line, 'arrow labels and styles are not read; guards go on if/else/case/while branches'); continue; }
    problems.unsupported(line, 'not an activity statement this importer understands (start, stop, end, actions, if/else, switch/case, fork, while, repeat, swimlanes, notes)');
  }
  if (note) problems.malformed(note.line, 'the note is not closed with "end note"');
  if (action) problems.malformed(action.line, 'the action is not closed with ";"');
  for (const frame of stack) problems.malformed(frame.line, `the ${frame.kind} block is not closed`);
  if (pending === undefined && !problems.list.length) problems.malformed(lines[0] ?? { number: 1, text: '' }, 'the flow must begin with "start"');

  function finishNote(): void {
    note!.node.note = note!.text.join(' ');
    note = undefined;
  }

  function close(kind: 'if' | 'switch' | 'fork', line: SourceLine): void {
    const frame = stack.at(-1);
    if (frame?.kind !== kind) { problems.malformed(line, `"${line.text}" does not close an open ${kind}`); return; }
    stack.pop();
    const ends = [...frame.ends, ...(pending ?? [])];
    if (kind === 'fork') {
      const join = { id: ids.fresh('join'), type: 'join' } as ActivityNode;
      nodes.push(join);
      for (const e of ends) connect(e, join.id);
      pending = [{ from: join.id }];
      lastExecutable = undefined;
      return;
    }
    // Two or more branches that continue meet at a merge node; one continues on its own.
    if (ends.length >= 2) {
      const merge = { id: ids.fresh('merge'), type: 'merge' } as ActivityNode;
      nodes.push(merge);
      for (const e of ends) connect(e, merge.id);
      pending = [{ from: merge.id }];
    } else pending = ends;
    lastExecutable = undefined;
    // An empty branch's flow is drawn only now: keep the flows leaving the decision in branch order.
    const decision = (frame as { decision: string; guards: string[] });
    const leaving = edges.filter(e => e.from === decision.decision).sort((a, b) => decision.guards.indexOf(a.guard!) - decision.guards.indexOf(b.guard!));
    let k = 0;
    edges.forEach((e, i) => { if (e.from === decision.decision) edges[i] = leaving[k++]!; });
  }

  const model: Record<string, unknown> = { kind: 'activity' };
  if (title !== undefined) model.title = title;
  if (partitions.length) model.partitions = partitions;
  model.nodes = nodes;
  model.edges = edges;
  return model;
}

export function detectActivity(lines: readonly SourceLine[]): number {
  let score = 0;
  for (const { text } of lines) {
    if (/^(?:start|stop|endif|endwhile|end fork|fork again|endswitch|repeat)$/u.test(text) || /^:.*;/u.test(text) || /^if\s*\(.*\)\s*then\b/u.test(text) || /^\|[^|]+\|$/u.test(text)) score += 3;
  }
  return score;
}

export const plantumlActivity: KindFormat<ActivityDiagram> = { kind: 'activity', export: exportActivity, import: importActivity, detect: detectActivity };
