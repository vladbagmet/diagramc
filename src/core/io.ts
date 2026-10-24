import { createReadStream } from 'node:fs';
import { open, rename, stat, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { UmlError } from './errors.js';
import { MAX_INPUT_BYTES } from './limits.js';

/** Plain-words explanation of the common file system error codes. */
const REASONS: Record<string, string> = {
  ENOENT: 'no such file or directory',
  EISDIR: 'it is a directory, not a file',
  ENOTDIR: 'a part of the path is not a directory',
  EACCES: 'permission denied',
  EPERM: 'operation not permitted',
  EROFS: 'read-only file system',
  ENOSPC: 'no space left on the device',
  EEXIST: 'a file with that name already exists',
  ENAMETOOLONG: 'the path is too long',
  ELOOP: 'too many symbolic links in the path',
};

/** `{ path, reason, errno }` details of a file system error, for agents that fix paths. */
function ioDetails(path: string, error: unknown): { path: string; reason: string; errno?: string } {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  const errno = typeof code === 'string' ? code : undefined;
  return { path, reason: (errno && REASONS[errno]) ?? 'the operating system refused the operation', ...(errno ? { errno } : {}) };
}

export async function readInput(path: string): Promise<string> {
  const stream = path === '-' ? process.stdin : createReadStream(path);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      size += bytes.length;
      if (size > MAX_INPUT_BYTES) throw new UmlError('INPUT_TOO_LARGE', `Input exceeds ${MAX_INPUT_BYTES} bytes`);
      chunks.push(bytes);
    }
  } catch (error) {
    if (error instanceof UmlError) throw error;
    const details = ioDetails(path === '-' ? '(stdin)' : path, error);
    throw new UmlError('INPUT_READ_FAILED', `Could not read input ${JSON.stringify(details.path)}: ${details.reason}`, 4, details);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new UmlError('INVALID_ENCODING', 'Input must be valid UTF-8');
  }
}

/** Paths that name this process's standard output. */
const STDOUT_PATHS = new Set(['/dev/stdout', '/dev/fd/1', '/proc/self/fd/1']);

/** Writes to standard output and resolves once the data is handed to the system. */
function writeStdout(data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(data, error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * Writes through a temporary sibling and renames, so an existing file is replaced
 * only on success. An existing target that is not a regular file (a device such
 * as /dev/null, a named pipe) cannot be replaced by a rename: it is written
 * directly. Standard output is written through the process stream instead of
 * being opened by path, because Linux refuses to open /dev/stdout when it is a
 * socket, which is how Node connects the output of a child process.
 */
export async function writeOutput(path: string, data: Buffer): Promise<void> {
  if (STDOUT_PATHS.has(path)) {
    try {
      await writeStdout(data);
      return;
    } catch (error) {
      const details = ioDetails(path, error);
      throw new UmlError('OUTPUT_WRITE_FAILED', `Could not write output ${JSON.stringify(path)}: ${details.reason}`, 4, { ...details, output: path });
    }
  }
  const existing = await stat(path).catch(() => {});
  if (existing && !existing.isFile() && !existing.isDirectory()) {
    try {
      const target = await open(path, 'w');
      try {
        await target.writeFile(data);
      } finally {
        await target.close();
      }
      return;
    } catch (error) {
      const details = ioDetails(path, error);
      throw new UmlError('OUTPUT_WRITE_FAILED', `Could not write output ${JSON.stringify(path)}: ${details.reason}`, 4, { ...details, output: path });
    }
  }
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let created = false;
  try {
    const file = await open(temporary, 'wx', 0o644);
    created = true;
    try {
      await file.writeFile(data);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } catch (error) {
    // A missing temporary file means the directory itself is the problem.
    const details = ioDetails(created ? path : dirname(path), error);
    throw new UmlError(
      'OUTPUT_WRITE_FAILED',
      `Could not write output ${JSON.stringify(path)}: ${details.reason}${created ? '' : ` (directory ${JSON.stringify(dirname(path))})`}; the parent directory must exist and be writable`,
      4,
      { ...details, output: path },
    );
  } finally {
    if (created) await unlink(temporary).catch(() => {});
  }
}
