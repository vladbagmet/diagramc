import type { KindDefinition } from '../../model/kind.js';
import { loadFonts } from '../../engine/fonts.js';
import type { ClassDiagram } from './model.js';
import { classSchema } from './schema.js';
import { validateClassDiagram } from './validate.js';
import { layoutClassDiagram } from './layout.js';
import { drawClassDiagram } from './draw.js';
import { classToPlantUml } from './to-plantuml.js';
import { classV1 } from './v1.js';

export const classKind: KindDefinition<ClassDiagram> = {
  kind: 'class',
  title: 'Class diagram',
  summary: 'Classes, interfaces, enumerations and their generalizations, realizations, associations, aggregations, compositions and dependencies.',
  frameKeyword: 'class',
  schema: classSchema,
  validate: validateClassDiagram,
  backends: [
    {
      name: 'engine',
      async render(model) {
        const metrics = await loadFonts();
        return drawClassDiagram(await layoutClassDiagram(model, metrics), metrics);
      },
    },
    { name: 'plantuml', diagramType: 'CLASS', toPlantUml: classToPlantUml },
  ],
  legacy: classV1,
};
