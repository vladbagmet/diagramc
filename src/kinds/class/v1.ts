import { readFileSync } from 'node:fs';
import { TEXT_KEYWORD } from '../../core/text.js';
import type { JsonSchema, LegacyFormat } from '../../model/kind.js';
import type { ClassDiagram } from './model.js';

/**
 * The MVP's v1 format (`classes` + `relationships`, no `kind`), kept working as a
 * class diagram. The checked-in schema/model-v1.schema.json stays the published
 * contract; the display-text marker is added here so v1 gets the same text rules.
 */
interface V1 {
  classes: { id: string; name: string; attributes?: string[]; methods?: string[] }[];
  relationships: { type: 'association' | 'inheritance'; from: string; to: string; label?: string }[];
}

const published = JSON.parse(readFileSync(new URL('../../../schema/model-v1.schema.json', import.meta.url), 'utf8')) as {
  definitions: Record<string, Record<string, unknown>>;
};
const schema: JsonSchema = {
  ...published,
  definitions: {
    ...published.definitions,
    name: { ...published.definitions.name, [TEXT_KEYWORD]: true },
    text: { ...published.definitions.text, [TEXT_KEYWORD]: true },
  },
};

export const classV1: LegacyFormat<ClassDiagram> = {
  detect: value => 'classes' in value,
  schema,
  upgrade(value) {
    const v1 = value as V1;
    return {
      kind: 'class',
      elements: v1.classes.map(c => ({
        id: c.id, type: 'class' as const, name: c.name,
        attributes: (c.attributes ?? []).map(text => ({ text })),
        operations: (c.methods ?? []).map(text => ({ text })),
      })),
      relationships: v1.relationships.map(r => ({
        type: r.type === 'inheritance' ? 'generalization' as const : 'association' as const,
        from: r.from, to: r.to, ...(r.label === undefined ? {} : { name: r.label }),
      })),
    };
  },
  mapPath(path) {
    return path
      .replace(/^\/elements\/(\d+)\/operations/u, '/classes/$1/methods')
      .replace(/^\/elements/u, '/classes')
      .replace(/^(\/relationships\/\d+)\/name$/u, '$1/label');
  },
};
