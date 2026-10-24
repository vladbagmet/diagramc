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
  uniqueIds(
    [
      ...model.elements.map((e, i) => ({ id: e.id, path: pointer('', 'elements', i) })),
      ...relationships.flatMap((r, i) => (r.id === undefined ? [] : [{ id: r.id, path: pointer('', 'relationships', i) }])),
    ],
    diagnostics,
  );
  const elements = new Map<string, Element>(model.elements.map(e => [e.id, e]));
  // Relationships and note anchors name classifiers; a note is never a useful suggestion.
  const classifierIds = model.elements.filter(e => !isNote(e)).map(e => e.id);

  for (const [i, element] of model.elements.entries()) {
    const at = pointer('', 'elements', i);
    if (isNote(element)) {
      for (const [j, id] of (element.attachedTo ?? []).entries()) {
        const path = pointer(at, 'attachedTo', j);
        if (!reference(id, path, elements, diagnostics, 'element', undefined, classifierIds)) continue;
        if (isNote(elements.get(id)!))
          diagnostics.push({ code: 'INVALID_ATTACHMENT', path, message: `Note "${element.id}" cannot be attached to another note ("${id}")` });
      }
      continue;
    }
    checkMembers(element, at, diagnostics);
  }

  const generalizations: { from: string; to: string; path: string }[] = [];
  const containments: { from: string; to: string; path: string }[] = [];
  const seenPairs = new Map<string, string>();
  const owners = new Map<string, string>();
  for (const [i, r] of relationships.entries()) {
    const at = pointer('', 'relationships', i);
    const fromOk = reference(r.from, pointer(at, 'from'), elements, diagnostics, 'element', { from: r.from, to: r.to }, classifierIds);
    const toOk = reference(r.to, pointer(at, 'to'), elements, diagnostics, 'element', { from: r.from, to: r.to }, classifierIds);
    for (const end of ['fromEnd', 'toEnd'] as const) checkMultiplicity(r[end]?.multiplicity, pointer(at, end, 'multiplicity'), diagnostics);
    if (!fromOk || !toOk) continue;
    const from = elements.get(r.from)!,
      to = elements.get(r.to)!;
    for (const [end, element] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (isNote(element))
        diagnostics.push({
          code: 'NOTE_IN_RELATIONSHIP',
          path: pointer(at, end),
          message: `Relationships cannot connect notes; use the note's "attachedTo" instead`,
        });
    }
    if (isNote(from) || isNote(to)) continue;

    if (r.type === 'generalization' || r.type === 'realization' || r.type === 'containment') {
      const key = `${r.type}\0${r.from}\0${r.to}`;
      const first = seenPairs.get(key);
      if (first === undefined) {
        seenPairs.set(key, at);
      } else {
        diagnostics.push({ code: 'DUPLICATE_RELATIONSHIP', path: at, message: `Duplicate ${r.type} from "${r.from}" to "${r.to}" (first at ${first})` });
      }
    }
    switch (r.type) {
      case 'generalization':
        generalizations.push({ from: r.from, to: r.to, path: at });
        if ((from.type === 'interface') !== (to.type === 'interface')) {
          diagnostics.push({
            code: 'INVALID_GENERALIZATION',
            path: pointer(at, 'to'),
            message:
              from.type === 'interface'
                ? `Interface "${r.from}" can only specialize interfaces, not ${to.type} "${r.to}"`
                : `${cap(from.type)} "${r.from}" cannot specialize interface "${r.to}"; use a realization`,
          });
        }
        break;
      case 'realization':
        if (to.type !== 'interface')
          diagnostics.push({
            code: 'INVALID_REALIZATION',
            path: pointer(at, 'to'),
            message: `Realization target "${r.to}" must be an interface, not a ${to.type}`,
          });
        else if (from.type === 'interface')
          diagnostics.push({
            code: 'INVALID_REALIZATION',
            path: pointer(at, 'from'),
            message: `Interface "${r.from}" cannot realize an interface; use a generalization`,
          });
        break;
      case 'aggregation':
        if (r.fromEnd?.navigable !== undefined)
          diagnostics.push({
            code: 'INVALID_NAVIGABILITY',
            path: pointer(at, 'fromEnd', 'navigable'),
            message: 'The whole end of an aggregation carries the diamond; navigability can only be set on the part end (toEnd)',
          });
        break;
      case 'composition': {
        if (r.fromEnd?.navigable !== undefined)
          diagnostics.push({
            code: 'INVALID_NAVIGABILITY',
            path: pointer(at, 'fromEnd', 'navigable'),
            message: 'The whole end of a composition carries the diamond; navigability can only be set on the part end (toEnd)',
          });
        const whole = r.fromEnd?.multiplicity;
        if (whole !== undefined) {
          const { upper } = multiplicityBounds(whole);
          if (upper === undefined || upper > 1)
            diagnostics.push({
              code: 'INVALID_COMPOSITION',
              path: pointer(at, 'fromEnd', 'multiplicity'),
              message: `A part belongs to at most one composite: the whole end multiplicity must be 0..1 or 1, not "${whole}"`,
            });
        }
        break;
      }
      case 'containment': {
        containments.push({ from: r.from, to: r.to, path: at });
        const owner = owners.get(r.to);
        if (owner === undefined || owner === r.from) {
          owners.set(r.to, r.from);
        } else {
          diagnostics.push({
            code: 'MULTIPLE_OWNERS',
            path: pointer(at, 'to'),
            message: `"${r.to}" is already nested in "${owner}"; a classifier has at most one owner`,
          });
        }
        break;
      }
      default:
        break;
    }
  }
  findCycles(generalizations, 'INHERITANCE_CYCLE', 'Generalization must be acyclic', diagnostics);
  findCycles(containments, 'CONTAINMENT_CYCLE', 'Containment (nesting) must be acyclic', diagnostics);
  return diagnostics;
}

