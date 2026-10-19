import { pointer, type Diagnostic } from '../../core/errors.js';
import { checkOwnership, nestedIn, owners } from '../../model/nesting.js';
import { checkMultiplicity, findCycles, reference, uniqueIds } from '../../model/rules.js';
import { suggest } from '../../model/hints.js';
import { isContainer, isNote, type Element, type ProfileDiagram } from './model.js';

/**
 * Semantic rules of profile diagrams (UML 2.5.1 clause 12.3). Each rule has a
 * stable code; docs/kinds/profile.md lists them with their fixtures.
 */
export function validateProfileDiagram(model: ProfileDiagram): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const relationships = model.relationships ?? [];
  uniqueIds([
    ...model.elements.map((e, i) => ({ id: e.id, path: pointer('', 'elements', i) })),
    ...relationships.flatMap((r, i) => r.id === undefined ? [] : [{ id: r.id, path: pointer('', 'relationships', i) }]),
  ], diagnostics);
  const elements = new Map<string, Element>(model.elements.map(e => [e.id, e]));

  const ownership: { from: string; to: string; path: string }[] = [];
  model.elements.forEach((element, i) => {
    const at = pointer('', 'elements', i);
    switch (element.type) {
      case 'note':
        (element.attachedTo ?? []).forEach((id, j) => {
          const path = pointer(at, 'attachedTo', j);
          if (!reference(id, path, elements, diagnostics)) return;
          if (isNote(elements.get(id)!)) diagnostics.push({ code: 'INVALID_ATTACHMENT', path, message: `Note "${element.id}" cannot be attached to another note ("${id}")` });
        });
        break;
      case 'profile': case 'package':
        (element.members ?? []).forEach((id, j) => {
          const path = pointer(at, 'members', j);
          if (!reference(id, path, elements, diagnostics)) return;
          ownership.push({ from: element.id, to: id, path });
          // A stereotype is defined by a profile (UML 2.5.1 12.3.3); a plain package cannot own one.
          if (element.type === 'package' && elements.get(id)!.type === 'stereotype') {
            diagnostics.push({ code: 'STEREOTYPE_OUTSIDE_PROFILE', path, message: `Stereotype "${id}" must be owned by a profile, not by package "${element.id}"` });
          }
        });
        break;
      case 'stereotype': {
        const names = new Map<string, number>();
        (element.attributes ?? []).forEach((a, j) => {
          const path = pointer(at, 'attributes', j);
          checkMultiplicity(a.multiplicity, pointer(path, 'multiplicity'), diagnostics);
          const first = names.get(a.name);
          if (first !== undefined) diagnostics.push({ code: 'DUPLICATE_MEMBER', path: pointer(path, 'name'), message: `Tagged value "${a.name}" is already defined at ${pointer(at, 'attributes', first)}` });
          else names.set(a.name, j);
        });
        break;
      }
      case 'enumeration': {
        const seen = new Map<string, number>();
        (element.literals ?? []).forEach((literal, j) => {
          const first = seen.get(literal);
          if (first !== undefined) diagnostics.push({ code: 'DUPLICATE_MEMBER', path: pointer(at, 'literals', j), message: `Literal "${literal}" is already defined at ${pointer(at, 'literals', first)}` });
          else seen.set(literal, j);
        });
        break;
      }
      default:
        break;
    }
  });

  const generalizations: { from: string; to: string; path: string }[] = [];
  const seen = new Map<string, string>();
  const checked: { index: number; from: string; to: string; applied?: boolean }[] = [];
  relationships.forEach((r, i) => {
    const at = pointer('', 'relationships', i);
    const fromOk = reference(r.from, pointer(at, 'from'), elements, diagnostics, 'element', { from: r.from, to: r.to });
    const toOk = reference(r.to, pointer(at, 'to'), elements, diagnostics, 'element', { from: r.from, to: r.to });
    if (!fromOk || !toOk) return;
    const from = elements.get(r.from)!, to = elements.get(r.to)!;
    if (isNote(from) || isNote(to)) {
      diagnostics.push({ code: 'NOTE_IN_RELATIONSHIP', path: pointer(at, isNote(from) ? 'from' : 'to'), message: `Relationships cannot connect notes; use the note's "attachedTo" instead` });
      return;
    }
    const key = `${r.type}\u0000${r.from}\u0000${r.to}`;
    const first = seen.get(key);
    if (first !== undefined) { diagnostics.push({ code: 'DUPLICATE_RELATIONSHIP', path: at, message: `Duplicate ${r.type} from "${r.from}" to "${r.to}" (first at ${first})` }); return; }
    seen.set(key, at);
    const fail = (code: string, end: 'from' | 'to', message: string) => diagnostics.push({ code, path: pointer(at, end), message });
    switch (r.type) {
      case 'extension':
        if (from.type !== 'stereotype') fail('INVALID_EXTENSION', 'from', `An extension goes from a stereotype to a metaclass; "${r.from}" is a ${from.type}`);
        else if (to.type !== 'metaclass') fail('INVALID_EXTENSION', 'to', `An extension goes from a stereotype to a metaclass; "${r.to}" is a ${to.type}`);
        break;
      case 'generalization':
        if (from.type !== 'stereotype') fail('INVALID_GENERALIZATION', 'from', `Generalization in a profile diagram connects stereotypes; "${r.from}" is a ${from.type}`);
        else if (to.type !== 'stereotype') fail('INVALID_GENERALIZATION', 'to', `A stereotype can only specialize a stereotype; "${r.to}" is a ${to.type}`);
        else generalizations.push({ from: r.from, to: r.to, path: at });
        break;
      case 'apply':
        if (!isContainer(from)) fail('INVALID_APPLICATION', 'from', `A profile is applied to a package; "${r.from}" is a ${from.type}`);
        else if (to.type !== 'profile') fail('INVALID_APPLICATION', 'to', `Only a profile can be applied; "${r.to}" is a ${to.type}`);
        else if (r.from === r.to) fail('INVALID_APPLICATION', 'to', `Profile "${r.from}" cannot apply itself`);
        else checked.push({ index: i, from: r.from, to: r.to, applied: true });
        break;
      case 'reference':
        if (from.type !== 'profile') fail('INVALID_REFERENCE', 'from', `A metaclass reference goes from a profile; "${r.from}" is a ${from.type}`);
        else if (to.type !== 'metaclass' && to.type !== 'package') fail('INVALID_REFERENCE', 'to', `A profile references a metaclass or a metamodel package; "${r.to}" is a ${to.type}`);
        else checked.push({ index: i, from: r.from, to: r.to });
        break;
    }
  });
  findCycles(generalizations, 'INHERITANCE_CYCLE', 'Generalization must be acyclic', diagnostics);
  // Applied stereotypes name stereotypes this diagram defines.
  const defined = model.elements.filter(e => e.type === 'stereotype').map(e => (e as { name: string }).name);
  if (defined.length) {
    model.elements.forEach((element, i) => {
      if (element.type !== 'class') return;
      (element.stereotypes ?? []).forEach((name, j) => {
        if (defined.includes(name)) return;
        const nearest = suggest(name, defined, 'id');
        diagnostics.push({ code: 'UNKNOWN_STEREOTYPE', path: pointer('', 'elements', i, 'stereotypes', j), message: `Applied stereotype "${name}" is not defined in this diagram${nearest ? `; did you mean "${nearest}"?` : ''} Defined stereotypes: ${defined.map(d => `"${d}"`).join(', ')}`, details: { defined, ...(nearest ? { suggestion: nearest } : {}) } });
      });
    });
  }
  const owner = checkOwnership(ownership, diagnostics);
  if (!diagnostics.some(d => d.code === 'CONTAINMENT_CYCLE')) {
    for (const { index, from, to, applied } of checked) {
      if (!nestedIn(from, to, owner)) continue;
      // UML 2.5.1 (12.3.3) lets a package apply a profile it owns, but the arrow from a package to a
      // member inside it cannot be drawn; say so instead of claiming the model is wrong.
      if (applied && owners(to, owner).includes(from)) {
        diagnostics.push({ code: 'RELATIONSHIP_WITH_OWN_MEMBER', path: pointer('', 'relationships', index), message: `Package "${from}" owns profile "${to}" and applies it: valid UML, but an «apply» arrow from a package to a profile inside it cannot be drawn. Remove "${to}" from the members of "${from}" so the profile is drawn beside the package` });
      } else diagnostics.push({ code: 'RELATIONSHIP_WITH_OWN_MEMBER', path: pointer('', 'relationships', index), message: `"${from}" and "${to}" are nested in one another; a package already sees its members` });
    }
  }
  return diagnostics;
}
