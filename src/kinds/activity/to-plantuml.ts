import { displayText } from '../../plantuml/encode.js';
import { activitySkinParams, plantUmlDocument } from '../../plantuml/skin.js';
import { theme } from '../../core/theme.js';
import { type FontMetrics } from '../../engine/fonts.js';
import { wrapMeasured } from '../../plantuml/wrap.js';
import type { ActivityDiagram, ActivityNode, ExecutableNode } from './model.js';
import { orderBySpan, structure, type Block } from './structure.js';

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
  // With swimlanes, branches are ordered by the lanes they occupy (validate.ts
  // rejects branches whose lanes interleave), so each branch keeps its own run of
  // lanes and no flow runs through another branch.
  const index = new Map((model.partitions ?? []).map((p, i) => [p.id, i]));
  const order = <T>(branches: T[], body: (b: T) => Block): T[] => index.size > 0 ? orderBySpan(branches, body, index) : branches;

  const executable = (node: ExecutableNode, indent: string, keyword = ''): void => {
    // Long names wrap at natural break points; each line is encoded separately.
    const rows = (t: string): string => nameRows(t, metrics).map(displayText).join(String.raw`\n`);
    const text = node.type === 'object' && node.state !== undefined
      ? String.raw`${rows(node.name)}\n${rows(`[${node.state}]`)}`
      : rows(node.name);
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
          switch (n.type) {
          case 'initial': {
          lines.push(`${indent}start`);
          break;
          }
          case 'activityFinal': {
          lines.push(`${indent}stop`);
          break;
          }
          case 'flowFinal': {
          lines.push(`${indent}end`);
          break;
          }
          default: executable(n as ExecutableNode, indent);
          }
          break;
        }
        case 'decision': {
          enter(step.node, indent);
          const branches = order(step.branches, x => x.body);
          if (branches.length === 2) {
            // if/else keeps each guard at its own branch line and survives swimlane
            // changes inside the branches (switch/case does not; see validate.ts).
            lines.push(`${indent}if () then ${guard(branches[0]!.guard)}`);
            block(branches[0]!.body, `${indent}  `);
            lines.push(`${indent}else ${guard(branches[1]!.guard)}`);
            block(branches[1]!.body, `${indent}  `);
            lines.push(`${indent}endif`);
          } else {
            lines.push(`${indent}switch ()`);
            for (const b of branches) {
              lines.push(`${indent}case ${guard(b.guard)}`);
              block(b.body, `${indent}  `);
            }
            lines.push(`${indent}endswitch`);
          }
          break;
        }
        case 'fork':
          enter(step.node, indent);
          for (const [i, b] of order(step.branches, x => x).entries()) {
            lines.push(`${indent}${i ? 'fork again' : 'fork'}`);
            block(b, `${indent}  `);
          }
          // The join is drawn in the swimlane current at `end fork`: the fork's.
          enter(step.node, indent);
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
          // PlantUML drops the is/not labels of repeat loops when decisions are drawn
          // as plain diamonds (and always with swimlanes): the returning guard is the
          // condition text beside the diamond, the leaving guard labels the next flow.
          lines.push(`${indent}repeat while ${guard(step.backGuard)}`, `${indent}->${displayText(`[${step.exitGuard}]`)};`);
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
  return wrapMeasured(metrics, text, { size: theme.font.size.body }, theme.size.maxNoteWidth);
}

/** Action and object node names wrapped to the theme's maximum name width. */
function nameRows(text: string, metrics: FontMetrics | undefined): string[] {
  if (!metrics) return [text];
  return wrapMeasured(metrics, text, { size: theme.font.size.name }, theme.size.maxNameWidth);
}
