import { frameName } from '../../kinds/interaction-overview/layout.js';
import type { FragmentLifeline, InteractionOverviewDiagram } from '../../kinds/interaction-overview/model.js';
import type { KindFormat, Losses } from '../types.js';
import { document, encode, plantumlAliases } from './text.js';

/**
 * Interaction overview diagram -> PlantUML state diagram (export only).
 * PlantUML's activity syntax is structured and cannot hold an arbitrary flow
 * graph, while its state diagram can, with the same control node symbols:
 * <<start>>, <<end>>, <<choice>> (decision and merge diamonds), <<fork>> and
 * <<join>> bars. Interaction uses are boxes headed `ref`, inline interactions
 * boxes headed `sd` that list their lifelines and messages; guards label the
 * flows. The title is the frame heading, with its `lifelines` clause.
 */

const STEREOTYPE = { initial: 'start', final: 'end', 'flow-final': 'end', decision: 'choice', merge: 'choice', fork: 'fork', join: 'join' } as const;

/** A quoted multi-line name: each line encoded, joined by PlantUML's `\n`. */
const multiline = (rows: readonly string[]): string => `"${rows.map(r => encode(r, '"')).join('\\n')}"`;

const lifelineText = (l: FragmentLifeline): string => l.type === undefined ? l.name ?? l.id : `${l.name ?? ''}:${l.type}`;
const ARROW = { synchronous: '→', asynchronous: '⇀', reply: '⇢' } as const;

export function exportInteractionOverview(model: InteractionOverviewDiagram, losses: Losses): string {
  const ids = plantumlAliases();
  const lines: string[] = [];
  model.nodes.forEach((n, i) => {
    const alias = ids.get(n.id);
    if (n.type === 'interaction-use') {
      lines.push(`state ${multiline(['ref', `${n.name}${n.arguments === undefined ? '' : `(${n.arguments.join(', ')})`}`])} as ${alias}`);
      return;
    }
    if (n.type === 'interaction') {
      lines.push(`state ${multiline([`sd ${n.name}`])} as ${alias}`);
      const names = new Map(n.lifelines.map(l => [l.id, lifelineText(l)]));
      lines.push(`${alias} : ${encode(`lifelines ${n.lifelines.map(lifelineText).join(', ')}`)}`);
      for (const m of n.messages) {
        const call = `${m.name}${m.arguments === undefined ? '' : `(${m.arguments.join(', ')})`}`;
        lines.push(`${alias} : ${encode(`${names.get(m.from)} ${ARROW[m.sort ?? 'synchronous']} ${names.get(m.to)}: ${call}`)}`);
      }
      return;
    }
    if (n.type === 'flow-final') losses.add(`/nodes/${i}`, 'A flow final node is drawn as a final node');
    lines.push(`state ${alias} <<${STEREOTYPE[n.type]}>>`);
  });
  if (model.nodes.some(n => n.type === 'interaction' || n.type === 'interaction-use')) {
    losses.add('/nodes', 'Interaction uses and inline interactions are drawn as boxes headed ref and sd, not as frames; an inline interaction lists its messages as text instead of drawing a sequence fragment');
  }
  for (const f of model.flows ?? []) lines.push(`${ids.get(f.from)} --> ${ids.get(f.to)}${f.guard === undefined ? '' : ` : [${encode(f.guard, '[]')}]`}`);
  // The title carries the frame heading's lifelines clause, as the own engine draws it.
  return document(frameName(model), lines);
}

export const plantumlInteractionOverview: KindFormat<InteractionOverviewDiagram> = { kind: 'interaction-overview', export: exportInteractionOverview };
