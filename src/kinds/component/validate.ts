import { pointer, type Diagnostic } from '../../core/errors.js';
import { checkDepth, checkNotes, Tree } from '../structure/tree.js';
import type { ComponentDiagram, Element, Nested, Note, Port } from './model.js';

/**
 * Semantic rules of component diagrams (UML 2.5.1 clause 11.6 and 11.8). Codes
 * are stable; docs/kinds/component.md lists them with their fixtures.
 */
export const MAX_COMPONENT_DEPTH = 4;

interface Realizer { provides?: string[]; requires?: string[]; ports?: Port[] }

export function buildComponentTree(model: ComponentDiagram): { tree: Tree; notes: { note: Note; path: string }[] } {
  const tree = new Tree();
  const notes: { note: Note; path: string }[] = [];
  const visit = (element: Element | Nested, path: string, parent: string | undefined): void => {
    tree.add({ id: element.id, path, type: element.type, parent, value: element as unknown as Record<string, unknown> });
    if (element.type === 'note') notes.push({ note: element, path });
    if (element.type === 'component' || element.type === 'class') {
      for (const [k, port] of (element.ports ?? []).entries()) tree.add({ id: port.id, path: pointer(path, 'ports', k), type: 'port', parent: element.id, value: port as unknown as Record<string, unknown> });
    }
    if (element.type === 'component') for (const [k, child] of (element.elements ?? []).entries()) visit(child, pointer(path, 'elements', k), element.id);
  };
  for (const [i, e] of model.elements.entries()) visit(e, pointer('', 'elements', i), undefined);
  return { tree, notes };
}

/** Interfaces provided or required by an endpoint (a port, a component or a class). */
function interfaces(value: Record<string, unknown>, which: 'provides' | 'requires'): string[] {
  return (value[which] as string[] | undefined) ?? [];
}

