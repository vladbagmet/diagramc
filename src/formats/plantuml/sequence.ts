import type { Fragment, Item, Lifeline, LifelineSymbol, MessageSort, Operator, SequenceDiagram } from '../../kinds/sequence/model.js';
import { isMessage } from '../../kinds/sequence/model.js';
import { IdMaker, compact, splitTopLevel } from '../common.js';
import type { KindFormat, Losses, Problems, SourceLine } from '../types.js';
import { decode, document, encode, plantumlAliases, titleOf } from './text.js';

/**
 * Sequence diagram <-> PlantUML sequence diagram. Lifelines keep their ID as the
 * alias and are declared in model order. Messages use PlantUML's arrows and its
 * activation shorthand (`++` activates the receiver, `--` deactivates the
 * sender, `**` creates, `!!` destroys the receiver), so every message flag has
 * its own mark and reads back exactly.
 */

const SYMBOL: Record<LifelineSymbol, string> = { rectangle: 'participant', actor: 'actor', boundary: 'boundary', control: 'control', entity: 'entity' };
const ARROW: Record<MessageSort, string> = { synchronous: '->', asynchronous: '->>', reply: '-->', create: '-->>', delete: '->' };
/** Operators with a PlantUML keyword; the others are written as `group <operator>`. */
const NATIVE = new Set<Operator>(['alt', 'opt', 'loop', 'par', 'break', 'critical']);
const OPERATORS = new Set<Operator>(['alt', 'opt', 'loop', 'par', 'break', 'critical', 'neg', 'strict', 'seq', 'assert']);

/** `name : Classifier` with `:` encoded inside each part. */
function lifelineText(l: Lifeline): string {
  const name = l.name === undefined ? '' : encode(l.name, '":');
  return l.classifier === undefined ? name : `${name}${name ? ' ' : ''}: ${encode(l.classifier, '":')}`;
}

/** `name(a, b)` with the call syntax encoded inside the name and each argument. */
const call = (name: string, args: readonly string[] | undefined): string =>
  `${encode(name, '():=,')}${args === undefined ? '' : `(${args.map(a => encode(a, '(),:=')).join(', ')})`}`;

