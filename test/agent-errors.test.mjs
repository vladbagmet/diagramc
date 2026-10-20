import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from '../dist/model/parse.js';
import { cli, root } from './helpers.mjs';

// "Agent first attempt" set: models that agents wrote from memory, before reading
// the schema (from the reviews, test/fixtures/agent-first/). The error output alone
// must be enough to fix each of them in one round: every problem is reported at
// once, unknown properties and values list what is allowed, corrections are named,
// and applying the named corrections plus the edits the messages ask for gives a
// valid model.

const dir = join(root, 'test/fixtures/agent-first');
const load = async name => JSON.parse(await readFile(join(dir, name), 'utf8'));
const errorOf = doc => {
  try { parseDocument(JSON.stringify(doc)); } catch (error) { return error; }
  assert.fail('expected a validation error');
};
const get = (doc, path) => path.split('/').slice(1).reduce((n, k) => n?.[k], doc);

/** Applies every `details.suggestion` of one error report (what an agent does with the named corrections). */
function applySuggestions(doc, diagnostics) {
  const copy = structuredClone(doc);
  // Paths refer to the document as written: change values first, then rename properties, innermost first.
  const renames = d => d.details?.rule === 'additionalProperties';
  const ordered = [...diagnostics.filter(d => !renames(d)), ...diagnostics.filter(renames).sort((a, b) => b.path.split('/').length - a.path.split('/').length)];
  for (const d of ordered) {
    const s = d.details?.suggestion;
    if (s === undefined && !d.details?.swap) continue;
    const parts = d.path.split('/').slice(1);
    const key = parts.pop();
    const parent = parts.reduce((n, k) => n?.[k], copy);
    if (!parent || typeof parent !== 'object') continue;
    if (d.details.rule === 'additionalProperties') { if (!(s in parent)) { parent[s] = parent[key]; delete parent[key]; } }
    else if (d.details.swap) Object.assign(parent, d.details.swap);
    else { parent[key] = s; if (d.details.also) Object.assign(parent, d.details.also); }
  }
  return copy;
}

/**
 * The edits each message asks for in words (no suggestion to copy): remove a
 * property, add a missing one, restructure. Each entry names the message it follows.
 */
