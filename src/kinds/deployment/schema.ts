import { kindSchema } from '../../model/schema.js';

const ref = (name: string, description?: string) => ({ $ref: `#/definitions/${name}`, ...(description ? { description } : {}) });
const stereotypes = {
  type: 'array',
  maxItems: 4,
  items: ref('keyword'),
  description: 'Stereotype names without guillemets, drawn «a, b» above the name (e.g. ["library"] for an artifact, ["J2EE Server"] for a node).',
};

function nodeLike(type: string, description: string) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'type', 'name'],
    description,
    properties: {
      id: ref('id'),
      type: { const: type },
      name: ref('name'),
      stereotypes,
      elements: {
        type: 'array',
        maxItems: 30,
        items: ref('nested'),
        description:
          'Nested nodes, execution environments, and the artifacts, deployment specifications and components deployed on this node, drawn inside it.',
      },
    },
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

/** JSON Schema of a deployment diagram document (`diagramc schema deployment`). */
export const deploymentSchema = kindSchema({
  kind: 'deployment',
  title: 'UML deployment diagram',
  description:
    'Nodes (3D boxes), devices and execution environments, nested in one another, with the artifacts, deployment specifications and components deployed on them; communication paths between nodes, «deploy» and «manifest» dependencies, and notes. Laid out left to right.',
  required: ['elements'],
  properties: {
    elements: {
      type: 'array',
      minItems: 1,
      maxItems: 80,
      items: ref('element'),
      description: 'Top-level elements. IDs of elements, nested elements and relationships share one namespace.',
    },
    relationships: { type: 'array', maxItems: 150, items: ref('relationship') },
  },
  definitions: {
    node: nodeLike('node', 'A node: a 3D box with its name.'),
    device: nodeLike('device', 'A device (physical computing resource): a node with «device».'),
    executionEnvironment: nodeLike(
      'executionEnvironment',
      'An execution environment (e.g. an application server or a container runtime): a node with «executionEnvironment», usually nested in a device or node.',
    ),
    artifact: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'type', 'name'],
      description:
        'An artifact (file, package, executable): rectangle with «artifact» and the document icon. Nest it in a node, or connect it with a `deploy` dependency, to show where it is deployed.',
      properties: { id: ref('id'), type: { const: 'artifact' }, name: ref('name'), stereotypes },
    },
    deploymentSpecification: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'type', 'name'],
      description: 'A deployment specification (configuration of a deployment): rectangle with «deployment spec», the document icon and its properties.',
      properties: {
        id: ref('id'),
        type: { const: 'deploymentSpecification' },
        name: ref('name'),
        properties: {
          type: 'array',
          maxItems: 20,
          description: 'Drawn `name : type = value`, one per line.',
          items: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: ref('text'), type: ref('text'), value: ref('text') } },
        },
      },
    },
    component: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'type', 'name'],
      description: 'A component an artifact manifests: rectangle with «component» and the component icon.',
      properties: { id: ref('id'), type: { const: 'component' }, name: ref('name'), stereotypes },
    },
    nested: {
      type: 'object',
      discriminator: { propertyName: 'type' },
      oneOf: [ref('node'), ref('device'), ref('executionEnvironment'), ref('artifact'), ref('deploymentSpecification'), ref('component')],
    },
    element: {
      type: 'object',
      discriminator: { propertyName: 'type' },
      oneOf: [
        ref('node'),
        ref('device'),
        ref('executionEnvironment'),
        ref('artifact'),
        ref('deploymentSpecification'),
        ref('component'),
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
      properties: { multiplicity: ref('multiplicity', 'How many instances at this end take part, drawn near it.') },
    },
    relationship: {
      type: 'object',
      discriminator: { propertyName: 'type' },
      oneOf: [
        relationship(
          'communicationPath',
          'A communication path between two nodes, devices or execution environments: solid line, «protocol» and name at the middle, multiplicities at the ends.',
          {
            name: ref('text'),
            protocol: ref('keyword', 'Protocol drawn as a stereotype, e.g. "HTTPS" -> «HTTPS».'),
            fromEnd: ref('end'),
            toEnd: ref('end'),
          },
        ),
        relationship(
          'deploy',
          'The artifact or deployment specification `from` is deployed on the node `to`: dashed line, open arrowhead at `to`, «deploy». Alternatively nest the artifact in the node.',
        ),
        relationship('manifest', 'The artifact `from` manifests the component `to`: dashed line, open arrowhead, «manifest».'),
        relationship(
          'dependency',
          '`from` depends on `to`: dashed line, open arrowhead at `to`, optional «keyword» (e.g. a deployment specification configuring an artifact).',
          { keyword: ref('keyword'), name: ref('text') },
        ),
      ],
    },
  },
});
