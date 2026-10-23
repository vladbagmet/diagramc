import type { UseCase, UseCaseDiagram } from '../../kinds/use-case/model.js';
import type { KindFormat, Losses } from '../types.js';
import { document, encode, mermaidAliases } from './text.js';

/**
 * Use case diagram -> Mermaid flowchart (export only). Use cases are stadiums
 * (the nearest Mermaid shape to an ellipse) with their extension points below
 * the name, subjects are subgraphs holding their use cases, include and extend
 * are dotted arrows labelled with their keyword. Mermaid has no actor figure
 * and no hollow triangle arrowhead; both are reported as losses.
 */

const keywords = (list: readonly string[] | undefined): string => (list ?? []).map(s => `«${encode(s)}»<br>`).join('');

export function exportUseCase(model: UseCaseDiagram, losses: Losses): string {
  const ids = mermaidAliases();
  const lines: string[] = [];
  const notes: string[] = [];
  const useCase = (u: UseCase, pad: string): void => {
    const points = u.extensionPoints?.length ? `<br>extension points<br>${u.extensionPoints.map(p => encode(p)).join('<br>')}` : '';
    lines.push(`${pad}${ids.get(u.id)}(["${encode(u.name)}${points}"])`);
  };
  model.elements.forEach((e, i) => {
    const id = ids.get(e.id);
    switch (e.type) {
      case 'actor':
        losses.add(`/elements/${i}`, 'Mermaid flowcharts have no stick figure: an actor is a box with the keyword «actor»');
        lines.push(`${id}["«actor»<br>${keywords(e.stereotypes)}${encode(e.name)}"]`);
        break;
      case 'subject':
        lines.push(`subgraph ${id} ["${keywords(e.stereotypes)}${encode(e.name)}"]`);
        for (const u of model.elements) if (u.type === 'useCase' && u.subject === e.id) useCase(u, '  ');
        lines.push('end');
        break;
      case 'useCase':
        if (e.subject === undefined) useCase(e, '');
        break;
      case 'note':
        losses.add(`/elements/${i}`, 'Mermaid flowcharts have no notes: a note is a comment node joined to its elements by dotted lines');
        lines.push(`${id}@{ shape: brace, label: "${encode(e.text)}" }`);
        for (const t of e.attachedTo ?? []) notes.push(`${id} -.- ${ids.get(t)}`);
        break;
    }
  });
  (model.relationships ?? []).forEach((r, i) => {
    const path = `/relationships/${i}`;
    if (r.id !== undefined) losses.add(`${path}/id`, 'Relationship IDs are not kept');
    const from = ids.get(r.from), to = ids.get(r.to);
    switch (r.type) {
      case 'association': {
        const ends = r.fromEnd?.multiplicity !== undefined || r.toEnd?.multiplicity !== undefined;
        if (ends) losses.add(path, 'Mermaid edges have no end labels: the multiplicities are written in the middle label, from end first');
        const text = [r.fromEnd?.multiplicity, r.name === undefined ? undefined : encode(r.name), r.toEnd?.multiplicity].filter(t => t !== undefined).join(' ');
        lines.push(`${from} ---${text ? `|"${text}"|` : ''} ${to}`);
        break;
      }
      case 'generalization':
        losses.add(path, 'Mermaid flowcharts have no hollow triangle arrowhead: a generalization is drawn as a plain arrow');
        lines.push(`${from} --> ${to}`);
        break;
      case 'include':
        lines.push(`${from} -.->|"«include»"| ${to}`);
        break;
      case 'extend':
        lines.push(`${from} -.->|"«extend»${r.condition === undefined ? '' : `<br>condition: {${encode(r.condition)}}`}<br>extension point: ${encode(r.extensionPoint)}"| ${to}`);
        break;
    }
  });
  lines.push(...notes);
  return document(model.title, 'flowchart LR', lines);
}

export const mermaidUseCase: KindFormat<UseCaseDiagram> = { kind: 'use-case', export: exportUseCase };
