import { createReadStream } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { UmlError } from './errors.js';
import { MAX_INPUT_BYTES } from './limits.js';

export async function readInput(path: string): Promise<string> {
  const stream = path === '-' ? process.stdin : createReadStream(path);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_INPUT_BYTES) throw new UmlError('INPUT_TOO_LARGE', `Input exceeds ${MAX_INPUT_BYTES} bytes`);
      chunks.push(bytes);
    }
  } catch (error) {
    if (error instanceof UmlError) throw error;
    throw new UmlError('INPUT_READ_FAILED', 'Could not read input', 4);
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw new UmlError('INVALID_ENCODING', 'Input must be valid UTF-8'); }
}

/** Writes through a temporary sibling and renames, so existing output is replaced only on success. */
export async function writeOutput(path: string, data: Buffer): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let created = false;
  try {
    const file = await open(temporary, 'wx', 0o644);
    created = true;
    try { await file.writeFile(data); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, path);
  } catch {
    throw new UmlError('OUTPUT_WRITE_FAILED', 'Could not atomically write output; check its parent directory and permissions', 4);
  } finally {
    if (created) await unlink(temporary).catch(() => {});
  }
}
