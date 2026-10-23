import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import { commonDefinitions, displayTextProblem, TEXT_KEYWORD, UNWRAPPED_KEYWORD, unwrappedProblem } from '../core/text.js';
import { pointer, type Diagnostic } from '../core/errors.js';
import type { JsonSchema } from './kind.js';
import { quoted, suggest } from './hints.js';
import { fixPattern } from './patterns.js';

/** A display string found while validating, with its JSON Pointer. */
export interface DocumentText { path: string; text: string }

let collected: DocumentText[] | undefined;

// `verbose` gives every error its schema, so messages can list allowed values and properties.
const ajv = new Ajv({ allErrors: true, strict: true, discriminator: true, verbose: true });
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
ajv.addKeyword({
  keyword: UNWRAPPED_KEYWORD,
  type: 'string',
  schemaType: 'string',
  errors: true,
  validate: function check(delimiters: string, data: string) {
    const problem = unwrappedProblem(data, delimiters);
    if (!problem) return true;
    (check as unknown as { errors: Partial<ErrorObject>[] }).errors = [{ keyword: UNWRAPPED_KEYWORD, message: problem.message, params: { suggestion: problem.suggestion } }];
    return false;
  },
});

const cache = new WeakMap<JsonSchema, ValidateFunction>();

export interface SchemaResult { diagnostics: Diagnostic[]; texts: DocumentText[] }

/**
 * Validates `value` against `schema`. Every problem becomes its own diagnostic,
 * worded so an agent can fix the document in one pass: unknown properties list
 * the allowed ones and the nearest match, wrong `type` values list the allowed
 * types, patterns are described in words with a corrected value where one is
 * obvious. Text-rule violations are INVALID_TEXT, everything else SCHEMA_INVALID.
 */
export function validateSchema(schema: JsonSchema, value: unknown): SchemaResult {
  let validate = cache.get(schema);
  if (!validate) { validate = ajv.compile(schema); cache.set(schema, validate); }
  const texts: DocumentText[] = [];
  collected = texts;
  let ok: boolean;
  try { ok = validate(value); }
  finally { collected = undefined; }
  if (ok) return { diagnostics: [], texts: dedupe(texts) };
  // One problem per string: an empty string only as too short; a string that breaks its
  // pattern and the display text rules as one diagnostic that gives the text rule's reason.
  const all = validate.errors ?? [];
  const shortAt = new Set(all.filter(e => e.keyword === 'minLength').map(e => e.instancePath));
  const errors = all.filter(e => !(shortAt.has(e.instancePath) && (e.keyword === TEXT_KEYWORD || e.keyword === 'pattern')));
  const textReason = new Map(errors.filter(e => e.keyword === TEXT_KEYWORD).map(e => [e.instancePath, e.message ?? 'Invalid display text']));
  const patternAt = new Set(errors.filter(e => e.keyword === 'pattern').map(e => e.instancePath));
  const diagnostics = [
    ...describeErrors(errors.filter(e => e.keyword !== TEXT_KEYWORD), schema, value).map(d => {
      const reason = (d.details as { rule?: string } | undefined)?.rule === 'pattern' ? textReason.get(d.path) : undefined;
      return reason ? { ...d, message: `${d.message} (${reason})` } : d;
    }),
    ...errors.filter(e => e.keyword === TEXT_KEYWORD && !patternAt.has(e.instancePath)).map(e => ({
      code: 'INVALID_TEXT', path: e.instancePath,
      message: `${e.instancePath || '(document root)'}: ${e.message ?? 'Invalid display text'}; display text must be nonblank, well-formed Unicode without bidi controls`,
    })),
  ];
  return { texts: [], diagnostics: sortByPath(diagnostics, value) };
}

function dedupe(texts: DocumentText[]): DocumentText[] {
  const seen = new Set<string>();
  return texts.filter(t => !seen.has(t.path) && seen.add(t.path));
}

type Schema = Record<string, unknown>;

/** Follows a local `#/definitions/...` reference, keeping the referencing schema's description. */
function resolve(root: Schema, s: unknown): Schema | undefined {
  if (!s || typeof s !== 'object') return undefined;
  const schema = s as Schema;
  const ref = typeof schema.$ref === 'string' ? schema.$ref : undefined;
  if (!ref?.startsWith('#/definitions/')) return schema;
  const target = (root.definitions as Record<string, Schema> | undefined)?.[ref.slice('#/definitions/'.length)];
  return target ? { ...target, ...(schema.description ? { description: schema.description } : {}) } : schema;
}

