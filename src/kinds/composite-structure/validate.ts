import { pointer, type Diagnostic } from '../../core/errors.js';
import { checkMultiplicity } from '../../model/rules.js';
import { checkDepth, checkNotes, Tree } from '../structure/tree.js';
import type { CompositeStructureDiagram, Note, Part, Port } from './model.js';

/**
 * Semantic rules of composite structure diagrams (UML 2.5.1 clause 11). Codes
 * are stable; docs/kinds/composite-structure.md lists them with their fixtures.
 */
export const MAX_PART_DEPTH = 4;

export function buildCompositeTree(
  model: CompositeStructureDiagram,
  diagnostics: Diagnostic[],
): { tree: Tree; notes: { note: Note; path: string }[]; context: Map<string, string> } {
  const tree = new Tree();
  const notes: { note: Note; path: string }[] = [];
  /** Top-level element (structured class or collaboration) each feature belongs to. */
  const context = new Map<string, string>();
  const port = (p: Port, path: string, owner: string, top: string): void => {
    tree.add({ id: p.id, path, type: 'port', parent: owner, value: p as unknown as Record<string, unknown> });
    context.set(p.id, top);
    checkMultiplicity(p.multiplicity, pointer(path, 'multiplicity'), diagnostics);
    if (p.conjugated && p.type === undefined)
      diagnostics.push({
        code: 'CONJUGATED_WITHOUT_TYPE',
        path: pointer(path, 'conjugated'),
        message: `Port "${p.id}" is conjugated but has no type; a conjugated port is drawn "~Type"`,
      });
  };
  const part = (p: Part, path: string, parent: string, top: string): void => {
    tree.add({ id: p.id, path, type: 'part', parent, value: p as unknown as Record<string, unknown> });
    context.set(p.id, top);
    checkMultiplicity(p.multiplicity, pointer(path, 'multiplicity'), diagnostics);
    for (const [k, q] of (p.ports ?? []).entries()) port(q, pointer(path, 'ports', k), p.id, top);
    for (const [k, q] of (p.parts ?? []).entries()) part(q, pointer(path, 'parts', k), p.id, top);
  };
  for (const [i, e] of model.elements.entries()) {
    const path = pointer('', 'elements', i);
    tree.add({ id: e.id, path, type: e.type, parent: undefined, value: e as unknown as Record<string, unknown> });
    context.set(e.id, e.id);
    if (e.type === 'note') notes.push({ note: e, path });
    else if (e.type === 'class') {
      for (const [k, q] of (e.ports ?? []).entries()) port(q, pointer(path, 'ports', k), e.id, e.id);
      for (const [k, q] of (e.parts ?? []).entries()) part(q, pointer(path, 'parts', k), e.id, e.id);
      for (const [k, u] of (e.collaborationUses ?? []).entries()) {
        tree.add({
          id: u.id,
          path: pointer(path, 'collaborationUses', k),
          type: 'collaborationUse',
          parent: e.id,
          value: u as unknown as Record<string, unknown>,
        });
        context.set(u.id, e.id);
      }
    } else
      for (const [k, r] of e.roles.entries()) {
        const at = pointer(path, 'roles', k);
        tree.add({ id: r.id, path: at, type: 'role', parent: e.id, value: r as unknown as Record<string, unknown> });
        context.set(r.id, e.id);
        checkMultiplicity(r.multiplicity, pointer(at, 'multiplicity'), diagnostics);
      }
  }
  return { tree, notes, context };
}

