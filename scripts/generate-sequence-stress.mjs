// Writes examples/sequence/stress.json: 8 lifelines, 41 messages, fragments nested
// three deep, activations, a created and destroyed lifeline, notes and a ref.
// Deterministic. Usage: node scripts/generate-sequence-stress.mjs
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const lifelines = [
  { id: 'client', name: 'client', symbol: 'actor' },
  { id: 'gateway', name: 'gw', classifier: 'ApiGateway', symbol: 'boundary' },
  { id: 'orders', name: 'orders', classifier: 'OrderService', symbol: 'control' },
  { id: 'job', name: 'job', classifier: 'FulfilmentJob' },
  { id: 'inventory', name: 'inventory', classifier: 'InventoryService' },
  { id: 'payments', name: 'payments', classifier: 'PaymentService' },
  { id: 'ledger', classifier: 'Ledger', symbol: 'entity' },
  { id: 'notifier', name: 'notifier', classifier: 'Notifier' },
];
const call = (from, to, name, args, extra = {}) => ({ type: 'message', sort: 'synchronous', from, to, name, ...(args ? { arguments: args } : {}), ...extra });
const send = (from, to, name, args) => ({ type: 'message', sort: 'asynchronous', from, to, name, ...(args ? { arguments: args } : {}) });
const reply = (from, to, name, value, extra = {}) => ({ type: 'message', sort: 'reply', from, to, name, ...(value ? { returnValue: value } : {}), deactivate: true, ...extra });
const frag = (operator, operands, extra = {}) => ({ type: 'fragment', operator, ...extra, operands });

const reserveLines = [];
for (let i = 1; i <= 3; i++) {
  reserveLines.push(
    call('job', 'inventory', 'reserve', [`line${i}`], { activate: true }),
    reply('inventory', 'job', 'reserve', i === 3 ? 'partial' : 'ok'),
  );
}

const items = [
  call('client', 'gateway', 'submitOrder', ['request'], { activate: true }),
  call('gateway', 'gateway', 'authenticate', ['token'], { activate: true }),
  { type: 'deactivate', lifeline: 'gateway' },
  call('gateway', 'orders', 'createOrder', ['request'], { activate: true }),
  { type: 'ref', covered: ['orders', 'inventory'], name: 'ValidateOrder', arguments: ['request'] },
  { type: 'message', sort: 'create', from: 'orders', to: 'job', name: 'FulfilmentJob', arguments: ['orderId'] },
  { type: 'stateInvariant', lifeline: 'job', constraint: 'state = PENDING' },
  send('orders', 'job', 'start'),
  { type: 'activate', lifeline: 'job' },
  frag('loop', [{ guard: 'for each order line', items: [
    frag('alt', [
      { guard: 'line in stock', items: reserveLines.slice(0, 4) },
      { guard: 'backorder allowed', items: [
        reserveLines[4], reserveLines[5],
        send('job', 'notifier', 'backordered', ['line3']),
      ] },
      { guard: 'else', items: [
        send('job', 'orders', 'lineRejected', ['line3']),
        frag('break', [{ guard: 'order cannot be filled', items: [
          send('orders', 'notifier', 'orderRejected', ['orderId']),
          { type: 'lost', sort: 'asynchronous', from: 'notifier', name: 'pageOnCall', arguments: ['orderId'] },
        ] }]),
      ] },
    ]),
  ] }], { min: 1, max: '*' }),
  call('job', 'payments', 'authorize', ['total'], { activate: true }),
  frag('critical', [{ items: [
    call('payments', 'ledger', 'debit', ['account', 'total'], { activate: true }),
    reply('ledger', 'payments', 'debit', 'entryId'),
    call('payments', 'ledger', 'credit', ['merchant', 'total'], { activate: true }),
    reply('ledger', 'payments', 'credit', 'entryId'),
  ] }]),
  reply('payments', 'job', 'authorize', 'authCode', { assignment: 'auth' }),
  frag('opt', [{ guard: 'auth.requiresReview', items: [
    send('job', 'notifier', 'reviewNeeded', ['orderId']),
    { type: 'note', position: 'right', lifelines: ['notifier'], text: 'Reviews are handled by the risk team within one business day.' },
  ] }]),
  frag('par', [
    { items: [send('job', 'notifier', 'emailCustomer', ['orderId']), send('notifier', 'client', 'orderConfirmed', ['orderId'])] },
    { items: [send('job', 'ledger', 'recordShipment', ['orderId'])] },
    { items: [call('job', 'inventory', 'commit', ['orderId'], { activate: true }), reply('inventory', 'job', 'commit')] },
  ]),
  frag('neg', [{ items: [call('client', 'ledger', 'readEntries')] }]),
  { type: 'deactivate', lifeline: 'job' },
  send('job', 'orders', 'fulfilled', ['orderId']),
  { type: 'message', sort: 'delete', from: 'orders', to: 'job', name: 'dispose' },
  call('orders', 'ledger', 'summary', ['orderId'], { activate: true }),
  reply('ledger', 'orders', 'summary', 'Summary'),
  send('orders', 'notifier', 'orderCompleted', ['orderId']),
  frag('loop', [{ guard: 'until delivered', items: [
    send('notifier', 'client', 'trackingUpdate', ['status']),
    call('notifier', 'notifier', 'scheduleNext', ['interval']),
  ] }], { min: 0, max: 5 }),
  reply('orders', 'gateway', 'createOrder', 'orderId'),
  call('gateway', 'gateway', 'logRequest', ['orderId']),
  frag('alt', [
    { guard: 'client accepts JSON', items: [{ type: 'message', sort: 'reply', from: 'gateway', to: 'client', assignment: 'response', name: 'submitOrder', returnValue: '201 Created' }] },
    { guard: 'else', items: [{ type: 'message', sort: 'reply', from: 'gateway', to: 'client', name: 'submitOrder', returnValue: '406 Not Acceptable' }] },
  ]),
  // The gateway's activation spans both alternatives, so it ends after the fragment.
  { type: 'deactivate', lifeline: 'gateway' },
  { type: 'found', sort: 'asynchronous', to: 'notifier', name: 'retryTick' },
  send('notifier', 'client', 'reminder', ['orderId']),
  { type: 'note', position: 'over', lifelines: ['client', 'gateway'], text: 'Replies are dashed with open arrowheads; asynchronous messages are solid with open arrowheads.' },
];

const doc = { kind: 'sequence', title: 'Order fulfilment', autonumber: true, lifelines, items };
const count = list => list.reduce((n, i) => n + (['message', 'found', 'lost'].includes(i.type) ? 1 : 0) + (i.type === 'fragment' ? i.operands.reduce((m, o) => m + count(o.items), 0) : 0), 0);
console.log(`messages: ${count(items)}`);
await writeFile(fileURLToPath(new URL('../examples/sequence/stress.json', import.meta.url)), `${JSON.stringify(doc, null, 1)}\n`);
