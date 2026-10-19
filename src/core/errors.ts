export class UmlError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly exitCode = 2,
    public readonly details?: unknown,
  ) { super(message); }
}
