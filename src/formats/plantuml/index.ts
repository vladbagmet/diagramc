import type { KindFormat } from '../types.js';
import { plantumlClass } from './class.js';

/** PlantUML mapping of every kind, in `uml kinds` order. Each kind's mapping lives in its own file. */
export const plantumlFormats: readonly KindFormat[] = [
  plantumlClass,
];
