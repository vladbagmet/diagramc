import type { Diagnostic } from '../core/errors.js';
import { findCycles } from './rules.js';

/**
 * Shared ownership rules for kinds with nesting (package members, containment
 * lines): an element has at most one owner (MULTIPLE_OWNERS), is listed at most
 * once by the same owner (DUPLICATE_MEMBER) and ownership is acyclic
 * (CONTAINMENT_CYCLE). `edges` are owner -> owned, `path` points at the reference
 * to the owned element. Returns the owner of each owned element (first wins).
 */
export function checkOwnership(edges: readonly { from: string; to: string; path: string }[], diagnostics: Diagnostic[]): Map<string, string> {
  const owner = new Map<string, string>();
  const acyclic: { from: string; to: string; path: string }[] = [];
  for (const e of edges) {
    const first = owner.get(e.to);
    if (first === undefined) { owner.set(e.to, e.from); acyclic.push(e); continue; }
    if (first === e.from) diagnostics.push({ code: 'DUPLICATE_MEMBER', path: e.path, message: `"${e.to}" is already owned by "${e.from}"`, details: { owner: e.from, member: e.to } });
    else diagnostics.push({ code: 'MULTIPLE_OWNERS', path: e.path, message: `"${e.to}" is already owned by "${first}"; an element has at most one owner`, details: { owner: first, member: e.to } });
  }
  findCycles(acyclic, 'CONTAINMENT_CYCLE', 'Ownership (nesting and containment) must be acyclic', diagnostics);
  return owner;
}

/** Transitive owners of `id`, nearest first. Safe on cyclic input. */
export function owners(id: string, owner: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (let p = owner.get(id); p !== undefined && !out.includes(p) && p !== id; p = owner.get(p)) out.push(p);
  return out;
}

/** True when one of `a` and `b` (transitively) owns the other. */
export function nestedIn(a: string, b: string, owner: ReadonlyMap<string, string>): boolean {
  return owners(a, owner).includes(b) || owners(b, owner).includes(a);
}
