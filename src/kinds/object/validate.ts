import { pointer, type Diagnostic } from '../../core/errors.js';
import { reference, uniqueIds } from '../../model/rules.js';
import { isNote, type ClassifierDeclaration, type Element, type ObjectDiagram } from './model.js';

/**
 * Semantic rules of object diagrams (UML 2.5.1 clause 9.8, instance
 * specifications and links). Each rule has a stable code; docs/kinds/object.md
 * lists them with their fixtures.
 */
export function validateObjectDiagram(model: ObjectDiagram): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const links = model.relationships ?? [];
  uniqueIds(
    [
      ...model.elements.map((e, i) => ({ id: e.id, path: pointer('', 'elements', i) })),
      ...links.flatMap((r, i) => (r.id === undefined ? [] : [{ id: r.id, path: pointer('', 'relationships', i) }])),
    ],
    diagnostics,
  );
  const elements = new Map<string, Element>(model.elements.map(e => [e.id, e]));

  const classifiers = model.classifiers === undefined ? undefined : new Map<string, ClassifierDeclaration>();
  for (const [i, c] of (model.classifiers ?? []).entries()) {
    if (classifiers!.has(c.name))
      diagnostics.push({ code: 'DUPLICATE_CLASSIFIER', path: pointer('', 'classifiers', i, 'name'), message: `Classifier "${c.name}" is declared twice` });
    else classifiers!.set(c.name, c);
    const seen = new Set<string>();
    for (const [j, a] of (c.attributes ?? []).entries()) {
      if (seen.has(a))
        diagnostics.push({
          code: 'DUPLICATE_MEMBER',
          path: pointer('', 'classifiers', i, 'attributes', j),
          message: `Attribute "${a}" is declared twice in "${c.name}"`,
        });
      seen.add(a);
    }
  }

  // Links and note anchors name instances; a note is never a useful suggestion.
  const instanceIds = model.elements.filter(e => !isNote(e)).map(e => e.id);
  for (const [i, element] of model.elements.entries()) {
    const at = pointer('', 'elements', i);
    if (isNote(element)) {
      for (const [j, id] of (element.attachedTo ?? []).entries()) {
        const path = pointer(at, 'attachedTo', j);
        if (!reference(id, path, elements, diagnostics, 'element', undefined, instanceIds)) continue;
        if (isNote(elements.get(id)!))
          diagnostics.push({ code: 'INVALID_ATTACHMENT', path, message: `Note "${element.id}" cannot be attached to another note ("${id}")` });
      }
      continue;
    }
    if (element.name === undefined && element.classifier === undefined) {
      diagnostics.push({ code: 'UNNAMED_UNTYPED_INSTANCE', path: at, message: `Instance "${element.id}" needs a name, a classifier or both` });
    }
    let declared: ClassifierDeclaration | undefined;
    if (element.classifier !== undefined && classifiers) {
      declared = classifiers.get(element.classifier);
      if (!declared)
        diagnostics.push({
          code: 'UNKNOWN_CLASSIFIER',
          path: pointer(at, 'classifier'),
          message: `Classifier "${element.classifier}" is not declared in "classifiers"`,
          details: { classifier: element.classifier, declared: [...classifiers.keys()] },
        });
    }
    const features = new Map<string, number>();
    for (const [j, slot] of (element.slots ?? []).entries()) {
      const path = pointer(at, 'slots', j, 'feature');
      const first = features.get(slot.feature);
      if (first === undefined) {
        features.set(slot.feature, j);
      } else {
        diagnostics.push({ code: 'DUPLICATE_SLOT', path, message: `Slot "${slot.feature}" already has a value at ${pointer(at, 'slots', first)}` });
      }
      if (declared?.attributes && !declared.attributes.includes(slot.feature)) {
        diagnostics.push({
          code: 'UNKNOWN_FEATURE',
          path,
          message: `"${slot.feature}" is not an attribute of "${declared.name}"`,
          details: { feature: slot.feature, attributes: declared.attributes },
        });
      }
    }
  }

  for (const [i, r] of links.entries()) {
    const at = pointer('', 'relationships', i);
    const fromOk = reference(r.from, pointer(at, 'from'), elements, diagnostics, 'instance', { from: r.from, to: r.to }, instanceIds);
    const toOk = reference(r.to, pointer(at, 'to'), elements, diagnostics, 'instance', { from: r.from, to: r.to }, instanceIds);
    if (!fromOk || !toOk) continue;
    for (const end of ['from', 'to'] as const) {
      if (isNote(elements.get(r[end])!))
        diagnostics.push({ code: 'NOTE_IN_RELATIONSHIP', path: pointer(at, end), message: `Links connect instances; use the note's "attachedTo" instead` });
    }
  }
  return diagnostics;
}
