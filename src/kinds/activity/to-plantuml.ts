import { displayText } from '../../plantuml/encode.js';
import { activitySkinParams, plantUmlDocument } from '../../plantuml/skin.js';
import { theme } from '../../core/theme.js';
import { type FontMetrics } from '../../engine/fonts.js';
import { wrapText } from '../../engine/text.js';
import type { ActivityDiagram, ActivityNode, ExecutableNode } from './model.js';
import { structure, type Block } from './structure.js';

/**
 * Activity diagram -> PlantUML new activity syntax. The flow graph is first
 * turned into structured blocks (structure.ts), then written as start/stop/end,
 * actions, switch (decision + merge), fork, while and repeat. Every display
 * string goes through displayText(); partition names become swimlane titles in
 * the order of `partitions`. Notes are wrapped by the caller-provided metrics.
 */
export function activityToPlantUml(model: ActivityDiagram, metrics?: FontMetrics): string {
  const lines: string[] = [...activitySkinParams()];
  const partitions = new Map((model.partitions ?? []).map(p => [p.id, p]));
  if (model.title !== undefined) lines.push(`mainframe **act** ${displayText(model.title)}`);
  const lane = (id: string): string => `|${displayText(partitions.get(id)!.name)}|`;
  // Declaring every swimlane first fixes their left-to-right order.
  for (const p of model.partitions ?? []) lines.push(lane(p.id));
  let current: string | undefined = model.partitions?.at(-1)?.id;
  const enter = (node: ActivityNode, indent: string): void => {
    const id = 'partition' in node ? node.partition : undefined;
    if (id !== undefined && id !== current) { lines.push(`${indent}${lane(id)}`); current = id; }
  };
  const guard = (text: string): string => `(${displayText(`[${text}]`)})`;
  // With swimlanes, branches are ordered by the mean position of their partitions,
  // so flows into far lanes start on the side of those lanes and cross fewer nodes.
  const index = new Map((model.partitions ?? []).map((p, i) => [p.id, i]));
  const lanes = (steps: Block): number[] => steps.flatMap(step => {
    switch (step.kind) {
      case 'node': return 'partition' in step.node && step.node.partition !== undefined ? [index.get(step.node.partition)!] : [];
      case 'decision': return step.branches.flatMap(b => lanes(b.body));
      case 'fork': return step.branches.flatMap(lanes);
      default: return lanes(step.body);
    }
  });
  const order = <T>(branches: T[], body: (b: T) => Block): T[] => {
    if (!index.size) return branches;
    const mean = (b: T): number => { const l = lanes(body(b)); return l.length ? l.reduce((x, y) => x + y, 0) / l.length : Infinity; };
    return branches.map((b, i) => ({ b, i, m: mean(b) })).sort((x, y) => (x.m - y.m) || (x.i - y.i)).map(x => x.b);
  };

  const executable = (node: ExecutableNode, indent: string, keyword = ''): void => {
    const text = node.type === 'object' && node.state !== undefined
      ? `${displayText(node.name)}\n${indent}${displayText(`[${node.state}]`)}`
      : displayText(node.name);
    const stereotype = { action: '', callBehavior: ' <<callBehavior>>', sendSignal: ' <<output>>', acceptEvent: ' <<input>>', object: ' <<object>>' }[node.type];
    lines.push(`${indent}${keyword}:${text};${stereotype}`);
    if (node.note !== undefined) {
      lines.push(`${indent}note right`);
      for (const row of noteRows(node.note, metrics)) lines.push(`${indent}  ${displayText(row)}`);
      lines.push(`${indent}end note`);
    }
  };

  const block = (steps: Block, indent: string): void => {
    for (const step of steps) {
      switch (step.kind) {
        case 'node': {
          const n = step.node;
          enter(n, indent);
          if (n.type === 'initial') lines.push(`${indent}start`);
          else if (n.type === 'activityFinal') lines.push(`${indent}stop`);
          else if (n.type === 'flowFinal') lines.push(`${indent}end`);
          else executable(n as ExecutableNode, indent);
          break;
        }
        case 'decision':
          enter(step.node, indent);
          lines.push(`${indent}switch ()`);
          for (const b of order(step.branches, x => x.body)) {
            lines.push(`${indent}case ${guard(b.guard)}`);
            block(b.body, `${indent}  `);
          }
          lines.push(`${indent}endswitch`);
          break;
        case 'fork':
          enter(step.node, indent);
          order(step.branches, x => x).forEach((b, i) => {
            lines.push(`${indent}${i ? 'fork again' : 'fork'}`);
            block(b, `${indent}  `);
          });
          lines.push(`${indent}end fork`);
          break;
        case 'while':
          enter(step.decision, indent);
          lines.push(`${indent}while () is ${guard(step.guard)}`);
          block(step.body, `${indent}  `);
          lines.push(`${indent}endwhile ${guard(step.exitGuard)}`);
          break;
        case 'repeat':
          // The loop's merge diamond is drawn where `repeat` stands: in the decision's partition.
          enter(step.decision, indent);
          lines.push(`${indent}repeat`);
          block(step.body, `${indent}  `);
          enter(step.decision, indent);
          if (step.backward) executable(step.backward, indent, 'backward');
          lines.push(`${indent}repeat while () is ${guard(step.backGuard)} not ${guard(step.exitGuard)}`);
          break;
      }
    }
  };
  block(structure(model), '');
  return plantUmlDocument(lines);
}

/**
 * Note text wrapped to the theme's note width. Spaces stay at the end of the
 * line they follow, so the rows concatenate to the original text.
 */
function noteRows(text: string, metrics: FontMetrics | undefined): string[] {
  if (!metrics) return [text];
  return wrapText(metrics, text, { size: theme.font.size.body }, theme.size.maxNoteWidth);
}
