import { pointer, type Diagnostic } from '../../core/errors.js';
import { checkMultiplicity, findCycles, multiplicityBounds, reference, uniqueIds } from '../../model/rules.js';
import { isLegacy, isNote, type ClassDiagram, type Classifier, type Element } from './model.js';

/**
 * Semantic rules of class diagrams (UML 2.5.1 clauses 9 and 11). Each rule has a
 * stable code; docs/kinds/class.md lists them with their fixtures.
 */
export function validateClassDiagram(model: ClassDiagram): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const relationships = model.relationships ?? [];
  uniqueIds([
    ...model.elements.map((e, i) => ({ id: e.id, path: pointer('', 'elements', i) })),
    ...relationships.flatMap((r, i) => r.id === undefined ? [] : [{ id: r.id, path: pointer('', 'relationships', i) }]),
  ], diagnostics);
  const elements = new Map<string, Element>(model.elements.map(e => [e.id, e]));

  model.elements.forEach((element, i) => {
    const at = pointer('', 'elements', i);
    if (isNote(element)) {
      (element.attachedTo ?? []).forEach((id, j) => {
        const path = pointer(at, 'attachedTo', j);
        if (!reference(id, path, elements, diagnostics)) return;
        if (isNote(elements.get(id)!)) diagnostics.push({ code: 'INVALID_ATTACHMENT', path, message: `Note "${element.id}" cannot be attached to another note ("${id}")` });
      });
      return;
    }
    checkMembers(element, at, diagnostics);
  });

  const generalizations: { from: string; to: string; path: string }[] = [];
  const containments: { from: string; to: string; path: string }[] = [];
  const seenPairs = new Map<string, string>();
  const owners = new Map<string, string>();
  relationships.forEach((r, i) => {
    const at = pointer('', 'relationships', i);
    const fromOk = reference(r.from, pointer(at, 'from'), elements, diagnostics, 'element', { from: r.from, to: r.to });
    const toOk = reference(r.to, pointer(at, 'to'), elements, diagnostics, 'element', { from: r.from, to: r.to });
    for (const end of ['fromEnd', 'toEnd'] as const) checkMultiplicity(r[end]?.multiplicity, pointer(at, end, 'multiplicity'), diagnostics);
    if (!fromOk || !toOk) return;
    const from = elements.get(r.from)!, to = elements.get(r.to)!;
    for (const [end, element] of [['from', from], ['to', to]] as const) {
      if (isNote(element)) diagnostics.push({ code: 'NOTE_IN_RELATIONSHIP', path: pointer(at, end), message: `Relationships cannot connect notes; use the note's "attachedTo" instead` });
    }
    if (isNote(from) || isNote(to)) return;

    if (r.type === 'generalization' || r.type === 'realization' || r.type === 'containment') {
      const key = `${r.type}\u0000${r.from}\u0000${r.to}`;
      const first = seenPairs.get(key);
      if (first !== undefined) diagnostics.push({ code: 'DUPLICATE_RELATIONSHIP', path: at, message: `Duplicate ${r.type} from "${r.from}" to "${r.to}" (first at ${first})` });
      else seenPairs.set(key, at);
    }
    switch (r.type) {
      case 'generalization':
        generalizations.push({ from: r.from, to: r.to, path: at });
        if ((from.type === 'interface') !== (to.type === 'interface')) {
          diagnostics.push({ code: 'INVALID_GENERALIZATION', path: pointer(at, 'to'), message: from.type === 'interface'
            ? `Interface "${r.from}" can only specialize interfaces, not ${to.type} "${r.to}"`
            : `${cap(from.type)} "${r.from}" cannot specialize interface "${r.to}"; use a realization` });
        }
        break;
      case 'realization':
        if (to.type !== 'interface') diagnostics.push({ code: 'INVALID_REALIZATION', path: pointer(at, 'to'), message: `Realization target "${r.to}" must be an interface, not a ${to.type}` });
        else if (from.type === 'interface') diagnostics.push({ code: 'INVALID_REALIZATION', path: pointer(at, 'from'), message: `Interface "${r.from}" cannot realize an interface; use a generalization` });
        break;
      case 'aggregation':
        if (r.fromEnd?.navigable !== undefined) diagnostics.push({ code: 'INVALID_NAVIGABILITY', path: pointer(at, 'fromEnd', 'navigable'), message: 'The whole end of an aggregation carries the diamond; navigability can only be set on the part end (toEnd)' });
        break;
      case 'composition': {
        if (r.fromEnd?.navigable !== undefined) diagnostics.push({ code: 'INVALID_NAVIGABILITY', path: pointer(at, 'fromEnd', 'navigable'), message: 'The whole end of a composition carries the diamond; navigability can only be set on the part end (toEnd)' });
        const whole = r.fromEnd?.multiplicity;
        if (whole !== undefined) {
          const { upper } = multiplicityBounds(whole);
          if (upper === undefined || upper > 1) diagnostics.push({ code: 'INVALID_COMPOSITION', path: pointer(at, 'fromEnd', 'multiplicity'), message: `A part belongs to at most one composite: the whole end multiplicity must be 0..1 or 1, not "${whole}"` });
        }
        break;
      }
      case 'containment': {
        containments.push({ from: r.from, to: r.to, path: at });
        const owner = owners.get(r.to);
        if (owner !== undefined && owner !== r.from) diagnostics.push({ code: 'MULTIPLE_OWNERS', path: pointer(at, 'to'), message: `"${r.to}" is already nested in "${owner}"; a classifier has at most one owner` });
        else owners.set(r.to, r.from);
        break;
      }
      default:
        break;
    }
  });
  findCycles(generalizations, 'INHERITANCE_CYCLE', 'Generalization must be acyclic', diagnostics);
  findCycles(containments, 'CONTAINMENT_CYCLE', 'Containment (nesting) must be acyclic', diagnostics);
  return diagnostics;
}

function checkMembers(element: Classifier, at: string, diagnostics: Diagnostic[]): void {
  const names = new Map<string, number>();
  (element.attributes ?? []).forEach((attribute, j) => {
    if (isLegacy(attribute)) return;
    const path = pointer(at, 'attributes', j);
    checkMultiplicity(attribute.multiplicity, pointer(path, 'multiplicity'), diagnostics);
    const first = names.get(attribute.name);
    if (first !== undefined) diagnostics.push({ code: 'DUPLICATE_MEMBER', path: pointer(path, 'name'), message: `Attribute "${attribute.name}" is already defined at ${pointer(at, 'attributes', first)}` });
    else names.set(attribute.name, j);
  });
  const literals = new Map<string, number>();
  (element.literals ?? []).forEach((literal, j) => {
    const first = literals.get(literal);
    if (first !== undefined) diagnostics.push({ code: 'DUPLICATE_MEMBER', path: pointer(at, 'literals', j), message: `Literal "${literal}" is already defined at ${pointer(at, 'literals', first)}` });
    else literals.set(literal, j);
  });
  (element.operations ?? []).forEach((operation, j) => {
    if (isLegacy(operation)) return;
    const path = pointer(at, 'operations', j);
    (operation.parameters ?? []).forEach((p, k) => checkMultiplicity(p.multiplicity, pointer(path, 'parameters', k, 'multiplicity'), diagnostics));
    if (operation.abstract && element.type !== 'interface' && !(element.type === 'class' && element.abstract)) {
      diagnostics.push({ code: 'ABSTRACT_OPERATION_IN_CONCRETE_CLASS', path: pointer(path, 'abstract'), message: `Abstract operation "${operation.name}" requires "${element.id}" to be an abstract class or an interface` });
    }
  });
}

const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);
