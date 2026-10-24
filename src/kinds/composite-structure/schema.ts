import { kindSchema } from '../../model/schema.js';

const ref = (name: string, description?: string) => ({ $ref: `#/definitions/${name}`, ...(description ? { description } : {}) });

/** JSON Schema of a composite structure diagram document (`diagramc schema composite-structure`). */
export const compositeStructureSchema = kindSchema({
  kind: 'composite-structure',
  title: 'UML composite structure diagram',
  description:
    'Structured classifiers with their internal structure: parts and reference properties (dashed), ports on the classifier and on parts, connectors with names, roles and multiplicities; collaborations (dashed ellipses with roles) and collaboration uses with role bindings; notes. Laid out left to right.',
  required: ['elements'],
  properties: {
    elements: {
      type: 'array',
      minItems: 1,
      maxItems: 40,
      items: ref('element'),
      description:
        'Structured classifiers, collaborations and notes. IDs of elements, parts, ports, roles, collaboration uses and relationships share one namespace.',
    },
    relationships: { type: 'array', maxItems: 150, items: ref('relationship') },
  },
  definitions: {
    port: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      description: 'A port: a small square on the border of its classifier or part, labelled `name : Type [multiplicity]`.',
      properties: {
        id: ref('id'),
        name: ref('name'),
        type: ref('name'),
        multiplicity: ref('multiplicity'),
        conjugated: { type: 'boolean', description: 'Conjugated port (provided and required interfaces swapped): type drawn `~Type`. Requires `type`.' },
      },
    },
    part: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name'],
      description:
        'A part (property of the structured classifier): rectangle labelled `name : Type [multiplicity]`. Composite parts have a solid outline, shared or plain reference properties a dashed one.',
      properties: {
        id: ref('id'),
        name: ref('name'),
        type: ref('name'),
        multiplicity: ref('multiplicity'),
        aggregation: {
          enum: ['composite', 'shared', 'none'],
          description: '"composite" (default) draws a solid outline; "shared" and "none" (references to instances owned elsewhere) a dashed one.',
        },
        ports: { type: 'array', maxItems: 12, items: ref('port') },
        parts: { type: 'array', maxItems: 20, items: ref('part'), description: "The part's own internal structure, drawn inside it." },
      },
    },
    collaborationUse: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'collaboration'],
      description:
        'A collaboration use: dashed ellipse `name : Collaboration` inside the classifier, with a dashed line to each bound part labelled with the role it plays.',
      properties: {
        id: ref('id'),
        name: ref('name'),
        collaboration: ref('id', 'ID of the applied collaboration.'),
        bindings: {
          type: 'array',
          maxItems: 12,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['role', 'part'],
            properties: { role: ref('id', 'ID of a role of the collaboration.'), part: ref('id', 'ID of a part of this classifier that plays the role.') },
          },
        },
      },
    },
    role: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name'],
      description: "A collaboration role: rectangle labelled `name : Type [multiplicity]` inside the collaboration's ellipse.",
      properties: { id: ref('id'), name: ref('name'), type: ref('name'), multiplicity: ref('multiplicity') },
    },
    element: {
      type: 'object',
      discriminator: { propertyName: 'type' },
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'name'],
          description:
            'A structured class: rectangle with its name compartment and, below it, the internal structure compartment holding its parts and collaboration uses. Ports sit on its border.',
          properties: {
            id: ref('id'),
            type: { const: 'class' },
            name: ref('name'),
            stereotypes: { type: 'array', maxItems: 4, items: ref('keyword'), description: 'Stereotype names without guillemets.' },
            ports: { type: 'array', maxItems: 16, items: ref('port') },
            parts: { type: 'array', maxItems: 30, items: ref('part') },
            collaborationUses: { type: 'array', maxItems: 6, items: ref('collaborationUse') },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'name', 'roles'],
          description: 'A collaboration: dashed ellipse with its name above a dashed line and its roles (connected by connectors) below.',
          properties: {
            id: ref('id'),
            type: { const: 'collaboration' },
            name: ref('name'),
            roles: { type: 'array', minItems: 1, maxItems: 12, items: ref('role') },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'text'],
          description: 'A comment (note) with a folded corner, linked by dashed lines to the elements in `attachedTo`.',
          properties: { id: ref('id'), type: { const: 'note' }, text: ref('longText'), attachedTo: { type: 'array', maxItems: 10, items: ref('id') } },
        },
      ],
    },
    end: {
      type: 'object',
      additionalProperties: false,
      properties: { role: ref('text', 'End name, drawn near this end.'), multiplicity: ref('multiplicity', 'Drawn near this end.') },
    },
    relationship: {
      type: 'object',
      discriminator: { propertyName: 'type' },
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'from', 'to'],
          description:
            'A connector between parts, ports or roles of one structured class (or one collaboration): solid line, `name : association` at the middle, end names and multiplicities at the ends.',
          properties: {
            id: ref('id', 'Optional ID, used in diagnostics and in the SVG (data-uml-id).'),
            type: { const: 'connector' },
            from: ref('id'),
            to: ref('id'),
            name: ref('text', 'Connector name.'),
            association: ref('name', 'Type of the connector (an association), drawn `name : association`.'),
            fromEnd: ref('end'),
            toEnd: ref('end'),
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'from', 'to'],
          description: '`from` depends on `to` (classifiers or collaborations): dashed line, open arrowhead at `to`, optional «keyword».',
          properties: {
            id: ref('id', 'Optional ID, used in diagnostics and in the SVG (data-uml-id).'),
            type: { const: 'dependency' },
            from: ref('id'),
            to: ref('id'),
            keyword: ref('keyword'),
            name: ref('text'),
          },
        },
      ],
    },
  },
});
