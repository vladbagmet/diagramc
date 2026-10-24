import { kindSchema } from '../../model/schema.js';

const ref = (name: string, description?: string) => ({ $ref: `#/definitions/${name}`, ...(description ? { description } : {}) });

function element(type: string, description: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'type', 'name'],
    description,
    properties: { id: ref('id'), type: { const: type }, name: ref('name'), ...extra },
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

const members = { type: 'array', maxItems: 100, items: ref('id'), description: 'IDs of the elements drawn nested inside. An element has at most one owner.' };

/** JSON Schema of a profile diagram document (`diagramc schema profile`). */
export const profileSchema = kindSchema({
  kind: 'profile',
  title: 'UML profile diagram',
  description:
    'Profiles with their stereotypes (tagged values as attributes), the metaclasses they extend, profile application to packages and metaclass references.',
  required: ['elements'],
  properties: {
    elements: {
      type: 'array',
      minItems: 1,
      maxItems: 150,
      items: ref('element'),
      description: 'Profiles, packages, stereotypes, metaclasses, enumerations, classes and notes. IDs share one namespace with relationship IDs.',
    },
    relationships: { type: 'array', maxItems: 300, items: ref('relationship') },
  },
  definitions: {
    taggedValue: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      description: 'A stereotype property (tag definition), drawn `name : type [multiplicity] = default`.',
      properties: { name: ref('text'), type: ref('text'), multiplicity: ref('multiplicity'), default: ref('text', 'Default value, shown after "=".') },
    },
    element: {
      type: 'object',
      discriminator: { propertyName: 'type' },
      oneOf: [
        element('profile', 'A profile: package with the «profile» keyword. Its stereotypes and referenced metaclasses go in `members`.', { members }),
        element('package', 'A package, e.g. a model that applies a profile. With members it is drawn as a frame around them.', { members }),
        element(
          'stereotype',
          'A stereotype: class box with «stereotype»; tagged values in an attributes compartment. Abstract stereotypes have an italic name.',
          {
            abstract: { type: 'boolean', description: 'Abstract stereotype: name in italics.' },
            attributes: { type: 'array', maxItems: 40, items: ref('taggedValue'), description: 'Tagged value definitions.' },
          },
        ),
        element('metaclass', 'A UML metaclass that stereotypes extend, e.g. "Class" or "Component": class box with «metaclass».'),
        element('enumeration', 'An enumeration used as the type of tagged values, drawn with «enumeration» and its literals.', {
          literals: { type: 'array', maxItems: 60, items: ref('text'), description: 'Enumeration literals, one per line.' },
        }),
        element('class', 'An ordinary class (for example in a package that applies the profile), optionally showing applied stereotypes.', {
          stereotypes: { type: 'array', maxItems: 4, items: ref('keyword'), description: 'Applied stereotype names without guillemets, drawn above the name.' },
        }),
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
        relationship(
          'extension',
          '`from` (a stereotype) extends `to` (a metaclass). Solid line, filled triangle at the metaclass; `required: true` adds {required} at the stereotype end.',
          {
            required: { type: 'boolean', description: 'Every instance of the metaclass must carry the stereotype: drawn {required}.' },
          },
        ),
        relationship('generalization', '`from` (the specific stereotype) specializes `to` (the general stereotype). Solid line, hollow triangle at `to`.'),
        relationship(
          'apply',
          'Profile application: `from` (a package or profile) applies the profile `to`. Dashed line, open arrowhead at the profile, «apply».',
        ),
        relationship(
          'reference',
          'Metaclass reference: `from` (a profile) references `to` (a metaclass or a metamodel package). Dashed line, open arrowhead, «reference».',
        ),
      ],
    },
  },
});
