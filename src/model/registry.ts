import type { KindDefinition } from './kind.js';
import { classKind } from '../kinds/class/index.js';
import { activityKind } from '../kinds/activity/index.js';
import { stateMachineKind } from '../kinds/state-machine/index.js';
import { useCaseKind } from '../kinds/use-case/index.js';

/**
 * Every diagram kind the CLI knows, in `uml kinds` order. To add a kind, create
 * src/kinds/<kind>/index.ts exporting its KindDefinition and add it here
 * (one import, one array entry). See docs/kinds/README.md.
 */
export const kinds: readonly KindDefinition[] = [
  classKind,
  activityKind,
  stateMachineKind,
  useCaseKind,
];

export function findKind(name: string): KindDefinition | undefined {
  return kinds.find(k => k.kind === name);
}
