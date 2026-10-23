import type { Behavior, ConnectionPoint, Element, PseudostateType, Region, State, StateMachineDiagram, Transition, Vertex } from '../../kinds/state-machine/model.js';
import { isNote, isState } from '../../kinds/state-machine/model.js';
import { IdMaker, compact } from '../common.js';
import type { KindFormat, Losses, Problems, SourceLine } from '../types.js';
import { STEREOTYPE, decode, document, encode, plantumlAliases, quoted, titleOf } from './text.js';

/**
 * State machine <-> PlantUML state diagram. Every vertex keeps its ID as the
 * alias: pseudostates are declared with PlantUML's stereotypes (`<<start>>`,
 * `<<choice>>`, `<<history*>>`, ...), composite states nest their regions in
 * braces separated by `--`, and all transitions follow the declarations at the
 * top level, labelled `trigger [guard] / effect`.
 */

const PSEUDO: Record<PseudostateType, string> = {
  initial: 'start', final: 'end', choice: 'choice', junction: 'junction', fork: 'fork', join: 'join',
  shallowHistory: 'history', deepHistory: 'history*', terminate: 'terminate',
};
const PSEUDO_BACK = new Map(Object.entries(PSEUDO).map(([k, v]) => [v, k as PseudostateType]));

/** `trigger [guard] / effect`, each part encoded so the separators stay unambiguous. */
export function behaviorText(b: { trigger?: string | undefined; guard?: string | undefined; effect?: string | undefined }): string {
  return [
    b.trigger === undefined ? undefined : encode(b.trigger, '[]/'),
    b.guard === undefined ? undefined : `[${encode(b.guard, '[]')}]`,
    b.effect === undefined ? undefined : `/ ${encode(b.effect)}`,
  ].filter(p => p !== undefined).join(' ');
}

/** Inverse of behaviorText; undefined when the text is not of that form. */
export function parseBehavior(text: string): { trigger?: string; guard?: string; effect?: string } | undefined {
  const m = /^([^[\]/]*?)\s*(?:\[([^\]]*)\])?\s*(?:\/\s*(.*))?$/u.exec(text.trim());
  if (!m) return undefined;
  return compact({ trigger: m[1] ? decode(m[1]) : undefined, guard: m[2] === undefined ? undefined : decode(m[2].trim()), effect: m[3] === undefined ? undefined : decode(m[3].trim()) });
}