const MANUAL = {
  'act-llm.json': [
    ['a decision node has no name', d => { delete d.nodes[2].name; }],
    ['several incoming flows; join them with an explicit merge', d => {
      d.nodes.push({ id: 'm', type: 'merge' });
      d.edges.find(e => e.from === 'busy' && e.to === 'move').to = 'm';
      d.edges.find(e => e.from === 'wait' && e.to === 'move').to = 'm';
      d.edges.push({ from: 'm', to: 'move' });
    }],
  ],
  'class-llm.json': [
    ['multiplicities belong to the ends', d => { delete d.relationships[0].multiplicity; d.relationships[0].toEnd = { multiplicity: '1..*' }; }],
    ['Reference to unknown element "OrderItem"', d => { d.elements.push({ id: 'OrderItem', type: 'class', name: 'OrderItem' }); }],
  ],
  'communication-agent.json': [
    ['no link connects them', d => { d.links.push({ from: 'bank', to: 'acct' }); }],
    ['its sender must be "atm" (the receiver of 2), not "bank"', d => { d.messages[3].sequence = '2.1.1'; }],
    ['Reply 3.2 must answer synchronous call 3', d => { Object.assign(d.messages[6], { sequence: '3.1.1', from: 'bank', to: 'atm' }); delete d.messages[6].sort; delete d.messages[6].returnValue; d.messages[6].name = 'debited'; }],
  ],
  'component-agent.json': [
    ['Missing required property "interface"', d => { d.relationships[1].interface = 'IPayment'; }],
    ['"cart" does not require interface "ICart"', d => { [d.relationships[0].from, d.relationships[0].to] = ['web', 'cart']; }],
    ['The target of a usage must be an interface', d => { d.relationships[3].to = 'ICart'; }],
  ],
  'cs-llm.json': [
    ['Unknown property "provides"', d => { delete d.elements[0].parts[0].ports[0].provides; }],
    ['Missing required property "name"', d => { d.elements[0].parts[1].name = 'gearbox'; }],
    ['is conjugated but has no type', d => { d.elements[0].ports[0].type = 'FuelLine'; }],
    ['Reference to unknown element "engine-tank"', d => { d.relationships[2].to = 'engine'; }],
    ['A connector must connect two different parts', d => { d.relationships.pop(); }],
  ],
  'deployment-agent.json': [
    ['An execution environment cannot contain a device', d => { const hsm = d.elements[1].elements[0].elements.pop(); d.elements[1].elements.push(hsm); }],
    ['not the artifact "atmsw"', d => { d.relationships[1].from = 'atm'; }],
  ],
  'iod-agent.json': [
    ['a decision node has no name', d => { delete d.nodes[3].name; }],
    ['Only flows leaving a decision node carry guards', d => { delete d.flows[1].guard; }],
    ['"pay" has 2 outgoing flows', d => {
      d.nodes.push({ id: 'again', type: 'decision' }, { id: 'merge1', type: 'merge' }, { id: 'merge2', type: 'merge' });
      d.flows = [
        { from: 'start', to: 'merge1' }, { from: 'merge1', to: 'browse' }, { from: 'browse', to: 'cart' }, { from: 'cart', to: 'check' },
        { from: 'check', to: 'login', guard: 'no' }, { from: 'check', to: 'merge2', guard: 'else' }, { from: 'login', to: 'merge2' },
        { from: 'merge2', to: 'pay' }, { from: 'pay', to: 'again' }, { from: 'again', to: 'end', guard: 'done' }, { from: 'again', to: 'merge1', guard: 'more' },
      ];
    }],
  ],
  'object-llm.json': [
    ['"slots" is similar but takes a list', d => { delete d.elements[0].attributes; d.elements[0].slots = [{ feature: 'name', value: 'Alice' }]; }],
    ['a link between instances has no multiplicity', d => { delete d.relationships[0].toEnd.multiplicity; }],
    ['Classifier "SavingsAccount" is not declared in "classifiers"', d => { d.classifiers.push({ name: 'SavingsAccount', attributes: ['rate'] }); }],
  ],
  'package-llm.json': [
    ['belongs to class diagrams', d => { delete d.elements[2].attributes; }],
    ['Reference to unknown element "Controller"', d => { d.elements.push({ id: 'Controller', type: 'class', name: 'Controller' }); }],
    ['Only a package can import', d => { d.relationships.splice(3, 1); }],
    ['"order" is already owned by "domain"', d => { d.elements[3].members = []; }],
    ['"ui" and "domain" are nested in one another', d => { d.elements[1].members = ['order']; }],
  ],
  'profile-llm.json': [
    ['a stereotype extends a metaclass through a relationship', d => { delete d.elements[2].extends; }],
    ['Unknown property "attributes" in /elements/4', d => { delete d.elements[4].attributes; }],
    ['An extension goes from a stereotype to a metaclass', d => { [d.relationships[0].from, d.relationships[0].to] = ['resource', 'Class']; }],
    ['cannot apply itself', d => { d.relationships.pop(); }],
  ],
  'tim-llm.json': [
    ['Missing required property "timeUnit"', d => { d.timeUnit = 'ms'; }],
    ['for fractions use a finer unit', d => {
      for (const l of d.lifelines) for (const c of l.changes) c.at *= 1000;
      d.messages[0].fromTime = 9500;
    }],
    ['Missing required property "toTime"', d => { d.messages[0].toTime = 9500; }],
  ],
  'use-case-agent.json': [
    ['set "subject": "<this subject\'s id>" on each use case', d => {
      for (const id of d.elements[3].useCases) d.elements.find(e => e.id === id).subject = 'app';
      delete d.elements[3].useCases;
    }],
    ['Missing required property "extensionPoint"', d => {
      d.elements.find(e => e.id === 'book').extensionPoints = ['peak hours'];
      Object.assign(d.relationships[5], { from: 'surge', to: 'book', extensionPoint: 'peak hours' });
    }],
    ['Actors communicate with use cases, not with other actors', d => { d.relationships.pop(); }],
  ],
};

