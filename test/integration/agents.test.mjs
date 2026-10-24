import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BIN, mcpToolName } from '../../dist/commands.js';
import { cli, hasPlantUml, root, workspace } from '../helpers.mjs';
import { call, mcpClient } from '../mcp-helpers.mjs';
import { runSkillCommands, skillCommands } from '../skill-helpers.mjs';

// The agent entry points with the real PlantUML renderer: every command of the
// usage skill, including the ones the unit suite skips, and the MCP server
// drawing the PlantUML kinds.

const skip = hasPlantUml ? false : 'PlantUML runtime missing: run npm run setup:renderer';

test('every command in the usage skill runs, in order, as written', { skip }, async t => {
  const skill = await readFile(join(root, `skills/${BIN}/SKILL.md`), 'utf8');
  const results = await runSkillCommands(await workspace(t), skillCommands(skill));
  assert.ok(results.some(r => r.line.includes('--backend plantuml')));
  for (const { line, status, stderr } of results) {
    assert.equal(status, 0, `${line}\n${stderr}`);
    assert.equal(stderr, '', `${line} printed no error or warning`);
  }
});

test('the MCP server renders sequence, timing and activity like the CLI', { skip }, async t => {
  const dir = await workspace(t);
  const client = await mcpClient(t);
  for (const kind of ['sequence', 'timing', 'activity']) {
    const file = join(root, `examples/${kind}/minimal.json`);
    const result = await call(client, mcpToolName('render'), { file });
    assert.ok(!result.isError, JSON.stringify(result.parsed));
    assert.equal(result.content.length, 1, `${kind}: no layout warnings`);
    const out = join(dir, `${kind}.svg`);
    assert.equal(cli(['render', file, '-o', out]).status, 0);
    assert.equal(result.content[0].text, await readFile(out, 'utf8'), `${kind}: the same SVG as the CLI`);
  }
});
