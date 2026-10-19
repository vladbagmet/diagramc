import type { Diagnostic } from '../core/errors.js';

/** A JSON Schema object (draft-07). */
export type JsonSchema = Record<string, unknown>;

/** Draws a validated model with the own engine (elkjs layout + SVG writer). Must not spawn processes. */
export interface EngineBackend<M> {
  readonly name: 'engine';
  render(model: M): Promise<string>;
}

/**
 * Draws a validated model with PlantUML. `toPlantUml` must encode every display
 * string with `displayText()` from src/plantuml/encode.ts and start from
 * `plantUmlPreamble()` from src/plantuml/skin.ts.
 */
export interface PlantUmlBackend<M> {
  readonly name: 'plantuml';
  /** Value PlantUML writes to `data-diagram-type` on the root <svg>, e.g. "CLASS" or "SEQUENCE". */
  readonly diagramType: string;
  toPlantUml(model: M): string;
}

export type Backend<M> = EngineBackend<M> | PlantUmlBackend<M>;

/** Support for an older document format that predates the `kind` envelope. */
export interface LegacyFormat<M> {
  /** True when an envelope-less document is in this legacy format. */
  detect(value: Record<string, unknown>): boolean;
  readonly schema: JsonSchema;
  /** Converts a schema-valid legacy document to the current model. */
  upgrade(value: unknown): M;
  /** Maps a JSON Pointer in the upgraded model back to the legacy document. */
  mapPath(path: string): string;
}

/**
 * Everything the CLI needs to know about one diagram kind. A kind lives in
 * src/kinds/<kind>/ and is registered with one line in src/model/registry.ts.
 */
export interface KindDefinition<M = any> {
  /** Value of the `kind` property, lowercase, e.g. "class" or "state-machine". */
  readonly kind: string;
  /** Human title, e.g. "Class diagram". */
  readonly title: string;
  /** One sentence for `uml kinds`. */
  readonly summary: string;
  /** Keyword in the UML diagram frame heading (UML 2.5.1 Annex A), e.g. "class" or "sd". */
  readonly frameKeyword: string;
  /** Full JSON Schema of a document of this kind, envelope included. Build it with `kindSchema()`. */
  readonly schema: JsonSchema;
  /** Semantic rules JSON Schema cannot express. Runs only after the schema passed. Must not throw. */
  validate(model: M): Diagnostic[];
  /** Renderers; the first is the default. */
  readonly backends: readonly Backend<M>[];
  readonly legacy?: LegacyFormat<M>;
}
