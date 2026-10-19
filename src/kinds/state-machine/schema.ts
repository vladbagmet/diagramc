import { kindSchema } from '../../model/schema.js';

const ref = (name: string, description?: string) => ({ $ref: `#/definitions/${name}`, ...(description ? { description } : {}) });

function pseudostate(type: string, description: string) {
  return { type: 'object', additionalProperties: false, required: ['id', 'type'], description, properties: { id: ref('id'), type: { const: type } } };
}

/** JSON Schema of a state machine diagram document (`uml schema state-machine`). */
export const stateMachineSchema = kindSchema({
  kind: 'state-machine',
  title: 'UML state machine diagram',
  description: 'States (simple, composite with one or more orthogonal regions, submachine states) and pseudostates, connected by transitions labeled `trigger [guard] / effect`. '
    + 'Nesting is expressed by `regions`: a state with regions is a composite state; its vertices live in `regions[].elements`. Transitions are listed once, at the top level, and may connect vertices at any depth.',
  required: ['elements'],
  properties: {
    elements: { type: 'array', minItems: 1, maxItems: 120, items: ref('element'), description: 'Top-level vertices (the state machine\'s region) and notes. IDs are unique across the whole document, nested vertices included.' },
    transitions: { type: 'array', maxItems: 250, items: ref('transition') },
  },
  definitions: {
    behavior: {
      type: 'object', additionalProperties: false, required: ['trigger'],
      description: 'An internal transition, drawn in the state as `trigger [guard] / effect`.',
      properties: { trigger: ref('text'), guard: ref('text', 'Guard WITHOUT brackets.'), effect: ref('text', 'Effect behavior, drawn after "/".') },
    },
    region: {
      type: 'object', additionalProperties: false, required: ['elements'],
      description: 'A region of a composite state. Several regions are orthogonal (concurrent) and are separated by dashed lines.',
      properties: {
        id: ref('id', 'Optional ID, used in diagnostics.'),
        name: ref('name', 'Optional region name, drawn at the top left of the region.'),
        elements: { type: 'array', minItems: 1, maxItems: 60, items: ref('vertex') },
      },
    },
    connectionPoint: {
      type: 'object', additionalProperties: false, required: ['id', 'type'],
      description: 'An entry point (small circle) or exit point (circle with a cross) on the border of a composite or submachine state.',
      properties: { id: ref('id'), type: { enum: ['entryPoint', 'exitPoint'] }, name: ref('name', 'Drawn next to the point.') },
    },
    state: {
      type: 'object', additionalProperties: false, required: ['id', 'type', 'name'],
      description: 'A state: rounded rectangle with its name. With `regions` it is a composite state; with `submachine` a submachine state (`name : Submachine`).',
      properties: {
        id: ref('id'), type: { const: 'state' }, name: ref('name'),
        entry: ref('text', 'Entry behavior, drawn `entry / ...`.'),
        doActivity: ref('text', 'Do activity, drawn `do / ...`.'),
        exit: ref('text', 'Exit behavior, drawn `exit / ...`.'),
        internal: { type: 'array', maxItems: 20, items: ref('behavior'), description: 'Internal transitions.' },
        regions: { type: 'array', minItems: 1, maxItems: 6, items: ref('region'), description: 'Regions of a composite state, drawn top to bottom.' },
        submachine: ref('name', 'Name of the referenced state machine, drawn `name : submachine`. Not combined with regions.'),
        connectionPoints: { type: 'array', maxItems: 12, items: ref('connectionPoint'), description: 'Entry points (left border) and exit points (right border). Only on composite or submachine states.' },
      },
    },
    vertex: {
      type: 'object', discriminator: { propertyName: 'type' },
      oneOf: [
        ref('state'),
        pseudostate('initial', 'Initial pseudostate: a filled circle. At most one per region; exactly one outgoing transition, without trigger or guard.'),
        pseudostate('final', 'Final state: a circle around a filled circle. No outgoing transitions.'),
        pseudostate('choice', 'Choice pseudostate: a diamond. Outgoing transitions carry guards (dynamic branch).'),
        pseudostate('junction', 'Junction pseudostate: a small filled circle (static branch or merge).'),
        pseudostate('fork', 'Fork pseudostate: a bar. One incoming transition, outgoing transitions into orthogonal regions.'),
        pseudostate('join', 'Join pseudostate: a bar. Incoming transitions from orthogonal regions, one outgoing transition.'),
        pseudostate('shallowHistory', 'Shallow history pseudostate: a circle with H. Only inside a composite state.'),
        pseudostate('deepHistory', 'Deep history pseudostate: a circle with H*. Only inside a composite state.'),
        pseudostate('terminate', 'Terminate pseudostate: a cross. No outgoing transitions.'),
      ],
    },
    note: {
      type: 'object', additionalProperties: false, required: ['id', 'type', 'text'],
      description: 'A comment with a folded corner, linked by dashed lines to the vertices in `attachedTo`.',
      properties: { id: ref('id'), type: { const: 'note' }, text: ref('longText'), attachedTo: { type: 'array', maxItems: 10, items: ref('id') } },
    },
    element: {
      type: 'object', discriminator: { propertyName: 'type' },
      oneOf: [ref('state'), ...['initial', 'final', 'choice', 'junction', 'fork', 'join', 'shallowHistory', 'deepHistory', 'terminate'].map(t => pseudostate(t, `See vertex type "${t}".`)), ref('note')],
    },
    transition: {
      type: 'object', additionalProperties: false, required: ['from', 'to'],
      description: 'A transition from `from` to `to`, drawn as a solid line with an open arrowhead at `to`, labeled `trigger [guard] / effect`. `from` = `to` is a self-transition.',
      properties: {
        id: ref('id', 'Optional ID, used in diagnostics and in the SVG.'),
        from: ref('id', 'Source vertex or connection point.'), to: ref('id', 'Target vertex or connection point.'),
        trigger: ref('text', 'Event(s) that fire the transition, e.g. "timeout" or "keyPressed(key)".'),
        guard: ref('text', 'Guard WITHOUT brackets, drawn [guard].'),
        effect: ref('text', 'Effect behavior, drawn after "/".'),
      },
    },
  },
});
