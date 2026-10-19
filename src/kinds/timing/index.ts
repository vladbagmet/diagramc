import type { KindDefinition } from '../../model/kind.js';
import type { TimingDiagram } from './model.js';
import { timingSchema } from './schema.js';
import { validateTimingDiagram } from './validate.js';
import { timingToPlantUml } from './to-plantuml.js';
import { postProcessTiming } from './postprocess.js';

export const timingKind: KindDefinition<TimingDiagram> = {
  kind: 'timing',
  title: 'Timing diagram',
  summary: 'State and value changes of lifelines along a time axis (robust and concise notation), with messages, duration and time constraints, highlighted intervals and notes.',
  frameKeyword: 'sd',
  schema: timingSchema,
  validate: validateTimingDiagram,
  backends: [
    { name: 'plantuml', diagramType: 'TIMING', toPlantUml: timingToPlantUml, postProcess: postProcessTiming },
  ],
};
