import type { KindFormat } from '../types.js';
import { plantumlClass } from './class.js';
import { plantumlObject } from './object.js';
import { plantumlPackage } from './package.js';
import { plantumlProfile } from './profile.js';
import { plantumlCommunication } from './communication.js';
import { plantumlInteractionOverview } from './interaction-overview.js';
import { plantumlComponent } from './component.js';
import { plantumlDeployment } from './deployment.js';
import { plantumlCompositeStructure } from './composite-structure.js';
import { plantumlSequence } from './sequence.js';
import { plantumlTiming } from './timing.js';
import { plantumlStateMachine } from './state-machine.js';
import { plantumlUseCase } from './use-case.js';

/** PlantUML mapping of every kind, in `uml kinds` order. Each kind's mapping lives in its own file. */
export const plantumlFormats: readonly KindFormat[] = [
  plantumlClass,
  plantumlObject,
  plantumlPackage,
  plantumlProfile,
  plantumlCommunication,
  plantumlInteractionOverview,
  plantumlComponent,
  plantumlDeployment,
  plantumlCompositeStructure,
  plantumlSequence,
  plantumlTiming,
  plantumlStateMachine,
  plantumlUseCase,
];
