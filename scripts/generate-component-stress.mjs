// Writes examples/component/stress.json (6 subsystems with 3 parts each, 30
// components, 24 interfaces, 60 relationships; streaming platform domain):
//   node scripts/generate-component-stress.mjs > examples/component/stress.json
const subsystems = [
  ['ingest', 'Ingestion', ['Uploader', 'Validator', 'Chunker']],
  ['media', 'Media Processing', ['Transcoder', 'Thumbnailer', 'Packager']],
  ['catalog', 'Catalog', ['Metadata Store', 'Search', 'Recommender']],
  ['playback', 'Playback', ['Session Manager', 'License Server', 'Edge Selector']],
  ['billing', 'Billing', ['Subscriptions', 'Invoicing', 'Tax Engine']],
  ['identity', 'Identity', ['Accounts', 'Token Service', 'Profiles']],
];
const externals = [
  ['studio', 'Studio Portal'],
  ['player', 'Web Player'],
  ['cdn', 'CDN'],
  ['payments', 'Payment Provider'],
  ['mail', 'Mail Relay'],
  ['analytics', 'Analytics'],
];
const id = s => s.replaceAll(/[^A-Za-z]/g, '');
const elements = [],
  relationships = [],
  interfaces = [];
const iface = (key, name) => {
  interfaces.push({ id: key, type: 'interface', name });
  return key;
};

// Each subsystem: an inbound port delegating to its first part, which uses the
// two other parts; the last part feeds the outbound port.
for (const [key, name, parts] of subsystems) {
  const inbound = iface(`i${id(name)}`, `I${id(name)}`);
  const internal = parts.slice(1).map(p => iface(`i${id(p)}`, `I${id(p)}`));
  const nested = parts.map((p, k) => ({
    id: `${key}${k}`,
    type: 'component',
    name: p,
    ports: [...(k === 0 ? [{ id: `${key}${k}in`, provides: [inbound] }] : []), ...(k === parts.length - 1 ? [{ id: `${key}${k}out`, requires: ['OUT'] }] : [])],
    ...(k > 0 ? { provides: [internal[k - 1]] } : {}),
    ...(k === 0 ? { requires: internal } : {}),
  }));
  elements.push({
    id: key,
    type: 'component',
    name,
    ports: [
      { id: `${key}In`, name: 'in', provides: [inbound] },
      { id: `${key}Out`, name: 'out', requires: ['OUT'] },
    ],
    elements: nested,
  });
  relationships.push({ type: 'delegation', from: `${key}In`, to: `${key}0in` }, { type: 'delegation', from: `${key}${parts.length - 1}out`, to: `${key}Out` });
  for (let k = 1; k < parts.length; k++) relationships.push({ type: 'assembly', from: `${key}0`, to: `${key}${k}`, interface: internal[k - 1] });
}
// Outbound ports require the next subsystem's inbound interface (two pipelines).
const next = { ingest: 'media', media: 'catalog', catalog: 'playback', identity: 'billing', billing: 'playback', playback: null };
for (const e of elements) {
  const target = next[e.id];
  const out = target ? `i${id(subsystems.find(s => s[0] === target)[1])}` : iface('iDelivery', 'IDelivery');
  e.ports[1].requires = [out];
  for (const part of e.elements) for (const p of part.ports) if (p.requires) p.requires = [out];
  if (target) relationships.push({ type: 'assembly', from: `${e.id}Out`, to: `${target}In`, interface: out });
}
for (const [key, name] of externals) elements.push({ id: key, type: 'component', name, stereotypes: ['external'] });
const ext = elements.filter(e => e.stereotypes);
ext[0].requires = ['iIngestion'];
relationships.push({ type: 'assembly', from: 'studio', to: 'ingestIn', interface: 'iIngestion' });
ext[1].requires = ['iIdentity'];
relationships.push({ type: 'assembly', from: 'player', to: 'identityIn', interface: 'iIdentity' });
ext[2].provides = ['iDelivery'];
relationships.push({ type: 'assembly', from: 'playbackOut', to: 'cdn', interface: 'iDelivery' });
ext[3].provides = [iface('iCharge', 'ICharge')];
ext[4].provides = [iface('iMail', 'IMail')];
ext[5].provides = [iface('iEvents', 'IEvents')];
const billingTax = elements.find(e => e.id === 'billing').elements[2];
billingTax.requires = [...(billingTax.requires ?? []), 'iCharge'];
relationships.push(
  { type: 'dependency', from: 'billing', to: 'payments', keyword: 'call' },
  { type: 'dependency', from: 'identity', to: 'mail', keyword: 'send' },
);
for (const s of ['catalog', 'playback', 'billing']) relationships.push({ type: 'dependency', from: s, to: 'analytics', keyword: 'emit' });
for (const [i, s] of subsystems.entries()) {
  elements.push({ id: `${s[0]}Jar`, type: 'artifact', name: `${s[0]}-service-${i + 1}.0.jar` });
  relationships.push({ type: 'manifest', from: `${s[0]}Jar`, to: s[0] });
}
elements.push(...interfaces, {
  id: 'note',
  type: 'note',
  text: 'Two pipelines meet in Playback: content (ingest, media, catalog) and customers (identity, billing).',
  attachedTo: ['playback'],
});
const doc = { kind: 'component', title: 'Streaming platform', elements, relationships };
console.log(JSON.stringify(doc, null, 1));
