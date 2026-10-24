import type { Instance, Link, LinkEnd, ObjectDiagram } from '../../kinds/object/model.js';
import { isNote } from '../../kinds/object/model.js';
import type { KindFormat, Losses } from '../types.js';
import { document, encode, plantumlAliases, quoted, stereotypeText } from './text.js';

/**
 * Object diagram -> PlantUML object diagram (export only). Instances become
 * `object` declarations named `name : Classifier` with their slots in the
 * body; links keep their end roles, navigability and `name : Association`
 * label. Classifier declarations are only checked, never drawn, so they are
 * not exported.
 */

/** `name : Classifier`, `name` or `: Classifier` (UML 2.5.1 9.8.4). */
const instanceLabel = (i: Instance): string =>
  i.classifier === undefined ? (i.name ?? '') : `${i.name ?? ''}${i.name === undefined ? '' : ' '}: ${i.classifier}`;

const endLabel = (end: LinkEnd | undefined): string => (end?.role === undefined ? '' : ` ${quoted(end.role)}`);

function linkLabel(link: Link): string {
  if (link.association === undefined) return link.name === undefined ? '' : encode(link.name);
  return encode(`${link.name === undefined ? '' : `${link.name} `}: ${link.association}`);
}

export function exportObject(model: ObjectDiagram, _losses: Losses): string {
  const ids = plantumlAliases();
  const lines: string[] = [];
  for (const e of model.elements) {
    const alias = ids.get(e.id);
    if (isNote(e)) {
      lines.push(`note ${quoted(e.text)} as ${alias}`);
      continue;
    }
    const head = `object ${quoted(instanceLabel(e))} as ${alias}${stereotypeText(e.stereotypes)}`;
    if (!e.slots?.length) {
      lines.push(head);
      continue;
    }
    lines.push(`${head} {`);
    for (const s of e.slots) lines.push(`  ${encode(`${s.feature}${s.type === undefined ? '' : ` : ${s.type}`} = ${s.value}`, '{}')}`);
    lines.push('}');
  }
  for (const r of model.relationships ?? []) {
    const nav = (n: boolean | undefined, yes: string): string => (n === undefined ? '' : n ? yes : 'x');
    const arrow = `${nav(r.fromEnd?.navigable, '<')}--${nav(r.toEnd?.navigable, '>')}`;
    const label = linkLabel(r);
    lines.push(`${ids.get(r.from)}${endLabel(r.fromEnd)} ${arrow}${endLabel(r.toEnd)} ${ids.get(r.to)}${label ? ` : ${label}` : ''}`);
  }
  for (const e of model.elements) if (isNote(e)) for (const target of e.attachedTo ?? []) lines.push(`${ids.get(e.id)} .. ${ids.get(target)}`);
  return document(model.title, lines);
}

export const plantumlObject: KindFormat<ObjectDiagram> = { kind: 'object', export: exportObject };
