import type { ComponentDiagram, Element, Port } from '../../kinds/component/model.js';
import type { KindFormat, Losses } from '../types.js';
import { document, encode, plantumlAliases, quoted, stereotypeText } from './text.js';

/**
 * Component diagram -> PlantUML component diagram (export only). Components
 * and their ports and parts nest as in the model (a class part is a
 * rectangle marked <<class>>); a provided interface is a line to the
 * interface circle (lollipop), a required one a socket (`--(`); an assembly
 * is a ball-and-socket connector (`-(0-`) labelled with its interface.
 */

const portLabel = (p: Port): string => p.type === undefined ? p.name ?? ' ' : `${p.name ?? ''} : ${p.type}`;

export function exportComponent(model: ComponentDiagram, losses: Losses): string {
  const ids = plantumlAliases();
  const lines: string[] = [];
  const wires: string[] = [];
  const names = new Map<string, string>();
  const offers = (owner: string, provides: readonly string[] | undefined, requires: readonly string[] | undefined): void => {
    for (const i of provides ?? []) wires.push(`${ids.get(owner)} -- ${ids.get(i)}`);
    for (const i of requires ?? []) wires.push(`${ids.get(owner)} --( ${ids.get(i)}`);
  };
  const emit = (e: Element, path: string, indent: string): void => {
    const alias = ids.get(e.id);
    switch (e.type) {
      case 'note': lines.push(`${indent}note ${quoted(e.text)} as ${alias}`); return;
      case 'interface':
        names.set(e.id, e.name);
        lines.push(`${indent}interface ${quoted(e.name)} as ${alias}${stereotypeText(e.stereotypes)}`);
        if (e.operations?.length) losses.add(`${path}/operations`, 'The operations of an interface are not shown on its circle');
        return;
      case 'artifact': lines.push(`${indent}artifact ${quoted(e.name)} as ${alias}${stereotypeText(e.stereotypes)}`); return;
      case 'component': case 'class': {
        const head = e.type === 'component'
          ? `${indent}component ${quoted(e.name)} as ${alias}${stereotypeText(e.stereotypes)}`
          : `${indent}rectangle ${quoted(e.name)} as ${alias}${stereotypeText(['class', ...(e.stereotypes ?? [])])}`;
        const nested = e.type === 'component' ? e.elements ?? [] : [];
        offers(e.id, e.provides, e.requires);
        for (const p of e.ports ?? []) offers(p.id, p.provides, p.requires);
        if (!e.ports?.length && !nested.length) { lines.push(head); return; }
        lines.push(`${head} {`);
        for (const p of e.ports ?? []) lines.push(`${indent}  port ${quoted(portLabel(p))} as ${ids.get(p.id)}`);
        nested.forEach((n, j) => emit(n, `${path}/elements/${j}`, `${indent}  `));
        lines.push(`${indent}}`);
      }
    }
  };
  model.elements.forEach((e, i) => emit(e, `/elements/${i}`, ''));
  lines.push(...wires);
  const label = (parts: (string | undefined)[]): string => {
    const text = parts.filter((p): p is string => p !== undefined).join(' ');
    return text ? ` : ${text}` : '';
  };
  const keyword = (k: string): string => `<<${encode(k, '<>,')}>>`;
  for (const r of model.relationships ?? []) {
    const from = ids.get(r.from), to = ids.get(r.to);
    const name = 'name' in r && r.name !== undefined ? encode(r.name, '<>«»') : undefined;
    switch (r.type) {
      case 'assembly': lines.push(`${from} -(0- ${to}${label([name, encode(names.get(r.interface) ?? r.interface, '<>«»')])}`); break;
      case 'delegation': lines.push(`${from} --> ${to}${label([keyword('delegate'), name])}`); break;
      case 'realization': lines.push(`${from} ..|> ${to}`); break;
      case 'usage': lines.push(`${from} ..> ${to}${label([keyword('use')])}`); break;
      case 'manifest': lines.push(`${from} ..> ${to}${label([keyword('manifest')])}`); break;
      case 'dependency': lines.push(`${from} ..> ${to}${label([r.keyword === undefined ? undefined : keyword(r.keyword), name])}`); break;
    }
  }
  const notes = (list: readonly Element[]): void => {
    for (const e of list) if (e.type === 'note') for (const target of e.attachedTo ?? []) lines.push(`${ids.get(e.id)} .. ${ids.get(target)}`);
  };
  notes(model.elements);
  return document(model.title, lines);
}

export const plantumlComponent: KindFormat<ComponentDiagram> = { kind: 'component', export: exportComponent };
