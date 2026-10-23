import type { KindDefinition } from '../../model/kind.js';
import { loadFonts } from '../../engine/fonts.js';
import type { ActivityDiagram } from './model.js';
import { activitySchema } from './schema.js';
import { validateActivityDiagram } from './validate.js';
import { activityToPlantUml } from './to-plantuml.js';
import { fixActivitySvg } from './postprocess.js';

export const activityKind: KindDefinition<ActivityDiagram> = {
  kind: 'activity',
  title: 'Activity diagram',
  summary: 'Actions, object nodes, signals, decisions and merges, forks and joins, loops and partitions (swimlanes) of a well-structured flow.',
  frameKeyword: 'act',
  schema: activitySchema,
  validate: validateActivityDiagram,
  backends: [
    {
      name: 'plantuml',
      diagramType: 'ACTIVITY',
      async toPlantUml(model) {
        return activityToPlantUml(model, await loadFonts());
      },
      postProcess: fixActivitySvg,
    },
  ],
};
