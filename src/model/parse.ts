import { UmlError, failValidation, type Diagnostic } from '../core/errors.js';
import { MAX_INPUT_BYTES } from '../core/limits.js';
import type { KindDefinition } from './kind.js';
import { kinds, findKind } from './registry.js';
import { validateSchema, type DocumentText } from './schema.js';

export interface ParsedDocument<M = unknown> {
  kind: KindDefinition<M>;
  model: M;
  /** Every display string of the input with its JSON Pointer, for the literal-text QA gate. */
  texts: DocumentText[];
  /** 2 for `kind` envelope documents, 1 for legacy documents. */
  version: 1 | 2;
}

/**
 * Parses and fully validates a document: size, JSON syntax, envelope, the kind's
 * schema, display text rules, then the kind's semantic rules. Throws UmlError with
 * the first diagnostic (all diagnostics attached). Never touches a renderer.
 */
export function parseDocument(text: string): ParsedDocument {
  if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) {
    throw new UmlError('INPUT_TOO_LARGE', `Input exceeds ${MAX_INPUT_BYTES} bytes`);
  }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new UmlError('INVALID_JSON', 'Input must be valid JSON'); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    failValidation([{ code: 'SCHEMA_INVALID', path: '', message: 'Document must be a JSON object with a "kind" property' }]);
  }
  const document = value as Record<string, unknown>;
  if (!('kind' in document)) {
    const legacy = kinds.find(k => k.legacy?.detect(document));
    if (legacy?.legacy) return parseLegacy(legacy, document);
    failValidation([{ code: 'SCHEMA_INVALID', path: '/kind', message: `Document must have a "kind" property; one of ${kinds.map(k => k.kind).join(', ')}` }]);
  }
  const name = document.kind;
  const kind = typeof name === 'string' ? findKind(name) : undefined;
  if (!kind) {
    failValidation([{ code: 'UNKNOWN_KIND', path: '/kind', message: `Unknown diagram kind ${JSON.stringify(name)}; run \`uml kinds\``, details: { kind: name, available: kinds.map(k => k.kind) } }]);
  }
  const { diagnostics, texts } = validateSchema(kind.schema, document);
  if (diagnostics.length) failValidation(diagnostics);
  const semantic = kind.validate(document);
  if (semantic.length) failValidation(semantic);
  return { kind, model: document, texts, version: 2 };
}

function parseLegacy(kind: KindDefinition, document: unknown): ParsedDocument {
  const legacy = kind.legacy!;
  const { diagnostics, texts } = validateSchema(legacy.schema, document);
  if (diagnostics.length) failValidation(diagnostics);
  const model = legacy.upgrade(document);
  const semantic = kind.validate(model);
  if (semantic.length) failValidation(semantic.map((d): Diagnostic => ({ ...d, path: legacy.mapPath(d.path) })));
  return { kind, model, texts, version: 1 };
}