/** The value at a JSON Pointer of the document. */
function at(document: unknown, path: string): unknown {
  let node: unknown = document;
  for (const raw of path.split('/').slice(1)) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** JSON Schema type name of a value. */
const jsonType = (v: unknown): string => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v;
const typeName = (v: unknown): string => v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v === 'object' ? 'an object' : typeof v === 'string' ? `the string ${JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v)}` : `${typeof v} ${JSON.stringify(v)}`;
const where = (path: string): string => path || '(document root)';
const sentence = (s: unknown): string => typeof s === 'string' && s ? ` ${s.endsWith('.') ? s : `${s}.`}` : '';

/**
 * The description the schema gives the property at `path` itself (the one next
 * to its `$ref`), so a type error explains that property rather than the shared
 * definition it refers to. Undefined when the walk cannot follow the path.
 */
function ownDescription(root: Schema, document: unknown, path: string): string | undefined {
  let schema: Schema | undefined = root, raw: Schema | undefined = root, node: unknown = document;
  for (const part of path.split('/').slice(1)) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!schema) return undefined;
    const object = schemaOf(root, schema, node);
    raw = (object.properties as Record<string, Schema> | undefined)?.[key] ?? (Array.isArray(node) ? object.items as Schema | undefined : undefined);
    schema = resolve(root, raw);
    node = node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined;
  }
  return typeof raw?.description === 'string' ? raw.description : undefined;
}

/** The object at `path` for messages: `/elements/0 (type "class")` when `type` is one of its properties. */
function describeObject(document: unknown, path: string, allowed: readonly string[] = ['type']): string {
  const node = at(document, path);
  const type = node && typeof node === 'object' && !Array.isArray(node) ? (node as Record<string, unknown>).type : undefined;
  return typeof type === 'string' && allowed.includes('type') ? `${where(path)} (type "${type}")` : where(path);
}

/** Allowed property names of an object schema (after following references and discriminated unions). */
function allowedProperties(root: Schema, schema: Schema | undefined, node: unknown): string[] {
  if (!schema) return [];
  if (schema.properties) return Object.keys(schema.properties);
  const branches = (schema.oneOf ?? schema.anyOf) as unknown[] | undefined;
  if (branches && node && typeof node === 'object') {
    const type = (node as Record<string, unknown>).type;
    const branch = branches.map(b => resolve(root, b)).find(b => (b?.properties as Record<string, Schema> | undefined)?.type?.const === type);
    if (branch) return allowedProperties(root, branch, node);
  }
  return [];
}

/** The object schema that applies to `node` (the matching alternative of a discriminated union). */
function schemaOf(root: Schema, schema: Schema, node: unknown): Schema {
  if (schema.properties) return schema;
  const type = node && typeof node === 'object' ? (node as Record<string, unknown>).type : undefined;
  return ((schema.oneOf ?? schema.anyOf ?? []) as unknown[]).map(b => resolve(root, b)).find(b => (b?.properties as Record<string, Schema> | undefined)?.type?.const === type) ?? schema;
}

/** Values allowed for the discriminator `tag` in a oneOf, in schema order. */
function tagValues(root: Schema, schema: Schema, tag: string): unknown[] {
  return ((schema.oneOf ?? []) as unknown[]).map(b => (resolve(root, b)?.properties as Record<string, Schema> | undefined)?.[tag]?.const).filter(v => v !== undefined);
}

/**
 * A wrong discriminator value that is really the value of another property of
 * one of the alternatives, e.g. `"type": "alt"` for `{"type": "fragment", "operator": "alt"}`.
 */
