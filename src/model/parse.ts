import { UmlError, failValidation, pointer, type Diagnostic } from '../core/errors.js';
import { MAX_INPUT_BYTES } from '../core/limits.js';
import type { KindDefinition } from './kind.js';
import { kinds, findKind } from './registry.js';
import { validateSchema, type DocumentText } from './schema.js';
import { parseJson } from './json.js';
import { squash, suggest } from './hints.js';

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
 * every diagnostic. Never touches a renderer.
 *
 * To let an agent fix a document in one round, schema problems that have an
 * unambiguous correction (a renamed property, a misspelled type) are corrected
 * on a copy and validation continues on it: further problems found that way are
 * reported too, marked `details.afterFixes`.
 */
export function parseDocument(text: string): ParsedDocument {
  if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) {
    throw new UmlError('INPUT_TOO_LARGE', `Input exceeds ${MAX_INPUT_BYTES} bytes`);
  }
  if (!text.trim())
    throw new UmlError(
      'INVALID_JSON',
      'Input is empty; expected a JSON object such as {"kind": "class", "elements": [...]}. Run `uml example <kind>` for a complete minimal model',
    );
  const value = parseJson(text);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    failValidation([{ code: 'SCHEMA_INVALID', path: '', message: 'Document must be a JSON object with a "kind" property' }]);
  }
  const document = value as Record<string, unknown>;
  if (!('kind' in document)) {
    const legacy = kinds.find(k => k.legacy?.detect(document));
    if (legacy?.legacy) return parseLegacy(legacy, document);
    failValidation([
      {
        code: 'SCHEMA_INVALID',
        path: '/kind',
        message: `Document must have a "kind" property; one of ${kinds.map(k => k.kind).join(', ')}`,
        details: { available: kinds.map(k => k.kind) },
      },
    ]);
  }
  const name = document.kind;
  const kind = typeof name === 'string' ? findKind(name) : undefined;
  if (!kind) {
    const nearest = typeof name === 'string' ? suggestKind(name) : undefined;
    failValidation([
      {
        code: 'UNKNOWN_KIND',
        path: '/kind',
        message: `Unknown diagram kind ${JSON.stringify(name)}${nearest ? `; did you mean "${nearest}"?` : ''} Kinds: ${kinds.map(k => k.kind).join(', ')} (run \`uml kinds\`)`,
        details: { kind: name, available: kinds.map(k => k.kind), ...(nearest ? { suggestion: nearest } : {}) },
      },
    ]);
  }
  const { diagnostics, texts } = validateSchema(kind.schema, document);
  if (diagnostics.length > 0) failValidation(withHints(kind, document, [...diagnostics, ...afterFixes(kind, document, diagnostics)]));
  const semantic = kind.validate(document);
  if (semantic.length > 0) failValidation(withHints(kind, document, semantic));
  return { kind, model: document, texts, version: 2 };
}

/** The registered kind an unknown kind name most likely means ("state_machine", "seq", "use case diagram"). */
export function suggestKind(name: string): string | undefined {
  const all = kinds.map(k => k.kind);
  const plain = name
    .toLowerCase()
    .replaceAll(/[\s_]+/gu, '-')
    .replace(/-?diagrams?$/u, '');
  return (
    all.find(k => k === plain) ??
    all.find(k => plain.length >= 3 && k.startsWith(plain)) ??
    suggest(plain, all, 'value') ??
    (
      {
        uml: undefined,
        statechart: 'state-machine',
        state: 'state-machine',
        iod: 'interaction-overview',
        overview: 'interaction-overview',
        usecase: 'use-case',
        composite: 'composite-structure',
        act: 'activity',
        sd: 'sequence',
        flow: 'activity',
        flowchart: 'activity',
        er: 'class',
        erd: 'class',
      } as Record<string, string | undefined>
    )[plain.replaceAll('-', '')]
  );
}

/** At most this many correction rounds. */
const REPAIR_ROUNDS = 3;

/**
 * Applies the corrections the schema diagnostics name (`details.suggestion`) to
 * a copy of the document and validates it again (schema, then semantics),
 * returning the new problems marked `afterFixes`. Nothing is guessed: only
 * diagnostics with a suggestion are corrected.
 */
