import { kindSchema } from '../../model/schema.js';

const ref = (name: string, description?: string) => ({ $ref: `#/definitions/${name}`, ...(description ? { description } : {}) });
const stereotypes = { type: 'array', maxItems: 4, items: ref('keyword'), description: 'Stereotype names without guillemets, e.g. ["framework"], drawn «framework» above the name.' };

function classifier(type: string, description: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'object', additionalProperties: false, required: ['id', 'type', 'name'], description,
    properties: { id: ref('id'), type: { const: type }, name: ref('name'), stereotypes, ...extra },
  };
}

function relationship(type: string, description: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'object', additionalProperties: false, required: ['type', 'from', 'to'], description,
    properties: {
      id: ref('id', 'Optional ID, used in diagnostics and in the SVG (data-uml-id).'),
      type: { const: type },
      from: ref('id'), to: ref('id'), ...extra,
    },
  };
}

/** JSON Schema of a package diagram document (`uml schema package`). */
export const packageSchema = kindSchema({
  kind: 'package',
  title: 'UML package diagram',
  description: 'Packages (nested through `members`), the classifiers they own drawn as name-only boxes, and notes, connected by package import («import»), private import («access»), package merge («merge»), dependency and containment (circle-plus).',
  required: ['elements'],
  properties: {
    elements: { type: 'array', minItems: 1, maxItems: 150, items: ref('element'), description: 'Packages, classifiers and notes. IDs share one namespace with relationship IDs.' },
    relationships: { type: 'array', maxItems: 300, items: ref('relationship') },
  },
  definitions: {
    element: {
      type: 'object', discriminator: { propertyName: 'type' },
      oneOf: [
        {
          type: 'object', additionalProperties: false, required: ['id', 'type', 'name'],
          description: 'A package: tab-folder shape. With members it is drawn as a frame around them, name in the tab; without, the name sits in the body.',
          properties: {
            id: ref('id'), type: { const: 'package' }, name: ref('name'), stereotypes,
            members: { type: 'array', maxItems: 100, items: ref('id'), description: 'IDs of the elements drawn nested inside this package (packages, classifiers, notes). An element has at most one owner.' },
          },
        },
        classifier('class', 'A class, drawn as a name-only box. `abstract: true` draws the name in italics.', { abstract: { type: 'boolean', description: 'Abstract class: name in italics.' } }),
        classifier('interface', 'An interface, drawn with the «interface» keyword.'),
        classifier('enumeration', 'An enumeration, drawn with the «enumeration» keyword.'),
        classifier('datatype', 'A data type, drawn with the «dataType» keyword.'),
        {
          type: 'object', additionalProperties: false, required: ['id', 'type', 'text'],
          description: 'A comment (note) with a folded corner, linked by dashed lines to the elements in `attachedTo`.',
          properties: { id: ref('id'), type: { const: 'note' }, text: ref('longText'), attachedTo: { type: 'array', maxItems: 10, items: ref('id') } },
        },
      ],
    },
    relationship: {
      type: 'object', discriminator: { propertyName: 'type' },
      oneOf: [
        relationship('import', 'Public package import or element import: `from` (a package) imports `to` (a package or a classifier). Dashed line, open arrowhead at `to`, «import».'),
        relationship('access', 'Private package import or element import: like `import`, drawn «access».'),
        relationship('merge', 'Package merge: `from` (the receiving package) merges `to` (the merged package). Dashed line, open arrowhead at `to`, «merge».'),
        relationship('dependency', '`from` (client) depends on `to` (supplier). Dashed line, open arrowhead at `to`, optional «keyword» and name.', {
          name: ref('text'), keyword: ref('keyword', 'Optional keyword such as "use", drawn «use».'),
        }),
        relationship('containment', '`from` (a package or class) owns `to`, drawn outside it. Solid line, circle with a plus at `from`. An alternative to nesting with `members`.'),
      ],
    },
  },
});
