import { kindSchema } from '../../model/schema.js';

const ref = (name: string, description?: string) => ({ $ref: `#/definitions/${name}`, ...(description ? { description } : {}) });
const stereotypes = { type: 'array', maxItems: 4, items: ref('keyword'), description: 'Stereotype names without guillemets, drawn «a, b» above the name.' };

function relationship(type: string, description: string, extra: Record<string, unknown> = {}, required: string[] = []) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'from', 'to', ...required],
    description,
    properties: { id: ref('id', 'Optional ID, used in diagnostics and in the SVG.'), type: { const: type }, from: ref('id'), to: ref('id'), ...extra },
  };
}

/** JSON Schema of a use case diagram document (`diagramc schema use-case`). */
export const useCaseSchema = kindSchema({
  kind: 'use-case',
  title: 'UML use case diagram',
  description:
    'Actors, use cases (optionally inside a subject, the system boundary), associations, «include», «extend» with extension points and conditions, and generalizations. ' +
    'Layout reads left to right: the `from` end of an association is placed left of its `to` end, so put primary actors in `from` and secondary actors in `to`.',
  required: ['elements'],
  properties: {
    elements: {
      type: 'array',
      minItems: 1,
      maxItems: 120,
      items: ref('element'),
      description: 'Actors, use cases, subjects and notes. IDs share one namespace with relationship IDs.',
    },
    relationships: { type: 'array', maxItems: 250, items: ref('relationship') },
  },
  definitions: {
    end: {
      type: 'object',
      additionalProperties: false,
      properties: { multiplicity: ref('multiplicity', 'Drawn near this end, e.g. "0..1" or "*".') },
    },
    element: {
      type: 'object',
      discriminator: { propertyName: 'type' },
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'name'],
          description: 'An actor: stick figure with its name below.',
          properties: { id: ref('id'), type: { const: 'actor' }, name: ref('name'), stereotypes },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'name'],
          description: 'A use case: ellipse with its name; with `extensionPoints`, an "extension points" compartment below a line.',
          properties: {
            id: ref('id'),
            type: { const: 'useCase' },
            name: ref('name'),
            extensionPoints: {
              type: 'array',
              maxItems: 12,
              items: ref('name'),
              description: 'Names of the extension points; «extend» relationships into this use case must name one of them.',
            },
            subject: ref('id', 'ID of the subject (system boundary) that contains this use case.'),
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'name'],
          description: 'A subject (system boundary): a rectangle with its name at the top, containing the use cases that name it in `subject`.',
          properties: { id: ref('id'), type: { const: 'subject' }, name: ref('name'), stereotypes },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'text'],
          description: 'A comment with a folded corner, linked by dashed lines to the elements in `attachedTo`.',
          properties: { id: ref('id'), type: { const: 'note' }, text: ref('longText'), attachedTo: { type: 'array', maxItems: 10, items: ref('id') } },
        },
      ],
    },
    relationship: {
      type: 'object',
      discriminator: { propertyName: 'type' },
      oneOf: [
        relationship('association', 'Association between an actor and a use case: a solid line. `from` is placed left of `to`.', {
          name: ref('text', 'Association name, drawn at the middle.'),
          fromEnd: ref('end', 'Multiplicity at the `from` end.'),
          toEnd: ref('end', 'Multiplicity at the `to` end.'),
        }),
        relationship('include', '`from` (the base use case) includes `to` (the included use case): dashed line, open arrowhead at `to`, «include».'),
        relationship(
          'extend',
          '`from` (the extending use case) extends `to` (the base use case) at `extensionPoint`, declared by `to`: dashed line, open arrowhead at the base, «extend». A `condition` is shown in a note attached to the relationship.',
          {
            extensionPoint: ref('name', 'Name of one of the extension points of the base use case `to`.'),
            condition: ref('constraint', 'Condition under which the extension applies, drawn as `Condition: {condition}` in a note.'),
          },
          ['extensionPoint'],
        ),
        relationship('generalization', '`from` is the specific actor (or use case), `to` the general one: solid line, hollow triangle at `to`.'),
      ],
    },
  },
});
