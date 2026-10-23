import { lifelineLabel, messageLabel } from '../../kinds/communication/format.js';
import type { CommunicationDiagram, Link, Message } from '../../kinds/communication/model.js';
import type { KindFormat, Losses } from '../types.js';
import { document, encode, plantumlAliases, quoted } from './text.js';

/**
 * Communication diagram -> PlantUML description diagram (export only).
 * PlantUML has no communication diagram: lifelines become rectangles
 * (multi-objects: `collections`), links become lines, and each message is a
 * line of its link's label in UML notation (`1.2 [guard]: x = name(args)`)
 * with an arrow character for its direction.
 */

export function exportCommunication(model: CommunicationDiagram, losses: Losses): string {
  const ids = plantumlAliases();
  const lines: string[] = [];
  for (const l of model.lifelines) lines.push(`${l.multiObject ? 'collections' : 'rectangle'} ${quoted(lifelineLabel(l) || ' ')} as ${ids.get(l.id)}`);
  const links: Link[] = [...(model.links ?? [])];
  const onLink = new Map<Link, Message[]>(links.map(l => [l, []]));
  const pair = (l: { from: string; to: string }, m: Message): boolean => (l.from === m.from && l.to === m.to) || (l.from === m.to && l.to === m.from);
  (model.messages ?? []).forEach((m, i) => {
    let link = links.find(l => pair(l, m));
    if (!link) {
      // A message needs a link to travel along; one is drawn for it.
      losses.add(`/messages/${i}`, 'A message between lifelines without a link is drawn on an added link');
      link = { from: m.from, to: m.to };
      links.push(link);
      onLink.set(link, []);
    }
    onLink.get(link)!.push(m);
  });
  if (model.messages?.length) losses.add('/messages', 'Messages are lines of their link\'s label with an arrow character for their direction; synchronous, asynchronous and reply messages are not told apart by the arrow');
  for (const link of links) {
    const messages = onLink.get(link)!;
    // `\n` (written by the exporter, never taken from model text) starts a new label line.
    const label = messages.map(m => encode(`${messageLabel(m)} ${m.from === link.from && m.from !== m.to ? '→' : m.from === m.to ? '↻' : '←'}`)).join('\\n');
    lines.push(`${ids.get(link.from)} -- ${ids.get(link.to)}${label ? ` : ${label}` : ''}`);
  }
  return document(model.title, lines);
}

export const plantumlCommunication: KindFormat<CommunicationDiagram> = { kind: 'communication', export: exportCommunication };