export function exportStateMachine(model: StateMachineDiagram, losses: Losses): string {
  const ids = plantumlAliases();
  const lines: string[] = [];
  // PlantUML keeps the second and later orthogonal regions of a composite state
  // closed: their vertices can only be connected inside the region. So every
  // transition and attached note is written in the innermost region that holds
  // its vertices, and a transition that leaves such a region cannot be written.
  const chains = new Map<string, string[]>();
  const index = (elements: readonly Element[], chain: string[]): void => {
    for (const e of elements) {
      if (isNote(e)) continue;
      chains.set(e.id, chain);
      if (!isState(e)) continue;
      for (const p of e.connectionPoints ?? []) chains.set(p.id, [...chain, `${e.id}#0`]);
      (e.regions ?? []).forEach((r, j) => index(r.elements, [...chain, `${e.id}#${j}`]));
    }
  };
  index(model.elements, []);
  const here = new Map<string, string[]>();
  const put = (key: string, line: string): void => { here.set(key, [...(here.get(key) ?? []), line]); };
  (model.transitions ?? []).forEach((t, i) => {
    if (t.id !== undefined) losses.add(`/transitions/${i}/id`, 'Transition IDs are not kept');
    const a = chains.get(t.from)!, b = chains.get(t.to)!;
    let common = 0;
    while (common < a.length && common < b.length && a[common] === b[common]) common++;
    if ([...a.slice(common), ...b.slice(common)].some(k => !k.endsWith('#0'))) {
      losses.add(`/transitions/${i}`, 'PlantUML cannot draw a transition into or out of a second or later orthogonal region; it is left out');
      return;
    }
    const label = behaviorText(t);
    put(a.slice(0, common).at(-1) ?? '', `${ids.get(t.from)} --> ${ids.get(t.to)}${label ? ` : ${label}` : ''}`);
  });
  model.elements.forEach((e, i) => {
    if (!isNote(e) || !e.attachedTo?.length) return;
    losses.add(`/elements/${i}/id`, 'The ID of an attached note is not kept');
    if (e.attachedTo.length > 1) losses.add(`/elements/${i}/attachedTo`, 'A note attached to several vertices is written once per vertex');
    for (const target of e.attachedTo) put(chains.get(target)!.at(-1) ?? '', `note right of ${ids.get(target)} : ${encode(e.text)}`);
  });
  const flush = (key: string, pad: string): void => { for (const l of here.get(key) ?? []) lines.push(`${pad}${l}`); };

  const declare = (v: Vertex, path: string, pad: string): void => {
    const alias = ids.get(v.id);
    if (!isState(v)) {
      lines.push(`${pad}state ${alias} <<${PSEUDO[v.type]}>>`);
      if (v.type === 'junction' || v.type === 'terminate') losses.add(path, `PlantUML has no ${v.type} symbol: it is written as a state stereotyped <<${PSEUDO[v.type]}>>, which PlantUML draws as a plain box; it reads back as a ${v.type}`);
      return;
    }
    const label = v.submachine === undefined ? encode(v.name, '":') : `${encode(v.name, '":')} : ${encode(v.submachine, '":')}`;
    const head = `${pad}state ${label === alias ? alias : `"${label}" as ${alias}`}`;
    if (!v.connectionPoints?.length && !v.regions?.length) lines.push(head);
    else {
      lines.push(`${head} {`);
      for (const point of v.connectionPoints ?? []) {
        const pa = ids.get(point.id);
        lines.push(`${pad}  state ${point.name === undefined ? pa : `${quoted(point.name)} as ${pa}`} <<${point.type}>>`);
      }
      (v.regions ?? []).forEach((r, j) => {
        if (j > 0) lines.push(`${pad}  --`);
        if (r.id !== undefined) losses.add(`${path}/regions/${j}/id`, 'Region IDs are not kept');
        if (r.name !== undefined) losses.add(`${path}/regions/${j}/name`, 'Region names are not kept');
        r.elements.forEach((e, k) => declare(e, `${path}/regions/${j}/elements/${k}`, `${pad}  `));
        flush(`${v.id}#${j}`, `${pad}  `);
      });
      lines.push(`${pad}}`);
    }
    if (v.entry !== undefined) lines.push(`${pad}${alias} : entry / ${encode(v.entry)}`);
    if (v.doActivity !== undefined) lines.push(`${pad}${alias} : do / ${encode(v.doActivity)}`);
    if (v.exit !== undefined) lines.push(`${pad}${alias} : exit / ${encode(v.exit)}`);
    for (const b of v.internal ?? []) lines.push(`${pad}${alias} : ${internalText(b)}`);
  };
  model.elements.forEach((e, i) => {
    if (!isNote(e)) declare(e, `/elements/${i}`, '');
    else if (!e.attachedTo?.length) lines.push(`note ${quoted(e.text)} as ${ids.get(e.id)}`);
  });
  flush('', '');
  return document(model.title, lines);
}

/** An internal behavior whose trigger reads like entry, do or exit has its first character encoded. */
function internalText(b: Behavior): string {
  const text = behaviorText(b);
  return /^(?:entry|do|exit)\s*\//u.test(text) ? `<U+${b.trigger.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}>${text.slice(1)}` : text;
}

// ---------------------------------------------------------------- import

interface Scope { regions: Region[]; state?: State; line?: SourceLine }

