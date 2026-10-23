import { pointer, type Diagnostic } from '../../core/errors.js';
import { checkMultiplicity, findCycles, reference, uniqueIds } from '../../model/rules.js';
import type { Element, UseCaseDiagram } from './model.js';

/**
 * Semantic rules of use case diagrams (UML 2.5.1 clause 18). Each rule has a
 * stable code; docs/kinds/use-case.md lists them with their fixtures.
 */
export function validateUseCaseDiagram(model: UseCaseDiagram): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const relationships = model.relationships ?? [];
  uniqueIds([
    ...model.elements.map((e, i) => ({ id: e.id, path: pointer('', 'elements', i) })),
    ...relationships.flatMap((r, i) => r.id === undefined ? [] : [{ id: r.id, path: pointer('', 'relationships', i) }]),
  ], diagnostics);
  const elements = new Map<string, Element>(model.elements.map(e => [e.id, e]));

  for (const [i, e] of model.elements.entries()) {
    const at = pointer('', 'elements', i);
    if (e.type === 'useCase') {
      if (e.subject !== undefined && reference(e.subject, pointer(at, 'subject'), elements, diagnostics, 'subject') && elements.get(e.subject)!.type !== 'subject') {
        diagnostics.push({ code: 'INVALID_SUBJECT', path: pointer(at, 'subject'), message: `"${e.subject}" is a ${elements.get(e.subject)!.type}, not a subject` });
      }
      const seen = new Set<string>();
      for (const [j, p] of (e.extensionPoints ?? []).entries()) {
        if (seen.has(p)) diagnostics.push({ code: 'DUPLICATE_EXTENSION_POINT', path: pointer(at, 'extensionPoints', j), message: `Use case "${e.id}" declares extension point "${p}" twice` });
        seen.add(p);
      }
    }
    if (e.type === 'note') {
      for (const [j, id] of (e.attachedTo ?? []).entries()) {
        const path = pointer(at, 'attachedTo', j);
        if (reference(id, path, elements, diagnostics) && elements.get(id)!.type === 'note') diagnostics.push({ code: 'INVALID_ATTACHMENT', path, message: `Note "${e.id}" cannot be attached to another note ("${id}")` });
      }
    }
  }

  const includes: { from: string; to: string; path: string }[] = [];
  const extendsGraph: { from: string; to: string; path: string }[] = [];
  const generalizations: { from: string; to: string; path: string }[] = [];
  const pairs = new Map<string, string>();
  for (const [i, r] of relationships.entries()) {
    const at = pointer('', 'relationships', i);
    const fromOk = reference(r.from, pointer(at, 'from'), elements, diagnostics, 'element', { from: r.from, to: r.to });
    const toOk = reference(r.to, pointer(at, 'to'), elements, diagnostics, 'element', { from: r.from, to: r.to });
    if (r.type === 'association') for (const end of ['fromEnd', 'toEnd'] as const) checkMultiplicity(r[end]?.multiplicity, pointer(at, end, 'multiplicity'), diagnostics);
    if (!fromOk || !toOk) continue;
    const from = elements.get(r.from)!, to = elements.get(r.to)!;
    for (const [end, e] of [['from', from], ['to', to]] as const) {
      if (e.type === 'note' || e.type === 'subject') diagnostics.push({ code: e.type === 'note' ? 'NOTE_IN_RELATIONSHIP' : 'SUBJECT_IN_RELATIONSHIP', path: pointer(at, end), message: e.type === 'note' ? `Relationships cannot connect notes; use the note's "attachedTo" instead` : `Relationships connect actors and use cases, not the subject "${e.id}"` });
    }
    if (from.type === 'note' || to.type === 'note' || from.type === 'subject' || to.type === 'subject') continue;
    if (r.type !== 'association') {
      const key = `${r.type}\u0000${r.from}\u0000${r.to}`;
      const first = pairs.get(key);
      if (first === undefined) {pairs.set(key, at);}
      else {diagnostics.push({ code: 'DUPLICATE_RELATIONSHIP', path: at, message: `Duplicate ${r.type} from "${r.from}" to "${r.to}" (first at ${first})` });}
    }
    switch (r.type) {
      case 'association':
        if ((from.type === 'actor') === (to.type === 'actor')) {
          diagnostics.push({ code: 'INVALID_ASSOCIATION', path: pointer(at, from.type === 'actor' ? 'to' : 'from'), message: from.type === 'actor'
            ? `Actors communicate with use cases, not with other actors ("${r.from}" and "${r.to}"): associate each of them with the use cases they take part in instead (a generalization between the two only if one actor is a kind of the other)`
            : `An association in a use case diagram connects an actor and a use case; "${r.from}" and "${r.to}" are use cases (use «include» or «extend»)` });
        }
        break;
      case 'include': case 'extend': {
        const bad = from.type === 'useCase' ? to.type === 'useCase' ? undefined : 'to' : 'from';
        if (bad) {
          diagnostics.push({ code: r.type === 'include' ? 'INVALID_INCLUDE' : 'INVALID_EXTEND', path: pointer(at, bad), message: `«${r.type}» connects two use cases; "${bad === 'from' ? r.from : r.to}" is an actor` });
          break;
        }
        (r.type === 'include' ? includes : extendsGraph).push({ from: r.from, to: r.to, path: at });
        if (r.type === 'extend' && to.type === 'useCase' && !(to.extensionPoints ?? []).includes(r.extensionPoint)) {
          diagnostics.push({ code: 'UNKNOWN_EXTENSION_POINT', path: pointer(at, 'extensionPoint'), message: `Base use case "${r.to}" declares no extension point "${r.extensionPoint}"; «extend» points from the extending use case (from) to the base use case (to), which lists its extension points`, details: { declared: to.extensionPoints ?? [] } });
        }
        break;
      }
      case 'generalization':
        if (from.type === to.type) {generalizations.push({ from: r.from, to: r.to, path: at });}
        else {diagnostics.push({ code: 'INVALID_GENERALIZATION', path: pointer(at, 'to'), message: `A ${from.type} can only specialize another ${from.type}; "${r.to}" is a ${to.type}` });}
        break;
    }
  }
  findCycles(includes, 'INCLUDE_CYCLE', 'Use cases cannot include themselves, directly or through other inclusions', diagnostics);
  findCycles(extendsGraph, 'EXTEND_CYCLE', 'Use cases cannot extend themselves, directly or through other extensions', diagnostics);
  findCycles(generalizations, 'INHERITANCE_CYCLE', 'Generalization must be acyclic', diagnostics);
  return diagnostics;
}
