import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { root } from './helpers.mjs';

/**
 * Starts `uml mcp` as a child process and connects an MCP client to it over
 * stdio, as an agent harness does. The server is closed when the test ends.
 */
export async function mcpClient(t, env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, 'dist/cli.js'), 'mcp'],
    cwd: root,
    env: { ...process.env, ...env },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'uml-test', version: '1.0.0' });
  await client.connect(transport);
  t.after(() => client.close());
  return client;
}

/** Calls a tool and returns the result with each text item parsed as JSON where it is JSON. */
export async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const parsed = result.content.map(item => {
    if (item.type !== 'text') return item;
    try {
      return JSON.parse(item.text);
    } catch {
      return item.text;
    }
  });
  return { ...result, parsed };
}
