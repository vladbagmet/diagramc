import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { commonDefinitions, displayTextProblem, TEXT_KEYWORD } from '../core/text.js';
import { pointer, type Diagnostic } from '../core/errors.js';
import type { JsonSchema } from './kind.js';

/** A display string found while validating, with its JSON Pointer. */
export interface DocumentText { path: string; text: string }

let collected: DocumentText[] | undefined;

const ajv = new Ajv({ allErrors: true, strict: true, discriminator: true });
ajv.addKeyword({
  keyword: TEXT_KEYWORD,
  type: 'string',
  schemaType: 'boolean',
  errors: true,
  validate: function check(enabled: boolean, data: string, _parent: unknown, context?: { instancePath: string }) {
    if (!enabled) return true;
    const problem = displayTextProblem(data);
    if (!problem) {
      collected?.push({ path: context?.instancePath ?? '', text: data });
      return true;
    }
    (check as unknown as { errors: Partial<ErrorObject>[] }).errors = [{ keyword: TEXT_KEYWORD, message: `Display text ${problem}`, params: {} }];
    return false;
  },
});

const cache = new WeakMap<JsonSchema, ValidateFunction>();

export interface SchemaResult { diagnostics: Diagnostic[]; texts: DocumentText[] }

/**
 * Validates `value` against `schema`. Text-rule violations become INVALID_TEXT
 * diagnostics; everything else becomes one SCHEMA_INVALID diagnostic whose
 * details list every Ajv error (path, keyword, message, params).
 */
export function validateSchema(schema: JsonSchema, value: unknown): SchemaResult {
  let validate = cache.get(schema);
  if (!validate) { validate = ajv.compile(schema); cache.set(schema, validate); }
  const texts: DocumentText[] = [];
  collected = texts;
  let ok: boolean;
  try { ok = validate(value) as boolean; }
  finally { collected = undefined; }
  if (ok) return { diagnostics: [], texts: dedupe(texts) };
  const errors = validate.errors ?? [];
  const structural = errors.filter(e => e.keyword !== TEXT_KEYWORD);
  if (structural.length) {
    const first = structural[0]!;
    return { texts: [], diagnostics: [{
      code: 'SCHEMA_INVALID',
      path: errorPath(first),
      message: `Document does not match the schema: ${describe(first)}`,
      details: structural.map(e => ({ path: errorPath(e), keyword: e.keyword, message: e.message, params: e.params })),
    }] };
  }
  return { texts: [], diagnostics: errors.map(e => ({
    code: 'INVALID_TEXT', path: e.instancePath,
    message: `${e.message ?? 'Invalid display text'}; display text must be nonblank, well-formed Unicode without bidi controls`,
  })) };
}

function dedupe(texts: DocumentText[]): DocumentText[] {
  const seen = new Set<string>();
  return texts.filter(t => !seen.has(t.path) && seen.add(t.path));
}

/** Points at the offending property itself for missing and unknown properties. */
function errorPath(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  if ((error.keyword === 'required' || error.keyword === 'dependencies') && typeof params.missingProperty === 'string') return pointer(error.instancePath, params.missingProperty);
  if (error.keyword === 'additionalProperties' && typeof params.additionalProperty === 'string') return pointer(error.instancePath, params.additionalProperty);
  return error.instancePath;
}

function describe(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  const where = errorPath(error) || '(document root)';
  if (error.keyword === 'additionalProperties') return `unknown property ${where}`;
  if (error.keyword === 'required') return `missing required property ${where}`;
  if (error.keyword === 'dependencies') return `missing property ${where}, required when ${pointer(error.instancePath, String(params.property))} is present`;
  if (error.keyword === 'enum' && Array.isArray(params.allowedValues)) return `${where} must be one of ${params.allowedValues.map(v => JSON.stringify(v)).join(', ')}`;
  if (error.keyword === 'const') return `${where} must be ${JSON.stringify(params.allowedValue)}`;
  return `${where} ${error.message ?? 'is invalid'}`;
}

export interface KindSchemaSpec {
  kind: string;
  title: string;
  description: string;
  /** Kind-specific top-level properties besides `kind` and `title`. */
  properties: Record<string, JsonSchema>;
  required: string[];
  /** Kind-specific definitions, merged with the shared ones (id, name, text, longText, keyword, multiplicity). */
  definitions?: Record<string, JsonSchema>;
}

/** Builds a kind's complete document schema: the v2 envelope plus the kind's vocabulary. */
export function kindSchema(spec: KindSchemaSpec): JsonSchema {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `https://agent-uml.invalid/schema/${spec.kind}.schema.json`,
    title: spec.title,
    description: spec.description,
    type: 'object',
    additionalProperties: false,
    required: ['kind', ...spec.required],
    properties: {
      kind: { const: spec.kind, description: 'Diagram kind. Run `uml kinds` for the list.' },
      title: { $ref: '#/definitions/name', description: 'Optional diagram name, drawn in the UML frame heading.' },
      ...spec.properties,
    },
    definitions: { ...commonDefinitions, ...spec.definitions },
  };
}
