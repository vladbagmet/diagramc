import type { KindDefinition } from './kind.js';
import { classKind } from '../kinds/class/index.js';
import { sequenceKind } from '../kinds/sequence/index.js';
import { timingKind } from '../kinds/timing/index.js';

/**
 * Every diagram kind the CLI knows, in `uml kinds` order. To add a kind, create
 * src/kinds/<kind>/index.ts exporting its KindDefinition and add it here
 * (one import, one array entry). See docs/kinds/README.md.
 */
export const kinds: readonly KindDefinition[] = [
  classKind,
  sequenceKind,
  timingKind,
];

export function findKind(name: string): KindDefinition | undefined {
  return kinds.find(k => k.kind === name);
}
