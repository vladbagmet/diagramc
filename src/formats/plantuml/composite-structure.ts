import type { CompositeStructureDiagram, ConnectorEnd, Part, Port } from '../../kinds/composite-structure/model.js';
import type { KindFormat, Losses } from '../types.js';
import { document, encode, plantumlAliases, quoted, stereotypeText } from './text.js';

/**
 * Composite structure diagram -> PlantUML component diagram (export only).
 * PlantUML has no composite structure diagram; its nesting rectangles and
 * ports carry the same structure: a structured class is a rectangle holding
 * its parts (`name : Type [multiplicity]`, dashed for a reference property)
 * and ports (`name : ~Type` when conjugated), connectors are lines with end
 * labels, a collaboration use is a dashed ellipse with dashed lines to the
 * parts it binds, labelled with the role.
 */

const typed = (name: string | undefined, type: string | undefined, multiplicity: string | undefined, conjugated = false): string =>
  `${name ?? ''}${type === undefined ? '' : `${name === undefined ? '' : ' '}: ${conjugated ? '~' : ''}${type}`}${multiplicity === undefined ? '' : ` [${multiplicity}]`}` ||
  ' ';

const endLabel = (end: ConnectorEnd | undefined): string => {
  const text = [end?.role, end?.multiplicity].filter((t): t is string => t !== undefined).join(' ');
  return text ? ` ${quoted(text)}` : '';
};

export function exportCompositeStructure(model: CompositeStructureDiagram, losses: Losses): string {
  const ids = plantumlAliases();
  const lines: string[] = [];
  const bindings: string[] = [];
  const roleNames = new Map<string, string>();
  for (const e of model.elements) if (e.type === 'collaboration') for (const r of e.roles) roleNames.set(r.id, r.name);
  const ports = (list: readonly Port[] | undefined, indent: string): void => {
    for (const p of list ?? []) lines.push(`${indent}port ${quoted(typed(p.name, p.type, p.multiplicity, p.conjugated))} as ${ids.get(p.id)}`);
  };
  const part = (p: Part, indent: string): void => {
    const head = `${indent}rectangle ${quoted(typed(p.name, p.type, p.multiplicity))} as ${ids.get(p.id)}${p.aggregation === 'shared' || p.aggregation === 'none' ? ' #line.dashed' : ''}`;
    if (!p.ports?.length && !p.parts?.length) {
      lines.push(head);
      return;
    }
    lines.push(`${head} {`);
    ports(p.ports, `${indent}  `);
    for (const child of p.parts ?? []) part(child, `${indent}  `);
    lines.push(`${indent}}`);
  };
  for (const [i, e] of model.elements.entries()) {
    const alias = ids.get(e.id);
    if (e.type === 'note') {
      lines.push(`note ${quoted(e.text)} as ${alias}`);
      continue;
    }
    if (e.type === 'collaboration') {
      losses.add(`/elements/${i}`, 'A collaboration is drawn as a dashed rectangle holding its roles, not as a dashed ellipse');
      lines.push(`rectangle ${quoted(e.name)} as ${alias} <<collaboration>> #line.dashed {`);
      for (const r of e.roles) lines.push(`  rectangle ${quoted(typed(r.name, r.type, r.multiplicity))} as ${ids.get(r.id)}`);
      lines.push('}');
      continue;
    }
    lines.push(`rectangle ${quoted(e.name)} as ${alias}${stereotypeText(e.stereotypes)} {`);
    ports(e.ports, '  ');
    for (const p of e.parts ?? []) part(p, '  ');
    for (const u of e.collaborationUses ?? []) {
      const collaboration = model.elements.find(c => c.id === u.collaboration);
      const name = collaboration?.type === 'collaboration' ? collaboration.name : u.collaboration;
      lines.push(`  usecase ${quoted(`${u.name} : ${name}`)} as ${ids.get(u.id)} #line.dashed`);
      for (const b of u.bindings ?? []) bindings.push(`${ids.get(u.id)} .. ${ids.get(b.part)} : ${encode(roleNames.get(b.role) ?? b.role, '<>«»')}`);
    }
    lines.push('}');
  }
  lines.push(...bindings);
  for (const r of model.relationships ?? []) {
    const from = ids.get(r.from),
      to = ids.get(r.to);
    if (r.type === 'connector') {
      const label = r.association === undefined ? r.name : `${r.name === undefined ? '' : `${r.name} `}: ${r.association}`;
      lines.push(`${from}${endLabel(r.fromEnd)} --${endLabel(r.toEnd)} ${to}${label === undefined ? '' : ` : ${encode(label, '<>«»')}`}`);
    } else {
      const label = [r.keyword === undefined ? undefined : `<<${encode(r.keyword, '<>,')}>>`, r.name === undefined ? undefined : encode(r.name, '<>«»')]
        .filter(t => t !== undefined)
        .join(' ');
      lines.push(`${from} ..> ${to}${label ? ` : ${label}` : ''}`);
    }
  }
  for (const e of model.elements) if (e.type === 'note') for (const target of e.attachedTo ?? []) lines.push(`${ids.get(e.id)} .. ${ids.get(target)}`);
  return document(model.title, lines);
}

export const plantumlCompositeStructure: KindFormat<CompositeStructureDiagram> = { kind: 'composite-structure', export: exportCompositeStructure };