function checkMembers(element: Classifier, at: string, diagnostics: Diagnostic[]): void {
  const names = new Map<string, number>();
  for (const [j, attribute] of (element.attributes ?? []).entries()) {
    if (isLegacy(attribute)) continue;
    const path = pointer(at, 'attributes', j);
    checkMultiplicity(attribute.multiplicity, pointer(path, 'multiplicity'), diagnostics);
    // The "/" of a derived attribute is drawn from the flag; written in the name it would be doubled or wrong.
    if (attribute.name.startsWith('/') && attribute.name.length > 1) {
      const bare = attribute.name.slice(1).trimStart();
      diagnostics.push({
        code: 'DERIVED_MARK_IN_NAME',
        path: pointer(path, 'name'),
        message: `Attribute name "${attribute.name}" starts with "/": write the name "${bare}" and set "derived": true, which draws the "/"`,
        details: { suggestion: bare },
      });
    }
    const first = names.get(attribute.name);
    if (first === undefined) {
      names.set(attribute.name, j);
    } else {
      diagnostics.push({
        code: 'DUPLICATE_MEMBER',
        path: pointer(path, 'name'),
        message: `Attribute "${attribute.name}" is already defined at ${pointer(at, 'attributes', first)}`,
      });
    }
  }
  const literals = new Map<string, number>();
  for (const [j, literal] of (element.literals ?? []).entries()) {
    const first = literals.get(literal);
    if (first === undefined) {
      literals.set(literal, j);
    } else {
      diagnostics.push({
        code: 'DUPLICATE_MEMBER',
        path: pointer(at, 'literals', j),
        message: `Literal "${literal}" is already defined at ${pointer(at, 'literals', first)}`,
      });
    }
  }
  for (const [j, operation] of (element.operations ?? []).entries()) {
    if (isLegacy(operation)) continue;
    const path = pointer(at, 'operations', j);
    for (const [k, p] of (operation.parameters ?? []).entries()) checkMultiplicity(p.multiplicity, pointer(path, 'parameters', k, 'multiplicity'), diagnostics);
    if (operation.abstract && element.type !== 'interface' && !(element.type === 'class' && element.abstract)) {
      diagnostics.push({
        code: 'ABSTRACT_OPERATION_IN_CONCRETE_CLASS',
        path: pointer(path, 'abstract'),
        message: `Abstract operation "${operation.name}" requires "${element.id}" to be an abstract class or an interface`,
      });
    }
  }
}

const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);
