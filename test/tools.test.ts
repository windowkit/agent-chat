// The tool helpers every driver shares: validation, results, JSON Schema.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import {
  defineTool,
  jsonSchemaOf,
  normalizeResult,
  validateInput,
} from '../src/core/tools.js';
import {
  shapeFromJsonSchema,
  zodShapeOf,
} from '../src/drivers/claude/schema.js';

test('a zod schema validates, and its messages name the path', async () => {
  const p = z.object({ id: z.string(), n: z.number().optional() });
  assert.deepEqual(await validateInput(p, { id: 'a' }), {
    ok: true,
    value: { id: 'a' },
  });
  const bad = await validateInput(p, { id: 1 });
  assert.equal(bad.ok, false);
  assert.match(!bad.ok ? bad.message : '', /^Invalid arguments: id:/);
});

test('a JSON Schema checks its required keys', async () => {
  const p = {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  } as const;
  assert.equal((await validateInput(p, {})).ok, false);
  assert.equal((await validateInput(p, { id: 'x' })).ok, true);
});

test('a string is text, a value is JSON for the model and itself for the card', () => {
  assert.deepEqual(normalizeResult('hi').output, [
    { type: 'text', text: 'hi' },
  ]);
  const { result, output } = normalizeResult({ id: 7 });
  assert.equal(result.content[0]!.type, 'text');
  assert.deepEqual(result.structuredContent, { id: 7 });
  assert.deepEqual(output, [{ type: 'value', value: { id: 7 } }]);
  assert.deepEqual(normalizeResult(undefined).result.content, [
    { type: 'text', text: 'Done.' },
  ]);
  const mcp = {
    content: [{ type: 'text' as const, text: 'raw' }],
    isError: true,
  };
  assert.equal(normalizeResult(mcp).result, mcp);
});

test('defineTool types run from the schema', () => {
  const t = defineTool({
    description: 'x',
    parameters: z.object({ n: z.number() }),
    run: ({ n }) => n * 2,
  });
  // a type-level check: `n` is a number, so this compiles
  const doubled: number = t.run(
    { n: 2 },
    {
      signal: new AbortController().signal,
      callId: 'c',
      progress() {},
    },
  ) as number;
  assert.equal(doubled, 4);
});

test('a zod object hands its shape to the SDK; a JSON Schema becomes one', () => {
  const schema = z.object({ id: z.string() });
  assert.equal(zodShapeOf(schema), schema.shape);
  const shape = shapeFromJsonSchema(
    {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'the id' },
        tags: { type: 'array', items: { type: 'string' } },
        mode: { enum: ['a', 'b'] },
        n: { type: ['integer', 'null'] },
      },
    },
    z as never,
  );
  const parsed = z
    .object(shape as unknown as z.ZodRawShape)
    .safeParse({ id: 'x', mode: 'a', n: null });
  assert.equal(parsed.success, true);
  assert.equal(
    z
      .object(shape as unknown as z.ZodRawShape)
      .safeParse({ id: 'x', mode: 'c' }).success,
    false,
  );
});

test('jsonSchemaOf passes a JSON Schema through and asks zod for its own', () => {
  const plain = { type: 'object' as const, properties: {} };
  assert.equal(jsonSchemaOf(plain), plain);
  const fromZod = jsonSchemaOf(z.object({ id: z.string() }));
  assert.equal(fromZod.type, 'object');
});
