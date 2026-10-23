// Generates examples/interaction-overview/stress.json: a long onboarding flow
// with decisions, merges, a fork/join, loops, inline interactions and both final
// node kinds (about 40 nodes and 50 flows).
// Usage: node scripts/generate-interaction-overview-stress.mjs
import { writeFile } from 'node:fs/promises';

const nodes = [{ id: 'start', type: 'initial' }];
const flows = [];
const flow = (from, to, guard) => flows.push(guard === undefined ? { from, to } : { from, to, guard });
const use = (id, name, args) => nodes.push(args ? { id, type: 'interaction-use', name, arguments: args } : { id, type: 'interaction-use', name });
const inline = (id, name, lifelines, messages) => nodes.push({ id, type: 'interaction', name, lifelines, messages });
const node = (id, type) => nodes.push({ id, type });

let previous = 'start';
const stages = ['Register', 'VerifyEmail', 'CollectProfile', 'CheckIdentity', 'ChoosePlan', 'TakePayment', 'ProvisionAccount', 'Welcome'];
for (const [i, stage] of stages.entries()) {
  const id = stage.toLowerCase();
  const retry = `${id}-retry`;
  node(retry, 'merge');
  flow(previous, retry);
  if (i % 3 === 1) {
    const a = `${id}-a`,
      b = `${id}-b`;
    inline(
      id,
      stage,
      [
        { id: a, type: 'Client' },
        { id: b, type: `${stage}Service` },
      ],
      [
        { from: a, to: b, name: 'request', arguments: ['data'] },
        { from: b, to: b, name: 'validate' },
        { from: b, to: a, name: 'result', sort: 'reply' },
      ],
    );
  } else use(id, stage, i % 2 ? ['user'] : undefined);
  flow(retry, id);
  const check = `${id}-ok`;
  node(check, 'decision');
  flow(id, check);
  const again = `${id}-again`;
  use(again, `Explain${stage}Error`);
  flow(check, again, 'invalid');
  flow(again, retry);
  if (i === 3) {
    const reject = `${id}-reject`;
    use(reject, 'RejectApplicant');
    flow(check, reject, 'fraud suspected');
    const abandon = `${id}-stop`;
    node(abandon, 'flow-final');
    flow(reject, abandon);
  }
  if (i === 5) {
    const fork = 'parallel',
      join = 'parallel-done';
    node(fork, 'fork');
    flow(check, fork, 'valid');
    const branches = [
      ['invoice', 'SendInvoice'],
      ['crm', 'UpdateCrm'],
      ['ledger', 'PostToLedger'],
    ];
    for (const [bid, name] of branches) {
      use(bid, name);
      flow(fork, bid);
    }
    node(join, 'join');
    for (const [bid] of branches) flow(bid, join);
    previous = join;
    continue;
  }
  const next = `${id}-next`;
  node(next, 'merge');
  flow(check, next, 'valid');
  const skip = `${id}-skip`;
  use(skip, `Skip${stage}`);
  flow(check, skip, 'skipped');
  flow(skip, next);
  previous = next;
}
node('end', 'final');
flow(previous, 'end');
const document = { kind: 'interaction-overview', title: 'Onboarding (stress)', lifelines: [':Client', ':Backend'], nodes, flows };
await writeFile(new URL('../examples/interaction-overview/stress.json', import.meta.url), JSON.stringify(document, null, 2) + '\n');
console.log(`${nodes.length} nodes, ${flows.length} flows`);
