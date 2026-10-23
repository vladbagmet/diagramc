import { pointer, type Diagnostic } from '../../core/errors.js';
import { checkMultiplicity } from '../../model/rules.js';
import { checkDepth, checkNotes, Tree } from '../structure/tree.js';
import { isNodeType, type DeploymentDiagram, type Element, type Note } from './model.js';

/**
 * Semantic rules of deployment diagrams (UML 2.5.1 clause 19). Codes are
 * stable; docs/kinds/deployment.md lists them with their fixtures.
 */
export const MAX_DEPLOYMENT_DEPTH = 6;

export function validateDeploymentDiagram(model: DeploymentDiagram): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const relationships = model.relationships ?? [];
  const tree = new Tree();
  const notes: { note: Note; path: string }[] = [];
  const visit = (element: Element, path: string, parent: string | undefined): void => {
    tree.add({ id: element.id, path, type: element.type, parent, value: element as unknown as Record<string, unknown> });
    if (element.type === 'note') notes.push({ note: element, path });
    if (isNodeType(element.type) && 'elements' in element) {
      for (const [k, child] of (element.elements ?? []).entries()) {
        const at = pointer(path, 'elements', k);
        // An execution environment may host nodes (a hypervisor running virtual
        // machines) but not physical devices.
        if (element.type === 'executionEnvironment' && child.type === 'device') {
          diagnostics.push({
            code: 'INVALID_NESTING',
            path: pointer(at, 'type'),
            message:
              'An execution environment cannot contain a device (hardware); use a node for a virtual machine, or nest the execution environment in the device instead',
          });
        }
        visit(child, at, element.id);
      }
    }
  };
  for (const [i, e] of model.elements.entries()) visit(e, pointer('', 'elements', i), undefined);
  tree.checkIds(relationships, diagnostics);
  checkDepth(tree, MAX_DEPLOYMENT_DEPTH, diagnostics, []);
  checkNotes(notes, tree, diagnostics);

  for (const [i, r] of relationships.entries()) {
    const at = pointer('', 'relationships', i);
    if (r.type === 'communicationPath')
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
    if (r.from === r.to) {
      diagnostics.push({ code: 'SELF_CONNECTION', path: pointer(at, 'to'), message: `A ${r.type} must connect two different elements` });
      continue;
    }
    const nested = tree.inside(r.from, r.to) || tree.inside(r.to, r.from);
    switch (r.type) {
      case 'communicationPath':
        for (const [end, item] of [
          ['from', from],
          ['to', to],
        ] as const) {
          if (!isNodeType(item.type))
            diagnostics.push({
              code: 'INVALID_COMMUNICATION_PATH',
              path: pointer(at, end),
              message: `A communication path connects nodes, devices or execution environments, not the ${item.type} "${item.id}"`,
            });
        }
        if (isNodeType(from.type) && isNodeType(to.type) && nested)
          diagnostics.push({
            code: 'INVALID_COMMUNICATION_PATH',
            path: pointer(at, 'to'),
            message: `"${r.from}" and "${r.to}" are nested in one another; a communication path links separate nodes`,
          });
        break;
      case 'deploy':
        if (from.type !== 'artifact' && from.type !== 'deploymentSpecification')
          diagnostics.push({
            code: 'INVALID_DEPLOYMENT',
            path: pointer(at, 'from'),
            message: `Only artifacts and deployment specifications are deployed; "${r.from}" is a ${from.type}`,
          });
        if (!isNodeType(to.type))
          diagnostics.push({
            code: 'INVALID_DEPLOYMENT',
            path: pointer(at, 'to'),
            message: `The deployment target must be a node, device or execution environment, not the ${to.type} "${r.to}"`,
          });
        else if (tree.inside(r.from, r.to))
          diagnostics.push({
            code: 'INVALID_DEPLOYMENT',
            path: pointer(at, 'to'),
            message: `"${r.from}" is already drawn inside "${r.to}", which shows the deployment; remove the dependency or move the artifact out`,
          });
        break;
      case 'manifest':
        if (from.type !== 'artifact')
          diagnostics.push({
            code: 'INVALID_MANIFEST',
            path: pointer(at, 'from'),
            message: `Only an artifact manifests a component; "${r.from}" is a ${from.type}`,
          });
        if (to.type !== 'component')
          diagnostics.push({ code: 'INVALID_MANIFEST', path: pointer(at, 'to'), message: `An artifact manifests a component; "${r.to}" is a ${to.type}` });
        break;
      case 'dependency':
        if (nested)
          diagnostics.push({
            code: 'INVALID_DEPENDENCY',
            path: pointer(at, 'to'),
            message: `"${r.from}" and "${r.to}" are nested in one another; nesting already shows how they relate`,
          });
        break;
    }
  }
  return diagnostics;
}