function valueOfAnotherProperty(root: Schema, schema: Schema, tag: string, value: unknown): { text: string; tagValue: unknown; property: string; value: unknown } | undefined {
  for (const exact of [true, false]) {
    for (const b of (schema.oneOf ?? []) as unknown[]) {
      const branch = resolve(root, b);
      const properties = (branch?.properties ?? {}) as Record<string, Schema>;
      for (const [name, raw] of Object.entries(properties)) {
        if (name === tag) continue;
        const p = resolve(root, raw);
        const values = [...((p?.enum as unknown[] | undefined) ?? []), ...(p && 'const' in p ? [p.const] : [])];
        const hit = exact ? (values.includes(value) ? value : undefined) : typeof value === 'string' ? suggest(value, values.filter((v): v is string => typeof v === 'string'), 'value') : undefined;
        if (hit !== undefined) return { text: `use {"${tag}": ${JSON.stringify(properties[tag]?.const)}, "${name}": ${JSON.stringify(hit)}}`, tagValue: properties[tag]?.const, property: name, value: hit };
      }
    }
  }
  return undefined;
}

interface Issue { path: string; keyword: string; message: string; details?: Record<string, unknown> }

/** One diagnostic per problem, merged where two Ajv errors describe one mistake. */
function describeErrors(errors: ErrorObject[], root: Schema, document: unknown): Diagnostic[] {
  // Errors inside the alternatives of a failed oneOf/anyOf are summarized by that error.
  const unions = errors.filter(e => e.keyword === 'oneOf' || e.keyword === 'anyOf').map(e => e.schemaPath);
  const relevant = errors.filter(e => !unions.some(u => e.schemaPath.startsWith(`${u}/`)));

  // Unknown and missing properties per object, so a misnamed property is one problem ("rename").
  const unknown = new Map<string, { names: string[]; schema: Schema }>();
  const missing = new Map<string, { names: string[]; schema: Schema }>();
  for (const e of relevant) {
    const p = e.params as Record<string, unknown>;
    if (e.keyword === 'additionalProperties' && typeof p.additionalProperty === 'string') {
      const entry = unknown.get(e.instancePath) ?? { names: [], schema: e.parentSchema as Schema };
      entry.names.push(p.additionalProperty);
      unknown.set(e.instancePath, entry);
    } else if (e.keyword === 'required' && typeof p.missingProperty === 'string') {
      const entry = missing.get(e.instancePath) ?? { names: [], schema: e.parentSchema as Schema };
      entry.names.push(p.missingProperty);
      missing.set(e.instancePath, entry);
    }
  }
  const issues: Issue[] = [];
  for (const [path, { names, schema }] of unknown) {
    const node = at(document, path);
    const allowed = allowedProperties(root, schema, node);
    const absent = missing.get(path)?.names ?? [];
    const present = node && typeof node === 'object' ? Object.keys(node) : [];
    for (const name of names) {
      // Prefer a required property that is missing, then any allowed property not already used.
      // A value that fits a missing property's allowed values names that property ("type": "robust" -> "notation").
      const own = node && typeof node === 'object' ? (node as Record<string, unknown>)[name] : undefined;
      const byValue = [...absent, ...allowed.filter(a => !present.includes(a) && !absent.includes(a))].find(m => {
        const ms = resolve(root, (schemaOf(root, schema, node).properties as Record<string, unknown> | undefined)?.[m]);
        return ms && ((ms.enum as unknown[] | undefined)?.includes(own) === true || ('const' in ms && ms.const === own));
      });
      const special = specialPropertyHint(name, allowed, node);
      const guess = special ? undefined : byValue ?? suggest(name, absent) ?? suggest(name, allowed.filter(a => !present.includes(a)));
      // A rename is only offered (and applied when checking further) if the value fits the other property.
      const targetType = guess === undefined ? undefined : resolve(root, (schemaOf(root, schema, node).properties as Record<string, unknown> | undefined)?.[guess])?.type;
      // Numbers fit number and integer properties (a fraction is reported after the rename).
      const fits = targetType === undefined || jsonType(own) === targetType || ((targetType === 'integer' || targetType === 'number') && typeof own === 'number');
      const rename = fits ? guess : undefined;
      const required = rename !== undefined && absent.includes(rename);
      if (required) missing.get(path)!.names = missing.get(path)!.names.filter(m => m !== rename);
      const hint = guess === undefined ? '' : fits ? required ? `; rename it to "${rename}"` : `; did you mean "${rename}"` : `; "${guess}" is similar but takes ${article(typeof targetType === 'string' ? targetType : JSON.stringify(targetType))}`;
      issues.push({
        path: pointer(path, name), keyword: 'additionalProperties',
        message: `Unknown property "${name}" in ${describeObject(document, path, allowed)}${hint}${special ? ` ${special}` : ''}. Allowed properties: ${allowed.join(', ')}`,
        details: { property: name, allowed, ...(rename ? { suggestion: rename } : {}) },
      });
    }
  }
  for (const [path, { names, schema }] of missing) {
    for (const name of names) {
      const property = resolve(root, (schema.properties as Record<string, unknown> | undefined)?.[name]);
      issues.push({
        path: pointer(path, name), keyword: 'required',
        message: `Missing required property "${name}" in ${describeObject(document, path, allowedProperties(root, schema, at(document, path)))}.${sentence(property?.description)}`,
        // Display text can be stood in for while the rest of the document is checked (parse.ts).
        details: { property: name, ...(property?.[TEXT_KEYWORD] ? { text: true } : {}) },
      });
    }
  }

  for (const e of relevant) {
    const p = e.params as Record<string, unknown>;
    const schema = (e.parentSchema ?? {}) as Schema;
    const path = e.instancePath;
    const value = at(document, path);
    switch (e.keyword) {
      case 'additionalProperties': case 'required': break;
      case 'discriminator': {
        const tag = typeof p.tag === 'string' ? p.tag : 'type';
        const allowed = tagValues(root, schema, tag);
        const tagPath = pointer(path, tag);
        const tagValue = p.tagValue;
        if (p.error === 'mapping') {
          // A value that is exactly a value of another property ("type": "alt" is the operator of a
          // fragment) names that property, before any similar-looking allowed value.
          const exact = valueOfAnotherProperty(root, schema, tag, tagValue);
          const fuzzy = typeof tagValue === 'string' ? suggest(tagValue, allowed.map(String), 'value') : undefined;
          const nearest = exact && exact.value === tagValue ? undefined : fuzzy;
          const other = nearest ? undefined : exact;
          const hint = other ? `; ${other.text}` : nearest ? `; did you mean "${nearest}"` : '';
          const abstract = typeof tagValue === 'string' && /abstract/iu.test(tagValue) && nearest ? ` (set "abstract": true for an abstract ${nearest})` : '';
          issues.push({ path: tagPath, keyword: 'discriminator',
            message: `${tagPath} is ${JSON.stringify(tagValue)}, which is not a known ${tag}${hint}${abstract}. Allowed values: ${quoted(allowed)}`,
            details: { allowed, value: tagValue, ...(nearest ? { suggestion: nearest } : other ? { suggestion: other.tagValue, also: { [other.property]: other.value } } : {}) } });
        } else {
          issues.push({ path: tagPath, keyword: 'discriminator',
            message: `${where(path)} needs a string property "${tag}"${tagValue === undefined ? '' : ` (it is ${typeName(tagValue)})`}. Allowed values: ${quoted(allowed)}`,
            details: { allowed } });
        }
        break;
      }
      case 'enum': {
        const allowed = (p.allowedValues as unknown[] | undefined) ?? [];
        const nearest = typeof value === 'string' ? suggest(value, allowed.map(String), 'value') : undefined;
        issues.push({ path, keyword: 'enum', message: `${where(path)} is ${typeName(value)}${nearest ? `; did you mean "${nearest}"` : ''}. Allowed values: ${quoted(allowed)}`, details: { allowed, ...(nearest ? { suggestion: nearest } : {}) } });
        break;
      }
      case 'const':
        issues.push({ path, keyword: 'const', message: `${where(path)} must be ${JSON.stringify(p.allowedValue)}, not ${typeName(value)}`, details: { allowed: [p.allowedValue], suggestion: p.allowedValue } });
        break;
      case 'type': {
        const expected = String(p.type);
        let hint = '';
        if (expected.includes('string') && (typeof value === 'number' || typeof value === 'boolean')) hint = `; write it as a string: ${JSON.stringify(String(value))}`;
        else if (expected === 'array' && value !== null && typeof value !== 'object') hint = `; wrap it in a list: [${JSON.stringify(value)}]`;
        else if (expected === 'object' && typeof value === 'string') {
          const required = (schema.required as string[] | undefined) ?? [];
          const attribute = /\/attributes\/\d+$/u.test(path) ? parseAttribute(value) : undefined;
          hint = attribute ? `; write it as ${JSON.stringify(attribute)}` : `; write an object${required.length > 0 ? ` with ${quoted(required)}` : ''}, not a string`;
          if (attribute) { issues.push({ path, keyword: 'type', message: `${where(path)} must be an object, but it is ${typeName(value)}${hint}.`, details: { expected, suggestion: attribute } }); break; }
        } else if (expected === 'integer' && typeof value === 'number') hint = '; use whole numbers';
        else if (expected === 'string' && value !== null && typeof value === 'object' && !Array.isArray(value) && typeof (value as { id?: unknown }).id === 'string') {
          // An element nested where an ID list is expected (a package's members): say where the element goes.
          const id = (value as { id: string }).id;
          issues.push({ path, keyword: 'type', message: `${where(path)} must be an ID string, but it is an object; declare that element in the top-level "elements" list (with any members of its own also listed by ID) and write only its ID here: ${JSON.stringify(id)}.`, details: { expected, id } });
          break;
        }
        const quote = expected.includes('string') && (typeof value === 'number' || typeof value === 'boolean');
        issues.push({ path, keyword: 'type', message: `${where(path)} must be ${article(expected)}, but it is ${typeName(value)}${hint}.${sentence(ownDescription(root, document, path) ?? schema.description)}`, details: { expected, ...(quote ? { suggestion: String(value) } : {}) } });
        break;
      }
      case 'pattern': {
        const fixed = typeof value === 'string' ? fixPattern(String(p.pattern), value) : undefined;
        issues.push({ path, keyword: 'pattern',
          message: `${where(path)} ${typeName(value)} is not valid.${sentence(schema.description) || ' It must match the documented format.'}${fixed === undefined ? '' : ` For example: ${JSON.stringify(fixed)}.`}`,
          details: { ...(fixed === undefined ? {} : { suggestion: fixed }) } });
        break;
      }
      case UNWRAPPED_KEYWORD:
        issues.push({ path, keyword: 'format', message: `${where(path)}: ${e.message}`, details: { suggestion: p.suggestion } });
        break;
      case 'oneOf': case 'anyOf': {
        const options = ((schema[e.keyword] ?? []) as unknown[]).map(o => resolve(root, o)).map(o => o?.description ?? (o && 'const' in o ? JSON.stringify(o.const) : o?.type)).filter(Boolean);
        issues.push({ path, keyword: e.keyword, message: `${where(path)} ${typeName(value)} is not valid; it must be one of: ${options.join('; ')}.${sentence(schema.description)}` });
        break;
      }
      case 'minLength': case 'maxLength': case 'minItems': case 'maxItems': case 'minimum': case 'maximum': case 'exclusiveMinimum': case 'exclusiveMaximum': case 'minProperties': case 'maxProperties': {
        const limit = Number(p.limit);
        const what = { minLength: `at least ${limit} characters long`, maxLength: `at most ${limit} characters long`, minItems: `a list of at least ${limit} item${limit === 1 ? '' : 's'}`, maxItems: `a list of at most ${limit} items`, minimum: `at least ${limit}`, maximum: `at most ${limit}`, exclusiveMinimum: `greater than ${limit}`, exclusiveMaximum: `less than ${limit}`, minProperties: `an object with at least ${limit} properties`, maxProperties: `an object with at most ${limit} properties` }[e.keyword];
        issues.push({ path, keyword: e.keyword, message: `${where(path)} must be ${what}.${sentence(schema.description)}`, details: { limit } });
        break;
      }
      case 'uniqueItems':
        issues.push({ path, keyword: 'uniqueItems', message: `${where(path)} lists item ${Number(p.j)} and item ${Number(p.i)} twice; each value may appear once` });
        break;
      case 'dependencies':
        issues.push({ path: pointer(path, String(p.missingProperty)), keyword: 'dependencies', message: `Missing property ${pointer(path, String(p.missingProperty))}, required when ${pointer(path, String(p.property))} is present` });
        break;
      default:
        issues.push({ path, keyword: e.keyword, message: `${where(path)} ${e.message ?? 'is invalid'}.${sentence(schema.description)}` });
    }
  }
  // One diagnostic per problem.
  const seen = new Set<string>();
  return issues.filter(i => !seen.has(`${i.path}\u0000${i.keyword}\u0000${i.message}`) && seen.add(`${i.path}\u0000${i.keyword}\u0000${i.message}`))
    .map(i => ({ code: 'SCHEMA_INVALID', path: i.path, message: i.message, details: { rule: i.keyword, ...i.details } }));
}

