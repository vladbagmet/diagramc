import type { KindDefinition } from '../../model/kind.js';
import { loadFonts } from '../../engine/fonts.js';
import { drawStructure } from '../structure/draw.js';
import { layoutStructure } from '../structure/layout.js';
import { compositeStructureGraph } from './graph.js';
import type { CompositeStructureDiagram } from './model.js';
import { compositeStructureSchema } from './schema.js';
import { validateCompositeStructureDiagram } from './validate.js';

export const compositeStructureKind: KindDefinition<CompositeStructureDiagram> = {
  kind: 'composite-structure',
  title: 'Composite structure diagram',
  summary: 'Structured classes with parts, reference properties and ports, connectors with end names and multiplicities, collaborations with roles and collaboration uses.',
  frameKeyword: 'class',
  schema: compositeStructureSchema,
  validate: validateCompositeStructureDiagram,
  backends: [
    {
      name: 'engine',
      async render(model) {
        const metrics = await loadFonts();
        return drawStructure(await layoutStructure(compositeStructureGraph(model), metrics), metrics);
      },
    },
  ],
};
