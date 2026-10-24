import type { JsonSchema } from '../../model/kind.js';
import { kindSchema } from '../../model/schema.js';
import { classSchema } from '../class/schema.js';

const ref = (name: string, description?: string) => ({ $ref: `#/definitions/${name}`, ...(description ? { description } : {}) });
const classDefinitions = classSchema.definitions as Record<string, JsonSchema>;

const interfaceList = (description: string) => ({ type: 'array', maxItems: 12, items: ref('id'), description });
const stereotypes = { type: 'array', maxItems: 4, items: ref('keyword'), description: 'Stereotype names without guillemets, drawn «a, b» above the name.' };
const realizing = {
  ports: { type: 'array', maxItems: 16, items: ref('port') },
  provides: interfaceList('IDs of interfaces provided directly (no port): a lollipop on the left border.'),
  requires: interfaceList('IDs of interfaces required directly (no port): a socket on the right border.'),
};

function relationship(type: string, description: string, extra: Record<string, unknown> = {}, required: string[] = []) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'from', 'to', ...required],
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

/** JSON Schema of a component diagram document (`diagramc schema component`). */
export const componentSchema = kindSchema({
  kind: 'component',
  title: 'UML component diagram',
  description:
    'Components with ports, provided interfaces (lollipops) and required interfaces (sockets), nested components and classes, assembly connectors (ball-and-socket), delegation connectors, interfaces as classifiers with realization and usage, artifacts manifesting components, and notes. Laid out left to right: requiring elements left of the elements providing to them.',
  required: ['elements'],
  properties: {
    elements: {
      type: 'array',
      minItems: 1,
      maxItems: 80,
      items: ref('element'),
      description: 'Top-level elements. IDs of elements, nested elements, ports and relationships share one namespace.',
    },
    relationships: { type: 'array', maxItems: 150, items: ref('relationship') },
  },
  definitions: {
    visibility: classDefinitions.visibility!,
    parameter: classDefinitions.parameter!,
    operation: classDefinitions.operation!,
    port: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      description:
        "A port: a small square on the owner's border. Its provided and required interfaces are drawn on it as lollipops and sockets, or as ball-and-socket joints when an assembly connects them.",
      properties: {
        id: ref('id'),
        name: ref('name', 'Port name, drawn next to the square.'),
        type: ref('name', 'Port type, drawn "name : Type".'),
        provides: interfaceList('IDs of interfaces this port provides.'),
        requires: interfaceList('IDs of interfaces this port requires.'),
      },
    },
    component: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'type', 'name'],
      description: 'A component: rectangle with the «component» keyword and the component icon. Nested `elements` are drawn inside it.',
      properties: {
        id: ref('id'),
        type: { const: 'component' },
        name: ref('name'),
        stereotypes,
        ...realizing,
        elements: { type: 'array', maxItems: 30, items: ref('nested'), description: "Nested components and classes (the component's parts), drawn inside it." },
      },
    },
    class: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'type', 'name'],
      description: 'A class, typically nested in a component it helps realize.',
      properties: { id: ref('id'), type: { const: 'class' }, name: ref('name'), stereotypes, ...realizing },
    },
    nested: {
      type: 'object',
      discriminator: { propertyName: 'type' },
      oneOf: [ref('component'), ref('class')],
    },
    element: {
      type: 'object',
      discriminator: { propertyName: 'type' },
      oneOf: [
        ref('component'),
        ref('class'),
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'name'],
          description:
            'An interface. Ports and components refer to it in `provides`/`requires` (drawn as lollipops and sockets labelled with its name). It is also drawn as a classifier box with «interface» when a realization, usage or dependency touches it, or when nothing provides or requires it.',
          properties: {
            id: ref('id'),
            type: { const: 'interface' },
            name: ref('name'),
            stereotypes,
            operations: { type: 'array', maxItems: 30, items: ref('operation') },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'name'],
          description: 'An artifact: rectangle with «artifact» and the document icon; use `manifest` to show which component it manifests.',
          properties: { id: ref('id'), type: { const: 'artifact' }, name: ref('name'), stereotypes },
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
    relationship: {
      type: 'object',
      discriminator: { propertyName: 'type' },
      oneOf: [
        relationship(
          'assembly',
          'Assembly connector, drawn as a ball-and-socket joint labelled with the interface name. `from` (a port or component) requires `interface`, `to` (a port or component) provides it.',
          { interface: ref('id', 'ID of the interface `from` requires and `to` provides.') },
          ['interface'],
        ),
        relationship(
          'delegation',
          'Delegation connector: solid line with an open arrowhead at `to` and «delegate». One end is a port of a component, the other a part directly inside that component (or a port of that part). Provided interfaces delegate from the outer port inward; required interfaces from the inner part outward.',
          { name: ref('text') },
        ),
        relationship('realization', '`from` (component or class) realizes the interface `to`: dashed line, hollow triangle at `to`.'),
        relationship('usage', '`from` (component or class) uses (requires) the interface `to`: dashed line, open arrowhead, «use».'),
        relationship('manifest', 'The artifact `from` manifests the component `to`: dashed line, open arrowhead, «manifest».'),
        relationship('dependency', '`from` depends on `to`: dashed line, open arrowhead at `to`, optional «keyword».', {
          keyword: ref('keyword'),
          name: ref('text'),
        }),
      ],
    },
  },
});
