import type { Element, PackageDiagram } from '../../kinds/package/model.js';
import { isNote, isPackage } from '../../kinds/package/model.js';
import type { KindFormat, Losses } from '../types.js';
import { document, encode, plantumlAliases, quoted, stereotypeText } from './text.js';

/**
 * Package diagram -> PlantUML class diagram with packages (export only).
 * Members are written inside their package block; import, access and merge
 * are dashed arrows with their keyword, containment is the `+--` circle-plus.
 */

const KEYWORD = { import: 'import', access: 'access', merge: 'merge', dependency: undefined, containment: undefined } as const;

export function exportPackage(model: PackageDiagram, _losses: Losses): string {
  const ids = plantumlAliases();
  const lines: string[] = [];
  const owner = new Map<string, string>();
  for (const e of model.elements) if (isPackage(e)) for (const m of e.members ?? []) owner.set(m, e.id);
  const byId = new Map(model.elements.map(e => [e.id, e]));
  const emit = (e: Element, indent: string): void => {
    const alias = ids.get(e.id);
    if (isNote(e)) { lines.push(`${indent}note ${quoted(e.text)} as ${alias}`); return; }
    if (isPackage(e)) {
      lines.push(`${indent}package ${quoted(e.name)} as ${alias}${stereotypeText(e.stereotypes)} {`);
      for (const m of e.members ?? []) { const member = byId.get(m); if (member) emit(member, `${indent}  `); }
      lines.push(`${indent}}`);
      return;
    }
    const keyword = e.type === 'interface' ? 'interface' : e.type === 'enumeration' ? 'enum' : e.abstract ? 'abstract class' : 'class';
    const stereotypes = [...(e.type === 'datatype' ? ['dataType'] : []), ...(e.stereotypes ?? [])];
    lines.push(`${indent}${keyword} ${quoted(e.name)} as ${alias}${stereotypeText(stereotypes)}`);
  };
  for (const e of model.elements) if (!owner.has(e.id)) emit(e, '');
  for (const r of model.relationships ?? []) {
    const arrow = r.type === 'containment' ? '+--' : '..>';
    const keywords = [KEYWORD[r.type], r.keyword].filter((k): k is string => k !== undefined);
    const label = [...keywords.map(k => `<<${encode(k, '<>,')}>>`), ...(r.name === undefined ? [] : [encode(r.name, '<>«»')])].join(' ');
    lines.push(`${ids.get(r.from)} ${arrow} ${ids.get(r.to)}${label ? ` : ${label}` : ''}`);
  }
  for (const e of model.elements) if (isNote(e)) for (const target of e.attachedTo ?? []) lines.push(`${ids.get(e.id)} .. ${ids.get(target)}`);
  return document(model.title, lines);
}

export const plantumlPackage: KindFormat<PackageDiagram> = { kind: 'package', export: exportPackage };
