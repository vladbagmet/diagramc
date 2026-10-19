import type { KindDefinition } from '../../model/kind.js';
import { loadFonts } from '../../engine/fonts.js';
import type { CommunicationDiagram } from './model.js';
import { communicationSchema } from './schema.js';
import { validateCommunicationDiagram } from './validate.js';
import { layoutCommunicationDiagram } from './layout.js';
import { drawCommunicationDiagram } from './draw.js';

export const communicationKind: KindDefinition<CommunicationDiagram> = {
  kind: 'communication',
  title: 'Communication diagram',
  summary: 'Lifelines connected by links, with numbered synchronous, asynchronous and reply messages listed along the links.',
  frameKeyword: 'sd',
  schema: communicationSchema,
  validate: validateCommunicationDiagram,
  backends: [
    {
      name: 'engine',
      async render(model) {
        const metrics = await loadFonts();
        return drawCommunicationDiagram(await layoutCommunicationDiagram(model, metrics), metrics);
      },
    },
  ],
};
