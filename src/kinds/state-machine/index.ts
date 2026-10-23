import type { KindDefinition } from '../../model/kind.js';
import { loadFonts } from '../../engine/fonts.js';
import type { StateMachineDiagram } from './model.js';
import { stateMachineSchema } from './schema.js';
import { validateStateMachine } from './validate.js';
import { layoutStateMachine } from './layout.js';
import { drawStateMachine } from './draw.js';

export const stateMachineKind: KindDefinition<StateMachineDiagram> = {
  kind: 'state-machine',
  title: 'State machine diagram',
  summary:
    'States with entry/do/exit behaviors, composite states with orthogonal regions, submachine states, all pseudostates and transitions labeled trigger [guard] / effect.',
  frameKeyword: 'stm',
  schema: stateMachineSchema,
  validate: validateStateMachine,
  backends: [
    {
      name: 'engine',
      async render(model) {
        const metrics = await loadFonts();
        return drawStateMachine(await layoutStateMachine(model, metrics), metrics);
      },
    },
  ],
};
