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
  uniqueIds([
    ...model.elements.map((e, i) => ({ id: e.id, path: pointer('', 'elements', i) })),
    ...links.flatMap((r, i) => r.id === undefined ? [] : [{ id: r.id, path: pointer('', 'relationships', i) }]),
  ], diagnostics);
  const elements = new Map<string, Element>(model.elements.map(e => [e.id, e]));

  const classifiers = model.classifiers === undefined ? undefined : new Map<string, ClassifierDeclaration>();
  (model.classifiers ?? []).forEach((c, i) => {
    if (classifiers!.has(c.name)) diagnostics.push({ code: 'DUPLICATE_CLASSIFIER', path: pointer('', 'classifiers', i, 'name'), message: `Classifier "${c.name}" is declared twice` });
    else classifiers!.set(c.name, c);
    const seen = new Set<string>();
    (c.attributes ?? []).forEach((a, j) => {
      if (seen.has(a)) diagnostics.push({ code: 'DUPLICATE_MEMBER', path: pointer('', 'classifiers', i, 'attributes', j), message: `Attribute "${a}" is declared twice in "${c.name}"` });
      seen.add(a);
    });
  });

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
    if (element.name === undefined && element.classifier === undefined) {
      diagnostics.push({ code: 'UNNAMED_UNTYPED_INSTANCE', path: at, message: `Instance "${element.id}" needs a name, a classifier or both` });
    }
    let declared: ClassifierDeclaration | undefined;
    if (element.classifier !== undefined && classifiers) {
      declared = classifiers.get(element.classifier);
      if (!declared) diagnostics.push({ code: 'UNKNOWN_CLASSIFIER', path: pointer(at, 'classifier'), message: `Classifier "${element.classifier}" is not declared in "classifiers"`, details: { classifier: element.classifier, declared: [...classifiers.keys()] } });
    }
    const features = new Map<string, number>();
    (element.slots ?? []).forEach((slot, j) => {
      const path = pointer(at, 'slots', j, 'feature');
      const first = features.get(slot.feature);
      if (first !== undefined) diagnostics.push({ code: 'DUPLICATE_SLOT', path, message: `Slot "${slot.feature}" already has a value at ${pointer(at, 'slots', first)}` });
      else features.set(slot.feature, j);
      if (declared?.attributes && !declared.attributes.includes(slot.feature)) {
        diagnostics.push({ code: 'UNKNOWN_FEATURE', path, message: `"${slot.feature}" is not an attribute of "${declared.name}"`, details: { feature: slot.feature, attributes: declared.attributes } });
      }
    });
  });

  links.forEach((r, i) => {
    const at = pointer('', 'relationships', i);
    const fromOk = reference(r.from, pointer(at, 'from'), elements, diagnostics, 'instance', { from: r.from, to: r.to });
    const toOk = reference(r.to, pointer(at, 'to'), elements, diagnostics, 'instance', { from: r.from, to: r.to });
    if (!fromOk || !toOk) return;
    for (const end of ['from', 'to'] as const) {
      if (isNote(elements.get(r[end])!)) diagnostics.push({ code: 'NOTE_IN_RELATIONSHIP', path: pointer(at, end), message: `Links connect instances; use the note's "attachedTo" instead` });
    }
  });
  return diagnostics;
}
