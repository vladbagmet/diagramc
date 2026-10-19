/**
 * One problem found in an input document. `path` is a JSON Pointer (RFC 6901)
 * into the document as the user wrote it, for example `/relationships/2/to`.
 * `code` is stable and documented; `message` is for humans and may change.
 */
export interface Diagnostic {
  code: string;
  path: string;
  message: string;
  details?: unknown;
}

/**
 * The single error type the CLI reports. Exit codes: 2 usage/input,
 * 3 renderer, 4 file I/O, 130/143 interrupted by SIGINT/SIGTERM.
 */
export class UmlError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly exitCode = 2,
    public readonly details?: unknown,
    public readonly path?: string,
    public readonly diagnostics?: readonly Diagnostic[],
  ) { super(message); }

  toJSON(): object {
    return {
      code: this.code,
      message: this.message,
      ...(this.path === undefined ? {} : { path: this.path }),
      ...(this.details === undefined ? {} : { details: this.details }),
      ...(this.diagnostics === undefined ? {} : { diagnostics: this.diagnostics }),
    };
  }
}

/** Throws the first diagnostic as the error, carrying all of them for agents that fix in bulk. */
export function failValidation(diagnostics: readonly Diagnostic[]): never {
  const [first] = diagnostics;
  if (!first) throw new UmlError('INTERNAL_ERROR', 'Validation failed without diagnostics', 3);
  throw new UmlError(first.code, first.message, 2, first.details, first.path, diagnostics);
}

/** Appends a JSON Pointer segment, escaping `~` and `/` as RFC 6901 requires. */
export function pointer(base: string, ...segments: (string | number)[]): string {
  return segments.reduce<string>((path, segment) =>
    `${path}/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`, base);
}