export function validateCompositeStructureDiagram(model: CompositeStructureDiagram): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const relationships = model.relationships ?? [];
  const { tree, notes, context } = buildCompositeTree(model, diagnostics);
  tree.checkIds(relationships, diagnostics);
  checkDepth(tree, MAX_PART_DEPTH, diagnostics);
  checkNotes(notes, tree, diagnostics);

  // Collaboration uses: the collaboration exists, each binding names one of its roles and a part of this class.
  for (const [i, e] of model.elements.entries()) {
    if (e.type !== 'class') continue;
    for (const [k, u] of (e.collaborationUses ?? []).entries()) {
      const at = pointer('', 'elements', i, 'collaborationUses', k);
      const collaboration = tree.ref(u.collaboration, pointer(at, 'collaboration'), diagnostics, 'collaboration');
      if (collaboration && collaboration.type !== 'collaboration')
        diagnostics.push({
          code: 'NOT_A_COLLABORATION',
          path: pointer(at, 'collaboration'),
          message: `"${u.collaboration}" is a ${collaboration.type}, not a collaboration`,
        });
      const bound = new Set<string>();
      for (const [j, b] of (u.bindings ?? []).entries()) {
        const bp = pointer(at, 'bindings', j);
        const role = tree.ref(b.role, pointer(bp, 'role'), diagnostics, 'role');
        if (role && (role.type !== 'role' || role.parent !== u.collaboration))
          diagnostics.push({
            code: 'INVALID_ROLE_BINDING',
            path: pointer(bp, 'role'),
            message: `"${b.role}" is not a role of collaboration "${u.collaboration}"`,
          });
        else if (role && bound.has(b.role))
          diagnostics.push({
            code: 'DUPLICATE_BINDING',
            path: pointer(bp, 'role'),
            message: `Role "${b.role}" is already bound in collaboration use "${u.id}"`,
          });
        bound.add(b.role);
        const target = tree.ref(b.part, pointer(bp, 'part'), diagnostics, 'part');
        if (target && (target.type !== 'part' || context.get(b.part) !== e.id))
          diagnostics.push({
            code: 'INVALID_ROLE_BINDING',
            path: pointer(bp, 'part'),
            message: `"${b.part}" is not a part of "${e.id}"; a collaboration use binds roles to parts of its own classifier`,
          });
      }
    }
  }

  for (const [i, r] of relationships.entries()) {
    const at = pointer('', 'relationships', i);
    if (r.type === 'connector')
      for (const end of ['fromEnd', 'toEnd'] as const) checkMultiplicity(r[end]?.multiplicity, pointer(at, end, 'multiplicity'), diagnostics);
    const from = tree.ref(r.from, pointer(at, 'from'), diagnostics);
    const to = tree.ref(r.to, pointer(at, 'to'), diagnostics);
    if (!from || !to) continue;
    for (const [end, item] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (item.type === 'note')
        diagnostics.push({
          code: 'NOTE_IN_RELATIONSHIP',
          path: pointer(at, end),
          message: 'Relationships cannot connect notes; use the note\'s "attachedTo" instead',
        });
    }
    if (from.type === 'note' || to.type === 'note') continue;
    if (r.type === 'dependency') {
      for (const [end, item] of [
        ['from', from],
        ['to', to],
      ] as const) {
        if (item.type !== 'class' && item.type !== 'collaboration')
          diagnostics.push({
            code: 'INVALID_DEPENDENCY',
            path: pointer(at, end),
            message: `Dependencies connect structured classes and collaborations, not the ${item.type} "${item.id}"`,
          });
      }
      if (r.from === r.to) diagnostics.push({ code: 'SELF_CONNECTION', path: pointer(at, 'to'), message: 'A dependency must connect two different elements' });
      continue;
    }
    let ok = true;
    for (const [end, item] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (item.type !== 'part' && item.type !== 'port' && item.type !== 'role') {
        ok = false;
        diagnostics.push({
          code: 'INVALID_CONNECTOR_END',
          path: pointer(at, end),
          message: `A connector connects parts, ports or roles, not the ${item.type} "${item.id}"`,
        });
      }
    }
    if (!ok) continue;
    if (context.get(r.from) !== context.get(r.to)) {
      diagnostics.push({
        code: 'CONNECTOR_CONTEXT',
        path: pointer(at, 'to'),
        message: `A connector stays inside one structured class or collaboration; "${r.from}" is in "${context.get(r.from)}", "${r.to}" in "${context.get(r.to)}"`,
      });
      continue;
    }
    const fromOwner = tree.owner(r.from),
      toOwner = tree.owner(r.to);
    if (fromOwner === toOwner) {
      diagnostics.push({
        code: 'SELF_CONNECTION',
        path: pointer(at, 'to'),
        message: `A connector must connect two different parts; both ends belong to "${fromOwner}"`,
      });
      continue;
    }
    // Into a part's own internal structure only through one of its ports.
    for (const [outerEnd, outer, innerOwner, outerOwner] of [
      ['from', from, toOwner, fromOwner],
      ['to', to, fromOwner, toOwner],
    ] as const) {
      if (tree.inside(innerOwner, outerOwner) && outer.type !== 'port') {
        diagnostics.push({
          code: 'INVALID_CONNECTOR_END',
          path: pointer(at, outerEnd),
          message: `"${outer.id}" contains the other end; connect to its internal structure through one of its ports`,
        });
      }
    }
  }
  return diagnostics;
}
