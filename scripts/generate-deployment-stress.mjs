// Writes examples/deployment/stress.json (2 regions, 8 servers, 66 elements,
// 40 relationships; a multi-region SaaS deployment):
//   node scripts/generate-deployment-stress.mjs > examples/deployment/stress.json
const services = [
  ['api', 'API'],
  ['worker', 'Worker'],
  ['search', 'Search'],
  ['auth', 'Auth'],
];
const elements = [],
  relationships = [];
const path = (from, to, protocol, extra = {}) => relationships.push({ type: 'communicationPath', from, to, protocol, ...extra });

elements.push(
  { id: 'browser', type: 'device', name: 'Browser', stereotypes: ['client'] },
  { id: 'mobile', type: 'device', name: 'Mobile App', stereotypes: ['client'] },
  { id: 'cdn', type: 'node', name: 'CDN Edge', elements: [{ id: 'assets', type: 'artifact', name: 'static-assets.zip' }] },
);
path('browser', 'cdn', 'HTTPS', { fromEnd: { multiplicity: '*' }, toEnd: { multiplicity: '1..*' } });

for (const [r, region] of [
  ['eu', 'eu-west-1'],
  ['us', 'us-east-1'],
].entries()) {
  const key = region[0];
  const servers = services.map(([svc, name], s) => ({
    id: `${key}${svc}`,
    type: 'device',
    name: `${name} host ${r + 1}.${s + 1}`,
    elements: [
      {
        id: `${key}${svc}Rt`,
        type: 'executionEnvironment',
        name: svc === 'search' ? 'OpenSearch 2' : 'Container runtime',
        elements: [
          { id: `${key}${svc}Img`, type: 'artifact', name: `${svc}-image:3.${s}` },
          ...(s % 2 === 0
            ? [
                {
                  id: `${key}${svc}Cfg`,
                  type: 'deploymentSpecification',
                  name: `${svc}.env`,
                  properties: [{ name: 'replicas', type: 'Integer', value: String(2 + s) }],
                },
              ]
            : []),
        ],
      },
    ],
  }));
  const lb = { id: `${key}lb`, type: 'device', name: `Load balancer ${region[1]}` };
  const db = {
    id: `${key}db`,
    type: 'node',
    name: `Database ${region[1]}`,
    stereotypes: ['managed'],
    elements: [
      { id: `${key}pg`, type: 'executionEnvironment', name: 'PostgreSQL 16', elements: [{ id: `${key}schema`, type: 'artifact', name: 'schema-v42.sql' }] },
    ],
  };
  const queue = {
    id: `${key}mq`,
    type: 'node',
    name: `Queue ${region[1]}`,
    elements: [{ id: `${key}broker`, type: 'executionEnvironment', name: 'RabbitMQ' }],
  };
  elements.push({ id: `${key}region`, type: 'node', name: `Region ${region[1]}`, stereotypes: ['cloud region'], elements: [lb, ...servers, db, queue] });
  path('browser', lb.id, 'HTTPS', { fromEnd: { multiplicity: '*' }, toEnd: { multiplicity: '1' } });
  path('mobile', lb.id, 'HTTPS', { fromEnd: { multiplicity: '*' }, toEnd: { multiplicity: '1' } });
  path(lb.id, `${key}api`, 'HTTP', { toEnd: { multiplicity: '2..*' } });
  path(lb.id, `${key}auth`, 'HTTP');
  path(`${key}api`, `${key}search`, 'HTTP');
  path(`${key}api`, `${key}mq`, 'AMQP');
  path(`${key}worker`, `${key}mq`, 'AMQP');
  path(`${key}api`, db.id, 'TCP', { name: 'primary' });
  path(`${key}worker`, db.id, 'TCP');
  path(`${key}auth`, db.id, 'TCP');
  for (const [svc] of services)
    if (services.findIndex(s => s[0] === svc) % 2 === 0)
      relationships.push({ type: 'dependency', from: `${key}${svc}Cfg`, to: `${key}${svc}Img`, keyword: 'configures' });
}
path('eudb', 'usdb', 'TCP', { name: 'replication', fromEnd: { multiplicity: '1' }, toEnd: { multiplicity: '1' } });
elements.push({ id: 'apiComp', type: 'component', name: 'Public API' });
relationships.push({ type: 'manifest', from: 'euapiImg', to: 'apiComp' });
elements.push({ id: 'migrations', type: 'artifact', name: 'migrations.tar' });
relationships.push({ type: 'deploy', from: 'migrations', to: 'eupg' }, { type: 'deploy', from: 'migrations', to: 'uspg' });
elements.push({
  id: 'note',
  type: 'note',
  text: 'Both regions are active; writes go to the primary region of each tenant.',
  attachedTo: ['euregion', 'usregion'],
});
console.log(JSON.stringify({ kind: 'deployment', title: 'Multi-region SaaS', elements, relationships }, null, 1));
