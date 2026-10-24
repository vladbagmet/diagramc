// Writes examples/timing/stress.json: 8 lifelines (robust and concise), about
// 100 state changes, 20 messages, duration and time constraints, a highlight and
// notes. Deterministic. Usage: node scripts/generate-timing-stress.mjs
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const END = 400;
const specs = [
  ['cpu', 'cpu', 'Processor', 'robust', ['Busy', 'Idle', 'Sleep']],
  ['bus', 'bus', 'MemoryBus', 'robust', ['Write', 'Read', 'Free']],
  ['dma', 'dma', 'DmaEngine', 'robust', ['Transfer', 'Ready']],
  ['irq', 'irq', 'InterruptLine', 'robust', ['Asserted', 'Clear']],
  ['uart', 'uart', 'Uart', 'concise', ['IDLE', 'START', 'DATA', 'STOP']],
  ['fifo', 'fifo', 'RxFifo', 'concise', ['EMPTY', 'PARTIAL', 'FULL']],
  ['driver', 'driver', 'UartDriver', 'concise', ['WAIT', 'COPY', 'NOTIFY']],
  ['app', 'app', 'Application', 'concise', ['RUN', 'HANDLE']],
];
// A fixed pseudo-random sequence keeps the example deterministic.
let seed = 11;
const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;

// 20 messages, each from one lifeline to the next one down, in its own time slot.
const messages = [];
for (let k = 0; k < 20; k++) {
  const from = specs[k % 7][0],
    to = specs[(k % 7) + 1][0];
  const fromTime = 12 + k * 19;
  messages.push({ from, fromTime, to, toTime: fromTime + 6, name: `m${k + 1}`, ...(k % 3 === 0 ? { arguments: [`b${k}`] } : {}) });
}
// Every message is sent and received at a state change; more changes fill the gaps.
const lifelines = specs.map(([id, name, classifier, notation, states]) => {
  const times = new Set([0]);
  for (const m of messages) {
    if (m.from === id) times.add(m.fromTime);
    if (m.to === id) times.add(m.toTime);
  }
  const step = notation === 'robust' ? 30 : 45;
  for (let t = 20 + Math.floor(next() * step); t < END; t += step + Math.floor(next() * step)) {
    if ([...times].every(u => !(Math.abs(u - t) < 10))) times.add(t);
  }
  const changes = [];
  for (const at of [...times].sort((a, b) => a - b)) {
    const options = states.filter(s => s !== changes.at(-1)?.state);
    changes.push({ at, state: options[Math.floor(next() * options.length)] });
  }
  return { id, name, classifier, notation, states, changes };
});

const timesOf = id => lifelines.find(l => l.id === id).changes.map(c => c.at);
const durationConstraints = [
  ['cpu', 1, 3, '20', '90'],
  ['dma', 2, 4, '10', '60'],
  ['irq', 5, 7, 'd', '3*d'],
].map(([lifeline, a, b, min, max]) => ({ lifeline, from: timesOf(lifeline)[a], to: timesOf(lifeline)[b], min, max }));
const irqChange = timesOf('irq')[3];
const doc = {
  kind: 'timing',
  title: 'UART receive path',
  timeUnit: 'µs',
  lifelines,
  messages,
  durationConstraints,
  timeConstraints: [{ lifeline: 'irq', at: irqChange, from: irqChange - 8, to: irqChange + 8 }],
  highlights: [{ from: 300, to: 340, label: 'low-power window' }],
  notes: [
    { lifeline: 'uart', at: timesOf('uart')[1], text: 'Start bit detected' },
    { lifeline: 'app', at: timesOf('app')[2], position: 'bottom', text: 'Handler runs at task level' },
  ],
};
console.log(`changes: ${lifelines.reduce((n, l) => n + l.changes.length, 0)}, messages: ${messages.length}`);
await writeFile(fileURLToPath(new URL('../examples/timing/stress.json', import.meta.url)), `${JSON.stringify(doc, null, 1)}\n`);
