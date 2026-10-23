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
 * Mermaid state diagrams: one `[*]` initial and final per region (terminate
 * becomes a final), junction becomes choice, history a state named H or H*,
 * connection points states at the start of their composite's first region; a
 * transition across a region border is left out, and so are floating notes and
 * notes on `[*]`.
 */
function mermaidState(m) {
  const pseudo = new Map();
  const visit = (elements, key) => elements.map(e => {
    if (e.type === 'note') return e;
    if (e.type === 'junction') return { ...e, type: 'choice' };
    if (e.type === 'deepHistory' || e.type === 'shallowHistory') return { id: e.id, type: 'state', name: e.type === 'deepHistory' ? 'H*' : 'H' };
    if (['initial', 'final', 'terminate'].includes(e.type)) { pseudo.set(e.id, { type: e.type === 'initial' ? 'initial' : 'final', key }); return e; }
    if (e.type !== 'state') return e;
    const s = { ...e };
    const points = (s.connectionPoints ?? []).map(p => ({ id: p.id, type: 'state', name: p.name ?? p.id }));
    delete s.connectionPoints;
    if (s.regions || points.length) {
      const regions = (s.regions ?? [{ elements: [] }]).map((r, j) => ({ ...r, elements: visit(r.elements, `${e.id}#${j}`) }));
      regions[0] = { ...regions[0], elements: [...points, ...regions[0].elements] };
      s.regions = regions;
    }
    return s;
  });
  m.elements = visit(m.elements, '');
  const chains = regionChains(m);
  const regionOf = id => chains.get(id).at(-1) ?? '';
  // Each region's [*] pseudostates collapse into one initial and one final.
  const star = new Map();
  for (const [id, { type, key }] of pseudo) { const k = `${type}@${key}`; if (!star.has(k)) star.set(k, id); }
  const canonicalId = id => { const p = pseudo.get(id); return p ? star.get(`${p.type}@${p.key}`) : id; };
  const strip = elements => elements.filter(e => !(pseudo.has(e.id) && canonicalId(e.id) !== e.id)).map(e => {
    const out = pseudo.has(e.id) ? { id: e.id, type: pseudo.get(e.id).type } : e;
    return out.regions ? { ...out, regions: out.regions.map(r => ({ ...r, elements: strip(r.elements) })) } : out;
  });
  m.transitions = (m.transitions ?? []).filter(t => regionOf(t.from) === regionOf(t.to)).map(t => ({ ...t, from: canonicalId(t.from), to: canonicalId(t.to) }));
  if (!m.transitions.length) delete m.transitions;
  m.elements = strip(m.elements);
  m.elements = attachedNotes({ elements: m.elements.filter(e => e.type !== 'note' || e.attachedTo?.length) }).elements
    .map(e => (e.type === 'note' ? { ...e, attachedTo: e.attachedTo.filter(t => !pseudo.has(t)) } : e))
    .filter(e => e.type !== 'note' || e.attachedTo.length);
  return m;
}

