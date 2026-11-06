// The transcript reducer: deltas accumulate, a finished block replaces what
// streamed, tools move through their states, subagents nest, and a stop
// settles whatever was open.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reduce } from '../src/core/reducer.js';
import type { AgentMessage, ToolPart } from '../src/core/types.js';

const user = (id: string, text: string, queued = false): AgentMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', id: `${id}:t`, text, streaming: false }],
  createdAt: 0,
  ...(queued ? { queued: true } : {}),
});

test('text deltas accumulate into one part, and a finished block replaces them', () => {
  let m = reduce(
    [user('u1', 'hi')],
    { type: 'text', id: 'a', delta: 'Hel' },
    1,
  );
  m = reduce(m, { type: 'text', id: 'a', delta: 'lo' }, 1);
  assert.equal(m.length, 2);
  assert.deepEqual(m[1]!.parts, [
    { type: 'text', id: 'a', text: 'Hello', streaming: true },
  ]);
  m = reduce(m, { type: 'text', id: 'a', text: 'Hello.', done: true }, 1);
  assert.deepEqual(m[1]!.parts, [
    { type: 'text', id: 'a', text: 'Hello.', streaming: false },
  ]);
});

test('a change touches only the message it is in', () => {
  const before = reduce(
    [user('u1', 'one')],
    { type: 'text', id: 'a', delta: 'x' },
    1,
  );
  const after = reduce(before, { type: 'text', id: 'a', delta: 'y' }, 1);
  assert.equal(after[0], before[0], 'the user message is the same object');
  assert.notEqual(after[1], before[1]);
});

test('a tool goes from streaming input to done, and its JSON parses as it arrives', () => {
  let m = reduce(
    [user('u1', 'go')],
    { type: 'tool-start', id: 't', name: 'Read' },
    1,
  );
  let t = m[1]!.parts[0] as ToolPart;
  assert.equal(t.state, 'input-streaming');
  m = reduce(m, { type: 'tool-input', id: 't', delta: '{"file_path":' }, 1);
  m = reduce(m, { type: 'tool-input', id: 't', delta: '"a.ts"}' }, 1);
  t = m[1]!.parts[0] as ToolPart;
  assert.deepEqual(t.input, { file_path: 'a.ts' });
  m = reduce(m, { type: 'tool-update', id: 't', progress: 'reading' }, 1);
  m = reduce(
    m,
    {
      type: 'tool-end',
      id: 't',
      state: 'done',
      output: [{ type: 'text', text: 'ok' }],
    },
    1,
  );
  t = m[1]!.parts[0] as ToolPart;
  assert.equal(t.state, 'done');
  assert.deepEqual(
    t.output,
    [{ type: 'text', text: 'ok' }],
    'the progress line is gone',
  );
});

test('approval is a state of the tool, cleared by the answer', () => {
  let m = reduce(
    [user('u1', 'go')],
    { type: 'tool-start', id: 't', name: 'Bash', input: { command: 'ls' } },
    1,
  );
  m = reduce(m, {
    type: 'approval',
    id: 't',
    options: [{ id: 'allow-once', label: 'Allow', kind: 'allow' }],
  });
  assert.equal((m[1]!.parts[0] as ToolPart).state, 'awaiting-approval');
  m = reduce(m, { type: 'approved', id: 't', allowed: false });
  const t = m[1]!.parts[0] as ToolPart;
  assert.equal(t.state, 'denied');
  assert.equal(t.approval, undefined);
});

test("a subagent's events nest under the tool call that runs it", () => {
  let m = reduce(
    [user('u1', 'go')],
    { type: 'tool-start', id: 'task', name: 'Agent', input: {} },
    1,
  );
  m = reduce(
    m,
    { type: 'text', id: 'inner', text: 'looking', done: true, parent: 'task' },
    1,
  );
  m = reduce(
    m,
    { type: 'tool-start', id: 'grep', name: 'Grep', parent: 'task' },
    1,
  );
  m = reduce(m, { type: 'tool-end', id: 'grep', state: 'done' }, 1);
  const task = m[1]!.parts[0] as ToolPart;
  assert.equal(m[1]!.parts.length, 1, 'nothing leaked into the outer message');
  assert.equal(task.children?.length, 1);
  assert.deepEqual(
    task.children![0]!.parts.map((p) => p.id),
    ['inner', 'grep'],
  );
  assert.equal((task.children![0]!.parts[1] as ToolPart).state, 'done');
});

test('a turn writes above a queued message, not below it', () => {
  let m = reduce(
    [user('u1', 'first')],
    { type: 'text', id: 'a', delta: 'x' },
    1,
  );
  m = reduce(m, { type: 'user', message: user('u2', 'second', true) });
  m = reduce(m, { type: 'text', id: 'a', delta: 'y' }, 1);
  assert.deepEqual(
    m.map((x) => x.id),
    ['u1', m[1]!.id, 'u2'],
  );
  assert.equal((m[1]!.parts[0] as { text: string }).text, 'xy');
});

test('one plan a turn, replaced in place', () => {
  let m = reduce([user('u1', 'go')], {
    type: 'plan',
    entries: [{ text: 'a', status: 'pending' }],
  });
  m = reduce(m, { type: 'text', id: 'x', text: 'working', done: true }, 1);
  m = reduce(m, {
    type: 'plan',
    entries: [{ text: 'a', status: 'completed' }],
  });
  const plans = m[1]!.parts.filter((p) => p.type === 'plan');
  assert.equal(plans.length, 1);
  assert.equal(m[1]!.parts[0]!.type, 'plan', 'it stays where it first was');
});

test('a stop settles streaming text, open tools and open questions', () => {
  let m = reduce([user('u1', 'go')], { type: 'text', id: 'a', delta: 'x' }, 1);
  m = reduce(m, { type: 'tool-start', id: 't', name: 'Bash', input: {} }, 1);
  m = reduce(m, {
    type: 'question',
    id: 'q',
    questions: [{ question: 'Which?', options: [], multiSelect: false }],
  });
  m = reduce(m, { type: 'stopped' });
  const [text, tool, question] = m[1]!.parts;
  assert.equal(m[1]!.done, true);
  assert.equal((text as { streaming: boolean }).streaming, false);
  assert.equal((tool as ToolPart).state, 'cancelled');
  assert.equal((question as { state: string }).state, 'cancelled');
});
