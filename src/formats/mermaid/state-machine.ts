import type { Behavior, Element, PseudostateType, Region, State, StateMachineDiagram, Transition, Vertex } from '../../kinds/state-machine/model.js';
import { isNote, isState } from '../../kinds/state-machine/model.js';
import { IdMaker, compact } from '../common.js';
import type { KindFormat, Losses, Problems, SourceLine } from '../types.js';
import { PRESENTATION, decode, document, encode, entity, mermaidAliases, titleOf } from './text.js';

/**
 * State machine <-> Mermaid stateDiagram-v2. States keep their ID; choice,
 * fork and join are Mermaid stereotypes; initial and final pseudostates are
 * `[*]`, one of each per region (Mermaid gives them no ID). Mermaid draws a
 * transition only between vertices of one region, so each transition is
 * written in its region and one that crosses a composite state's border is
 * reported as a loss.
 */

const STEREO: Partial<Record<PseudostateType, string>> = { choice: 'choice', fork: 'fork', join: 'join', junction: 'choice' };

/** `trigger [guard] / effect`, each part encoded so the separators stay unambiguous. */
function behaviorText(b: { trigger?: string | undefined; guard?: string | undefined; effect?: string | undefined }): string {
  return [
    b.trigger === undefined ? undefined : encode(b.trigger, '[]/:'),
    b.guard === undefined ? undefined : `[${encode(b.guard, '[]:')}]`,
    b.effect === undefined ? undefined : `/ ${encode(b.effect, ':')}`,
  ].filter(p => p !== undefined).join(' ');
}

function parseBehavior(text: string): { trigger?: string; guard?: string; effect?: string } | undefined {
  const m = /^([^[\]/]*?)\s*(?:\[([^\]]*)\])?\s*(?:\/\s*(.*))?$/u.exec(text.trim());
  if (!m) return undefined;
  return compact({ trigger: m[1] ? decode(m[1]) : undefined, guard: m[2] === undefined ? undefined : decode(m[2].trim()), effect: m[3] === undefined ? undefined : decode(m[3].trim()) });
}

