// Generates examples/communication/stress.json: 24 lifelines, a call tree plus
// cross links, and numbered calls, replies and signals that obey the nesting
// rules (a nested message is sent by the receiver of its parent).
// Usage: node scripts/generate-communication-stress.mjs
import { writeFile } from 'node:fs/promises';

const names = [
  ['api', 'ApiGateway'],
  ['auth', 'AuthService'],
  ['orders', 'OrderService'],
  ['catalog', 'CatalogService'],
  ['tokens', 'TokenStore'],
  ['users', 'UserRepository'],
  ['carts', 'CartService'],
  ['pricing', 'PricingEngine'],
  ['stock', 'Inventory'],
  ['search', 'SearchIndex'],
  ['media', 'MediaStore'],
  ['audit', 'AuditLog'],
  ['payments', 'PaymentService'],
  ['fraud', 'FraudCheck'],
  ['ledger', 'Ledger'],
  ['shipping', 'ShippingService'],
  ['carriers', 'CarrierAdapter'],
  ['notify', 'Notifier'],
  ['mail', 'MailQueue'],
  ['sms', 'SmsGateway'],
  ['tax', 'TaxCalculator'],
  ['promo', 'PromotionRules'],
  ['wh', 'Warehouse'],
  ['metrics', 'Metrics'],
];
const tree = {
  api: ['auth', 'orders', 'catalog'],
  auth: ['tokens', 'users'],
  orders: ['carts', 'payments', 'shipping', 'notify'],
  catalog: ['search', 'media'],
  carts: ['pricing', 'stock'],
  pricing: ['tax', 'promo'],
  stock: ['wh'],
  payments: ['fraud', 'ledger'],
  shipping: ['carriers'],
  notify: ['mail', 'sms'],
};
const cross = [
  ['orders', 'audit'],
  ['payments', 'audit'],
  ['auth', 'audit'],
  ['stock', 'metrics'],
  ['api', 'metrics'],
  ['shipping', 'wh'],
];
const operations = {
  auth: 'authenticate',
  tokens: 'issue',
  users: 'find',
  orders: 'submit',
  carts: 'checkout',
  pricing: 'quote',
  tax: 'compute',
  promo: 'apply',
  stock: 'reserve',
  wh: 'pick',
  payments: 'charge',
  fraud: 'score',
  ledger: 'post',
  shipping: 'book',
  carriers: 'label',
  notify: 'orderPlaced',
  mail: 'enqueue',
  sms: 'send',
  catalog: 'browse',
  search: 'query',
  media: 'thumbnails',
  audit: 'record',
  metrics: 'count',
};
const asynchronous = new Set(['notify', 'mail', 'sms', 'audit', 'metrics']);
const lifelines = names.map(([id, type]) => ({ id, name: id, type }));
lifelines.find(l => l.id === 'wh').multiObject = true;
const links = [...Object.entries(tree).flatMap(([from, children]) => children.map(to => ({ from, to }))), ...cross.map(([from, to]) => ({ from, to }))];
const messages = [];

function handle(node, prefix) {
  const targets = [...(tree[node] ?? []), ...cross.filter(([from]) => from === node).map(([, to]) => to)];
  let k = 0;
  for (const to of targets) {
    const seq = prefix ? `${prefix}.${++k}` : `${++k}`;
    const sort = asynchronous.has(to) ? 'asynchronous' : 'synchronous';
    const message = { sequence: seq, from: node, to, name: operations[to] ?? 'call', arguments: [] };
    if (sort === 'asynchronous') message.sort = sort;
    if (to === 'fraud') message.guard = 'amount > limit';
    if (to === 'tax') message.iteration = 'line in cart';
    messages.push(message);
    const nested = tree[to] ? handle(to, seq) : 0;
    if (sort === 'synchronous') {
      messages.push({ sequence: `${seq}.${nested + 1}`, from: to, to: node, name: operations[to], returnValue: 'result', sort: 'reply' });
    }
  }
  return k;
}
handle('api', '');
// A second transaction: tracking an order.
messages.push(
  { sequence: '5', from: 'api', to: 'orders', name: 'track', arguments: ['orderId'], assignTo: 'status' },
  { sequence: '5.1', from: 'orders', to: 'shipping', name: 'status', arguments: ['orderId'], assignTo: 's' },
  { sequence: '5.1.1', from: 'shipping', to: 'carriers', name: 'track', arguments: ['label'] },
  { sequence: '5.1.2', from: 'shipping', to: 'wh', name: 'lastScan', arguments: [] },
  { sequence: '5.2', from: 'orders', to: 'audit', name: 'record', arguments: ['"track"'], sort: 'asynchronous' },
  { sequence: '5.3', from: 'orders', to: 'api', name: 'track', returnValue: 's', sort: 'reply' },
  { sequence: '6', from: 'api', to: 'metrics', name: 'count', arguments: ['"checkout"'], sort: 'asynchronous' },
);
const document = { kind: 'communication', title: 'Checkout (stress)', lifelines, links, messages };
await writeFile(new URL('../examples/communication/stress.json', import.meta.url), JSON.stringify(document, null, 2) + '\n');
console.log(`${lifelines.length} lifelines, ${links.length} links, ${messages.length} messages`);
