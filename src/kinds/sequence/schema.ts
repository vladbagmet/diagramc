import { kindSchema } from '../../model/schema.js';
import { MAX_LIFELINES, MAX_ITEMS } from './limits.js';

const ref = (name: string, description?: string) => ({ $ref: `#/definitions/${name}`, ...(description ? { description } : {}) });
const flag = (description: string) => ({ type: 'boolean', description });

const messageLabel = {
  id: ref('id', 'Optional ID, used in diagnostics.'),
  name: ref('text', 'Operation or signal name. Required for synchronous and asynchronous messages; optional for reply, create and delete messages.'),
  arguments: {
    type: 'array',
    maxItems: 12,
    items: ref('text'),
    description: 'Argument texts, drawn `name(a, b)`. An empty array draws `name()`; omit it to draw the bare name.',
  },
};
const activate = { activate: flag('Starts an activation (execution specification) on the receiving lifeline right after this message.') };
const deactivate = { deactivate: flag('Ends the innermost activation of the sending lifeline right after this message (typical for replies).') };
const sort = (values: string[], description: string) => ({ enum: values, description });

function item(type: string, description: string, required: string[], properties: Record<string, unknown>) {
  return { type: 'object', additionalProperties: false, required: ['type', ...required], description, properties: { type: { const: type }, ...properties } };
}

/** JSON Schema of a sequence diagram document (`uml schema sequence`). */
export const sequenceSchema = kindSchema({
  kind: 'sequence',
  title: 'UML sequence diagram',
  description:
    'Lifelines exchanging messages in time order (top to bottom), with activations, creation and destruction, combined fragments, interaction uses, state invariants and notes. Drawn inside a frame headed `sd <title>`.',
  required: ['lifelines', 'items'],
  properties: {
    autonumber: flag('Number every message (found and lost included) in drawing order.'),
    lifelines: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_LIFELINES,
      items: ref('lifeline'),
      description: 'Lifelines, drawn left to right in this order. A lifeline that is the target of a create message is drawn with its head at that message.',
    },
    items: { type: 'array', minItems: 1, maxItems: MAX_ITEMS, items: ref('item'), description: 'The interaction, in time order from top to bottom.' },
  },
  definitions: {
    lifeline: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      description: 'A lifeline, drawn as a head with `name : classifier` and a dashed line below it. At least one of `name` and `classifier` is required.',
      properties: {
        id: ref('id'),
        name: ref('name', 'Name of the represented connectable element, e.g. "cart".'),
        classifier: ref('name', 'Type of the represented element, e.g. "Cart"; drawn after a colon. With no name the head reads ": Cart".'),
        symbol: {
          enum: ['rectangle', 'actor', 'boundary', 'control', 'entity'],
          description: 'Head symbol: "rectangle" (default), "actor" (stick figure), or the «boundary», «control», «entity» stereotype icons.',
        },
      },
    },
    item: {
      type: 'object',
      discriminator: { propertyName: 'type' },
      oneOf: [
        item(
          'message',
          'A message from `from` to `to`. synchronous: solid line, filled arrowhead; asynchronous: solid line, open arrowhead; reply: dashed line, open arrowhead; create: dashed line, open arrowhead ending at the head of the created lifeline `to`; delete: solid line, filled arrowhead, ends in the destruction X of `to`. `from` = `to` draws a self-message.',
          ['sort', 'from', 'to'],
          {
            sort: sort(['synchronous', 'asynchronous', 'reply', 'create', 'delete'], 'UML message sort.'),
            from: ref('id', 'Sending lifeline.'),
            to: ref('id', 'Receiving lifeline.'),
            ...messageLabel,
            ...activate,
            ...deactivate,
            assignment: ref('text', 'Reply only: assignment target, drawn `target = name(...)`.'),
            returnValue: ref('text', 'Reply only: return value, drawn `name(...) : value`.'),
          },
        ),
        item('found', 'A found message (sender unknown): starts at a filled circle, ends at `to`.', ['sort', 'to'], {
          sort: sort(['synchronous', 'asynchronous'], 'Message sort.'),
          to: ref('id', 'Receiving lifeline.'),
          ...messageLabel,
          ...activate,
        }),
        item('lost', 'A lost message (receiver unknown): starts at `from`, ends at a filled circle.', ['sort', 'from'], {
          sort: sort(['synchronous', 'asynchronous'], 'Message sort.'),
          from: ref('id', 'Sending lifeline.'),
          ...messageLabel,
          ...deactivate,
        }),
        item('activate', 'Starts an activation (execution specification bar) on `lifeline`. Nested activations are drawn offset.', ['lifeline'], {
          lifeline: ref('id'),
        }),
        item('deactivate', 'Ends the innermost activation of `lifeline`.', ['lifeline'], { lifeline: ref('id') }),
        item('destroy', 'Destruction occurrence: an X ends `lifeline`. Nothing may refer to the lifeline afterwards.', ['lifeline'], { lifeline: ref('id') }),
        item(
          'stateInvariant',
          'State invariant: the constraint drawn in braces on `lifeline`, e.g. constraint "balance >= 0" is drawn {balance >= 0}.',
          ['lifeline', 'constraint'],
          {
            id: ref('id'),
            lifeline: ref('id'),
            constraint: ref('constraint', 'Constraint text without braces, drawn {constraint} on the lifeline.'),
          },
        ),
        item(
          'note',
          'A note (comment). position "over" spans the listed lifelines; "left" and "right" take exactly one lifeline.',
          ['position', 'lifelines', 'text'],
          {
            id: ref('id'),
            position: { enum: ['over', 'left', 'right'] },
            lifelines: { type: 'array', minItems: 1, maxItems: MAX_LIFELINES, items: ref('id') },
            text: ref('longText'),
          },
        ),
        item(
          'ref',
          'Interaction use: a frame headed "ref" spanning the `covered` lifelines, naming another interaction, e.g. Login(user).',
          ['covered', 'name'],
          {
            id: ref('id'),
            covered: { type: 'array', minItems: 1, maxItems: MAX_LIFELINES, items: ref('id') },
            name: ref('text', 'Name of the referred interaction.'),
            arguments: { type: 'array', maxItems: 12, items: ref('text'), description: 'Drawn `name(a, b)`.' },
          },
        ),
        item(
          'fragment',
          'Combined fragment: a frame with the operator in its pentagon and one region per operand, separated by dashed lines. alt: one or more operands; par, strict, seq: two or more; every other operator exactly one.',
          ['operator', 'operands'],
          {
            id: ref('id'),
            operator: { enum: ['alt', 'opt', 'loop', 'par', 'break', 'critical', 'neg', 'strict', 'seq', 'assert'], description: 'Interaction operator.' },
            min: { type: 'integer', minimum: 0, maximum: 1_000_000, description: 'loop only: minimum number of iterations, drawn loop(min,max).' },
            max: {
              anyOf: [{ type: 'integer', minimum: 0, maximum: 1_000_000 }, { const: '*' }],
              description: 'loop only: maximum number of iterations or "*"; requires `min`.',
            },
            operands: { type: 'array', minItems: 1, maxItems: 12, items: ref('operand') },
          },
        ),
      ],
    },
    operand: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      description: 'An interaction operand: an optional guard and its items in time order.',
      properties: {
        guard: ref('guard', 'Guard condition without brackets, drawn [guard]. Use "else" for the last alt operand.'),
        items: { type: 'array', minItems: 1, maxItems: MAX_ITEMS, items: ref('item') },
      },
    },
  },
});
