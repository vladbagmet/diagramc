import type { KindDefinition } from '../../model/kind.js';
import { loadFonts } from '../../engine/fonts.js';
import { renderDiagram } from '../../engine/diagram.js';
import type { ProfileDiagram } from './model.js';
import { profileSchema } from './schema.js';
import { validateProfileDiagram } from './validate.js';
import { profileDiagramSpec } from './layout.js';

export const profileKind: KindDefinition<ProfileDiagram> = {
  kind: 'profile',
  title: 'Profile diagram',
  summary: 'Profiles, stereotypes with tagged values, the metaclasses they extend, profile application and metaclass references.',
  frameKeyword: 'profile',
  schema: profileSchema,
  validate: validateProfileDiagram,
  backends: [
    {
      name: 'engine',
      async render(model) {
        const metrics = await loadFonts();
        return renderDiagram(profileDiagramSpec(model), metrics);
      },
    },
  ],
};