export function importStateMachine(lines: readonly SourceLine[], problems: Problems): Record<string, unknown> {
  const ids = new IdMaker();
  const top: Element[] = [];
  const transitions: Transition[] = [];
  const byKey = new Map<string, Vertex | ConnectionPoint>();
  /** `[*]` per region: one initial and one final, created on first use. */
  const pseudo = new Map<Region | 'top', { initial?: string; final?: string }>();
  const stack: Scope[] = [];
  let title: string | undefined;
  const elementsHere = (): Element[] => stack.at(-1)?.regions.at(-1)?.elements ?? top;

  const add = (v: Vertex, key: string): void => { elementsHere().push(v); byKey.set(key, v); };
  /** States PlantUML created where a transition first named them; a later declaration places and defines them. */
  const implicit = new Map<string, Element[]>();
  /** Removes an implicitly created state so its declaration can take its place; false when the key is declared. */
  const redeclare = (key: string): boolean => {
    const list = implicit.get(key);
    if (!list) return !byKey.has(key);
    list.splice(list.indexOf(byKey.get(key) as Element), 1);
    implicit.delete(key);
    return true;
  };
  const resolve = (written: string, line: SourceLine): string | undefined => {
    if (written === '[*]') return undefined;
    const key = written.startsWith('"') ? decode(written.slice(1, -1)) : written;
    const found = byKey.get(key);
    if (found) return found.id;
    // PlantUML creates an undeclared state where it is first named.
    if (!/^[\p{L}\p{N}_.]+$/u.test(key) && !written.startsWith('"')) { problems.malformed(line, `invalid state name ${JSON.stringify(written)}`); return undefined; }
    const state: State = { id: ids.claim(key) ?? ids.fresh(key), type: 'state', name: key };
    add(state, key);
    implicit.set(key, elementsHere());
    return state.id;
  };
  /** The initial or final pseudostate `[*]` stands for in the current region. */
  const star = (type: 'initial' | 'final'): string => {
    const region = stack.at(-1)?.regions.at(-1) ?? 'top';
    const entry = pseudo.get(region) ?? {};
    pseudo.set(region, entry);
    if (entry[type] === undefined) {
      const id = ids.fresh(type);
      elementsHere().push({ id, type });
      entry[type] = id;
    }
    return entry[type]!;
  };

  for (const line of lines) {
    const t = line.text;
    const heading = titleOf(line);
    if (heading !== undefined) { title = heading; continue; }
    if (t === '}') {
      const scope = stack.pop();
      if (!scope) { problems.malformed(line, 'unmatched "}"'); continue; }
      // A body that only declares connection points has no regions.
      const regions = scope.regions.filter(r => r.elements.length);
      if (!regions.length) delete scope.state!.regions;
      else if (regions.length < scope.regions.length) problems.malformed(line, `a region of "${scope.state!.name}" is empty`);
      continue;
    }
    if (t === '--' || t === '||') {
      const scope = stack.at(-1);
      if (!scope) problems.malformed(line, 'a region separator must be inside a composite state');
      else scope.regions.push({ elements: [] });
      continue;
    }
    let m = new RegExp(String.raw`^state\s+(?:"([^"]*)"\s+as\s+([\p{L}\p{N}_.]+)|([\p{L}\p{N}_.]+)\s+as\s+"([^"]*)"|([\p{L}\p{N}_.]+)|"([^"]*)")\s*(?:${STEREOTYPE})?\s*(\{)?$`, 'u').exec(t);
    if (m) {
      const label = m[1] ?? m[4] ?? m[6];
      const key = m[2] ?? m[3] ?? m[5] ?? decode(m[6]!);
      const stereotype = m[7]?.trim();
      const opens = m[8] === '{';
      const earlier = implicit.has(key) ? byKey.get(key)!.id : undefined;
      if (!redeclare(key)) { problems.malformed(line, `"${key}" is declared twice`); continue; }
      const id = earlier ?? ids.claim(key) ?? ids.fresh(key);
      if (stereotype === 'entryPoint' || stereotype === 'exitPoint') {
        const owner = stack.at(-1)?.state;
        if (!owner || opens) { problems.malformed(line, `an ${stereotype} is declared directly inside its composite state`); continue; }
        const point: ConnectionPoint = { id, type: stereotype, ...(label === undefined ? {} : { name: decode(label) }) };
        (owner.connectionPoints ??= []).push(point);
        byKey.set(key, point);
        continue;
      }
      if (stereotype !== undefined) {
        const type = PSEUDO_BACK.get(stereotype);
        if (!type) { problems.unsupported(line, `the stereotype <<${stereotype}>> is not a pseudostate of the model (start, end, choice, junction, fork, join, history, history*, terminate, entryPoint, exitPoint)`); continue; }
        if (opens || label !== undefined) { problems.malformed(line, `a <<${stereotype}>> pseudostate has no name or body`); continue; }
        add({ id, type }, key);
        continue;
      }
      const text = label ?? key;
      const sub = /^(.*?)\s:\s(.*)$/u.exec(text);
      const state: State = { id, type: 'state', name: decode((sub ? sub[1]! : text).trim()) };
      if (sub) state.submachine = decode(sub[2]!.trim());
      add(state, key);
      if (opens) {
        state.regions = [{ elements: [] }];
        stack.push({ regions: state.regions, state, line });
      }
      continue;
    }
    m = /^state\s+([\p{L}\p{N}_.]+)\s*:\s*(.*)$/u.exec(t);
    if (m) {
      if (!byKey.has(m[1]!)) resolve(m[1]!, line);
      describe(m[1]!, m[2]!, line);
      continue;
    }
    if (/^state\b/u.test(t)) { problems.unsupported(line, 'expected "state Name", "state \\"Display\\" as alias" with an optional pseudostate stereotype and "{"; colors and other options are not imported'); continue; }
    m = /^(\[\*\]|\[H\*?\]|"[^"]*"|[\p{L}\p{N}_.]+)\s*-+(?:(?:up|down|left|right|u|d|l|r)-+)?>\s*(\[\*\]|\[H\*?\]|"[^"]*"|[\p{L}\p{N}_.]+)\s*(?::\s*(.*))?$/u.exec(t);
    if (m) {
      if (/^\[H/u.test(m[1]!) || /^\[H/u.test(m[2]!)) { problems.unsupported(line, 'write history pseudostates as "state h <<history>>" (or <<history*>>) so they have an ID'); continue; }
      const from = m[1] === '[*]' ? star('initial') : resolve(m[1]!, line);
      const to = m[2] === '[*]' ? star('final') : resolve(m[2]!, line);
      if (from === undefined || to === undefined) continue;
      const label = m[3] === undefined ? {} : parseBehavior(m[3]);
      if (!label) { problems.malformed(line, 'expected a transition label "trigger [guard] / effect"'); continue; }
      transitions.push({ from, to, ...label });
      continue;
    }
    m = /^(?:note\s+(left|right|top|bottom)\s+of\s+("[^"]*"|[\p{L}\p{N}_.]+)\s*:\s*(.+)|note\s+"([^"]*)"\s+as\s+([\p{L}\p{N}_.]+))$/u.exec(t);
    if (m) {
      if (m[5] !== undefined && stack.length) { problems.unsupported(line, 'floating notes are read at the top level only'); continue; }
      if (m[5] !== undefined) { top.push({ id: ids.claim(m[5]) ?? ids.fresh('note'), type: 'note', text: decode(m[4]!) }); continue; }
      const target = resolve(m[2]!, line);
      if (target === undefined) continue;
      top.push({ id: ids.fresh('note'), type: 'note', text: decode(m[3]!.trim()), attachedTo: [target] });
      continue;
    }
    if (/^note\b/u.test(t)) { problems.unsupported(line, 'only one-line notes are read: "note right of State : text" or "note \\"text\\" as N"'); continue; }
    m = /^("[^"]*"|[\p{L}\p{N}_.]+)\s*:\s*(.*)$/u.exec(t);
    if (m) {
      describe(m[1]!.startsWith('"') ? decode(m[1]!.slice(1, -1)) : m[1]!, m[2]!, line);
      continue;
    }
    problems.unsupported(line, 'not a state diagram statement this importer understands (states, pseudostates, transitions, behaviors, notes)');
  }
  for (const scope of stack) problems.malformed(scope.line!, 'the composite state is not closed with "}"');

  /** A state description line: entry, do or exit behavior, or an internal transition. */
  function describe(key: string, text: string, line: SourceLine): void {
    const target = byKey.get(key);
    if (!target || !isState(target as Element)) { problems.malformed(line, `"${key}" is not a declared state`); return; }
    const state = target as State;
    const special = /^(entry|do|exit)\s*\/\s*(.*)$/u.exec(text.trim());
    if (special) {
      const slot = special[1] === 'do' ? 'doActivity' : special[1] as 'entry' | 'exit';
      if (state[slot] !== undefined) { problems.malformed(line, `"${key}" already has a ${special[1]} behavior`); return; }
      state[slot] = decode(special[2]!.trim());
      return;
    }
    const b = parseBehavior(text);
    if (!b || b.trigger === undefined) { problems.unsupported(line, 'a state description must be "entry / x", "do / x", "exit / x" or an internal transition "trigger [guard] / effect"; free text is not part of the model'); return; }
    (state.internal ??= []).push(b as Behavior);
  }

  const model: Record<string, unknown> = { kind: 'state-machine' };
  if (title !== undefined) model.title = title;
  model.elements = top;
  if (transitions.length) model.transitions = transitions;
  return model;
}

export function detectStateMachine(lines: readonly SourceLine[]): number {
  let score = 0;
  for (const { text } of lines) {
    if (/^state\s/u.test(text) || /\[\*\]/u.test(text)) score += 3;
    else if (/^\S+\s*:\s*(?:entry|do|exit)\s*\//u.test(text)) score += 2;
  }
  return score;
}

export const plantumlStateMachine: KindFormat<StateMachineDiagram> = { kind: 'state-machine', export: exportStateMachine, import: importStateMachine, detect: detectStateMachine };
