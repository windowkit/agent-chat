// JSON that has not finished arriving: what a tool's `render` is handed while
// the model writes its arguments.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePartialJson } from '../src/core/partial-json.js';

test('complete text is what JSON.parse makes of it', () => {
  for (const text of [
    '{"a":1,"b":[true,false,null],"c":{"d":"e\\n\\u00e9"}}',
    '[]',
    '{}',
    '12',
    '-0.5e3',
    '"s"',
    ' { "spaced" : [ 1 , 2 ] } ',
  ]) {
    assert.deepEqual(parsePartialJson(text), JSON.parse(text), text);
  }
});

test('an object keeps its members so far, the last as far as it has got', () => {
  const cases: Array<[string, unknown]> = [
    ['{', {}],
    ['{"ti', {}],
    ['{"title"', {}],
    ['{"title":', {}],
    ['{"title":"Reve', { title: 'Reve' }],
    ['{"title":"Revenue","sub', { title: 'Revenue' }],
    ['{"a":{"b":"c', { a: { b: 'c' } }],
    ['{"ok":tr', {}],
    ['{"ok":true', { ok: true }],
    ['{"s":"a\\', { s: 'a' }],
    ['{"s":"\\u00e', { s: '' }],
    ['{"s":"\\u00e9', { s: 'é' }],
  ];
  for (const [text, value] of cases) {
    assert.deepEqual(parsePartialJson(text), value, text);
  }
});

test('a number at the very end is left out: its digits may go on', () => {
  assert.deepEqual(parsePartialJson('{"n":33'), {});
  assert.deepEqual(parsePartialJson('{"n":33,'), { n: 33 });
  assert.deepEqual(parsePartialJson('{"n":-'), {});
  assert.deepEqual(parsePartialJson('{"n":1.'), {});
  assert.deepEqual(parsePartialJson('{"n":2e+'), {});
});

test('an array keeps only its finished items: never half a row', () => {
  assert.deepEqual(parsePartialJson('[1,2'), [1]);
  assert.deepEqual(parsePartialJson('[1,2,'), [1, 2]);
  assert.deepEqual(parsePartialJson('["a","b'), ['a']);
  assert.deepEqual(
    parsePartialJson('{"rows":[{"m":"Jan","v":1},{"m":"Feb","v'),
    { rows: [{ m: 'Jan', v: 1 }] },
  );
  assert.deepEqual(parsePartialJson('{"rows":[{"m":"Jan","v":1}'), {
    rows: [{ m: 'Jan', v: 1 }],
  });
});

test('text that is wrong, not short, is undefined', () => {
  for (const text of [
    '',
    '   ',
    'nope',
    '{a:1}',
    '{"a":1,}',
    '[1,]',
    '{"a":01',
    '{"a" 1}',
    '{"a":1}x',
    '{"s":"\\q"}',
  ]) {
    assert.equal(parsePartialJson(text), undefined, text);
  }
});

test('"__proto__" is an own member, as JSON.parse makes it', () => {
  const value = parsePartialJson('{"__proto__":{"x":1},"y":"z') as Record<
    string,
    unknown
  >;
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.deepEqual(Object.keys(value), ['__proto__', 'y']);
  assert.equal((value as { x?: unknown }).x, undefined);
});

test('every prefix of a spec parses, and its elements only ever grow', () => {
  const spec = JSON.stringify({
    root: 'q3',
    elements: {
      q3: { type: 'Stack', props: { gap: 12 }, children: ['m', 'c'] },
      m: { type: 'Metric', props: { label: 'Revenue', value: '$1.27M' } },
      c: {
        type: 'BarChart',
        props: {
          x: 'month',
          series: [{ key: 'v' }],
          data: [
            { month: 'Jul', v: 318.5 },
            { month: 'Aug', v: -3e2 },
          ],
        },
      },
    },
  });
  let keys = 0;
  let rows = 0;
  for (let n = 1; n <= spec.length; n++) {
    const value = parsePartialJson(spec.slice(0, n)) as {
      elements?: Record<string, { props?: { data?: unknown[] } }>;
    };
    assert.equal(typeof value, 'object', spec.slice(0, n));
    const k = Object.keys(value.elements ?? {}).length;
    const r = value.elements?.c?.props?.data?.length ?? 0;
    assert.ok(k >= keys && r >= rows, `shrank at ${spec.slice(0, n)}`);
    keys = k;
    rows = r;
  }
  assert.deepEqual(parsePartialJson(spec), JSON.parse(spec));
});
