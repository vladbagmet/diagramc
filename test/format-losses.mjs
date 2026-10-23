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

/** Visits every vertex of a state machine, nested regions included. */
const vertices = (elements, visit) => { for (const e of elements) { visit(e); for (const r of e.regions ?? []) vertices(r.elements, visit); } };

const stateCommon = m => {
  drop(m.transitions, 'id');
  vertices(m.elements, v => { for (const r of v.regions ?? []) { delete r.id; delete r.name; } });
  dropEmpty(m, ['internal', 'connectionPoints', 'attachedTo', 'transitions']);
  return m;
};

/** Attached notes are written once per target vertex. */
const attachedNotes = m => {
  const out = [];
  for (const e of m.elements) {
    if (e.type !== 'note' || !e.attachedTo?.length) { out.push(e); continue; }
    for (const target of e.attachedTo) out.push({ type: 'note', text: e.text, attachedTo: [target] });
  }
  m.elements = out;
  return m;
};

/** Region chain of every vertex and connection point ("state#index" keys, outermost first). */
function regionChains(m) {
  const chains = new Map();
  const index = (elements, chain) => {
    for (const e of elements) {
      if (e.type === 'note') continue;
      chains.set(e.id, chain);
      for (const p of e.connectionPoints ?? []) chains.set(p.id, [...chain, `${e.id}#0`]);
      (e.regions ?? []).forEach((r, j) => index(r.elements, [...chain, `${e.id}#${j}`]));
    }
  };
  index(m.elements, []);
  return chains;
}

/** PlantUML cannot draw a transition into or out of a second or later orthogonal region. */
const closedRegions = m => {
  const chains = regionChains(m);
  m.transitions = (m.transitions ?? []).filter(t => {
    const a = chains.get(t.from), b = chains.get(t.to);
    let common = 0;
    while (common < a.length && common < b.length && a[common] === b[common]) common++;
    return ![...a.slice(common), ...b.slice(common)].some(k => !k.endsWith('#0'));
  });
  if (!m.transitions.length) delete m.transitions;
  return m;
};

/**
 * Order that carries no meaning, applied to both sides before comparing: the
 * order of transitions (written per region) and of attached notes (written
 * beside their vertex, with fresh IDs).
 */
/**
 * An activity graph without its IDs, which PlantUML does not carry: each node
 * is named by what it is (type, name, swimlane name, note, state) refined three
 * times by the labels of its neighbours (Weisfeiler-Lehman), and the graph is
 * the sorted lists of node and flow labels. Equal results mean the same nodes,
 * names and flows, connected the same way.
 */
function activityGraph(m) {
  const lanes = new Map((m.partitions ?? []).map(p => [p.id, p.name]));
  let label = new Map(m.nodes.map(n => [n.id, JSON.stringify([n.type, n.name, lanes.get(n.partition), n.note, n.state])]));
  for (let round = 0; round < 3; round++) {
    label = new Map(m.nodes.map(n => [n.id, JSON.stringify([
      label.get(n.id),
      m.edges.filter(e => e.from === n.id).map(e => [e.guard, label.get(e.to)]).sort(),
      m.edges.filter(e => e.to === n.id).map(e => [e.guard, label.get(e.from)]).sort(),
    ])]));
  }
  return {
    title: m.title,
    partitions: (m.partitions ?? []).map(p => p.name),
    nodes: m.nodes.map(n => label.get(n.id)).sort(),
    edges: m.edges.map(e => JSON.stringify([label.get(e.from), label.get(e.to), e.guard, e.type])).sort(),
  };
}

export const CANONICAL = {
  activity: activityGraph,
  'state-machine': m => {
    if (m.transitions) m.transitions = [...m.transitions].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const attached = m.elements.filter(e => e.type === 'note' && e.attachedTo?.length).map(({ id, ...rest }) => rest);
    m.elements = [...m.elements.filter(e => !(e.type === 'note' && e.attachedTo?.length)), ...attached.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))];
    return m;
  },
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
    'state-machine': m => closedRegions(attachedNotes(stateCommon(m))),
    activity: m => {
      // Flows have no IDs, and their type is inferred (object flow when an end is an object node).
      const objects = new Set(m.nodes.filter(n => n.type === 'object').map(n => n.id));
      for (const e of m.edges) {
        delete e.id;
        if (e.type === (objects.has(e.from) || objects.has(e.to) ? 'object' : 'control')) delete e.type;
      }
      return m;
    },
    'use-case': m => {
      drop(m.relationships, 'id');
      dropEmpty(m, ['stereotypes', 'extensionPoints', 'attachedTo', 'relationships']);
      // Use cases of a subject are written inside it, right after the subject.
      const order = [];
      for (const e of m.elements) {
        if (e.type === 'useCase' && e.subject !== undefined) continue;
        order.push(e);
        if (e.type === 'subject') order.push(...m.elements.filter(u => u.type === 'useCase' && u.subject === e.id));
      }
      m.elements = order;
      return m;
    },
  },
  mermaid: {},
};
