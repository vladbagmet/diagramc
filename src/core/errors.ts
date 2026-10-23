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
  ) {
    super(message);
  }

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

/** Problems spelled out in an error's `message`; all of them are always in `diagnostics`. */
const SUMMARY_LIMIT = 12;

/**
 * Throws a validation error carrying every diagnostic. `code` and `path` are the
 * first problem's; `message` summarises all of them, so an agent that reads only
 * the message still sees every problem (up to SUMMARY_LIMIT, then a count).
 * Details live in the diagnostics only, never duplicated at the top level.
 */
export function failValidation(diagnostics: readonly Diagnostic[]): never {
  const [first] = diagnostics;
  if (!first) throw new UmlError('INTERNAL_ERROR', 'Validation failed without diagnostics', 3);
  const message =
    diagnostics.length === 1
      ? first.message
      : `${diagnostics.length} problems; fix all of them (each is also listed in "diagnostics" with its path): ` +
        diagnostics
          .slice(0, SUMMARY_LIMIT)
          .map((d, i) => `(${i + 1}) ${d.message}`)
          .join(' ') +
        (diagnostics.length > SUMMARY_LIMIT ? ` (and ${diagnostics.length - SUMMARY_LIMIT} more in "diagnostics")` : '');
  throw new UmlError(first.code, message, 2, undefined, first.path, diagnostics);
}

/** Appends a JSON Pointer segment, escaping `~` and `/` as RFC 6901 requires. */
export function pointer(base: string, ...segments: (string | number)[]): string {
  return segments.reduce<string>((path, segment) => `${path}/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`, base);
}
