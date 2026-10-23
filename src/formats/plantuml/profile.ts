import type { Element, ProfileDiagram, TaggedValue } from '../../kinds/profile/model.js';
import { isContainer, isNote } from '../../kinds/profile/model.js';
import type { KindFormat, Losses } from '../types.js';
import { document, encode, plantumlAliases, quoted, stereotypeText } from './text.js';

/**
 * Profile diagram -> PlantUML class diagram (export only). Profiles are
 * packages marked <<profile>>, stereotypes and metaclasses are classes marked
 * <<stereotype>> and <<metaclass>>, tagged values are attributes. PlantUML has
 * no filled-triangle arrowhead, so an extension is a solid arrow with an open
 * head (reported as a loss); {required} is its label.
 */

const tagged = (t: TaggedValue): string =>
  `${encode(t.name, ':[]={}(),')}${t.type === undefined ? '' : ` : ${encode(t.type, '[]={}()')}`}${t.multiplicity === undefined ? '' : ` [${t.multiplicity}]`}${t.default === undefined ? '' : ` = ${encode(t.default, '{}()')}`}`;

export function exportProfile(model: ProfileDiagram, losses: Losses): string {
  const ids = plantumlAliases();
  const lines: string[] = [];
  const owner = new Map<string, string>();
  for (const e of model.elements) if (isContainer(e)) for (const m of e.members ?? []) owner.set(m, e.id);
  const byId = new Map(model.elements.map(e => [e.id, e]));
  const emit = (e: Element, indent: string): void => {
    const alias = ids.get(e.id);
    const named = (keyword: string, name: string, stereotypes: string[]): string =>
      `${indent}${keyword} ${quoted(name)} as ${alias}${stereotypeText(stereotypes)}`;
    switch (e.type) {
      case 'note':
        lines.push(`${indent}note ${quoted(e.text)} as ${alias}`);
        return;
      case 'profile':
      case 'package':
        lines.push(`${named('package', e.name, e.type === 'profile' ? ['profile'] : [])} {`);
        for (const m of e.members ?? []) {
          const member = byId.get(m);
          if (member) emit(member, `${indent}  `);
        }
        lines.push(`${indent}}`);
        return;
      case 'stereotype':
        if (!e.attributes?.length) {
          lines.push(named(e.abstract ? 'abstract class' : 'class', e.name, ['stereotype']));
          return;
        }
        lines.push(
          `${named(e.abstract ? 'abstract class' : 'class', e.name, ['stereotype'])} {`,
          ...e.attributes.map(a => `${indent}  ${tagged(a)}`),
          `${indent}}`,
        );
        return;
      case 'metaclass':
        lines.push(named('class', e.name, ['metaclass']));
        return;
      case 'enumeration':
        if (!e.literals?.length) {
          lines.push(named('enum', e.name, []));
          return;
        }
        lines.push(`${named('enum', e.name, [])} {`, ...e.literals.map(l => `${indent}  ${encode(l, '(){}[]:')}`), `${indent}}`);
        return;
      case 'class':
        lines.push(named('class', e.name, e.stereotypes ?? []));
        return;
    }
  };
  for (const e of model.elements) if (!owner.has(e.id)) emit(e, '');
  for (const [i, r] of (model.relationships ?? []).entries()) {
    const from = ids.get(r.from),
      to = ids.get(r.to);
    switch (r.type) {
      case 'extension':
        losses.add(`/relationships/${i}`, 'An extension is drawn as a solid arrow with an open head instead of a filled triangle');
        lines.push(`${from} --> ${to}${r.required ? ' : {required}' : ''}`);
        break;
      case 'generalization':
        lines.push(`${from} --|> ${to}`);
        break;
      case 'apply':
        lines.push(`${from} ..> ${to} : <<apply>>`);
        break;
      case 'reference':
        lines.push(`${from} ..> ${to} : <<reference>>`);
        break;
    }
  }
  for (const e of model.elements) if (isNote(e)) for (const target of e.attachedTo ?? []) lines.push(`${ids.get(e.id)} .. ${ids.get(target)}`);
  return document(model.title, lines);
}

export const plantumlProfile: KindFormat<ProfileDiagram> = { kind: 'profile', export: exportProfile };
