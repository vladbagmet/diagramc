import type { KindFormat } from '../types.js';
import { plantumlClass } from './class.js';
import { plantumlSequence } from './sequence.js';

/** PlantUML mapping of every kind, in `uml kinds` order. Each kind's mapping lives in its own file. */
export const plantumlFormats: readonly KindFormat[] = [
  plantumlClass,
  plantumlSequence,
];