export function validateComponentDiagram(model: ComponentDiagram): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const relationships = model.relationships ?? [];
  const { tree, notes } = buildComponentTree(model);
  tree.checkIds(relationships, diagnostics);
  checkDepth(tree, MAX_COMPONENT_DEPTH, diagnostics);
  checkNotes(notes, tree, diagnostics);

  // provides / requires name interfaces, each at most once per list.
  for (const item of tree.items.values()) {
    if (item.type !== 'component' && item.type !== 'class' && item.type !== 'port') continue;
    for (const which of ['provides', 'requires'] as const) {
      const seen = new Set<string>();
      for (const [j, id] of interfaces(item.value, which).entries()) {
        const at = pointer(item.path, which, j);
        if (seen.has(id)) diagnostics.push({ code: 'DUPLICATE_INTERFACE', path: at, message: `Interface "${id}" is listed twice in "${which}" of "${item.id}"` });
        seen.add(id);
        const target = tree.ref(id, at, diagnostics, 'interface');
        if (target && target.type !== 'interface') diagnostics.push({ code: 'NOT_AN_INTERFACE', path: at, message: `"${id}" is a ${target.type}, not an interface` });
      }
    }
  }

  const connectable = (type: string | undefined): boolean => type === 'component' || type === 'class' || type === 'port';
  for (const [i, r] of relationships.entries()) {
    const at = pointer('', 'relationships', i);
    const from = tree.ref(r.from, pointer(at, 'from'), diagnostics);
    const to = tree.ref(r.to, pointer(at, 'to'), diagnostics);
    if (!from || !to) continue;
    for (const [end, item] of [['from', from], ['to', to]] as const) {
      if (item.type === 'note') diagnostics.push({ code: 'NOTE_IN_RELATIONSHIP', path: pointer(at, end), message: 'Relationships cannot connect notes; use the note\'s "attachedTo" instead' });
    }
    if (from.type === 'note' || to.type === 'note') continue;
    const fromOwner = tree.owner(r.from), toOwner = tree.owner(r.to);
    switch (r.type) {
      case 'assembly': {
        let ok = true;
        for (const [end, item] of [['from', from], ['to', to]] as const) {
          if (!connectable(item.type)) { ok = false; diagnostics.push({ code: 'INVALID_CONNECTOR_END', path: pointer(at, end), message: `An assembly connects ports, components or classes, not the ${item.type} "${item.id}"` }); }
        }
        const iface = tree.ref(r.interface, pointer(at, 'interface'), diagnostics, 'interface');
        if (iface && iface.type !== 'interface') { diagnostics.push({ code: 'NOT_AN_INTERFACE', path: pointer(at, 'interface'), message: `"${r.interface}" is a ${iface.type}, not an interface` }); ok = false; }
        if (!ok || !iface) break;
        if (fromOwner === toOwner) { diagnostics.push({ code: 'SELF_CONNECTION', path: pointer(at, 'to'), message: `An assembly must connect two different elements; both ends belong to "${fromOwner}"` }); break; }
        if (tree.inside(fromOwner, toOwner) || tree.inside(toOwner, fromOwner)) {
          diagnostics.push({ code: 'INVALID_ASSEMBLY', path: pointer(at, 'to'), message: `"${fromOwner}" and "${toOwner}" are nested in one another; connect a container to its parts with a delegation` });
          break;
        }
        if (!interfaces(from.value, 'requires').includes(r.interface)) diagnostics.push({ code: 'ASSEMBLY_MISMATCH', path: pointer(at, 'from'), message: `"${r.from}" does not require interface "${r.interface}"; the requiring side of an assembly lists it in "requires"`, details: { requires: interfaces(from.value, 'requires') } });
        if (!interfaces(to.value, 'provides').includes(r.interface)) diagnostics.push({ code: 'ASSEMBLY_MISMATCH', path: pointer(at, 'to'), message: `"${r.to}" does not provide interface "${r.interface}"; the providing side of an assembly lists it in "provides"`, details: { provides: interfaces(to.value, 'provides') } });
        break;
      }
      case 'delegation': {
        let ok = true;
        for (const [end, item] of [['from', from], ['to', to]] as const) {
          if (!connectable(item.type)) { ok = false; diagnostics.push({ code: 'INVALID_CONNECTOR_END', path: pointer(at, end), message: `A delegation connects ports, components or classes, not the ${item.type} "${item.id}"` }); }
        }
        if (!ok) break;
        // The outer end is a port of the container; the inner end a direct part of it (or a port of one).
        const outward = tree.inside(fromOwner, toOwner);
        const inward = tree.inside(toOwner, fromOwner);
        if (!outward && !inward) {
          diagnostics.push({ code: 'DELEGATION_OUTSIDE_CONTAINER', path: pointer(at, 'to'), message: `A delegation links a component's port to a part inside that component; "${toOwner}" and "${fromOwner}" are not nested in one another` });
          break;
        }
        const [outerEnd, outer, innerEnd, innerOwner, containerId] = inward ? ['from', from, 'to', toOwner, fromOwner] as const : ['to', to, 'from', fromOwner, toOwner] as const;
        if (outer.type !== 'port') { diagnostics.push({ code: 'INVALID_DELEGATION', path: pointer(at, outerEnd), message: `The outer end of a delegation must be a port of "${containerId}"` }); break; }
        if (tree.get(innerOwner)?.parent !== containerId) {
          diagnostics.push({ code: 'DELEGATION_OUTSIDE_CONTAINER', path: pointer(at, innerEnd), message: `A delegation stays inside one containment level: "${innerOwner}" is not a direct part of "${containerId}"` });
          break;
        }
        const inner = inward ? to : from;
        const shared = (['provides', 'requires'] as const).some(which => interfaces(outer.value, which).some(id => interfaces(inner.value, which).includes(id)));
        const declared = (v: Record<string, unknown>) => interfaces(v, 'provides').length + interfaces(v, 'requires').length > 0;
        if (declared(outer.value) && declared(inner.value) && !shared) {
          diagnostics.push({ code: 'DELEGATION_INTERFACE_MISMATCH', path: pointer(at, innerEnd), message: `"${inner.id}" and "${outer.id}" have no provided or required interface in common` });
        }
        break;
      }
      case 'realization': case 'usage':
        if (from.type !== 'component' && from.type !== 'class') diagnostics.push({ code: r.type === 'usage' ? 'INVALID_USAGE' : 'INVALID_REALIZATION', path: pointer(at, 'from'), message: `The source of a ${r.type} must be a component or class, not the ${from.type} "${r.from}"` });
        if (to.type !== 'interface') diagnostics.push({ code: r.type === 'usage' ? 'INVALID_USAGE' : 'INVALID_REALIZATION', path: pointer(at, 'to'), message: `The target of a ${r.type} must be an interface, not the ${to.type} "${r.to}"` });
        break;
      case 'manifest':
        if (from.type !== 'artifact') diagnostics.push({ code: 'INVALID_MANIFEST', path: pointer(at, 'from'), message: `Only an artifact manifests a component; "${r.from}" is a ${from.type}` });
        if (to.type !== 'component') diagnostics.push({ code: 'INVALID_MANIFEST', path: pointer(at, 'to'), message: `An artifact manifests a component; "${r.to}" is a ${to.type}` });
        break;
      case 'dependency':
        if (fromOwner === toOwner) diagnostics.push({ code: 'SELF_CONNECTION', path: pointer(at, 'to'), message: 'A dependency must connect two different elements (not an element and its own port)' });
        break;
    }
  }
  return diagnostics;
}