test('agent first attempts: one report lists every problem, with allowed values and corrections', async () => {
  const files = (await readdir(dir)).filter(f => f.endsWith('.json')).sort();
  assert.ok(files.length >= 10, 'about ten realistic first attempts across kinds');
  for (const file of files) {
    const doc = await load(file);
    const error = errorOf(doc);
    assert.ok(error.diagnostics.length >= 1, file);
    assert.equal(error.details, undefined, `${file}: no top-level details duplicating diagnostics`);
    // The message alone names every problem (up to twelve).
    for (const d of error.diagnostics.slice(0, 12)) assert.ok(error.message.includes(d.message), `${file}: message summarises ${d.path}`);
    for (const d of error.diagnostics) {
      assert.ok(!/must match pattern|\(\?!|\^\(\?:/.test(d.message), `${file}: no raw regular expression in ${d.message}`);
      assert.ok(!/must NOT have additional properties|must be in oneOf/.test(d.message), `${file}: no raw validator wording in ${d.message}`);
      if (d.details?.rule === 'additionalProperties') assert.match(d.message, /Allowed properties: \w/, `${file}: ${d.path} lists the allowed properties`);
      if (d.details?.rule === 'discriminator' || d.details?.rule === 'enum') assert.match(d.message, /Allowed values: "/, `${file}: ${d.path} lists the allowed values`);
      assert.ok(get(doc, d.path) !== undefined || d.details?.rule === 'required' || d.details?.afterFixes || /\/\d+$/.test(d.path) || d.code !== 'SCHEMA_INVALID', `${file}: ${d.path} points into the document`);
    }
  }
});

test('agent first attempts: named corrections plus the edits the messages ask for give a valid model in one round', async () => {
  for (const file of (await readdir(dir)).filter(f => f.endsWith('.json')).sort()) {
    const edits = MANUAL[file] ?? [];
    const doc = await load(file);
    const error = errorOf(doc);
    const fixed = applySuggestions(doc, error.diagnostics);
    for (const [message, edit] of edits) {
      assert.ok(error.diagnostics.some(d => d.message.includes(message)), `${file}: the report asks for "${message}"`);
      edit(fixed);
    }
    try { parseDocument(JSON.stringify(fixed)); }
    catch (second) { assert.fail(`${file} needs a second round: ${second.message}`); }
  }
});

test('agent first attempts: typical mistakes get the intended suggestion', async () => {
  const suggestionAt = async (file, path) => errorOf(await load(file)).diagnostics.find(d => d.path === path)?.details?.suggestion;
  const cases = [
    ['class-llm.json', '/elements/0/methods', 'operations'],
    ['class-llm.json', '/elements/2/type', 'class'],
    ['class-llm.json', '/relationships/1/type', 'generalization'],
    ['class-llm.json', '/relationships/2/source', 'from'],
    ['class-llm.json', '/relationships/2/target', 'to'],
    ['class-llm.json', '/elements/1/attributes/0/visibility', 'public'],
    ['seq-llm.json', '/participants', 'lifelines'],
    ['tim-llm.json', '/lifelines/0/type', 'notation'],
    ['tim-llm.json', '/lifelines/0/changes/0/time', 'at'],
    ['object-llm.json', '/elements/0/type', 'instance'],
    ['profile-llm.json', '/elements/1/tags', 'attributes'],
    ['package-llm.json', '/relationships/1/stereotype', 'keyword'],
    ['component-agent.json', '/relationships/3/type', 'usage'],
    ['communication-agent.json', '/messages/7/sort', 'asynchronous'],
    ['deployment-agent.json', '/relationships/0/protocol', 'ISO 8583'],
    ['deployment-agent.json', '/relationships/0/fromEnd/multiplicity', '*'],
    ['cs-llm.json', '/relationships/2/to', 'engine-tank'],
    ['act-llm.json', '/nodes/6/type', 'activityFinal'],
    ['act-llm.json', '/edges/2/guard', 'yes'],
  ];
  for (const [file, path, expected] of cases) assert.deepEqual(await suggestionAt(file, path), expected, `${file} ${path}`);
  // A sequence "type": "sync" item is a message with a sort.
  const seq = errorOf(applySuggestions(await load('seq-llm.json'), errorOf(await load('seq-llm.json')).diagnostics.filter(d => !d.details?.afterFixes)));
  assert.ok(seq.diagnostics.some(d => d.path === '/items/0/type' && d.details.suggestion === 'message' && d.details.also?.sort === 'synchronous'));
});

test('interaction overview written with activity names gets the overview names suggested (F-B-27)', () => {
  const doc = { kind: 'interaction-overview', nodes: [{ id: 'i', type: 'initial' }, { id: 'a', type: 'callBehavior', name: 'X' }, { id: 'f', type: 'activityFinal' }, { id: 'g', type: 'flowFinal' }], edges: [{ from: 'i', to: 'a' }] };
  const suggestion = path => errorOf(doc).diagnostics.find(d => d.path === path)?.details?.suggestion;
  assert.equal(suggestion('/nodes/1/type'), 'interaction-use');
  assert.equal(suggestion('/nodes/2/type'), 'final');
  assert.equal(suggestion('/nodes/3/type'), 'flow-final');
  assert.equal(suggestion('/edges'), 'flows');
});

test('an element nested where an ID list is expected says where it goes (F-A-14)', () => {
  const doc = { kind: 'package', elements: [{ id: 'p', type: 'package', name: 'P', members: [{ id: 'q', type: 'package', name: 'Q', members: [{ id: 'c', type: 'class', name: 'C' }] }] }] };
  const error = errorOf(doc);
  const d = error.diagnostics.find(x => x.path === '/elements/0/members/0');
  assert.match(d.message, /must be an ID string, but it is an object; declare that element in the top-level "elements" list/);
  assert.match(d.message, /write only its ID here: "q"/);
  assert.ok(!error.diagnostics.some(x => x.details?.afterFixes), 'no confusing follow-up about a name');
});

test('CLI errors for agents: JSON position, kind and command suggestions, file reasons', () => {
  let result = cli(['validate', '-'], { input: '{\n  "kind": "class",\n  "elements": [],\n}' });
  assert.equal(result.status, 2);
  let error = JSON.parse(result.stderr).error;
  assert.equal(error.code, 'INVALID_JSON');
  assert.deepEqual([error.details.line, error.details.column], [4, 1]);
  assert.match(error.message, /line 4, column 1.*trailing comma/);
  result = cli(['validate', '-'], { input: JSON.stringify({ kind: 'state_machine' }) });
  error = JSON.parse(result.stderr).error;
  assert.equal(error.code, 'UNKNOWN_KIND');
  assert.equal(error.diagnostics[0].details.suggestion, 'state-machine');
  result = cli(['schema', 'seq']);
  assert.equal(JSON.parse(result.stderr).error.details.suggestion, 'sequence');
  result = cli(['validate', join(root, 'does-not-exist.json')]);
  assert.equal(result.status, 4);
  error = JSON.parse(result.stderr).error;
  assert.equal(error.code, 'INPUT_READ_FAILED');
  assert.equal(error.details.errno, 'ENOENT');
  assert.match(error.message, /does-not-exist\.json.*no such file/);
  result = cli(['render', join(root, 'examples/class/minimal.json'), '-o', join(root, 'no-such-dir/x.svg')]);
  assert.equal(result.status, 4);
  assert.match(JSON.parse(result.stderr).error.message, /no such file or directory/);
  result = cli(['render', join(root, 'examples/class/minimal.json'), '-o', 'x.svg', '--format', 'png']);
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stderr).error.message, /does not match the \.svg extension/);
  result = cli(['example', 'activity']);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).kind, 'activity');
  result = cli(['validate', '-'], { input: JSON.stringify({ ...JSON.parse(cli(['example', 'timing']).stdout), version: 2 }) });
  assert.equal(result.status, 0, 'a document may state "version": 2, which validate reports');
});
