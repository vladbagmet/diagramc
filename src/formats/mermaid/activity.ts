import type { ActivityDiagram, ActivityNode } from '../../kinds/activity/model.js';
import type { KindFormat, Losses } from '../types.js';
import { document, encode, mermaidAliases } from './text.js';

/**
 * Activity diagram -> Mermaid flowchart (export only). Mermaid 11's shapes give
 * most UML symbols: a small filled circle for the initial node, a framed circle
 * for the activity final, a crossed circle for the flow final, diamonds for
 * decisions and merges, bars for forks and joins, rounded boxes for actions and
 * a notched box for accept event actions. Partitions are subgraphs holding
 * their nodes; guards label the flows in brackets.
 */

export function exportActivity(model: ActivityDiagram, losses: Losses): string {
  const ids = mermaidAliases();
  const label = (text: string): string => `"${encode(text)}"`;
  const shape = (n: ActivityNode, path: string): string => {
    const id = ids.get(n.id);
    switch (n.type) {
      case 'initial':
        return `${id}@{ shape: sm-circ }`;
      case 'activityFinal':
        return `${id}@{ shape: fr-circ }`;
      case 'flowFinal':
        return `${id}@{ shape: cross-circ }`;
      case 'decision':
      case 'merge':
        return `${id}{" "}`;
      case 'fork':
      case 'join':
        return `${id}@{ shape: fork }`;
      case 'action':
        return `${id}(${label(n.name)})`;
      case 'callBehavior':
        losses.add(path, 'A call behavior action is drawn as a subroutine box, without the rake symbol');
        return `${id}[[${label(n.name)}]]`;
      case 'acceptEvent':
        return `${id}>${label(n.name)}]`;
      case 'sendSignal':
        losses.add(path, 'Mermaid has no send signal shape (a box with a pointed right side): it is drawn as a plain box');
        return `${id}[${label(n.name)}]`;
      case 'object':
        return `${id}["${encode(n.name)}${n.state === undefined ? '' : `<br>[${encode(n.state)}]`}"]`;
    }
  };
  const lines: string[] = [];
  const notes: string[] = [];
  const declare = (n: ActivityNode, i: number, pad: string): void => {
    lines.push(`${pad}${shape(n, `/nodes/${i}`)}`);
    const text = (n as { note?: string }).note;
    if (text !== undefined) {
      losses.add(`/nodes/${i}/note`, 'Mermaid flowcharts have no notes: a note is a comment node joined to its node by a dotted line');
      const note = ids.get(`${n.id}-note`);
      lines.push(`${pad}${note}@{ shape: brace, label: ${label(text)} }`);
      notes.push(`${ids.get(n.id)} -.- ${note}`);
    }
  };
  for (const p of model.partitions ?? []) {
    lines.push(`subgraph ${ids.get(p.id)} [${label(p.name)}]`, '  direction TB');
    for (const [i, n] of model.nodes.entries()) {
      if ((n as { partition?: string }).partition === p.id) declare(n, i, '  ');
    }
    lines.push('end');
  }
  for (const [i, n] of model.nodes.entries()) {
    if ((n as { partition?: string }).partition === undefined) declare(n, i, '');
  }
  for (const [i, e] of model.edges.entries()) {
    if (e.id !== undefined) losses.add(`/edges/${i}/id`, 'Flow IDs are not kept');
    lines.push(`${ids.get(e.from)} -->${e.guard === undefined ? '' : `|"[${encode(e.guard)}]"|`} ${ids.get(e.to)}`);
  }
  lines.push(...notes);
  return document(model.title, 'flowchart TD', lines);
}

export const mermaidActivity: KindFormat<ActivityDiagram> = { kind: 'activity', export: exportActivity };
