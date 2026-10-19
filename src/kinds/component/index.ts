import type { KindDefinition } from '../../model/kind.js';
import { loadFonts } from '../../engine/fonts.js';
import { drawStructure } from '../structure/draw.js';
import { layoutStructure } from '../structure/layout.js';
import { componentGraph } from './graph.js';
import type { ComponentDiagram } from './model.js';
import { componentSchema } from './schema.js';
import { validateComponentDiagram } from './validate.js';

export const componentKind: KindDefinition<ComponentDiagram> = {
  kind: 'component',
  title: 'Component diagram',
  summary: 'Components with ports, provided and required interfaces (lollipops and sockets), assembly and delegation connectors, nested parts, interfaces, artifacts and manifestations.',
  frameKeyword: 'cmp',
  schema: componentSchema,
  validate: validateComponentDiagram,
  backends: [
    {
      name: 'engine',
      async render(model) {
        const metrics = await loadFonts();
        return drawStructure(await layoutStructure(componentGraph(model), metrics), metrics);
      },
    },
  ],
};
