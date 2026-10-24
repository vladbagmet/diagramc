import { pointer, type Diagnostic } from '../../core/errors.js';
import { checkOwnership, nestedIn } from '../../model/nesting.js';
import { reference, uniqueIds } from '../../model/rules.js';
import { isNote, isPackage, type Element, type PackageDiagram } from './model.js';

/**
 * Semantic rules of package diagrams (UML 2.5.1 clause 12). Each rule has a
 * stable code; docs/kinds/package.md lists them with their fixtures.
 */
export function validatePackageDiagram(model: PackageDiagram): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const relationships = model.relationships ?? [];
  uniqueIds(
    [
      ...model.elements.map((e, i) => ({ id: e.id, path: pointer('', 'elements', i) })),
      ...relationships.flatMap((r, i) => (r.id === undefined ? [] : [{ id: r.id, path: pointer('', 'relationships', i) }])),
    ],
    diagnostics,
  );
  const elements = new Map<string, Element>(model.elements.map(e => [e.id, e]));

  // Ownership: nesting through `members` and containment lines share one rule set.
  const ownership: { from: string; to: string; path: string }[] = [];
  for (const [i, element] of model.elements.entries()) {
    const at = pointer('', 'elements', i);
    if (isNote(element)) {
      for (const [j, id] of (element.attachedTo ?? []).entries()) {
        const path = pointer(at, 'attachedTo', j);
        if (!reference(id, path, elements, diagnostics)) continue;
        if (isNote(elements.get(id)!))
          diagnostics.push({ code: 'INVALID_ATTACHMENT', path, message: `Note "${element.id}" cannot be attached to another note ("${id}")` });
      }
    }
    if (isPackage(element)) {
      for (const [j, id] of (element.members ?? []).entries()) {
        const path = pointer(at, 'members', j);
        if (reference(id, path, elements, diagnostics)) ownership.push({ from: element.id, to: id, path });
      }
    }
  }

  const seen = new Map<string, string>();
  const checked: { index: number; from: Element; to: Element }[] = [];
  for (const [i, r] of relationships.entries()) {
    const at = pointer('', 'relationships', i);
    const fromOk = reference(r.from, pointer(at, 'from'), elements, diagnostics, 'element', { from: r.from, to: r.to });
    const toOk = reference(r.to, pointer(at, 'to'), elements, diagnostics, 'element', { from: r.from, to: r.to });
    if (!fromOk || !toOk) continue;
    const from = elements.get(r.from)!,
      to = elements.get(r.to)!;
    let ok = true;
    for (const [end, element] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (isNote(element)) {
        ok = false;
        diagnostics.push({
          code: 'NOTE_IN_RELATIONSHIP',
          path: pointer(at, end),
          message: `Relationships cannot connect notes; use the note's "attachedTo" instead`,
        });
      }
    }
    if (!ok) continue;
    if (r.from === r.to) {
      diagnostics.push({ code: 'SELF_RELATIONSHIP', path: pointer(at, 'to'), message: `A ${r.type} cannot connect "${r.from}" to itself` });
      continue;
    }
    const key = `${r.type}\0${r.from}\0${r.to}`;
    const first = seen.get(key);
    if (first !== undefined) {
      diagnostics.push({ code: 'DUPLICATE_RELATIONSHIP', path: at, message: `Duplicate ${r.type} from "${r.from}" to "${r.to}" (first at ${first})` });
      continue;
    }
    seen.set(key, at);
    switch (r.type) {
      case 'import':
      case 'access':
        if (!isPackage(from))
          diagnostics.push({ code: 'INVALID_IMPORT', path: pointer(at, 'from'), message: `Only a package can import; "${r.from}" is a ${from.type}` });
        break;
      case 'merge':
        if (!isPackage(from))
          diagnostics.push({ code: 'INVALID_MERGE', path: pointer(at, 'from'), message: `Package merge connects two packages; "${r.from}" is a ${from.type}` });
        else if (!isPackage(to))
          diagnostics.push({ code: 'INVALID_MERGE', path: pointer(at, 'to'), message: `Package merge connects two packages; "${r.to}" is a ${to.type}` });
        break;
      case 'containment':
        if (to.type === 'package' && from.type !== 'package')
          diagnostics.push({
            code: 'INVALID_CONTAINMENT',
            path: pointer(at, 'from'),
            message: `A package can only be owned by a package, not by ${from.type} "${r.from}"`,
          });
        else ownership.push({ from: r.from, to: r.to, path: pointer(at, 'to') });
        break;
      default:
        break;
    }
    if (r.type !== 'containment') checked.push({ index: i, from, to });
  }

  const owner = checkOwnership(ownership, diagnostics);
  // A relationship between a package and its own (nested) member is meaningless
  // (a package already sees its members) and cannot be drawn sensibly.
  if (diagnostics.every(d => d.code !== 'CONTAINMENT_CYCLE')) {
    for (const { index, from, to } of checked) {
      if (nestedIn(from.id, to.id, owner)) {
        diagnostics.push({
          code: 'RELATIONSHIP_WITH_OWN_MEMBER',
          path: pointer('', 'relationships', index),
          message: `"${from.id}" and "${to.id}" are nested in one another; relationships connect elements that do not own each other`,
        });
      }
    }
  }
  return diagnostics;
}
