import { TEXT_KEYWORD, TEXT_PATTERN } from '../../core/text.js';
import { kindSchema } from '../../model/schema.js';

const ref = (name: string, description?: string) => ({ $ref: `#/definitions/${name}`, ...(description ? { description } : {}) });

/** JSON Schema of a communication diagram document (`uml schema communication`). */
export const communicationSchema = kindSchema({
  kind: 'communication',
  title: 'UML communication diagram',
  description: 'Lifelines (rectangles) connected by links (solid lines). Messages travel on links and are listed beside them with decimal sequence numbers and an arrow pointing from sender to receiver (UML 2.5.1 clause 17.9). Every message needs a link between its sender and receiver (a self-link when they are the same lifeline).',
  required: ['lifelines'],
  properties: {
    lifelines: { type: 'array', minItems: 1, maxItems: 40, items: ref('lifeline'), description: 'Participants. IDs share one namespace with link and message IDs.' },
    links: { type: 'array', maxItems: 80, items: ref('link'), description: 'Connectors between lifelines, at most one per pair. `from` = `to` is a self-link.' },
    messages: { type: 'array', maxItems: 150, items: ref('message'), description: 'Messages, in any order; they are listed by sequence number.' },
  },
  definitions: {
    sequenceNumber: {
      type: 'string', minLength: 1, maxLength: 40, pattern: TEXT_PATTERN, [TEXT_KEYWORD]: true,
      description: 'Decimal sequence number: integers joined by ".", each optionally followed by a lowercase letter for concurrent threads, e.g. "1", "1.2", "2a", "2b.1". Message "1.2" is sent by the receiver of "1" while it handles "1"; siblings are numbered 1, 2, 3 ... without gaps.',
    },
    lifeline: {
      type: 'object', additionalProperties: false, required: ['id'],
      description: 'A participant, drawn as a rectangle labelled `name[selector] : type`. At least one of `name` and `type` is required.',
      properties: {
        id: ref('id'),
        name: ref('name', 'Role (connectable element) name, e.g. "order".'),
        type: ref('name', 'Classifier name, drawn after " : ", e.g. "Order".'),
        selector: ref('text', 'Selects one instance of a multivalued role, drawn name[selector]. Requires `name`.'),
        multiObject: { type: 'boolean', description: 'Draw as a stack of rectangles: the lifeline stands for a set of instances.' },
      },
    },
    link: {
      type: 'object', additionalProperties: false, required: ['from', 'to'],
      description: 'A link (connector) between two lifelines, drawn as a solid line. Direction does not matter.',
      properties: { id: ref('id', 'Optional ID, used in diagnostics and in the SVG (data-uml-id).'), from: ref('id'), to: ref('id') },
    },
    message: {
      type: 'object', additionalProperties: false, required: ['sequence', 'from', 'to', 'name'],
      dependencies: { parallel: ['iteration'] },
      description: 'Drawn `sequence [guard]: assignTo = name(arguments): returnValue` (or `sequence *[iteration]: ...`) beside the link between `from` (sender) and `to` (receiver), with an arrow pointing to the receiver: filled arrowhead for synchronous calls, open for asynchronous signals, dashed with an open arrowhead for replies.',
      properties: {
        id: ref('id'),
        sequence: ref('sequenceNumber'),
        from: ref('id', 'Sending lifeline.'),
        to: ref('id', 'Receiving lifeline.'),
        name: ref('text', 'Operation or signal name.'),
        arguments: { type: 'array', maxItems: 10, items: ref('text'), description: 'Argument expressions, drawn name(a, b). Omit to draw the name without parentheses; [] draws name().' },
        assignTo: ref('text', 'Variable or attribute receiving the result, drawn "assignTo = name(...)". Not for asynchronous messages.'),
        returnValue: ref('text', 'Returned value, drawn after the name ": value". Reply messages only.'),
        guard: ref('guard', 'Condition without brackets, drawn [guard] after the sequence number. Not combined with iteration.'),
        iteration: ref('guard', 'Iteration clause without brackets, e.g. "i=1..n", drawn *[i=1..n] after the sequence number.'),
        parallel: { type: 'boolean', description: 'Iterations run concurrently, drawn *||[...]. Requires `iteration`.' },
        sort: { enum: ['synchronous', 'asynchronous', 'reply'], description: 'Default "synchronous".' },
      },
    },
  },
});