/** Initial and final pseudostates named by their region, every element list sorted by ID: order and `[*]` IDs carry no meaning. */
function mermaidStateCanonical(m) {
  m = CANONICAL['state-machine'](m);
  const rename = new Map();
  const visit = (elements, key) => {
    for (const e of elements) {
      if (e.type === 'initial' || e.type === 'final') rename.set(e.id, `${e.type}@${key}`);
      (e.regions ?? []).forEach((r, j) => visit(r.elements, `${e.id}#${j}`));
    }
  };
  visit(m.elements, '');
  const fix = elements => elements.map(e => {
    const out = rename.has(e.id) ? { ...e, id: rename.get(e.id) } : e;
    return out.regions ? { ...out, regions: out.regions.map(r => ({ ...r, elements: fix(r.elements) })) } : out;
  }).sort((a, b) => String(a.id ?? JSON.stringify(a)).localeCompare(String(b.id ?? JSON.stringify(b))));
  m.elements = fix(m.elements);
  if (m.transitions) m.transitions = m.transitions.map(t => ({ ...t, from: rename.get(t.from) ?? t.from, to: rename.get(t.to) ?? t.to })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return m;
}

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

/** Note IDs are not kept: compare notes without them. */
const withoutNoteIds = m => ({ ...m, elements: m.elements.map(e => (e.type === 'note' ? (({ id, ...rest }) => rest)(e) : e)) });

export const CANONICAL = {
  'mermaid class': withoutNoteIds,
  'mermaid state-machine': m => mermaidStateCanonical(m),
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
  mermaid: {
    sequence: m => {
      sequenceCommon(m);
      // No boundary, control or entity symbols; created lifelines are declared at their create message.
      for (const l of m.lifelines) if (['boundary', 'control', 'entity'].includes(l.symbol)) delete l.symbol;
      const created = [];
      items(m.items, i => { if (i.type === 'message' && i.sort === 'create' && !created.includes(i.to)) created.push(i.to); });
      m.lifelines = [...m.lifelines.filter(l => !created.includes(l.id)), ...created.map(id => m.lifelines.find(l => l.id === id))];
      const call = (name, args) => `${name}${args === undefined ? '' : `(${args.join(', ')})`}`;
      const separated = new Set(['alt', 'par', 'critical']);
      const rewrite = list => list.flatMap(item => {
        switch (item.type) {
          case 'destroy': return [];
          case 'found': case 'lost': {
            const text = `${item.type}: ${item.name === undefined ? '' : call(item.name, item.arguments)}`.trimEnd();
            return [{ type: 'note', position: item.type === 'found' ? 'left' : 'right', lifelines: [item.type === 'found' ? item.to : item.from], text }];
          }
          case 'stateInvariant': return [{ type: 'note', position: 'over', lifelines: [item.lifeline], text: `{${item.constraint}}` }];
          case 'note': return [item.position === 'over' ? { ...item, lifelines: outermost(m, item.lifelines) } : item];
          case 'ref': return [{ type: 'note', position: 'over', lifelines: outermost(m, item.covered), text: `ref ${call(item.name, item.arguments)}` }];
          case 'message': {
            if (!(item.activate && item.deactivate)) return [item];
            const { deactivate, ...rest } = item;
            return [rest, { type: 'deactivate', lifeline: item.from }];
          }
          case 'fragment': {
            if (!['alt', 'opt', 'loop', 'par', 'break', 'critical'].includes(item.operator)) return item.operands.flatMap(o => rewrite(o.items));
            if (item.operands.length > 1 && !separated.has(item.operator)) {
              const [first] = item.operands;
              return [{ ...item, operands: [{ ...first, items: rewrite(item.operands.flatMap(o => o.items)) }] }];
            }
            return [{ ...item, operands: item.operands.map(o => ({ ...o, items: rewrite(o.items) })) }];
          }
          default: return [item];
        }
      });
      m.items = rewrite(m.items);
      return m;
    },
    'state-machine': m => mermaidState(stateCommon(m)),
    class: m => {
      classCommon(m);
      for (const r of m.relationships ?? []) {
        // No containment line and no cross for a non-navigable end.
        if (r.type === 'containment') r.type = 'association';
        for (const end of [r.fromEnd, r.toEnd]) if (end?.navigable === false) delete end.navigable;
        if (r.fromEnd && !Object.keys(r.fromEnd).length) delete r.fromEnd;
        if (r.toEnd && !Object.keys(r.toEnd).length) delete r.toEnd;
      }
      // Notes are written after the classifiers, once per target, with new IDs.
      return attachedNotes({ ...m, elements: [...m.elements.filter(e => e.type !== 'note'), ...m.elements.filter(e => e.type === 'note').map(({ id, ...rest }) => rest)] });
    },
  },
};

/**
 * Examples whose round trip cannot give a valid model because the format has no
 * way to write one of their relationships (docs/formats.md, "Lossy cases"): the
 * export must warn about it at `path`, and the import must then fail validation
 * with `code` rather than produce a different, wrong model.
 */
export const LIMITS = {
  'plantuml state-machine/notation.json': { path: '/transitions/7', code: 'FORK_DEGREE', why: 'a fork into the second orthogonal region of a composite state' },
  'mermaid state-machine/notation.json': { path: '/transitions/6', code: 'FORK_DEGREE', why: 'transitions across the border of a composite state' },
};
