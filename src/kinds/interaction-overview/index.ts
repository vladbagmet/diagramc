import type { KindDefinition } from '../../model/kind.js';
import { loadFonts } from '../../engine/fonts.js';
import type { InteractionOverviewDiagram } from './model.js';
import { interactionOverviewSchema } from './schema.js';
import { validateInteractionOverview } from './validate.js';
import { layoutInteractionOverview } from './layout.js';
import { drawInteractionOverview } from './draw.js';

export const interactionOverviewKind: KindDefinition<InteractionOverviewDiagram> = {
  kind: 'interaction-overview',
  title: 'Interaction overview diagram',
  summary: 'Control flow between interaction uses (ref frames) and inline interactions (sd frames), with decisions, merges, forks, joins and final nodes.',
  frameKeyword: 'sd',
  schema: interactionOverviewSchema,
  validate: validateInteractionOverview,
  backends: [
    {
      name: 'engine',
      async render(model) {
        const metrics = await loadFonts();
        return drawInteractionOverview(await layoutInteractionOverview(model, metrics), metrics);
      },
    },
  ],
};
