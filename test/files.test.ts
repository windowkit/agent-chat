// The composer's `@` list: which files a walk finds, and how a query ranks
// them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { listFiles, matchFiles } from '../src/view/files.js';
import { sentTexts } from '../src/view/Composer.js';

test('a walk lists files near the root first, and skips dependencies and VCS data', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-chat-files-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['src/view', 'node_modules/react', '.git/objects']) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  for (const file of [
    'README.md',
    'src/index.ts',
    'src/view/Composer.tsx',
    'node_modules/react/index.js',
    '.git/objects/ab',
  ]) {
    writeFileSync(path.join(root, file), '');
  }
  assert.deepEqual(await listFiles(root), [
    'README.md',
    'src/index.ts',
    'src/view/Composer.tsx',
  ]);
});

test('a query ranks a name that starts with it over one that only holds it', () => {
  const files = [
    'docs/composer-notes.md',
    'src/view/Composer.tsx',
    'test/view.test.tsx',
    'src/core/session.ts',
  ];
  assert.deepEqual(matchFiles(files, 'comp'), [
    'src/view/Composer.tsx',
    'docs/composer-notes.md',
  ]);
  assert.deepEqual(
    matchFiles(files, 'vtt'),
    ['test/view.test.tsx'],
    'in order',
  );
  assert.deepEqual(matchFiles(files, '', 2), files.slice(0, 2));
});

test('recall is what was sent, oldest first, without what is still queued', () => {
  const user = (id: string, text: string, queued = false) => ({
    id,
    role: 'user' as const,
    parts: [{ type: 'text' as const, id: `${id}:t`, text, streaming: false }],
    createdAt: 0,
    ...(queued ? { queued: true } : {}),
  });
  assert.deepEqual(
    sentTexts([
      user('a', 'one'),
      user('b', 'two'),
      user('c', 'two'),
      user('d', 'later', true),
    ]),
    ['one', 'two'],
  );
});