/** `"- id: UUID"` -> `{"name": "id", "type": "UUID", "visibility": "private"}` (UML attribute notation). */
function parseAttribute(text: string): Record<string, string> | undefined {
  const m = /^\s*([+\-#~])?\s*(\/)?([A-Za-z_][\w]*)\s*(?::\s*([^=\s][^=]*?))?\s*(?:=\s*(.+?))?\s*$/u.exec(text);
  if (!m) return undefined;
  const visibility = ({ '+': 'public', '-': 'private', '#': 'protected', '~': 'package' } as Record<string, string>)[m[1] ?? ''];
  return { name: m[3]!, ...(m[4] ? { type: m[4].trim() } : {}), ...(visibility ? { visibility } : {}), ...(m[5] ? { defaultValue: m[5] } : {}) };
}

const article = (type: string): string => type.split(',').map(t => ({ object: 'an object', array: 'a list (array)', integer: 'a whole number', string: 'a string', number: 'a number', boolean: 'true or false', null: 'null' }[t] ?? t)).join(' or ');

/** Extra advice for property names whose meaning differs here. */
function specialPropertyHint(name: string, allowed: readonly string[], node: unknown): string | undefined {
  const n = name.toLowerCase();
  const type = node && typeof node === 'object' ? (node as Record<string, unknown>).type : undefined;
  if (n === 'multiplicity' && allowed.includes('fromEnd')) return '(multiplicities belong to the ends: "fromEnd": {"multiplicity": "1"}, "toEnd": {"multiplicity": "0..*"})';
  if (n === 'multiplicity' && allowed.includes('navigable')) return '(a link between instances has no multiplicity; multiplicities belong to the association in a class diagram)';
  if (n === 'extends' && type === 'stereotype') return '(a stereotype extends a metaclass through a relationship: {"type": "extension", "from": "<stereotype id>", "to": "<metaclass id>"})';
  if ((n === 'extends' || n === 'inherits' || n === 'parent') && !allowed.includes('generalization')) return '(model inheritance as a relationship: {"type": "generalization", "from": "<specific>", "to": "<general>"})';
  if (n === 'stereotype' && allowed.includes('stereotypes')) return '(a list without guillemets: "stereotypes": ["entity"])';
  if ((n === 'name' || n === 'label' || n === 'condition') && type === 'decision') return '(a decision node has no name: write the conditions as the guards of its outgoing flows)';
  if (n === 'usecases' && type === 'subject') return '(set "subject": "<this subject\'s id>" on each use case inside it instead)';
  return undefined;
}

/** Diagnostics in document order: array items by index, properties in the order the document lists them. */
function sortByPath(diagnostics: Diagnostic[], document: unknown): Diagnostic[] {
  const rank = (path: string): number[] => {
    const out: number[] = [];
    let node: unknown = document;
    for (const raw of path.split('/').slice(1)) {
      const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
      if (Array.isArray(node)) out.push(Number(key));
      else if (node && typeof node === 'object') { const keys = Object.keys(node); out.push(keys.includes(key) ? keys.indexOf(key) : keys.length); }
      else out.push(0);
      node = node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined;
    }
    return out;
  };
  return diagnostics.map((d, i) => ({ d, i, r: rank(d.path) })).sort((a, b) => {
    for (let j = 0; j < Math.min(a.r.length, b.r.length); j++) if (a.r[j] !== b.r[j]) return a.r[j]! - b.r[j]!;
    return a.r.length - b.r.length || a.i - b.i;
  }).map(x => x.d);
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
      version: { const: 2, description: 'Optional document format version; 2 is the current format (what `uml validate` reports).' },
      title: { $ref: '#/definitions/name', description: 'Optional diagram name, drawn in the UML frame heading.' },
      ...spec.properties,
    },
    definitions: { ...commonDefinitions, ...spec.definitions },
  };
}
