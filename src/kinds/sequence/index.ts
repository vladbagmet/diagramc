import type { KindDefinition } from '../../model/kind.js';
import type { SequenceDiagram } from './model.js';
import { sequenceSchema } from './schema.js';
import { validateSequenceDiagram } from './validate.js';
import { sequenceToPlantUml } from './to-plantuml.js';
import { postProcessSequence } from './postprocess.js';

export const sequenceKind: KindDefinition<SequenceDiagram> = {
  kind: 'sequence',
  title: 'Sequence diagram',
  summary: 'Lifelines and the messages between them in time order, with activations, creation and destruction, combined fragments, interaction uses, state invariants and notes.',
  frameKeyword: 'sd',
  schema: sequenceSchema,
  validate: validateSequenceDiagram,
  backends: [
    { name: 'plantuml', diagramType: 'SEQUENCE', toPlantUml: sequenceToPlantUml, postProcess: postProcessSequence },
  ],
};
