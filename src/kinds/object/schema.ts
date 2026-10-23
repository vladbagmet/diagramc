import { TEXT_PATTERN } from '../../core/text.js';
import { kindSchema } from '../../model/schema.js';

const ref = (name: string, description?: string) => ({ $ref: `#/definitions/${name}`, ...(description ? { description } : {}) });

/** JSON Schema of an object diagram document (`uml schema object`). */
export const objectSchema = kindSchema({
  kind: 'object',
  title: 'UML object diagram',
  description:
    'Instance specifications (objects) with slot values, connected by links (instances of associations), plus notes. Optional classifier declarations make the validator check classifier names and slot features.',
  required: ['elements'],
  properties: {
    classifiers: {
      type: 'array',
      maxItems: 100,
      items: ref('classifierDeclaration'),
      description:
        'Optional. When present, every instance `classifier` must name one of these, and slots must name declared attributes (if the classifier lists any). Not drawn.',
    },
    elements: { type: 'array', minItems: 1, maxItems: 150, items: ref('element'), description: 'Instances and notes. IDs share one namespace with link IDs.' },
    relationships: { type: 'array', maxItems: 300, items: ref('link') },
  },
  definitions: {
    // Declared names are compared with drawn text but are not drawn themselves,
    // so they carry no display-text marker.
    declaredName: { type: 'string', minLength: 1, maxLength: 100, pattern: TEXT_PATTERN, description: 'A classifier or attribute name, single line.' },
    classifierDeclaration: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: ref('declaredName', 'Classifier name as instances write it in `classifier`.'),
        attributes: {
          type: 'array',
          maxItems: 60,
          items: ref('declaredName'),
          description: 'Attribute names; slots of instances of this classifier must use them.',
        },
      },
    },
    slot: {
      type: 'object',
      additionalProperties: false,
      required: ['feature', 'value'],
      description: 'A slot, drawn `feature = value` or `feature : type = value`. The value is shown literally (write quotes yourself for strings).',
      properties: { feature: ref('text', 'The attribute this slot gives a value to.'), type: ref('text'), value: ref('text') },
    },
    linkEnd: {
      type: 'object',
      additionalProperties: false,
      properties: {
        role: ref('text', 'Role (end) name, drawn near this end.'),
        navigable: { type: 'boolean', description: 'true: open arrowhead at this end; false: an X; omitted: unspecified. Must agree with the association.' },
      },
    },
    element: {
      type: 'object',
      discriminator: { propertyName: 'type' },
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type'],
          description:
            'An instance specification: box with `name : classifier` underlined, and a slots compartment. Give a name, a classifier or both (`: Order` is an anonymous instance).',
          properties: {
            id: ref('id'),
            type: { const: 'instance' },
            name: ref('name', 'Instance name; omit for an anonymous instance.'),
            classifier: ref('name', 'Classifier name; omit when the classifier is unknown or unimportant.'),
            stereotypes: { type: 'array', maxItems: 4, items: ref('keyword'), description: 'Stereotype names without guillemets, drawn above the name.' },
            slots: { type: 'array', maxItems: 40, items: ref('slot') },
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
    link: {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'from', 'to'],
      description:
        'A link (instance of an association) between two instances: solid line. `name` and `association` are drawn underlined near the middle as `name : association`; role names and navigability per end.',
      properties: {
        id: ref('id', 'Optional ID, used in diagnostics and in the SVG (data-uml-id).'),
        type: { const: 'link' },
        from: ref('id'),
        to: ref('id'),
        name: ref('text', 'Link name.'),
        association: ref('text', 'Name of the association this link instantiates.'),
        fromEnd: ref('linkEnd', 'Properties of the end at `from`.'),
        toEnd: ref('linkEnd', 'Properties of the end at `to`.'),
      },
    },
  },
});
