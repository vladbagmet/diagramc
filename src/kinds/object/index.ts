import type { KindDefinition } from '../../model/kind.js';
import { loadFonts } from '../../engine/fonts.js';
import { renderDiagram } from '../../engine/diagram.js';
import type { ObjectDiagram } from './model.js';
import { objectSchema } from './schema.js';
import { validateObjectDiagram } from './validate.js';
import { objectDiagramSpec } from './layout.js';

export const objectKind: KindDefinition<ObjectDiagram> = {
  kind: 'object',
  title: 'Object diagram',
  summary: 'Instance specifications with slot values and the links between them, a snapshot of a system at one moment.',
  frameKeyword: 'object',
  schema: objectSchema,
  validate: validateObjectDiagram,
  backends: [
    {
      name: 'engine',
      async render(model) {
        const metrics = await loadFonts();
        return renderDiagram(objectDiagramSpec(model), metrics);
      },
    },
  ],
};