function afterFixes(kind: KindDefinition, document: unknown, diagnostics: readonly Diagnostic[]): Diagnostic[] {
  let copy = structuredClone(document);
  let current = diagnostics;
  const key = (d: Diagnostic, path = d.path): string => `${d.code}\u0000${path}\u0000${(d.details as { rule?: string } | undefined)?.rule ?? ''}`;
  const reported = new Set(diagnostics.map(d => key(d)));
  const found: Diagnostic[] = [];
  const renames = new Map<string, string>();
  const dropped: { array: string; index: number }[] = [];
  // Places where missing display text was stood in for: problems found there are about the stand-in.
  const filled = new Set<string>();
  /** A path in the corrected copy -> the same place in the document as written. */
  const original = (path: string): string => renamedFrom(restoreIndexes(path, dropped), renames);
  for (let round = 0; round < REPAIR_ROUNDS + 1; round++) {
    const fixed = applyFixes(copy, current, filled);
    let changed = fixed.changed;
    copy = fixed.document;
    for (const [to, from] of fixed.renames) renames.set(to, from);
    // Relationships that still miss a required reference are set aside, so the
    // rest of the document can be checked; nothing refers to a relationship.
    if (!changed) changed = dropIncomplete(copy, current, dropped);
    if (!changed) return found;
    const next = validateSchema(kind.schema, copy).diagnostics;
    // On the corrected copy, semantic problems get their swap hints too.
    const later = next.length > 0 ? next : withSwapHints(kind, copy, kind.validate(copy));
    const fresh = later.map(d => ({ ...d, path: original(d.path) })).filter(d => !reported.has(key(d)) && !filled.has(d.path));
    for (const d of fresh) {
      reported.add(key(d));
      found.push({
        ...d,
        message: `After the corrections above: ${d.message}`,
        details: {
          ...(typeof d.details === 'object' && d.details && !Array.isArray(d.details) ? d.details : d.details === undefined ? {} : { value: d.details }),
          afterFixes: true,
        },
      });
    }
    if (next.length === 0) return found;
    current = next;
  }
  return found;
}

/** Arrays of relationships, whose items no other part of a document refers to. */
const RELATIONSHIP_ARRAYS = new Set(['relationships', 'edges', 'flows', 'links', 'transitions', 'connectors']);

/** Removes relationship items with a missing required property (not display text); records them. */
function dropIncomplete(copy: unknown, diagnostics: readonly Diagnostic[], dropped: { array: string; index: number }[]): boolean {
  const items = new Map<string, number[]>();
  for (const d of diagnostics) {
    const details = d.details as { rule?: string; text?: boolean } | undefined;
    if (details?.rule !== 'required' || details.text) continue;
    const m = /^\/([^/]+)\/(\d+)\/[^/]+$/u.exec(d.path);
    if (!m || !RELATIONSHIP_ARRAYS.has(m[1]!)) continue;
    items.set(`/${m[1]}`, [...new Set([...(items.get(`/${m[1]}`) ?? []), Number(m[2])])]);
  }
  let changed = false;
  for (const [array, indexes] of items) {
    const list = valueAt(copy, array);
    if (!Array.isArray(list)) continue;
    for (const i of indexes.sort((a, b) => b - a)) {
      list.splice(i, 1);
      // Record the index in the document as written.
      dropped.push({ array, index: restoreIndexes(`${array}/${i}`, dropped).split('/').map(Number).at(-1)! });
      changed = true;
    }
  }
  return changed;
}

/** Maps an array index in the copy back over the items set aside before it. */
function restoreIndexes(path: string, dropped: readonly { array: string; index: number }[]): string {
  const m = /^(\/[^/]+)\/(\d+)(.*)$/u.exec(path);
  if (!m) return path;
  let index = Number(m[2]);
  for (const d of [...dropped]
    .filter(d => d.array === m[1])
    .map(d => d.index)
    .sort((a, b) => a - b))
    if (d <= index) index++;
  return `${m[1]}/${index}${m[3]}`;
}

/** The path a diagnostic would have had before properties were renamed. */
function renamedFrom(path: string, renames: Map<string, string>): string {
  for (const [to, from] of renames) if (path === to || path.startsWith(`${to}/`)) return from + path.slice(to.length);
  return path;
}

function applyFixes(
  document: unknown,
  diagnostics: readonly Diagnostic[],
  filled: Set<string>,
): { document: unknown; changed: boolean; renames: Map<string, string> } {
  const copy = structuredClone(document);
  const renames = new Map<string, string>();
  let changed = false;
  for (const d of diagnostics) {
    const details = d.details as { rule?: string; suggestion?: unknown; property?: string } | undefined;
    // An unknown property without a correction is left out, and missing display text is stood in
    // for, so the rest of the document can still be checked.
    const drop = details?.rule === 'additionalProperties' && details.suggestion === undefined;
    const fill = details?.rule === 'required' && (details as { text?: boolean }).text === true;
    if (!details || (details.suggestion === undefined && !drop && !fill)) continue;
    const segments = d.path
      .split('/')
      .slice(1)
      .map(s => s.replaceAll('~1', '/').replaceAll('~0', '~'));
    const key = segments.pop();
    if (key === undefined) continue;
    let parent: unknown = copy;
    for (const s of segments) parent = parent && typeof parent === 'object' ? (parent as Record<string, unknown>)[s] : undefined;
    if (!parent || typeof parent !== 'object') continue;
    const object = parent as Record<string, unknown>;
    if (drop) {
      if (key in object) {
        Reflect.deleteProperty(object, key);
        changed = true;
      }
    } else if (fill) {
      if (!(key in object)) {
        object[key] = '?';
        filled.add(d.path);
        changed = true;
      }
    } else if (details.rule === 'additionalProperties' && typeof details.suggestion === 'string') {
      if (details.suggestion in object) continue;
      object[details.suggestion] = object[key];
      Reflect.deleteProperty(object, key);
      renames.set(
        pointer(segments.length > 0 ? `/${segments.map(s => s.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}` : '', details.suggestion),
        d.path,
      );
      changed = true;
    } else if (details.rule !== 'additionalProperties' && key in object) {
      object[key] = details.suggestion;
      const also = (details as { also?: Record<string, unknown> }).also;
      if (also) Object.assign(object, also);
      changed = true;
    }
  }
  return { document: copy, changed, renames };
}

