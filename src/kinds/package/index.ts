import type { KindDefinition } from '../../model/kind.js';
import { loadFonts } from '../../engine/fonts.js';
import { renderDiagram } from '../../engine/diagram.js';
import type { PackageDiagram } from './model.js';
import { packageSchema } from './schema.js';
import { validatePackageDiagram } from './validate.js';
import { packageDiagramSpec } from './layout.js';

export const packageKind: KindDefinition<PackageDiagram> = {
  kind: 'package',
  title: 'Package diagram',
  summary: 'Packages with nested packages and classifiers, package import («import», «access»), package merge, dependencies and containment.',
  frameKeyword: 'package',
  schema: packageSchema,
  validate: validatePackageDiagram,
  backends: [
    {
      name: 'engine',
      async render(model) {
        const metrics = await loadFonts();
        return renderDiagram(packageDiagramSpec(model), metrics);
      },
    },
  ],
};
