// Writes examples/state-machine/stress.json: a vending machine controller with
// 4 composite states (two with orthogonal regions), about 45 vertices and 60 transitions.
//   node scripts/generate-state-machine-stress.mjs > examples/state-machine/stress.json
const elements = [],
  transitions = [];
const t = (from, to, label = {}) => transitions.push({ from, to, ...label });
const state = (id, name, extra = {}) => ({ id, type: 'state', name, ...extra });
const chain = (prefix, names, triggers) =>
  names
    .map((n, i) => state(`${prefix}${i}`, n, i === 0 ? { entry: `enter ${n.toLowerCase()}` } : {}))
    .map((s, i, all) => {
      if (i > 0) t(all[i - 1].id, s.id, { trigger: triggers[i - 1] });
      return s;
    });

elements.push({ id: 'init', type: 'initial' }, state('boot', 'Booting', { doActivity: 'self test' }));
t('init', 'boot');
const phases = [
  {
    id: 'select',
    name: 'Selecting',
    regions: [
      ['Browse', 'Highlight', 'Confirm'],
      ['Idle display', 'Promo', 'Clock'],
    ],
  },
  {
    id: 'pay',
    name: 'Paying',
    regions: [
      ['Await coins', 'Count', 'Validate'],
      ['Card idle', 'Card read', 'Authorize'],
    ],
  },
  { id: 'vend', name: 'Vending', regions: [['Rotate', 'Drop', 'Detect']] },
  { id: 'change', name: 'Returning change', regions: [['Compute', 'Dispense', 'Verify']] },
];
let previous = 'boot';
for (const [k, p] of phases.entries()) {
  const regions = p.regions.map((names, j) => {
    const prefix = `${p.id}${j}s`;
    const init = { id: `${p.id}${j}i`, type: 'initial' };
    const states = chain(
      prefix,
      names,
      names.slice(1).map((_, i) => `step${k}${j}${i}`),
    );
    t(init.id, states[0].id);
    t(states.at(-1).id, states[0].id, { trigger: 'reset', guard: `retries < ${3 + j}` });
    return { name: `${p.name.toLowerCase()} ${j + 1}`, elements: [init, ...states, { id: `${p.id}${j}f`, type: 'final' }] };
  });
  for (const [j, r] of regions.entries()) t(r.elements.at(-2).id, `${p.id}${j}f`, { trigger: 'done' });
  elements.push(state(p.id, p.name, { exit: `log ${p.id}`, regions: regions.map(r => (p.regions.length === 1 ? { elements: r.elements } : r)) }));
  t(previous, p.id, { trigger: k === 0 ? 'ready' : 'completed' });
  previous = p.id;
}
elements.push(
  { id: 'fault', type: 'choice' },
  state('service', 'Service mode', { entry: 'lock door', internal: [{ trigger: 'diagnose', effect: 'runDiagnostics' }] }),
  state('outOfOrder', 'Out of order'),
  { id: 'off', type: 'final' },
);
t('change', 'boot', { trigger: 'completed', effect: 'resetTotals' });
t('pay', 'fault', { trigger: 'jam' });
t('vend', 'fault', { trigger: 'jam' });
t('fault', 'service', { guard: 'technician present' });
t('fault', 'outOfOrder', { guard: 'else', effect: 'alert operator' });
t('service', 'boot', { trigger: 'restart' });
t('outOfOrder', 'service', { trigger: 'keySwitch' });
t('outOfOrder', 'off', { trigger: 'powerOff' });
t('service', 'service', { trigger: 'tick', guard: 'timer running' });
process.stdout.write(JSON.stringify({ kind: 'state-machine', title: 'Vending machine controller', elements, transitions }, null, 2) + '\n');
