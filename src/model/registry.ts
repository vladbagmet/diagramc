import type { KindDefinition } from './kind.js';
import { classKind } from '../kinds/class/index.js';
import { objectKind } from '../kinds/object/index.js';
import { packageKind } from '../kinds/package/index.js';
import { profileKind } from '../kinds/profile/index.js';
import { communicationKind } from '../kinds/communication/index.js';
import { interactionOverviewKind } from '../kinds/interaction-overview/index.js';
import { componentKind } from '../kinds/component/index.js';
import { deploymentKind } from '../kinds/deployment/index.js';
import { compositeStructureKind } from '../kinds/composite-structure/index.js';

/**
 * Every diagram kind the CLI knows, in `uml kinds` order. To add a kind, create
 * src/kinds/<kind>/index.ts exporting its KindDefinition and add it here
 * (one import, one array entry). See docs/kinds/README.md.
 */
export const kinds: readonly KindDefinition[] = [
  classKind,
  objectKind,
  packageKind,
  profileKind,
  communicationKind,
  interactionOverviewKind,
  componentKind,
  deploymentKind,
  compositeStructureKind,
];

export function findKind(name: string): KindDefinition | undefined {
  return kinds.find(k => k.kind === name);
}
