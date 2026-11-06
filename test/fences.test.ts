// Cutting a reply at its top-level fences.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitFences } from '../src/view/fences.js';

test('prose and fences alternate, with the language lowercased', () => {
  const s = splitFences(
    'Run this:\n\n```Bash title\nmake test\n```\n\nThen look.',
    false,
  );
  assert.deepEqual(s, [
    { type: 'prose', text: 'Run this:\n' },
    { type: 'fence', lang: 'bash', text: 'make test', partial: false },
    { type: 'prose', text: '\nThen look.' },
  ]);
});

test('an unclosed fence is partial while the reply streams, and closed after', () => {
  assert.deepEqual(splitFences('```js\nlet x', true), [
    { type: 'fence', lang: 'js', text: 'let x', partial: true },
  ]);
  assert.equal(
    (splitFences('```js\nlet x', false)[0] as { partial: boolean }).partial,
    false,
  );
});

test('a fence closes only on a marker of its own kind and at least its length', () => {
  const s = splitFences('~~~~\n```\nstill code\n~~~\n~~~~', false);
  assert.deepEqual(s, [
    { type: 'fence', lang: '', text: '```\nstill code\n~~~', partial: false },
  ]);
});

test('an indented fence stays in its list', () => {
  const md = '- step\n\n  ```sh\n  ls\n  ```';
  assert.deepEqual(splitFences(md, false), [{ type: 'prose', text: md }]);
});

test('a backtick fence whose info has a backtick is not a fence', () => {
  assert.deepEqual(splitFences('``` a`b\nx', false), [
    { type: 'prose', text: '``` a`b\nx' },
  ]);
});