export function exportSequence(model: SequenceDiagram, losses: Losses): string {
  const ids = plantumlAliases();
  const order = new Map(model.lifelines.map((l, i) => [l.id, i]));
  const lines: string[] = [];
  if (model.autonumber) lines.push('autonumber');
  for (const l of model.lifelines) {
    const alias = ids.get(l.id);
    const keyword = SYMBOL[l.symbol ?? 'rectangle'];
    lines.push(l.classifier === undefined && l.name === alias ? `${keyword} ${alias}` : `${keyword} "${lifelineText(l)}" as ${alias}`);
  }
  const a = (id: string): string => ids.get(id);
  /** Two lifelines at most: PlantUML spans the columns between them. */
  const span = (list: readonly string[], path: string, what: string): string => {
    if (list.length <= 2) return list.map(a).join(', ');
    losses.add(path, `${what} over ${list.length} lifelines is written over the outermost two, which span the ones between`);
    const sorted = [...list].sort((x, y) => order.get(x)! - order.get(y)!);
    return `${a(sorted[0]!)}, ${a(sorted.at(-1)!)}`;
  };
  const emit = (items: readonly Item[], depth: number, base: string): void => {
    const pad = '  '.repeat(depth);
    for (const [index, item] of items.entries()) {
      const path = `${base}/${index}`;
      if ((item as { id?: string }).id !== undefined) losses.add(`${path}/id`, `The ID of a ${item.type} item is not kept`);
      if (isMessage(item)) {
        const label =
          item.name === undefined
            ? ''
            : ` : ${
                item.type === 'message' && item.sort === 'reply'
                  ? `${item.assignment === undefined ? '' : `${encode(item.assignment, '=():,')} = `}${call(item.name, item.arguments)}${item.returnValue === undefined ? '' : ` : ${encode(item.returnValue)}`}`
                  : call(item.name, item.arguments)
              }`;
        const marks = `${'deactivate' in item && item.deactivate ? '--' : ''}${'activate' in item && item.activate ? '++' : ''}`;
        if (item.type === 'found') {
          lines.push(`${pad}[o${item.sort === 'synchronous' ? '->' : '->>'} ${a(item.to)}${marks ? ` ${marks}` : ''}${label}`);
          continue;
        }
        if (item.type === 'lost') {
          lines.push(`${pad}${a(item.from)} ${item.sort === 'synchronous' ? '->' : '->>'}o]${marks ? ` ${marks}` : ''}${label}`);
          continue;
        }
        const extra = item.sort === 'create' ? '**' : item.sort === 'delete' ? '!!' : '';
        lines.push(`${pad}${a(item.from)} ${ARROW[item.sort]} ${a(item.to)}${marks || extra ? ` ${extra}${marks}` : ''}${label}`);
        continue;
      }
      switch (item.type) {
        case 'activate':
        case 'deactivate':
        case 'destroy':
          lines.push(`${pad}${item.type} ${a(item.lifeline)}`);
          break;
        case 'stateInvariant':
          lines.push(`${pad}hnote over ${a(item.lifeline)} : {${encode(item.constraint)}}`);
          break;
        case 'note':
          lines.push(
            `${pad}note ${item.position === 'over' ? `over ${span(item.lifelines, `${path}/lifelines`, 'A note')}` : `${item.position} of ${a(item.lifelines[0]!)}`} : ${encode(item.text)}`,
          );
          if (item.position !== 'over' && item.lifelines.length > 1)
            losses.add(`${path}/lifelines`, `A note ${item.position} of several lifelines is written beside the first`);
          break;
        case 'ref':
          lines.push(`${pad}ref over ${span(item.covered, `${path}/covered`, 'An interaction use')} : ${call(item.name, item.arguments)}`);
          break;
        case 'fragment':
          fragment(item, depth, path);
          break;
      }
    }
  };
  const fragment = (f: Fragment, depth: number, path: string): void => {
    const pad = '  '.repeat(depth);
    for (const [i, operand] of f.operands.entries()) {
      const guard = operand.guard === undefined ? '' : encode(operand.guard, '[]');
      if (i > 0) lines.push(`${pad}else${guard ? ` ${guard}` : ''}`);
      else if (NATIVE.has(f.operator) && f.min === undefined) lines.push(`${pad}${f.operator}${guard ? ` ${guard}` : ''}`);
      else {
        const heading = f.min === undefined ? f.operator : `loop(${f.min}${f.max === undefined ? '' : `,${f.max}`})`;
        lines.push(`${pad}group ${heading}${guard ? ` [${guard}]` : ''}`);
      }
      emit(operand.items, depth + 1, `${path}/operands/${i}/items`);
    }
    lines.push(`${pad}end`);
  };
  emit(model.items, 0, '/items');
  return document(model.title, lines);
}

// ---------------------------------------------------------------- import

const DECLARATION = /^(participant|actor|boundary|control|entity|database|collections|queue)\s+(.+)$/u;
const ALIAS = String.raw`[\p{L}\p{N}_.]+`;
/** `from arrow to [marks] [: label]`, also `[o-> to` and `from ->o]`. Reverse arrows (`<-`) are read right to left. */
const MESSAGE = new RegExp(
  String.raw`^(\[o|"[^"]*"|${ALIAS})\s*(<<?--?|--?>>?)(o\]|x)?\s*(o\]|"[^"]*"|${ALIAS})?\s*((?:\*\*|!!|\+\+|--)*)\s*(?::\s*(.*))?$`,
  'u',
);

interface Frame {
  fragment: Fragment;
  line: SourceLine;
  items: Item[];
}

