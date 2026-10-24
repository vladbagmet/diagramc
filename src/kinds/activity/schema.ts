import { kindSchema } from '../../model/schema.js';

const ref = (name: string, description?: string) => ({ $ref: `#/definitions/${name}`, ...(description ? { description } : {}) });

const partition = ref('id', 'ID of the partition (swimlane) this node is drawn in. Required for every node except merge and join when `partitions` is given.');

function node(type: string, description: string, extra: Record<string, unknown> = {}, required: string[] = []) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'type', ...required],
    description,
    properties: { id: ref('id'), type: { const: type }, ...extra },
  };
}

const executable = {
  name: ref('name'),
  partition,
  note: ref('longText', 'A comment drawn next to this node, attached to it.'),
};

/** JSON Schema of an activity diagram document (`diagramc schema activity`). */
export const activitySchema = kindSchema({
  kind: 'activity',
  title: 'UML activity diagram',
  description:
    'An activity as a flow graph: actions, object nodes, signal actions and control nodes connected by control and object flows, optionally in partitions (swimlanes). ' +
    'The graph must be well structured: every decision closes at one merge node, every fork at one join node, and loops use a merge node (loop entry) and a decision node (loop exit). ' +
    'Decisions and merges, forks and joins are explicit nodes: an action has at most one incoming and one outgoing flow.',
  required: ['nodes', 'edges'],
  properties: {
    partitions: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: ref('partition'),
      description: 'Activity partitions, drawn as swimlanes left to right in this order.',
    },
    nodes: {
      type: 'array',
      minItems: 1,
      maxItems: 200,
      items: ref('node'),
      description: 'Activity nodes. IDs share one namespace with partition and edge IDs.',
    },
    edges: {
      type: 'array',
      minItems: 1,
      maxItems: 300,
      items: ref('edge'),
      description: 'Activity edges (flows), each from `from` to `to`; drawn with an arrowhead at `to`.',
    },
  },
  definitions: {
    partition: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name'],
      properties: { id: ref('id'), name: ref('name') },
    },
    node: {
      type: 'object',
      discriminator: { propertyName: 'type' },
      oneOf: [
        node('action', 'An opaque action: rounded rectangle with its name.', executable, ['name']),
        node('callBehavior', 'A call behavior action: rounded rectangle named after the called behavior.', executable, ['name']),
        node('sendSignal', 'A send signal action: convex pentagon with the signal name.', executable, ['name']),
        node('acceptEvent', 'An accept event action: rectangle with a concave notch on the left, with the event name.', executable, ['name']),
        node(
          'object',
          'An object node: rectangle with the name (type) and optional [state]. Connected by object flows only.',
          {
            ...executable,
            state: ref('name', 'Object state, drawn as [state] under the name.'),
          },
          ['name'],
        ),
        node('initial', 'The initial node: a filled circle. Exactly one per activity.', { partition }),
        node('activityFinal', "Activity final: a circle with a filled inner circle (bull's eye). Ends the whole activity.", { partition }),
        node('flowFinal', 'Flow final: a circle with an X. Ends only the flow that reaches it.', { partition }),
        node('decision', 'Decision node: a diamond. One incoming flow, two or more outgoing flows, each with a `guard`.', { partition }),
        node('merge', 'Merge node: a diamond. Two or more incoming flows, one outgoing flow. Closes a decision, or is the entry of a loop.'),
        node('fork', 'Fork node: a bar. One incoming flow, two or more outgoing flows (concurrent).', { partition }),
        node('join', 'Join node: a bar. Two or more incoming flows (from the matching fork), one outgoing flow.'),
      ],
    },
    edge: {
      type: 'object',
      additionalProperties: false,
      required: ['from', 'to'],
      properties: {
        id: ref('id', 'Optional ID, used in diagnostics.'),
        type: {
          enum: ['control', 'object'],
          description:
            '"control" for control flow; "object" for object flow (into or out of an object node). Both are drawn as solid arrows. Optional: when omitted, a flow touching an object node is an object flow, any other flow a control flow.',
        },
        from: ref('id'),
        to: ref('id'),
        guard: ref(
          'guard',
          'Guard condition WITHOUT brackets, drawn [guard]. Required on flows leaving a decision node and only allowed there; "else" is a valid guard.',
        ),
      },
    },
  },
});
