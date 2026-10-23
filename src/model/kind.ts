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
  /** May be async (e.g. to measure text for wrapping). Runs only after full validation. */
  toPlantUml(model: M): string | Promise<string>;
  /**
   * Optional fix-up of PlantUML's SVG where its drawing deviates from UML
   * notation. Runs before font embedding and the QA gates; it may only adjust
   * geometry and fixed theme styling, never introduce input text or markup.
   */
  postProcess?(svg: string, model: M): string;
  /**
   * The QA gates this backend's drawings are held to, when not all of them (a
   * best-effort fallback renderer). `uml render` warns only about these.
   */
  readonly gates?: readonly string[];
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the registry holds kinds of every model type; `unknown` would make their validate and render methods unassignable.
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
