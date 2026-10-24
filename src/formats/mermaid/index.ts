import type { KindFormat } from '../types.js';
import { mermaidActivity } from './activity.js';
import { mermaidClass } from './class.js';
import { mermaidSequence } from './sequence.js';
import { mermaidStateMachine } from './state-machine.js';
import { mermaidUseCase } from './use-case.js';

/**
 * Mermaid mapping of the kinds Mermaid can express faithfully, in `diagramc kinds`
 * order. Each kind's mapping lives in its own file. The other kinds have no
 * Mermaid diagram type that draws their notation (component: no sockets,
 * ports or assembly connectors; deployment, timing and the rest: no diagram
 * type at all), so they fail with UNSUPPORTED_EXPORT.
 */
export const mermaidFormats: readonly KindFormat[] = [mermaidClass, mermaidSequence, mermaidActivity, mermaidStateMachine, mermaidUseCase];
