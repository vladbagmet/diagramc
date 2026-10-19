import type { KindDefinition } from '../../model/kind.js';
import { loadFonts } from '../../engine/fonts.js';
import type { UseCaseDiagram } from './model.js';
import { useCaseSchema } from './schema.js';
import { validateUseCaseDiagram } from './validate.js';
import { layoutUseCaseDiagram } from './layout.js';
import { drawUseCaseDiagram } from './draw.js';

export const useCaseKind: KindDefinition<UseCaseDiagram> = {
  kind: 'use-case',
  title: 'Use case diagram',
  summary: 'Actors and use cases in a subject boundary, with associations, «include», «extend» (extension points and conditions) and generalizations.',
  frameKeyword: 'uc',
  schema: useCaseSchema,
  validate: validateUseCaseDiagram,
  backends: [
    {
      name: 'engine',
      async render(model) {
        const metrics = await loadFonts();
        return drawUseCaseDiagram(await layoutUseCaseDiagram(model, metrics), metrics);
      },
    },
  ],
};
