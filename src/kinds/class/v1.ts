import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { UmlError } from './errors.js';

export interface Model {
  classes: { id: string; name: string; attributes?: string[]; methods?: string[] }[];
  relationships: { type: 'association' | 'inheritance'; from: string; to: string; label?: string }[];
}
export const MAX_INPUT_BYTES = 256 * 1024;
const schema = JSON.parse(readFileSync(new URL('../schema/model-v1.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv({ allErrors: true, strict: true }).compile<Model>(schema);

export function parseModel(text: string): Model {
  if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) {
    throw new UmlError('INPUT_TOO_LARGE', `Input exceeds ${MAX_INPUT_BYTES} bytes`);
  }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new UmlError('INVALID_JSON', 'Input must be valid JSON'); }
  if (!validate(value)) {
    throw new UmlError('SCHEMA_INVALID', 'Model does not match schema v1', 2,
      validate.errors?.map(e => ({ path: e.instancePath, keyword: e.keyword, message: e.message, params: e.params })));
  }
  // JSON permits unpaired UTF-16 surrogates. Reject them instead of silently replacing text.
  const texts = value.classes.flatMap(c => [c.name, ...(c.attributes ?? []), ...(c.methods ?? [])])
    .concat(value.relationships.flatMap(r => r.label === undefined ? [] : [r.label]));
  if (texts.some(t => !t.isWellFormed() || !t.trim() || /[\u202a-\u202e\u2066-\u2069]/u.test(t))) {
    throw new UmlError('INVALID_TEXT', 'Display text must be nonblank, well-formed Unicode without bidi controls');
  }
  const ids = new Set<string>();
  for (const c of value.classes) {
    if (ids.has(c.id)) throw new UmlError('DUPLICATE_ID', `Duplicate class ID: ${c.id}`);
    ids.add(c.id);
  }
  const parents = new Map<string, string[]>();
  for (const r of value.relationships) {
    if (!ids.has(r.from) || !ids.has(r.to)) {
      throw new UmlError('MISSING_REFERENCE', 'Relationship references an unknown class', 2, { from: r.from, to: r.to });
    }
    if (r.type === 'inheritance') parents.set(r.from, [...(parents.get(r.from) ?? []), r.to]);
  }
  const active = new Set<string>(), done = new Set<string>();
  function visit(id: string): void {
    if (active.has(id)) throw new UmlError('INHERITANCE_CYCLE', 'Inheritance must be acyclic', 2, { id });
    if (done.has(id)) return;
    active.add(id);
    for (const parent of parents.get(id) ?? []) visit(parent);
    active.delete(id);
    done.add(id);
  }
  for (const id of ids) visit(id);
  return value;
}
