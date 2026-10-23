/**
 * The documented losses of each format and kind (docs/formats.md, "Lossy
 * cases"), applied to an original model (IDs already renamed as the exporter
 * names them). A round trip must give exactly this model.
 */

/** Deletes `keys` from every object of `list` (relationship IDs and the like). */
const drop = (list, ...keys) => { for (const item of list ?? []) for (const k of keys) delete item[k]; };
/** Removes empty arrays under the given keys anywhere in the model (an empty list reads back as no list). */
function dropEmpty(node, keys) {
  if (Array.isArray(node)) { node.forEach(n => dropEmpty(n, keys)); return node; }
  if (!node || typeof node !== 'object') return node;
  for (const [k, v] of Object.entries(node)) {
    if (Array.isArray(v) && !v.length && keys.includes(k)) delete node[k];
    else dropEmpty(v, keys);
  }
  return node;
}

const classCommon = m => {
  drop(m.relationships, 'id');
  dropEmpty(m, ['parameters', 'stereotypes', 'attributes', 'operations', 'literals', 'attachedTo', 'relationships']);
  for (const e of m.elements) if (e.type === 'interface') delete e.abstract;
  return m;
};

export const LOSSES = {
  plantuml: {
    class: classCommon,
  },
  mermaid: {},
};
