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

/** Visits every item of a sequence, fragments' operands included. */
const items = (list, visit) => { for (const item of list) { visit(item); if (item.type === 'fragment') for (const o of item.operands) items(o.items, visit); } };

const sequenceCommon = m => {
  for (const l of m.lifelines) if (l.symbol === 'rectangle') delete l.symbol;
  if (m.autonumber === false) delete m.autonumber;
  items(m.items, item => {
    delete item.id;
    if (item.activate === false) delete item.activate;
    if (item.deactivate === false) delete item.deactivate;
  });
  return m;
};

/** PlantUML spans the columns between two lifelines: a note or reference over more keeps the outermost two. */
const outermost = (m, list) => {
  const order = new Map(m.lifelines.map((l, i) => [l.id, i]));
  if (list.length <= 2) return list;
  const s = [...list].sort((a, b) => order.get(a) - order.get(b));
  return [s[0], s.at(-1)];
};

export const LOSSES = {
  plantuml: {
    class: classCommon,
    sequence: m => {
      sequenceCommon(m);
      items(m.items, item => {
        if (item.type === 'note' && item.position === 'over') item.lifelines = outermost(m, item.lifelines);
        if (item.type === 'ref') item.covered = outermost(m, item.covered);
      });
      return m;
    },
  },
  mermaid: {},
};
