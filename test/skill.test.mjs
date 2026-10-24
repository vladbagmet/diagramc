import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BIN, COMMANDS, MCP_TOOLS } from '../dist/commands.js';
import { kinds } from '../dist/model/registry.js';
import { skillReference, REFERENCE_FILE } from '../scripts/generate-skill-reference.mjs';
import { cli, root, workspace } from './helpers.mjs';
import { runSkillCommands, skillCommands } from './skill-helpers.mjs';

// The usage skill (skills/<binary>/) is what agents read before using the tool,
// so it must never name a command, flag, kind, tool or error code the CLI does
// not have, and must cover every kind the CLI has. Names follow BIN (the binary
// in package.json), so renaming the binary only needs the text replaced.

const skillFile = join(root, `skills/${BIN}/SKILL.md`);
const skill = await readFile(skillFile, 'utf8');
const reference = await readFile(REFERENCE_FILE, 'utf8');
const readme = await readFile(join(root, 'README.md'), 'utf8');
const kindNames = kinds.map(k => k.kind);

/** The text inside inline code spans and fenced code blocks: where commands and names are written. */
function codeText(markdown) {
  const blocks = [...markdown.matchAll(/^```[a-z]*\n([\s\S]*?)^```$/gmu)].map(m => m[1]);
  const prose = markdown.replaceAll(/^```[a-z]*\n[\s\S]*?^```$/gmu, '');
  const spans = [...prose.matchAll(/`([^`\n]+)`/gu)].map(m => m[1]);
  return [...blocks, ...spans].join('\n');
}

/** Every help text the CLI prints: the overview and one per command. */
function allHelp() {
  return [cli(['--help']).stdout, ...COMMANDS.filter(c => c !== 'help').map(c => cli([c, '--help']).stdout)].join('\n');
}

test('the skill has Agent Skills front matter and a short body', () => {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(skill);
  assert.ok(match, 'SKILL.md starts with YAML front matter between --- lines');
  const fields = Object.fromEntries(match[1].split('\n').map(line => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]));
  assert.deepEqual(Object.keys(fields), ['name', 'description']);
  // The name must match the directory and use lowercase letters, digits and hyphens.
  assert.equal(fields.name, BIN);
  assert.match(fields.name, /^[a-z\d-]{1,64}$/u);
  assert.ok(fields.description.length > 50 && fields.description.length <= 1024, 'description is present and at most 1024 characters');
  assert.ok(!/[<>]/u.test(fields.description), 'no angle brackets in the description');
  const body = match[2].trimEnd().split('\n');
  assert.ok(body.length <= 150, `SKILL.md body has ${body.length} lines; keep it at 150 or fewer and move detail to reference.md`);
});

test('reference.md is generated from the kinds and schemas and is up to date', () => {
  assert.equal(
    reference,
    skillReference(),
    `skills/${BIN}/reference.md is stale: run "npm run build && node scripts/generate-skill-reference.mjs" and commit the result`,
  );
  for (const kind of kindNames) assert.match(reference, new RegExp(`^## ${kind}$`, 'mu'), `reference.md has a section for ${kind}`);
});

test('every kind the CLI has is named in the skill or its reference', () => {
  const text = skill + reference;
  for (const kind of kindNames) assert.ok(text.includes(kind), `the skill does not mention the kind ${kind}`);
  const count = new RegExp(String.raw`${BIN} kinds\s+# the (\d+) kinds`, 'u').exec(skill);
  assert.ok(count, 'the discovery block states how many kinds there are');
  assert.equal(Number(count[1]), kindNames.length);
});

test('the skill only names commands, flags, kinds, tools and error codes the CLI has', async () => {
  const help = allHelp();
  for (const [name, markdown] of [
    ['SKILL.md', skill],
    ['reference.md', reference],
  ]) {
    const code = codeText(markdown);
    for (const [, command] of code.matchAll(new RegExp(String.raw`(?:^|[\s|\x60(])${BIN} ([a-z][a-z-]*)`, 'gmu')))
      assert.ok(COMMANDS.includes(command), `${name} names a command "${BIN} ${command}" that does not exist`);
    for (const [flag] of code.matchAll(/(?<![\w-])--[a-z][a-z-]*/gu)) assert.ok(help.includes(flag), `${name} names a flag ${flag} that no help text lists`);
    for (const { groups } of code.matchAll(new RegExp(`(?:${BIN} (?:example|schema)|--kind) (?<kind>[a-z][a-z-]*)`, 'gu'))) {
      const { kind } = groups;
      assert.ok(kindNames.includes(kind) || kind === 'reference', `${name} names an unknown kind "${kind}"`);
    }
    for (const [tool] of markdown.matchAll(new RegExp(String.raw`\b${BIN}_[a-z]+\b`, 'gu')))
      assert.ok(MCP_TOOLS.includes(tool), `${name} names an MCP tool ${tool} that does not exist`);
  }
  // Every error code and environment variable the skill names exists in the source.
  const sources = await sourceText();
  for (const [, constant] of codeText(skill).matchAll(/\b([A-Z][A-Z0-9]*_[A-Z0-9_]+)\b/gu))
    assert.ok(
      sources.includes(`'${constant}'`) || sources.includes(`"${constant}"`) || sources.includes(`.${constant}`),
      `SKILL.md names ${constant}, which src/ never uses`,
    );
  // The README names the same tools.
  for (const tool of MCP_TOOLS) assert.ok(skill.includes(tool) && readme.includes(tool), `${tool} is documented in SKILL.md and README.md`);
});

async function sourceText() {
  const files = (await readdir(join(root, 'src'), { recursive: true })).filter(f => f.endsWith('.ts'));
  const texts = await Promise.all(files.map(f => readFile(join(root, 'src', f), 'utf8')));
  return texts.join('\n');
}

test('every command in the skill runs (those needing PlantUML are in the integration suite)', async t => {
  const commands = skillCommands(skill);
  assert.ok(commands.length >= 15, 'the skill shows the commands an agent needs');
  const results = await runSkillCommands(await workspace(t), commands, { skip: line => line.includes('--backend plantuml') });
  for (const { line, status, stderr, stdout } of results) {
    assert.equal(status, 0, `${line}\n${stderr}`);
    assert.equal(stderr, '', `${line} printed no error or warning`);
    if (line.startsWith(`${BIN} validate`)) assert.match(stdout, /^\{"valid":true,"kind":"class","version":2\}\n$/u);
  }
});

test('the guide command prints the skill and its reference from the package; --help points to it', async () => {
  let result = cli(['guide']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, skill.replace(/^---\n[\s\S]*?\n---\n+/u, ''));
  result = cli(['guide', 'reference']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, reference);
  result = cli(['guide', 'kinds']);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stderr).error.code, 'USAGE');
  assert.match(JSON.parse(result.stderr).error.message, /topics: reference/u);
  result = cli(['guide', 'reference', 'extra']);
  assert.equal(result.status, 2);
  result = cli(['mcp', 'extra']);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stderr).error.code, 'USAGE');
  // An agent that only has the binary finds the guide in the first lines of the help.
  const firstLines = cli(['--help']).stdout.split('\n').slice(0, 5).join('\n');
  assert.ok(firstLines.includes(`${BIN} guide`));
  assert.ok(firstLines.includes(`${BIN} mcp`));
  assert.ok(cli(['guide', '--help']).stdout.includes(join(`skills`, BIN, `SKILL.md`)));
  // The skill ships in the package.
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('skills/'), 'package.json "files" includes skills/');
});
