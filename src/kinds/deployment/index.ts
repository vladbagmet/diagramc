import type { KindDefinition } from '../../model/kind.js';
import { loadFonts } from '../../engine/fonts.js';
import { drawStructure } from '../structure/draw.js';
import { layoutStructure } from '../structure/layout.js';
import { deploymentGraph } from './graph.js';
import type { DeploymentDiagram } from './model.js';
import { deploymentSchema } from './schema.js';
import { validateDeploymentDiagram } from './validate.js';

export const deploymentKind: KindDefinition<DeploymentDiagram> = {
  kind: 'deployment',
  title: 'Deployment diagram',
  summary: 'Nodes, devices and execution environments with deployed artifacts and deployment specifications, communication paths, «deploy» and «manifest» dependencies.',
  frameKeyword: 'dep',
  schema: deploymentSchema,
  validate: validateDeploymentDiagram,
  backends: [
    {
      name: 'engine',
      async render(model) {
        const metrics = await loadFonts();
        return drawStructure(await layoutStructure(deploymentGraph(model), metrics), metrics);
      },
    },
  ],
};
