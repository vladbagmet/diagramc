import type { KindDefinition } from '../../model/kind.js';
import { loadFonts } from '../../engine/fonts.js';
import type { ClassDiagram } from './model.js';
import { classSchema } from './schema.js';
import { validateClassDiagram } from './validate.js';
import { classDiagramSpec } from './layout.js';
import { renderDiagram } from '../../engine/diagram.js';
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
        return renderDiagram(classDiagramSpec(model), metrics);
      },
    },
    // Best-effort fallback (Smetana layout): held to the text and safety gates only.
    { name: 'plantuml', diagramType: 'CLASS', toPlantUml: classToPlantUml, gates: ['safe-markup', 'inside-canvas', 'literal-text', 'min-font-size', 'text-fits'] },
  ],
  legacy: classV1,
};
