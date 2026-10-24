// Generates examples/activity/stress.json: 6 stages of decision, fork and loop over 3 partitions.
import { writeFileSync } from 'node:fs';
const nodes = [],
  edges = [];
const lanes = ['intake', 'processing', 'delivery'];
const node = (id, type, extra = {}) => {
  nodes.push({ id, type, ...extra });
  return id;
};
const flow = (from, to, guard) => edges.push({ type: 'control', from, to, ...(guard ? { guard } : {}) });
let prev = node('start', 'initial', { partition: 'intake' });
const stages = ['Receive', 'Classify', 'Enrich', 'Assemble', 'Verify', 'Dispatch'];
for (const [s, stage] of stages.entries()) {
  const p = lanes[Math.floor(s / 2)];
  const a = node(`s${s}-task`, 'action', { name: `${stage} batch ${s + 1}`, partition: p });
  flow(prev, a);
  const d = node(`s${s}-check`, 'decision', { partition: p });
  flow(a, d);
  const x = node(`s${s}-quick`, 'action', { name: `Quick ${stage.toLowerCase()} path`, partition: p });
  const y1 = node(`s${s}-full`, 'action', { name: `Full ${stage.toLowerCase()} review`, partition: p });
  const y2 = node(`s${s}-sign`, 'action', { name: `Sign off ${stage.toLowerCase()}`, partition: p });
  const m = node(`s${s}-merge`, 'merge');
  flow(d, x, 'simple');
  flow(d, y1, 'complex');
  flow(y1, y2);
  flow(x, m);
  flow(y2, m);
  const f = node(`s${s}-fork`, 'fork', { partition: p });
  flow(m, f);
  const b1 = node(`s${s}-archive`, 'action', { name: `Archive ${stage.toLowerCase()} data`, partition: p });
  const b2 = node(`s${s}-report`, 'action', { name: `Report ${stage.toLowerCase()} metrics`, partition: p });
  const j = node(`s${s}-join`, 'join');
  flow(f, b1);
  flow(f, b2);
  flow(b1, j);
  flow(b2, j);
  prev = j;
  if (s % 2 === 1) {
    const lm = node(`s${s}-loop`, 'merge');
    const work = node(`s${s}-retry`, 'action', { name: `Retry ${stage.toLowerCase()} step`, partition: p });
    const ld = node(`s${s}-again`, 'decision', { partition: p });
    flow(prev, lm);
    flow(lm, work);
    flow(work, ld);
    flow(ld, lm, 'retry');
    const next = node(`s${s}-next`, 'action', { name: `Close ${stage.toLowerCase()}`, partition: p });
    flow(ld, next, 'ok');
    prev = next;
  }
}
flow(prev, node('end', 'activityFinal', { partition: 'delivery' }));
const doc = { kind: 'activity', title: 'Batch pipeline', partitions: lanes.map(id => ({ id, name: id[0].toUpperCase() + id.slice(1) })), nodes, edges };
writeFileSync(process.argv[2], JSON.stringify(doc, null, 2) + '\n');
console.log(nodes.length, 'nodes', edges.length, 'edges');
