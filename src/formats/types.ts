import { pointer, type Diagnostic } from '../core/errors.js';

/** The text formats a model can be exported to and imported from. */
export type FormatName = 'plantuml' | 'mermaid';
export const FORMATS: readonly FormatName[] = ['plantuml', 'mermaid'];

/**
 * Collects what an export cannot carry. Every construct of the model that the
 * target format cannot express is reported once, with the JSON Pointer of the
 * construct, as an EXPORT_LOSSY warning; the export still succeeds.
 */
export class Losses {
  readonly warnings: Diagnostic[] = [];
  constructor(private readonly format: FormatName) {}
  add(path: string, message: string): void {
    const text = `${this.format === 'plantuml' ? 'PlantUML' : 'Mermaid'} export: ${message}`;
    if (this.warnings.some(w => w.path === path && w.message === text)) return;
    this.warnings.push({ code: 'EXPORT_LOSSY', path, message: text });
  }
}

/** One meaningful source line: its 1-based number in the input and its text without indentation. */
export interface SourceLine { number: number; text: string }

/**
 * Collects every problem of an import, one diagnostic per offending line. The
 * path `/lines/<n>` names the 1-based source line; `details.line` repeats it and
 * `details.text` quotes the line.
 */
export class Problems {
  readonly list: Diagnostic[] = [];
  /** Valid in the source format, but it has no place in the model. */
  unsupported(line: SourceLine, message: string): void { this.add('UNSUPPORTED_SYNTAX', line, message); }
  /** Not understood at all, or contradicts an earlier line. */
  malformed(line: SourceLine, message: string): void { this.add('MALFORMED_LINE', line, message); }
  add(code: string, line: SourceLine, message: string): void {
    this.list.push({ code, path: pointer('/lines', line.number), message: `Line ${line.number}: ${message}`, details: { line: line.number, text: line.text } });
  }
}

/** The model and text of one kind in one format. Export is required; import is optional. */
export interface KindFormat<M = any> {
  readonly kind: string;
  /** Model (already validated) -> text in the format. Reports losses on `losses`. */
  export(model: M, losses: Losses): string;
  /** Source lines -> model document (validated by the caller). Reports problems on `problems`. */
  import?(lines: readonly SourceLine[], problems: Problems): Record<string, unknown>;
  /** How strongly the lines look like this kind (0: not at all). Import kinds only. */
  detect?(lines: readonly SourceLine[]): number;
}
