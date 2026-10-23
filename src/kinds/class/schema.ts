import { kindSchema } from '../../model/schema.js';

const ref = (name: string, description?: string) => ({ $ref: `#/definitions/${name}`, ...(description ? { description } : {}) });
const flag = (description: string) => ({ type: 'boolean', description });

const members = {
  stereotypes: {
    type: 'array',
    maxItems: 4,
    items: ref('keyword'),
    description: 'Stereotype names without guillemets, e.g. ["entity"], drawn «entity» above the name.',
  },
  attributes: { type: 'array', maxItems: 40, items: ref('attribute') },
  operations: { type: 'array', maxItems: 40, items: ref('operation') },
};

function classifier(type: string, description: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'type', 'name'],
    description,
    properties: { id: ref('id'), type: { const: type }, name: ref('name'), ...members, ...extra },
  };
}

function relationship(type: string, description: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'from', 'to'],
    description,
    properties: {
      id: ref('id', 'Optional ID, used in diagnostics and in the SVG (data-uml-id).'),
      type: { const: type },
      from: ref('id'),
      to: ref('id'),
      ...extra,
    },
  };
}

const associationEnds = {
  name: ref('text', 'Association name, drawn at the middle of the line.'),
  fromEnd: ref('end', 'Properties of the end at `from`.'),
  toEnd: ref('end', 'Properties of the end at `to`.'),
};

/** JSON Schema of a class diagram document (`uml schema class`). */
export const classSchema = kindSchema({
  kind: 'class',
  title: 'UML class diagram',
  description:
    'Classes, interfaces, enumerations, data types and notes, connected by generalization, realization, association, aggregation, composition, dependency and containment. Member text is structured and formatted by the renderer in UML 2.5.1 notation.',
  required: ['elements'],
  properties: {
    elements: {
      type: 'array',
      minItems: 1,
      maxItems: 150,
      items: ref('element'),
      description: 'Classifiers and notes. IDs share one namespace with relationship IDs.',
    },
    relationships: { type: 'array', maxItems: 300, items: ref('relationship') },
  },
  definitions: {
    visibility: { enum: ['public', 'private', 'protected', 'package'], description: 'Drawn as + - # ~.' },
    attribute: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      description: 'Drawn as `[visibility] [/]name [: type] [[multiplicity]] [= default] [{readOnly}]`; static attributes are underlined.',
      properties: {
        name: ref('text'),
        type: ref('text'),
        visibility: ref('visibility'),
        multiplicity: ref('multiplicity'),
        default: ref('text', 'Default value, shown after "=".'),
        static: flag('Underlined.'),
        derived: flag('Prefixed with "/".'),
        readOnly: flag('Suffixed with {readOnly}.'),
      },
    },
    parameter: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: ref('text'),
        type: ref('text'),
        direction: { enum: ['in', 'out', 'inout'], description: '"in" is the default and is not drawn.' },
        multiplicity: ref('multiplicity'),
        default: ref('text'),
      },
    },
    operation: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      description: 'Drawn as `[visibility] name(parameters) [: returnType] [{query}]`; static operations are underlined, abstract ones italic.',
      properties: {
        name: ref('text'),
        parameters: { type: 'array', maxItems: 12, items: ref('parameter') },
        returnType: ref('text'),
        visibility: ref('visibility'),
        static: flag('Underlined.'),
        abstract: flag('Italic. Only in abstract classes and interfaces.'),
        query: flag('Suffixed with {query}.'),
      },
    },
    end: {
      type: 'object',
      additionalProperties: false,
      properties: {
        role: ref('text', 'Role (end) name, drawn near this end.'),
        multiplicity: ref('multiplicity', 'Drawn near this end.'),
        navigable: flag('true: open arrowhead at this end; false: an X (explicitly not navigable); omitted: unspecified.'),
      },
    },
    element: {
      type: 'object',
      discriminator: { propertyName: 'type' },
      oneOf: [
        classifier('class', 'A class. `abstract: true` draws the name in italics.', { abstract: flag('Abstract class: name in italics.') }),
        classifier('interface', 'An interface, drawn with the «interface» keyword.'),
        classifier('enumeration', 'An enumeration, drawn with the «enumeration» keyword and a literals compartment.', {
          literals: { type: 'array', maxItems: 60, items: ref('text'), description: 'Enumeration literals, one per line.' },
        }),
        classifier('datatype', 'A data type, drawn with the «dataType» keyword.'),
        classifier('primitive', 'A primitive type, drawn with the «primitive» keyword.'),
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'text'],
          description: 'A comment (note) with a folded corner, linked by dashed lines to the elements in `attachedTo`.',
          properties: { id: ref('id'), type: { const: 'note' }, text: ref('longText'), attachedTo: { type: 'array', maxItems: 10, items: ref('id') } },
        },
      ],
    },
    relationship: {
      type: 'object',
      discriminator: { propertyName: 'type' },
      oneOf: [
        relationship('generalization', '`from` is the specific (sub) classifier, `to` the general one. Hollow triangle at `to`.'),
        relationship('realization', '`from` implements the interface `to`. Dashed line, hollow triangle at `to`.'),
        relationship('association', 'Solid line between `from` and `to`.', associationEnds),
        relationship('aggregation', 'Shared aggregation: `from` is the whole (hollow diamond), `to` the part.', associationEnds),
        relationship(
          'composition',
          'Composite aggregation: `from` is the whole (filled diamond), `to` the part. The whole end multiplicity must be at most 1.',
          associationEnds,
        ),
        relationship('dependency', '`from` (client) depends on `to` (supplier). Dashed line, open arrowhead at `to`.', {
          name: ref('text'),
          keyword: ref('keyword', 'Optional keyword such as "use", "create", "call", drawn «use».'),
        }),
        relationship('containment', '`from` owns the nested classifier `to`. Circle-plus at `from`.'),
      ],
    },
  },
});