export function exportStateMachine(model: StateMachineDiagram, losses: Losses): string {
  const ids = mermaidAliases();
  const lines: string[] = [];
  // Region of every vertex ("" top level, "state#index" nested), and the region a `[*]` stands in.
  const regionOf = new Map<string, string>();
  const pathOf = new Map<string, string>();
  const index = (elements: readonly Element[], key: string, base: string): void => {
    elements.forEach((e, i) => {
      if (isNote(e)) return;
      regionOf.set(e.id, key);
      pathOf.set(e.id, `${base}/${i}`);
      if (!isState(e)) return;
      (e.connectionPoints ?? []).forEach((p, j) => { regionOf.set(p.id, `${e.id}#0`); pathOf.set(p.id, `${base}/${i}/connectionPoints/${j}`); });
      (e.regions ?? []).forEach((r, j) => index(r.elements, `${e.id}#${j}`, `${base}/${i}/regions/${j}/elements`));
    });
  };
  index(model.elements, '', '/elements');
  const vertices = new Map<string, Vertex>();
  const collect = (elements: readonly Element[]): void => { for (const e of elements) if (!isNote(e)) { vertices.set(e.id, e); if (isState(e)) for (const r of e.regions ?? []) collect(r.elements); } };
  collect(model.elements);
  const ref = (id: string): string => {
    const v = vertices.get(id);
    return v && (v.type === 'initial' || v.type === 'final' || v.type === 'terminate') ? '[*]' : ids.get(id);
  };
  const here = new Map<string, string[]>();
  const put = (key: string, line: string): void => { here.set(key, [...(here.get(key) ?? []), line]); };
  (model.transitions ?? []).forEach((t, i) => {
    if (t.id !== undefined) losses.add(`/transitions/${i}/id`, 'Transition IDs are not kept');
    const a = regionOf.get(t.from)!, b = regionOf.get(t.to)!;
    if (a !== b) { losses.add(`/transitions/${i}`, 'Mermaid cannot draw a transition across the border of a composite state; it is left out'); return; }
    const label = behaviorText(t);
    put(a, `${ref(t.from)} --> ${ref(t.to)}${label ? ` : ${label}` : ''}`);
  });
  model.elements.forEach((e, i) => {
    if (!isNote(e)) return;
    losses.add(`/elements/${i}/id`, 'Notes have no IDs; imported notes get new ones');
    if (!e.attachedTo?.length) { losses.add(`/elements/${i}`, 'Mermaid state diagrams have no floating notes; the note is left out'); return; }
    if (e.attachedTo.length > 1) losses.add(`/elements/${i}/attachedTo`, 'A note attached to several vertices is written once per vertex');
    for (const target of e.attachedTo) {
      if (ref(target) === '[*]') { losses.add(`/elements/${i}/attachedTo`, 'A note on an initial or final state is left out'); continue; }
      put(regionOf.get(target)!, `note right of ${ids.get(target)} : ${encode(e.text, ':')}`);
    }
  });
  const flush = (key: string, pad: string): void => { for (const l of here.get(key) ?? []) lines.push(`${pad}${l}`); };

  const declare = (v: Vertex, pad: string): void => {
    const path = pathOf.get(v.id)!;
    if (!isState(v)) {
      if (v.type === 'initial' || v.type === 'final') { losses.add(`${path}/id`, `The ID of an ${v.type} state is not kept ([*])`); return; }
      if (v.type === 'terminate') { losses.add(path, 'Mermaid has no terminate pseudostate; it is written as a final state ([*])'); return; }
      const stereo = STEREO[v.type];
      if (stereo) {
        if (v.type === 'junction') losses.add(path, 'Mermaid has no junction; it is written as a choice');
        lines.push(`${pad}state ${ids.get(v.id)} <<${stereo}>>`);
        return;
      }
      losses.add(path, `Mermaid has no ${v.type === 'deepHistory' ? 'deep' : 'shallow'} history; it is written as a state named ${v.type === 'deepHistory' ? 'H*' : 'H'}`);
      lines.push(`${pad}state "${v.type === 'deepHistory' ? 'H*' : 'H'}" as ${ids.get(v.id)}`);
      return;
    }
    const alias = ids.get(v.id);
    const label = v.submachine === undefined ? encode(v.name, ':') : `${encode(v.name, ':')} : ${encode(v.submachine, ':')}`;
    lines.push(`${pad}state ${label === alias ? alias : `"${label}" as ${alias}`}`);
    if (v.connectionPoints?.length || v.regions?.length) {
      lines.push(`${pad}state ${alias} {`);
      (v.connectionPoints ?? []).forEach((p, j) => {
        losses.add(`${path}/connectionPoints/${j}`, `Mermaid has no ${p.type === 'entryPoint' ? 'entry' : 'exit'} points; it is written as a state inside the composite state`);
        lines.push(`${pad}  state ${p.name === undefined ? ids.get(p.id) : `"${encode(p.name, ':')}" as ${ids.get(p.id)}`}`);
      });
      (v.regions ?? []).forEach((r, j) => {
        if (j > 0) lines.push(`${pad}  --`);
        if (r.id !== undefined) losses.add(`${path}/regions/${j}/id`, 'Region IDs are not kept');
        if (r.name !== undefined) losses.add(`${path}/regions/${j}/name`, 'Region names are not kept');
        for (const e of r.elements) declare(e, `${pad}  `);
        flush(`${v.id}#${j}`, `${pad}  `);
      });
      if (!v.regions?.length) flush(`${v.id}#0`, `${pad}  `);
      lines.push(`${pad}}`);
    }
    const describe = (text: string): void => { lines.push(`${pad}${alias} : ${text}`); };
    if (v.entry !== undefined) describe(`entry / ${encode(v.entry, ':')}`);
    if (v.doActivity !== undefined) describe(`do / ${encode(v.doActivity, ':')}`);
    if (v.exit !== undefined) describe(`exit / ${encode(v.exit, ':')}`);
    for (const b of v.internal ?? []) {
      const text = behaviorText(b);
      describe(/^(?:entry|do|exit)\s*\//u.test(text) ? entity(text[0]!) + text.slice(1) : text);
    }
  };
  for (const e of model.elements) if (!isNote(e)) declare(e, '');
  flush('', '');
  return document(model.title, 'stateDiagram-v2', lines);
}

// ---------------------------------------------------------------- import

const ID = String.raw`[A-Za-z0-9_]+`;
interface Scope { state: State; line: SourceLine }

export function importStateMachine(lines: readonly SourceLine[], problems: Problems): Record<string, unknown> {
  const ids = new IdMaker();
  const top: Element[] = [];
  const transitions: Transition[] = [];
  const byKey = new Map<string, Vertex>();
  const stack: Scope[] = [];
  const stars = new Map<Region | 'top', { initial?: string; final?: string }>();
  let title: string | undefined;
  let note: { line: SourceLine; target: string; text: string[] } | undefined;
  const region = (): Region | undefined => stack.at(-1)?.state.regions?.at(-1);
  const here = (): Element[] => region()?.elements ?? top;
  const add = (v: Vertex, key: string): void => { here().push(v); byKey.set(key, v); };
  const resolve = (key: string): string => {
    const known = byKey.get(key);
    if (known) return known.id;
    const s: State = { id: ids.claim(key) ?? ids.fresh(key), type: 'state', name: key };
    add(s, key);
    return s.id;
  };
  const star = (type: 'initial' | 'final'): string => {
    const r = region() ?? 'top';
    const entry = stars.get(r) ?? {};
    stars.set(r, entry);
    if (entry[type] === undefined) { entry[type] = ids.fresh(type); here().push({ id: entry[type]!, type }); }
    return entry[type]!;
  };

  for (const line of lines.slice(1)) {
    const t = line.text;
    if (note) {
      if (/^end\s?note$/u.test(t)) { top.push({ id: ids.fresh('note'), type: 'note', text: note.text.join(' '), attachedTo: [note.target] }); note = undefined; }
      else note.text.push(decode(t));
      continue;
    }
    const heading = titleOf(line);
    if (heading !== undefined) { title = heading; continue; }
    if (PRESENTATION.test(t) || /^class\s/u.test(t)) continue;
    if (t === '}') {
      const scope = stack.pop();
      if (!scope) { problems.malformed(line, 'unmatched "}"'); continue; }
      const regions = scope.state.regions!.filter(r => r.elements.length);
      if (!regions.length) delete scope.state.regions;
      else if (regions.length < scope.state.regions!.length) problems.malformed(line, `a region of "${scope.state.name}" is empty`);
      continue;
    }
    if (t === '--') {
      const scope = stack.at(-1);
      if (!scope) problems.malformed(line, 'a region separator must be inside a composite state');
      else scope.state.regions!.push({ elements: [] });
      continue;
    }
    let m = new RegExp(String.raw`^state\s+(?:"([^"]*)"\s+as\s+(${ID})|(${ID}))\s*(?:<<(\w+)>>)?\s*(\{)?$`, 'u').exec(t);
    if (m) {
      const key = m[2] ?? m[3]!;
      const stereo = m[4];
      const existing = byKey.get(key);
      if (m[5] && !m[1] && !stereo && existing && isState(existing as Element)) {
        // `state id {` after `state "Label" as id`: the body of a declared state.
        const s = existing as State;
        if (s.regions) { problems.malformed(line, `"${key}" already has a body`); continue; }
        s.regions = [{ elements: [] }];
        stack.push({ state: s, line });
        continue;
      }
      if (existing) { problems.malformed(line, `"${key}" is declared twice`); continue; }
      const id = ids.claim(key) ?? ids.fresh(key);
      if (stereo !== undefined) {
        if (!['choice', 'fork', 'join'].includes(stereo) || m[5] || m[1]) { problems.unsupported(line, `<<${stereo}>> is not read (choice, fork and join have no label or body)`); continue; }
        add({ id, type: stereo as PseudostateType }, key);
        continue;
      }
      const label = m[1] === undefined ? key : m[1];
      const sub = /^(.*?)\s:\s(.*)$/u.exec(label);
      const s: State = { id, type: 'state', name: decode((sub ? sub[1]! : label).trim()) };
      if (sub) s.submachine = decode(sub[2]!.trim());
      add(s, key);
      if (m[5]) { s.regions = [{ elements: [] }]; stack.push({ state: s, line }); }
      continue;
    }
    if (/^state\b/u.test(t)) { problems.unsupported(line, 'expected "state Id", "state \\"Label\\" as Id" or "state Id <<choice|fork|join>>", optionally with "{"'); continue; }
    m = new RegExp(String.raw`^(\[\*\]|${ID})\s*-->\s*(\[\*\]|${ID})\s*(?::\s*(.*))?$`, 'u').exec(t);
    if (m) {
      const from = m[1] === '[*]' ? star('initial') : resolve(m[1]!);
      const to = m[2] === '[*]' ? star('final') : resolve(m[2]!);
      const label = m[3] === undefined ? {} : parseBehavior(m[3]);
      if (!label) { problems.malformed(line, 'expected a transition label "trigger [guard] / effect"'); continue; }
      transitions.push({ from, to, ...label });
      continue;
    }
    m = new RegExp(String.raw`^note\s+(?:left|right)\s+of\s+(${ID})\s*(?::\s*(.*))?$`, 'u').exec(t);
    if (m) {
      const target = resolve(m[1]!);
      if (m[2] === undefined) note = { line, target, text: [] };
      else top.push({ id: ids.fresh('note'), type: 'note', text: decode(m[2].trim()), attachedTo: [target] });
      continue;
    }
    if (/^note\b/u.test(t)) { problems.unsupported(line, 'only notes beside a state are read ("note right of Id : text")'); continue; }
    m = new RegExp(String.raw`^(${ID})\s*:\s*(.*)$`, 'u').exec(t);
    if (m) {
      const target = byKey.get(m[1]!);
      if (!target || !isState(target as Element)) { problems.malformed(line, `"${m[1]}" is not a declared state`); continue; }
      const state = target as State;
      const text = m[2]!.trim();
      const special = /^(entry|do|exit)\s*\/\s*(.*)$/u.exec(text);
      if (special) {
        const k = special[1] === 'do' ? 'doActivity' : special[1] as 'entry' | 'exit';
        if (state[k] !== undefined) { problems.malformed(line, `"${m[1]}" already has a ${special[1]} behavior`); continue; }
        state[k] = decode(special[2]!.trim());
        continue;
      }
      const b = parseBehavior(text);
      if (!b || b.trigger === undefined) { problems.unsupported(line, 'a state description must be "entry / x", "do / x", "exit / x" or an internal transition "trigger [guard] / effect"; free text is not part of the model'); continue; }
      (state.internal ??= []).push(b as Behavior);
      continue;
    }
    problems.unsupported(line, 'not a stateDiagram statement this importer understands (states, choice/fork/join, [*], transitions, descriptions, notes)');
  }
  for (const scope of stack) problems.malformed(scope.line, 'the composite state is not closed with "}"');
  if (note) problems.malformed(note.line, 'the note is not closed with "end note"');

  const model: Record<string, unknown> = { kind: 'state-machine' };
  if (title !== undefined) model.title = title;
  model.elements = top;
  if (transitions.length) model.transitions = transitions;
  return model;
}

export const detectStateMachine = (lines: readonly SourceLine[]): number => /^stateDiagram(?:-v2)?$/u.test(lines[0]?.text ?? '') ? 1 : 0;

export const mermaidStateMachine: KindFormat<StateMachineDiagram> = { kind: 'state-machine', export: exportStateMachine, import: importStateMachine, detect: detectStateMachine };
