// The app's own tools: a function and the shape of its arguments.
//
// Getting the function to the agent is the driver's business — in-process
// for Claude, a dynamic tool for Codex, an MCP bridge for an ACP agent — so
// nothing here knows about MCP beyond the result shape every one of those
// ends in. What is here is the part every driver shares: validating the
// arguments before `run` sees them, and turning whatever `run` returned into
// something a model can read and a renderer can draw.

import type { Part, ToolKind, ToolOutput } from './types.js';

/**
 * A Standard Schema (https://standardschema.dev): zod 3.24+ and 4, valibot,
 * arktype. Written out structurally so nothing here imports a schema library.
 */
export interface StandardSchemaLike<Output = unknown> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: unknown; readonly output: Output };
  };
}

type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | {
      readonly issues: ReadonlyArray<{
        readonly message: string;
        readonly path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
      }>;
    };

/** A JSON Schema for an object: what every harness ends up sending. */
export interface JsonObjectSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: readonly string[];
  [key: string]: unknown;
}

/** A tool's arguments: a Standard Schema object (zod's `z.object`), or a
 *  JSON Schema. */
export type ToolParameters = StandardSchemaLike | JsonObjectSchema;

/** The arguments `run` is handed, inferred from `parameters` where it can be. */
export type InferInput<P> =
  P extends StandardSchemaLike<infer O> ? O : Record<string, unknown>;

export interface ToolContext {
  /** Aborted when the user stops the turn. */
  signal: AbortSignal;
  /** The tool call's id, as the transcript knows it. */
  callId: string;
  /** A line shown on the tool's card while it runs. */
  progress(text: string): void;
}

/** What a tool's `render` is handed: its part, and the value `run`
 *  returned, once it has. */
export interface ToolRenderInfo<I = unknown, O = unknown> {
  part: Extract<Part, { type: 'tool' }>;
  input: I | undefined;
  output: O | undefined;
}

export interface ToolDef<I = any, O = unknown, R = unknown> {
  /** What the model reads to decide when to call it. */
  description: string;
  parameters: ToolParameters;
  run(input: I, ctx: ToolContext): O | Promise<O>;
  /** Ask the user before every call. Default false: the app wrote it. */
  ask?: boolean;
  /** One line for the tool's card. Default: the tool's name. */
  title?: (input: I) => string;
  /** Default `'other'`. */
  kind?: ToolKind;
  /** Draws the call. The view's `defineTool` types this as a `ReactNode`. */
  render?: (info: ToolRenderInfo<I, O>) => R;
}

/** Any tool, whatever its arguments and result: what a map of tools holds.
 *  (`ToolDef<unknown, unknown>` would refuse a tool whose `render` takes its
 *  own result type.) */
export type AnyToolDef = ToolDef<any, any, any>;

/** An identity, for inference: `run`'s argument is typed from `parameters`. */
export function defineTool<P extends ToolParameters, O, R = unknown>(
  def: ToolDef<InferInput<P>, O, R> & { parameters: P },
): ToolDef<InferInput<P>, O, R> {
  return def;
}

/** The shape every driver sends back: MCP's `CallToolResult`. */
export interface ToolResult {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

export function isStandardSchema(p: unknown): p is StandardSchemaLike {
  return (
    !!p &&
    (typeof p === 'object' || typeof p === 'function') &&
    '~standard' in (p as object)
  );
}

/**
 * Validate a call's arguments. Answers the value `run` should see, or the
 * message the model should: a bad argument is a tool error the model can
 * correct, never a throw in the app.
 */
export async function validateInput(
  parameters: ToolParameters,
  input: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  if (isStandardSchema(parameters)) {
    const result = await parameters['~standard'].validate(input);
    if (result.issues) {
      const lines = result.issues.map((issue) => {
        const path = (issue.path ?? [])
          .map((k) => String(typeof k === 'object' ? k.key : k))
          .join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });
      return { ok: false, message: `Invalid arguments: ${lines.join('; ')}` };
    }
    return { ok: true, value: result.value };
  }
  // A JSON Schema is the harness's to enforce; the required keys are cheap
  // to check here, and a model that left one out deserves a clear answer.
  const missing = (parameters.required ?? []).filter(
    (key) => !input || typeof input !== 'object' || !(key in (input as object)),
  );
  if (missing.length) {
    return {
      ok: false,
      message: `Invalid arguments: missing ${missing.join(', ')}`,
    };
  }
  return { ok: true, value: input };
}

/**
 * Whatever `run` returned, as a result for the model and outputs for the
 * card. A string is text; `undefined` is a bare "Done."; an MCP result is
 * passed through; anything else is sent as JSON and kept as a `value`
 * output, so the tool's `render` gets the object itself.
 */
export function normalizeResult(returned: unknown): {
  result: ToolResult;
  output: ToolOutput[];
} {
  if (typeof returned === 'string') {
    return {
      result: { content: [{ type: 'text', text: returned }] },
      output: [{ type: 'text', text: returned }],
    };
  }
  if (returned === undefined || returned === null) {
    return {
      result: { content: [{ type: 'text', text: 'Done.' }] },
      output: [],
    };
  }
  if (isToolResult(returned)) {
    return { result: returned, output: outputsOf(returned) };
  }
  const text = safeJson(returned);
  const structured =
    typeof returned === 'object' && !Array.isArray(returned)
      ? (returned as Record<string, unknown>)
      : undefined;
  return {
    result: {
      content: [{ type: 'text', text }],
      ...(structured ? { structuredContent: structured } : {}),
    },
    output: [{ type: 'value', value: returned }],
  };
}

/** A thrown error, as a result the model sees. The turn goes on. */
export function errorResult(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: message }], isError: true };
}

function isToolResult(value: unknown): value is ToolResult {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as { content?: unknown }).content) &&
    (value as { content: unknown[] }).content.every(
      (c) => !!c && typeof c === 'object' && 'type' in (c as object),
    )
  );
}

function outputsOf(result: ToolResult): ToolOutput[] {
  return result.content.map((c) =>
    c.type === 'image'
      ? { type: 'image', mime: c.mimeType, data: c.data }
      : { type: 'text', text: c.text },
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** A JSON Schema for any `ToolParameters`, for drivers that send one. */
export function jsonSchemaOf(parameters: ToolParameters): JsonObjectSchema {
  if (!isStandardSchema(parameters)) return parameters;
  // zod 4 answers `toJSONSchema()` on the schema itself; a library that does
  // not leaves the model a bare object, and validation still holds.
  const own = (parameters as { toJSONSchema?: () => unknown }).toJSONSchema;
  if (typeof own === 'function') {
    const schema = own.call(parameters) as JsonObjectSchema;
    if (schema && schema.type === 'object') return schema;
  }
  return { type: 'object' };
}