/**
 * Hints that need more than the failing kind's schema: a property that exists
 * in another kind ("attributes" on a class in a package diagram), and a
 * relationship whose problems disappear when `from` and `to` are swapped.
 */
function withHints(kind: KindDefinition, document: unknown, diagnostics: Diagnostic[]): Diagnostic[] {
  const swapped = swapHints(kind, document, diagnostics);
  return diagnostics.map(d => {
    const details = d.details as { rule?: string; property?: string; suggestion?: unknown } | undefined;
    if (details?.rule === 'additionalProperties' && details.suggestion === undefined && details.property) {
      const object = valueAt(document, d.path.slice(0, d.path.lastIndexOf('/')));
      const type = object && typeof object === 'object' ? (object as Record<string, unknown>).type : undefined;
      const elsewhere = typeof type === 'string' ? kindsWithProperty(type, details.property).filter(k => k !== kind.kind) : [];
      if (typeof type === 'string' && elsewhere.length > 0) {
        return {
          ...d,
          message: `${d.message}. "${details.property}" on a ${type} belongs to ${elsewhere.map(k => `${k} diagrams`).join(' and ')}; this ${kind.kind} diagram does not draw it, so remove it (or draw it in a ${elsewhere[0]} diagram)`,
        };
      }
    }
    if (d.code === 'MISSING_REFERENCE' && /\/attachedTo\/\d+$/u.test(d.path)) {
      // A note attached to a relationship (UML allows it; this kind draws note anchors to elements only).
      const wrong = valueAt(document, d.path);
      const relationship = typeof wrong === 'string' ? findRelationship(document, wrong) : undefined;
      if (typeof wrong === 'string' && relationship) {
        return {
          ...d,
          message: `"${wrong}" is a relationship; notes in ${kind.kind} diagrams attach to elements, so attach this note to one of its ends ("${relationship.from}" or "${relationship.to}")`,
          details: { ...(d.details as object | undefined), relationship: wrong, ends: [relationship.from, relationship.to] },
        };
      }
    }
    if (d.code === 'MISSING_REFERENCE') {
      // A reference by name: point at the ID of the element with that name.
      const wrong = (d.details as { id?: unknown } | undefined)?.id ?? valueAt(document, d.path);
      const owner = typeof wrong === 'string' ? findByName(document, wrong) : undefined;
      if (typeof wrong === 'string' && owner)
        return {
          ...d,
          message: `${d.message.replace(/; did you mean "[^"]*"\? References use IDs, not names|; known [^;]*$/u, '')}; "${wrong}" is the name of the element with ID "${owner}": references use IDs, so write "${owner}"`,
          details: { ...(d.details as object | undefined), suggestion: owner },
        };
    }
    return annotateSwap(d, swapped);
  });
}

/** Swap hints alone (for diagnostics of a corrected copy). */
function withSwapHints(kind: KindDefinition, document: unknown, diagnostics: Diagnostic[]): Diagnostic[] {
  const swapped = swapHints(kind, document, diagnostics);
  return diagnostics.map(d => annotateSwap(d, swapped));
}

function annotateSwap(d: Diagnostic, swapped: ReadonlyMap<string, SwapHint>): Diagnostic {
  const item = swapped.get(itemPath(d.path));
  if (!item) return d;
  const ends = item.ends ? ', "fromEnd" and "toEnd" exchanged too,' : '';
  const swap = { from: item.to, to: item.from, ...(item.ends ? Object.fromEntries(Object.entries(item.ends).filter(([, v]) => v !== undefined)) : {}) };
  return {
    ...d,
    message: `${d.message} (from and to look swapped: with "from": "${item.to}" and "to": "${item.from}"${ends} this ${item.type ?? 'relationship'} is valid)`,
    details: { ...(d.details as object | undefined), swap },
  };
}

