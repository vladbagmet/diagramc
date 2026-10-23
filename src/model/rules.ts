import { pointer, type Diagnostic } from '../core/errors.js';
import { suggest } from './hints.js';

/**
 * Shared semantic checks. Kinds call these from `validate()` and add their own
 * rules. Codes are stable: DUPLICATE_ID, MISSING_REFERENCE, plus whatever code
 * the caller passes to `findCycles`.
 */

export interface Identified {
  id: string;
  path: string;
}

/** Every ID in the document shares one namespace. Returns the set of known IDs. */
export function uniqueIds(items: readonly Identified[], diagnostics: Diagnostic[]): Map<string, string> {
  const seen = new Map<string, string>();
  for (const item of items) {
    const first = seen.get(item.id);
    if (first === undefined) {
      seen.set(item.id, item.path);
    } else {
      diagnostics.push({
        code: 'DUPLICATE_ID',
        path: pointer(item.path, 'id'),
        message: `Duplicate ID "${item.id}" (first used at ${first})`,
        details: { id: item.id, first },
      });
    }
  }
  return seen;
}

/**
 * Checks that `id` names something in `known` and, if `allowed` is given, that the
 * target satisfies it. Returns true when the reference is usable.
 */
export function reference(
  id: string,
  path: string,
  known: ReadonlyMap<string, unknown>,
  diagnostics: Diagnostic[],
  what = 'element',
  details?: object,
  candidates?: readonly string[],
): boolean {
  if (known.has(id)) return true;
  // The nearest valid ID (`candidates`: the IDs this reference may name, default all): same letters in another case or spelling, or a typo.
  const valid = candidates ?? [...known.keys()];
  const nearest = suggest(id, valid, 'id');
  diagnostics.push({
    code: 'MISSING_REFERENCE',
    path,
    message: `Reference to unknown ${what} "${id}"${
      nearest
        ? `; did you mean "${nearest}"? References use IDs, not names`
        : `; known ${what} IDs: ${valid
            .slice(0, 20)
            .map(k => `"${k}"`)
            .join(', ')}${valid.length > 20 ? ', ...' : ''}`
    }`,
    details: { ...(details ?? { id }), ...(nearest ? { suggestion: nearest } : {}) },
  });
  return false;
}

/**
 * Reports every directed cycle in a graph given as edges (from -> to), once per
 * cycle-closing edge. Self-edges are cycles. Deterministic: follows input order.
 */
export function findCycles(edges: readonly { from: string; to: string; path: string }[], code: string, message: string, diagnostics: Diagnostic[]): void {
  const out = new Map<string, { to: string; path: string }[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  const state = new Map<string, 'active' | 'done'>();
  const visit = (id: string): void => {
    state.set(id, 'active');
    for (const edge of out.get(id) ?? []) {
      const s = state.get(edge.to);
      if (s === 'active') diagnostics.push({ code, path: edge.path, message, details: { id: edge.to } });
      else if (s === undefined) visit(edge.to);
    }
    state.set(id, 'done');
  };
  for (const e of edges) if (!state.has(e.from)) visit(e.from);
}

/** Parses a multiplicity string ("*", "n", "n..m"). Returns undefined bounds for "*". */
export function multiplicityBounds(text: string): { lower: number; upper: number | undefined } {
  const [low, high = low] = text.split('..') as [string, string?];
  const lower = low === '*' ? 0 : Number(low);
  const upper = high === '*' ? undefined : Number(high);
  return { lower, upper };
}

/** Checks lower <= upper and that a lone "*" is not used as a lower bound with an upper ("*..3"). */
export function checkMultiplicity(text: string | undefined, path: string, diagnostics: Diagnostic[]): void {
  if (text === undefined) return;
  const parts = text.split('..');
  if (parts.length === 2 && parts[0] === '*') {
    diagnostics.push({ code: 'INVALID_MULTIPLICITY', path, message: `Multiplicity "${text}" has "*" as its lower bound` });
    return;
  }
  const { lower, upper } = multiplicityBounds(text);
  if (upper !== undefined && lower > upper)
    diagnostics.push({ code: 'INVALID_MULTIPLICITY', path, message: `Multiplicity "${text}" has a lower bound above its upper bound` });
  else if (upper === 0) diagnostics.push({ code: 'INVALID_MULTIPLICITY', path, message: `Multiplicity "${text}" has an upper bound of 0` });
}
