// A tool's parameters as the zod shape the SDK's `tool()` takes.
//
// A zod object is handed over by its `shape`. A JSON Schema is translated:
// the subset tool arguments use — objects, strings, numbers, integers,
// booleans, arrays, enums, constants, nullable unions — with `description`
// carried, and anything else as `unknown`, which the model still sees the
// description of and the tool's own validation still checks.

import { isStandardSchema, type ToolParameters } from '../../core/tools.js';
import type { ZodLike, ZodTypeLike } from './sdk.js';

export function zodShapeOf(
  parameters: ToolParameters,
): Record<string, unknown> | null {
  if (isStandardSchema(parameters)) {
    const shape = (parameters as { shape?: unknown }).shape;
    if (shape && typeof shape === 'object')
      return shape as Record<string, unknown>;
    return null;
  }
  return null;
}

export function shapeFromJsonSchema(
  schema: Record<string, unknown>,
  z: ZodLike,
): Record<string, ZodTypeLike> {
  const properties = (schema.properties ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  const shape: Record<string, ZodTypeLike> = {};
  for (const [key, prop] of Object.entries(properties)) {
    const type = typeOf(prop, z);
    shape[key] = required.has(key) ? type : type.optional();
  }
  return shape;
}

function typeOf(schema: Record<string, unknown>, z: ZodLike): ZodTypeLike {
  let t = baseType(schema, z);
  if (typeof schema.description === 'string')
    t = t.describe(schema.description);
  return t;
}

function baseType(schema: Record<string, unknown>, z: ZodLike): ZodTypeLike {
  if (
    Array.isArray(schema.enum) &&
    schema.enum.every((v) => typeof v === 'string')
  ) {
    const values = schema.enum as string[];
    if (values.length) return z.enum(values as [string, ...string[]]);
  }
  if ('const' in schema) {
    const v = schema.const;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      return z.literal(v as string | number | boolean | null);
    }
  }
  const types = Array.isArray(schema.type)
    ? (schema.type as string[])
    : [schema.type];
  const nonNull = types.filter((t) => t !== 'null');
  const nullable = nonNull.length < types.length;
  const one =
    nonNull.length === 1 ? single(nonNull[0], schema, z) : z.unknown();
  return nullable ? z.union([one, z.null()]) : one;
}

function single(
  type: unknown,
  schema: Record<string, unknown>,
  z: ZodLike,
): ZodTypeLike {
  switch (type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(
        schema.items && typeof schema.items === 'object'
          ? typeOf(schema.items as Record<string, unknown>, z)
          : z.unknown(),
      );
    case 'object':
      return schema.properties
        ? z.object(shapeFromJsonSchema(schema, z))
        : z.record(z.string(), z.unknown());
    default:
      return z.unknown();
  }
}
