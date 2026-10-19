import { theme } from '../../core/theme.js';
import { aliases, displayText } from '../../plantuml/encode.js';
import { plantUmlDocument } from '../../plantuml/skin.js';
import { wrapLines, wrappedDisplayText } from '../../plantuml/wrap.js';
import { lifelineLabel, loopHeading, messageLabel, refLabel } from './format.js';
import { isMessage, type Fragment, type Item, type SequenceDiagram } from './model.js';
import { sequenceSkin } from './skin.js';

/** Wrap widths in code points: lifeline heads, message labels, notes and frames. */
export const WRAP = { lifeline: 28, message: 44, note: 36, ref: 48 } as const;

const SYMBOL_KEYWORD = { rectangle: 'participant', actor: 'actor', boundary: 'boundary', control: 'control', entity: 'entity' } as const;

/** PlantUML arrows per message sort (with `skinparam style strictuml`). */
export const ARROW = {
  synchronous: '->', asynchronous: '->>', reply: '-->>', create: '-->>', delete: '->',
} as const;

/** Operators PlantUML has a keyword for; every other operator is drawn as a group headed by its name. */
const NATIVE = new Set(['alt', 'opt', 'loop', 'par', 'break', 'critical']);

/**
 * Sequence diagram to PlantUML. Every display string is encoded with
 * displayText()/wrappedDisplayText(); lifeline IDs map to private aliases.
 * Lifelines are declared up front in model order (so created lifelines keep
 * their column) and re-announced with `create` just before their create message.
 */
export function sequenceToPlantUml(model: SequenceDiagram): string {
  const ids = aliases(model.lifelines.map(l => l.id), 'l');
  const order = new Map(model.lifelines.map((l, i) => [l.id, i]));

  const lines: string[] = [...sequenceSkin()];
  if (model.autonumber) lines.push('autonumber');
  if (model.title !== undefined) lines.push(`mainframe **sd** ${displayText(model.title)}`);
  for (const l of model.lifelines) {
    lines.push(`${SYMBOL_KEYWORD[l.symbol ?? 'rectangle']} "${wrappedDisplayText(lifelineLabel(l), WRAP.lifeline)}" as ${ids.get(l.id)}`);
  }

  const alias = (id: string): string => ids.get(id)!;
  // Two lifelines spanning every listed one (PlantUML spans the columns in between).
  const span = (list: readonly string[]): string => {
    const sorted = [...new Set(list)].sort((a, b) => order.get(a)! - order.get(b)!);
    return sorted.length === 1 ? alias(sorted[0]!) : `${alias(sorted[0]!)}, ${alias(sorted.at(-1)!)}`;
  };

  const emit = (items: readonly Item[], depth: number): void => {
    const pad = '  '.repeat(depth);
    for (const item of items) {
      if (isMessage(item)) {
        const label = messageLabel(item);
        const text = label ? ` : ${wrappedDisplayText(label, WRAP.message)}` : '';
        if (item.type === 'found') {
          lines.push(`${pad}[o${item.sort === 'synchronous' ? '->' : '->>'} ${alias(item.to)}${text}`);
          if (item.activate) lines.push(`${pad}activate ${alias(item.to)}`);
          continue;
        }
        if (item.type === 'lost') {
          lines.push(`${pad}${alias(item.from)} ${item.sort === 'synchronous' ? '->' : '->>'}o]${text}`);
          if (item.deactivate) lines.push(`${pad}deactivate ${alias(item.from)}`);
          continue;
        }
        if (item.sort === 'create') lines.push(`${pad}create ${alias(item.to)}`);
        lines.push(`${pad}${alias(item.from)} ${ARROW[item.sort]} ${alias(item.to)}${text}`);
        if (item.deactivate) lines.push(`${pad}deactivate ${alias(item.from)}`);
        if (item.activate) lines.push(`${pad}activate ${alias(item.to)}`);
        if (item.sort === 'delete') lines.push(`${pad}destroy ${alias(item.to)}`);
        continue;
      }
      switch (item.type) {
        case 'activate': case 'deactivate': case 'destroy':
          lines.push(`${pad}${item.type} ${alias(item.lifeline)}`);
          break;
        case 'stateInvariant':
          // Constraint notation (17.2.4): the text in braces on the lifeline, no box.
          lines.push(`${pad}rnote over ${alias(item.lifeline)} ${theme.color.background};line:${theme.color.background.slice(1)} : ${wrappedDisplayText(`{${item.constraint}}`, WRAP.note)}`);
          break;
        case 'note':
          // Block form: one source line per wrapped line keeps long notes under PlantUML's line limit.
          lines.push(`${pad}note ${item.position === 'over' ? `over ${span(item.lifelines)}` : `${item.position} of ${alias(item.lifelines[0]!)}`}`,
            ...wrapLines(item.text, WRAP.note).map(line => `${pad}${displayText(line)}`), `${pad}end note`);
          break;
        case 'ref':
          lines.push(`${pad}ref over ${span(item.covered)} : ${wrappedDisplayText(refLabel(item.name, item.arguments), WRAP.ref)}`);
          break;
        case 'fragment':
          emitFragment(item, depth);
          break;
      }
    }
  };

  const emitFragment = (f: Fragment, depth: number): void => {
    const pad = '  '.repeat(depth);
    const guard = (g: string | undefined): string => g === undefined ? '' : displayText(g);
    f.operands.forEach((operand, i) => {
      if (i > 0) {
        lines.push(`${pad}else${operand.guard === undefined ? '' : ` ${guard(operand.guard)}`}`);
      } else if (NATIVE.has(f.operator) && !(f.operator === 'loop' && f.min !== undefined)) {
        lines.push(`${pad}${f.operator}${operand.guard === undefined ? '' : ` ${guard(operand.guard)}`}`);
      } else {
        const heading = f.operator === 'loop' ? loopHeading(f.min, f.max) : f.operator;
        lines.push(`${pad}group ${displayText(heading)}${operand.guard === undefined ? '' : ` [${guard(operand.guard)}]`}`);
      }
      emit(operand.items, depth + 1);
    });
    lines.push(`${pad}end`);
  };

  emit(model.items, 0);
  return plantUmlDocument(lines);
}

/** Visits every item in document order, fragments' operands included. */
export function walk(items: readonly Item[], visit: (item: Item) => void): void {
  for (const item of items) {
    visit(item);
    if (item.type === 'fragment') for (const operand of item.operands) walk(operand.items, visit);
  }
}