interface SwapHint {
  from: string;
  to: string;
  type?: string;
  ends?: { fromEnd: unknown; toEnd: unknown };
}

/** The item with this ID in a relationship array of the document. */
function findRelationship(document: unknown, id: string): { from: string; to: string } | undefined {
  for (const [array, items] of Object.entries(document as Record<string, unknown>)) {
    if (!RELATIONSHIP_ARRAYS.has(array) || !Array.isArray(items)) continue;
    const hit = items.find(r => r && typeof r === 'object' && (r as Record<string, unknown>).id === id) as Record<string, unknown> | undefined;
    if (hit && typeof hit.from === 'string' && typeof hit.to === 'string') return { from: hit.from, to: hit.to };
  }
  return undefined;
}

/** ID of the one object in the document whose `name` is `name` (ignoring case and spacing). */
function findByName(document: unknown, name: string): string | undefined {
  const hits: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (typeof o.id === 'string' && typeof o.name === 'string' && squash(o.name) === squash(name)) hits.push(o.id);
    for (const value of Object.values(o)) visit(value);
  };
  visit(document);
  return hits.length === 1 ? hits[0] : undefined;
}

/** `/relationships/3/to` -> `/relationships/3`. */
const itemPath = (path: string): string => /^\/[^/]+\/\d+/u.exec(path)?.[0] ?? '';

/** Items (with `from` and `to`) whose diagnostics all disappear when the two are swapped. */
function swapHints(kind: KindDefinition, document: unknown, diagnostics: readonly Diagnostic[]): Map<string, SwapHint> {
  const out = new Map<string, SwapHint>();
  const items = [...new Set(diagnostics.map(d => itemPath(d.path)).filter(Boolean))].slice(0, 10);
  for (const path of items) {
    const item = valueAt(document, path) as Record<string, unknown> | undefined;
    if (!item || typeof item.from !== 'string' || typeof item.to !== 'string' || item.from === item.to) continue;
    const copy = structuredClone(document) as Record<string, unknown>;
    const target = valueAt(copy, path) as Record<string, unknown>;
    [target.from, target.to] = [item.to, item.from];
    // End adornments belong to their element: they swap with it (a composition's whole end).
    const ends = 'fromEnd' in item || 'toEnd' in item;
    if (ends) {
      delete target.fromEnd;
      delete target.toEnd;
      if (item.toEnd !== undefined) target.fromEnd = item.toEnd;
      if (item.fromEnd !== undefined) target.toEnd = item.fromEnd;
    }
    if (validateSchema(kind.schema, copy).diagnostics.length > 0) continue;
    const after = kind.validate(copy);
    const before = diagnostics.filter(d => itemPath(d.path) === path).length;
    if (before && !after.some(d => itemPath(d.path) === path) && after.length < diagnostics.length) {
      out.set(path, {
        from: item.from,
        to: item.to,
        ...(typeof item.type === 'string' ? { type: item.type } : {}),
        ...(ends ? { ends: { fromEnd: item.toEnd, toEnd: item.fromEnd } } : {}),
      });
    }
  }
  return out;
}

function valueAt(document: unknown, path: string): unknown {
  let node = document;
  for (const s of path.split('/').slice(1))
    node = node && typeof node === 'object' ? (node as Record<string, unknown>)[s.replaceAll('~1', '/').replaceAll('~0', '~')] : undefined;
  return node;
}

/** Kinds whose schema lets an element of type `type` have `property`. */
function kindsWithProperty(type: string, property: string): string[] {
  return kinds
    .filter(k => {
      const definitions = (k.schema.definitions ?? {}) as Record<string, { oneOf?: unknown[] }>;
      return Object.values(definitions).some(def =>
        (def.oneOf ?? []).some(branch => {
          const b = resolveRef(k.schema, branch) as { properties?: Record<string, { const?: unknown }> } | undefined;
          return b?.properties?.type?.const === type && property in b.properties;
        }),
      );
    })
    .map(k => k.kind);
}

function resolveRef(root: Record<string, unknown>, s: unknown): unknown {
  const ref = (s as { $ref?: unknown } | undefined)?.$ref;
  return typeof ref === 'string' && ref.startsWith('#/definitions/') ? (root.definitions as Record<string, unknown>)[ref.slice(14)] : s;
}

function parseLegacy(kind: KindDefinition, document: unknown): ParsedDocument {
  const legacy = kind.legacy!;
  const { diagnostics, texts } = validateSchema(legacy.schema, document);
  if (diagnostics.length > 0) failValidation(diagnostics);
  const model: unknown = legacy.upgrade(document);
  const semantic = kind.validate(model);
  if (semantic.length > 0) failValidation(semantic.map((d): Diagnostic => ({ ...d, path: legacy.mapPath(d.path) })));
  return { kind, model, texts, version: 1 };
}