export function importSequence(lines: readonly SourceLine[], problems: Problems): Record<string, unknown> {
  const ids = new IdMaker();
  const lifelines: Lifeline[] = [];
  const byKey = new Map<string, string>();
  const top: Item[] = [];
  const stack: Frame[] = [];
  let title: string | undefined,
    autonumber = false;
  const current = (): Item[] => stack.at(-1)?.items ?? top;

  const declare = (key: string, label: string | undefined, symbol: LifelineSymbol): string => {
    const id = ids.claim(key) ?? ids.fresh(key);
    const l: Lifeline = { id };
    const text = label ?? key;
    // `name : Classifier`, `: Classifier` or `name`; the separator is a raw " : " or a leading ": ".
    const m = /^(.*?)\s*(?:^|\s):\s(.*)$/u.exec(text) ?? /^:\s*(.*)$/u.exec(text);
    if (m?.length === 3) {
      if (m[1]!.trim()) l.name = decode(m[1]!.trim());
      l.classifier = decode(m[2]!.trim());
    } else if (m) l.classifier = decode(m[1]!.trim());
    else l.name = decode(text);
    if (symbol !== 'rectangle') l.symbol = symbol;
    lifelines.push(l);
    byKey.set(key, id);
    return id;
  };
  const lifeline = (written: string): string => {
    const key = written.startsWith('"') ? decode(written.slice(1, -1)) : written;
    return byKey.get(key) ?? declare(key, undefined, 'rectangle');
  };
  const known = (written: string, line: SourceLine): string | undefined => {
    const key = written.startsWith('"') ? decode(written.slice(1, -1)) : written;
    const id = byKey.get(key);
    if (id === undefined) problems.malformed(line, `"${key}" is not a declared participant`);
    return id;
  };
  /** `name(a, b)` -> name and arguments. */
  const parseCall = (text: string): { name: string; arguments?: string[] } => {
    const m = /^([^()]*?)\s*\((.*)\)$/u.exec(text.trim());
    if (!m) return { name: decode(text.trim()) };
    return { name: decode(m[1]!), arguments: m[2]!.trim() ? splitTopLevel(m[2]!).map(decode) : [] };
  };

  for (const line of lines) {
    const t = line.text;
    const heading = titleOf(line);
    if (heading !== undefined) {
      title = heading;
      continue;
    }
    if (t === 'autonumber') {
      autonumber = true;
      continue;
    }
    if (/^autonumber\b/u.test(t)) {
      problems.unsupported(line, 'autonumber with a start, step or format is not supported; write "autonumber"');
      continue;
    }
    if (/^\|\|\d*\|\|$|^\|\|\|$/u.test(t)) continue;
    let m = DECLARATION.exec(t);
    if (m) {
      const keyword = m[1]!;
      if (!(keyword in { participant: 1, actor: 1, boundary: 1, control: 1, entity: 1 })) {
        problems.unsupported(line, `"${keyword}" lifelines have no symbol in the model (participant, actor, boundary, control, entity)`);
        continue;
      }
      const d = new RegExp(String.raw`^(?:"([^"]*)"\s+as\s+(${ALIAS})|(${ALIAS})\s+as\s+"([^"]*)"|(${ALIAS}))$`, 'u').exec(m[2]!);
      if (!d) {
        problems.unsupported(line, 'expected a participant name, optionally quoted with "as <alias>" (order, colors and stereotypes are not imported)');
        continue;
      }
      const key = d[2] ?? d[3] ?? d[5]!;
      if (byKey.has(key)) {
        problems.malformed(line, `"${key}" is declared twice`);
        continue;
      }
      declare(key, d[1] ?? d[4], keyword === 'participant' ? 'rectangle' : (keyword as LifelineSymbol));
      continue;
    }
    m = /^(activate|deactivate|destroy)\s+("[^"]*"|[\p{L}\p{N}_.]+)$/u.exec(t);
    if (m) {
      const id = known(m[2]!, line);
      if (id) current().push({ type: m[1] as 'activate', lifeline: id });
      continue;
    }
    if (/^create\s/u.test(t)) {
      problems.unsupported(line, 'write the creation on the message instead: "a -->> b ** : name"');
      continue;
    }
    m = /^hnote\s+over\s+("[^"]*"|[\p{L}\p{N}_.]+)\s*:\s*\{(.*)\}$/u.exec(t);
    if (m) {
      const id = known(m[1]!, line);
      if (id) current().push({ type: 'stateInvariant', lifeline: id, constraint: decode(m[2]!.trim()) });
      continue;
    }
    m = /^note\s+(over|left of|right of)\s+(.+?)\s*:\s*(.+)$/u.exec(t);
    if (m) {
      const targets = m[2]!
        .split(',')
        .map(s => s.trim())
        .map(s => known(s, line));
      if (targets.includes(undefined)) continue;
      const position = m[1] === 'over' ? 'over' : m[1] === 'left of' ? 'left' : 'right';
      if (position !== 'over' && targets.length > 1) {
        problems.malformed(line, `a note ${m[1]} takes one participant`);
        continue;
      }
      current().push({ type: 'note', position, lifelines: targets as string[], text: decode(m[3]!.trim()) });
      continue;
    }
    m = /^ref\s+over\s+(.+?)\s*:\s*(.+)$/u.exec(t);
    if (m) {
      const covered = m[1]!.split(',').map(s => known(s.trim(), line));
      if (covered.includes(undefined)) continue;
      current().push(compact({ type: 'ref' as const, covered: covered as string[], ...parseCall(m[2]!) }));
      continue;
    }
    if (/^(?:note|hnote|rnote|ref)\b/u.test(t)) {
      problems.unsupported(
        line,
        'only one-line notes ("note over a, b : text"), state invariants ("hnote over a : {constraint}") and references ("ref over a, b : Name(args)") are read',
      );
      continue;
    }
    m = /^(alt|opt|loop|par|break|critical)(?:\s+(.*))?$/u.exec(t);
    if (m) {
      open({ type: 'fragment', operator: m[1] as Operator, operands: [] }, m[2], line);
      continue;
    }
    m = /^group\s+(\S+?)(?:\s+\[(.*)\])?$/u.exec(t);
    if (m) {
      const loop = /^loop\((\d+)(?:,(\d+|\*))?\)$/u.exec(m[1]!);
      if (loop) {
        open(
          compact({
            type: 'fragment' as const,
            operator: 'loop' as const,
            min: Number(loop[1]),
            max: loop[2] === undefined ? undefined : loop[2] === '*' ? ('*' as const) : Number(loop[2]),
            operands: [],
          }),
          m[2],
          line,
        );
        continue;
      }
      if (OPERATORS.has(m[1] as Operator)) {
        open({ type: 'fragment', operator: m[1] as Operator, operands: [] }, m[2], line);
        continue;
      }
    }
    if (/^group\b/u.test(t)) {
      problems.unsupported(
        line,
        'a group must be headed by an interaction operator (neg, strict, seq, assert or loop(min,max)); plain groups are not part of the model',
      );
      continue;
    }
    m = /^else(?:\s+(.*))?$/u.exec(t);
    if (m) {
      const frame = stack.at(-1);
      if (!frame) {
        problems.malformed(line, '"else" outside a fragment');
        continue;
      }
      const operand = { items: [] as Item[], ...(m[1] === undefined ? {} : { guard: decode(m[1].trim()) }) };
      frame.fragment.operands.push(operand);
      frame.items = operand.items;
      continue;
    }
    if (t === 'end') {
      const frame = stack.pop();
      if (!frame) problems.malformed(line, '"end" without an open fragment');
      continue;
    }
    m = MESSAGE.exec(t);
    if (m) {
      message(m, line);
      continue;
    }
    if (/^(?:\.\.\.|==|box\b|end box|return\b|newpage|delay)/u.test(t)) {
      problems.unsupported(line, 'delays, dividers, boxes and "return" are not part of the sequence model');
      continue;
    }
    problems.unsupported(
      line,
      'not a sequence diagram statement this importer understands (participants, messages, activations, notes, references, fragments)',
    );
  }
  for (const frame of stack) problems.malformed(frame.line, `the ${frame.fragment.operator} fragment is not closed with "end"`);

  function open(fragment: Fragment, guard: string | undefined, line: SourceLine): void {
    const operand = { items: [] as Item[], ...(guard?.trim() ? { guard: decode(guard.trim()) } : {}) };
    fragment.operands.push(operand);
    current().push(fragment);
    stack.push({ fragment, line, items: operand.items });
  }

  function message(m: RegExpExecArray, line: SourceLine): void {
    const [, written, writtenArrow, lostHead, receiver, marks = '', label] = m as unknown as [
      string,
      string,
      string,
      string | undefined,
      string | undefined,
      string | undefined,
      string | undefined,
    ];
    let left = written,
      arrow = writtenArrow,
      right = receiver;
    if (lostHead === 'x') {
      problems.unsupported(line, 'messages ending in a cross (->x) are not part of the model; destroy the receiver with "!!" or "destroy"');
      return;
    }
    if (lostHead === 'o]') right = 'o]';
    if (right === undefined) {
      problems.malformed(line, 'expected a receiver after the arrow');
      return;
    }
    const reversed = arrow.startsWith('<');
    if (reversed) {
      if (left === '[o' || right === 'o]') {
        problems.unsupported(line, 'found and lost messages are written left to right ([o-> b, a ->o])');
        return;
      }
      [left, right] = [right, left];
      arrow = arrow.replace(/^<<?/u, '') + (arrow.startsWith('<<') ? '>>' : '>');
    }
    const dashed = arrow.startsWith('--');
    const open = arrow.endsWith('>>');
    const flags = new Set(marks.match(/\*\*|!!|\+\+|--/gu));
    let parsedLabel: { name?: string; arguments?: string[]; assignment?: string; returnValue?: string } = {};
    if (label?.trim()) {
      const text = label.trim();
      const reply = dashed && !flags.has('**');
      const r = reply ? /^(?:(.*?)\s=\s)?(.*?)(?:\s:\s(.*))?$/u.exec(text)! : undefined;
      const callText = r ? r[2]! : text;
      parsedLabel = parseCall(callText);
      if (r?.[1] !== undefined) parsedLabel.assignment = decode(r[1].trim());
      if (r?.[3] !== undefined) parsedLabel.returnValue = decode(r[3].trim());
    }
    const activate = flags.has('++') || undefined,
      deactivate = flags.has('--') || undefined;
    if (left === '[o') {
      if (dashed || flags.has('**') || flags.has('!!') || deactivate) {
        problems.unsupported(line, 'a found message is solid ([o-> or [o->>) and can only activate its receiver');
        return;
      }
      const to = known(right, line);
      if (to)
        current().push(compact({ type: 'found' as const, sort: open ? ('asynchronous' as const) : ('synchronous' as const), to, ...parsedLabel, activate }));
      return;
    }
    if (right === 'o]') {
      if (dashed || flags.has('**') || flags.has('!!') || activate) {
        problems.unsupported(line, 'a lost message is solid (->o] or ->>o]) and can only deactivate its sender');
        return;
      }
      const from = known(left, line);
      if (from)
        current().push(compact({ type: 'lost' as const, sort: open ? ('asynchronous' as const) : ('synchronous' as const), from, ...parsedLabel, deactivate }));
      return;
    }
    let sort: MessageSort;
    if (flags.has('**')) sort = 'create';
    else if (flags.has('!!')) sort = 'delete';
    else sort = dashed ? 'reply' : open ? 'asynchronous' : 'synchronous';
    if (flags.has('**') && flags.has('!!')) {
      problems.malformed(line, 'a message cannot both create (**) and destroy (!!) its receiver');
      return;
    }
    if (sort === 'delete' && open) {
      problems.unsupported(line, 'a deleting message is synchronous (-> b !!)');
      return;
    }
    const from = lifeline(left),
      to = lifeline(right);
    current().push(compact({ type: 'message' as const, sort, from, to, ...parsedLabel, activate, deactivate }));
  }

  const model: Record<string, unknown> = { kind: 'sequence' };
  if (title !== undefined) model.title = title;
  if (autonumber) model.autonumber = true;
  model.lifelines = lifelines;
  model.items = top;
  return model;
}

export function detectSequence(lines: readonly SourceLine[]): number {
  let score = 0;
  for (const { text } of lines) {
    if (/^(?:participant|boundary|control|entity|database|collections|queue)\s/u.test(text)) score += 3;
    else if (/^(?:activate|deactivate|destroy|autonumber|alt|opt|loop|par|break|critical|group|ref over|hnote over)\b/u.test(text)) score += 2;
    else if (/^note\s+over\b/u.test(text) || /^\[o?-|-o?\]/u.test(text)) score += 2;
    else if (/^\S+\s*-{1,2}>{1,2}\s*\S+\s*(?:[*!+-]{2})*\s*(?::|$)/u.test(text) && !/[|*o+]--|--[|*o+]|\(.*\)\s*-|\[\*\]/u.test(text)) score += 1;
  }
  return score;
}

export const plantumlSequence: KindFormat<SequenceDiagram> = { kind: 'sequence', export: exportSequence, import: importSequence, detect: detectSequence };
