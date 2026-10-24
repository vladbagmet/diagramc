import { readFileSync } from 'node:fs';

/**
 * Facts about the installed package, read from its package.json so they never
 * drift. This module imports nothing else from the tool, so any module (the
 * schemas and messages included) can name the binary without an import cycle.
 */

/** The package root: dist/core/ is two levels below it. */
export const packageRoot = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8')) as { version: string; bin: Record<string, string> };
export const VERSION = manifest.version;
/**
 * The name of the binary (the first `bin` entry of package.json). The skill
 * directory, the MCP server name, the MCP tool-name prefix and every command
 * shown in help and messages follow it, so renaming the binary in package.json
 * renames them too.
 */
export const BIN = Object.keys(manifest.bin)[0]!;
