import { kindSchema } from '../../model/schema.js';

const ref = (name: string, description?: string) => ({ $ref: `#/definitions/${name}`, ...(description ? { description } : {}) });

function control(type: string, description: string) {
  return { type: 'object', additionalProperties: false, required: ['id', 'type'], description, properties: { id: ref('id'), type: { const: type } } };
}

/** JSON Schema of an interaction overview document (`uml schema interaction-overview`). */
export const interactionOverviewSchema = kindSchema({
  kind: 'interaction-overview',
  title: 'UML interaction overview diagram',
  description: 'An activity-like control flow (top-down) whose nodes are interaction uses (ref frames) and inline interactions (sd frames with a small sequence fragment), plus initial, final, flow-final, decision, merge, fork and join nodes (UML 2.5.1 clause 17.10). Exactly one initial node; every node must be reachable from it; every path ends in a final node.',
  required: ['nodes'],
  properties: {
    lifelines: { type: 'array', minItems: 1, maxItems: 12, items: ref('name'), description: 'Optional lifelines list for the frame heading, drawn "sd <title> lifelines :A, :B". Write each entry as it should appear, e.g. ":User" or "u:User"; an entry without a colon is a type and is drawn ":User".' },
    nodes: { type: 'array', minItems: 1, maxItems: 60, items: ref('node'), description: 'IDs share one namespace with flows and inline lifelines and messages.' },
    flows: { type: 'array', maxItems: 120, items: ref('flow'), description: 'Control flows, drawn as solid lines with an open arrowhead at `to`.' },
  },
  definitions: {
    flow: {
      type: 'object', additionalProperties: false, required: ['from', 'to'],
      description: 'Control flow from node `from` to node `to`.',
      properties: {
        id: ref('id', 'Optional ID, used in diagnostics and in the SVG (data-uml-id).'),
        from: ref('id'), to: ref('id'),
        guard: ref('guard', 'Guard without brackets, drawn [guard] near the source. Required on, and only allowed on, flows leaving a decision; "else" is allowed once.'),
      },
    },
    fragmentLifeline: {
      type: 'object', additionalProperties: false, required: ['id'],
      description: 'A lifeline of an inline interaction, drawn as a head `name : type` with a dashed line. At least one of `name` and `type`.',
      properties: { id: ref('id'), name: ref('name'), type: ref('name') },
    },
    fragmentMessage: {
      type: 'object', additionalProperties: false, required: ['from', 'to', 'name'],
      description: 'A message between two lifelines of the same inline interaction, drawn in list order from top to bottom: filled arrowhead for synchronous calls, open arrowhead for asynchronous signals, dashed line with open arrowhead for replies. `from` = `to` draws a self-message.',
      properties: {
        id: ref('id'), from: ref('id'), to: ref('id'), name: ref('text'),
        arguments: { type: 'array', maxItems: 6, items: ref('text'), description: 'Drawn name(a, b); omit to draw the name alone, [] draws name().' },
        sort: { enum: ['synchronous', 'asynchronous', 'reply'], description: 'Default "synchronous".' },
      },
    },
    node: {
      type: 'object', discriminator: { propertyName: 'type' },
      oneOf: [
        control('initial', 'Initial node: small filled circle. Exactly one per diagram, no incoming flows.'),
        control('final', 'Activity final node: bull\'s eye. Ends the whole interaction; no outgoing flows.'),
        control('flow-final', 'Flow final node: circle with an X. Ends one flow; no outgoing flows.'),
        control('decision', 'Decision node: diamond with one incoming flow and two or more guarded outgoing flows.'),
        control('merge', 'Merge node: diamond with two or more incoming flows and one outgoing flow.'),
        control('fork', 'Fork node: black bar with one incoming flow and two or more outgoing flows (concurrent).'),
        control('join', 'Join node: black bar with two or more incoming flows and one outgoing flow.'),
        {
          type: 'object', additionalProperties: false, required: ['id', 'type', 'name'],
          description: 'Interaction use: a frame with the `ref` keyword and the name of the referenced interaction.',
          properties: {
            id: ref('id'), type: { const: 'interaction-use' }, name: ref('name', 'Name of the referenced interaction.'),
            arguments: { type: 'array', maxItems: 6, items: ref('text'), description: 'Actual arguments, drawn name(a, b).' },
          },
        },
        {
          type: 'object', additionalProperties: false, required: ['id', 'type', 'name', 'lifelines', 'messages'],
          description: 'Inline interaction: an `sd` frame with lifeline heads and messages, drawn as a small sequence fragment.',
          properties: {
            id: ref('id'), type: { const: 'interaction' }, name: ref('name'),
            lifelines: { type: 'array', minItems: 1, maxItems: 6, items: ref('fragmentLifeline') },
            messages: { type: 'array', minItems: 1, maxItems: 12, items: ref('fragmentMessage') },
          },
        },
      ],
    },
  },
});
