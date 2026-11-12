// The session over the fake driver: what an app sees of a turn, a tool that
// asks, the app's own tool, the policy and `onToolCall`, pause, stop and the
// queue, and a harness that cannot run here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { createAgentSession, describeRenderers } from '../src/core/session.js';
import { defineTool } from '../src/core/tools.js';
import { fakeDriver, scripted } from '../src/testing/index.js';
import { AgentUnavailableError } from '../src/core/driver.js';
import type { ToolPart } from '../src/core/types.js';
import { heldTurn, textOf, tool, until } from './helpers.js';

test('a reply streams into the transcript and the turn ends idle', async () => {
  const agent = fakeDriver(
    scripted([{ type: 'say', text: 'Hello there', chunk: 4 }]),
  );
  const session = createAgentSession({ agent });
  session.send('hi');
  assert.equal(session.snapshot.messages[0]!.role, 'user');
  await until(
    () =>
      session.snapshot.status === 'idle' &&
      session.snapshot.messages.length === 2,
  );
  assert.equal(textOf(session.snapshot), 'hi|Hello there');
  assert.equal(session.snapshot.messages[1]!.done, true);
  assert.equal(agent.sent[0]!.text, 'hi');
});

test('a tool the policy asks about waits for the user, then runs', async () => {
  const agent = fakeDriver(
    scripted([
      {
        type: 'call',
        id: 't1',
        name: 'Bash',
        kind: 'execute',
        input: { command: 'ls' },
        result: 'a.ts',
      },
      { type: 'say', text: 'done' },
    ]),
  );
  const session = createAgentSession({ agent });
  session.send('list');
  await until(
    () => tool(session, 't1')?.state === 'awaiting-approval',
    'approval',
  );
  assert.equal(session.snapshot.status, 'waiting');
  assert.deepEqual(
    tool(session, 't1')!.approval!.options.map((o) => o.id),
    ['allow-once', 'allow-session', 'deny'],
  );
  session.respond('t1', 'allow-once');
  await until(() => session.snapshot.status === 'idle', 'idle');
  assert.equal(tool(session, 't1')!.state, 'done');
  assert.deepEqual(tool(session, 't1')!.output, [
    { type: 'text', text: 'a.ts' },
  ]);
});

test('a denied tool is told why, and the turn goes on', async () => {
  const agent = fakeDriver(
    scripted([
      {
        type: 'call',
        id: 't1',
        name: 'Bash',
        kind: 'execute',
        input: { command: 'rm -rf /' },
      },
      { type: 'say', text: 'ok, I will not' },
    ]),
  );
  const session = createAgentSession({ agent });
  session.send('clean up');
  await until(() => tool(session, 't1')?.state === 'awaiting-approval');
  session.respond('t1', 'deny', 'not that');
  await until(() => session.snapshot.status === 'idle');
  assert.equal(tool(session, 't1')!.state, 'denied');
  assert.match(tool(session, 't1')!.error!, /not that/);
  assert.match(textOf(session.snapshot), /I will not/);
});

test('reads run without asking under the default policy; read-only denies an edit', async () => {
  const steps = [
    {
      type: 'call' as const,
      id: 'r',
      name: 'Read',
      kind: 'read' as const,
      input: {},
      result: 'x',
    },
    {
      type: 'call' as const,
      id: 'e',
      name: 'Edit',
      kind: 'edit' as const,
      input: {},
      result: 'y',
    },
  ];
  const session = createAgentSession({
    agent: fakeDriver(scripted(steps)),
    permissions: 'read-only',
  });
  session.send('go');
  await until(() => session.snapshot.status === 'idle');
  assert.equal(tool(session, 'r')!.state, 'done');
  assert.equal(tool(session, 'e')!.state, 'denied');
});

test("onToolCall decides ahead of the policy, and can change a call's arguments", async () => {
  const seen: string[] = [];
  const session = createAgentSession({
    agent: fakeDriver(
      scripted([
        {
          type: 'call',
          id: 'a',
          name: 'Bash',
          kind: 'execute',
          input: { command: 'make' },
          result: 'built',
        },
        { type: 'call', id: 'b', name: 'WebFetch', kind: 'fetch', input: {} },
      ]),
    ),
    onToolCall: (call) => {
      seen.push(call.label);
      if (call.label === 'Bash') return 'allow';
      return { deny: 'No network here.' };
    },
  });
  session.send('go');
  await until(() => session.snapshot.status === 'idle');
  assert.deepEqual(seen, ['Bash', 'WebFetch']);
  assert.equal(tool(session, 'a')!.state, 'done');
  assert.equal(tool(session, 'b')!.state, 'denied');
  assert.equal(tool(session, 'b')!.error, 'No network here.');
});

test("an app tool runs the app's function, and its card gets the value", async () => {
  const opened: string[] = [];
  const openTicket = defineTool({
    description: 'Open a ticket',
    parameters: z.object({ id: z.string() }),
    run: ({ id }, ctx) => {
      ctx.progress('opening');
      opened.push(id);
      return { id, title: 'Crash on start' };
    },
  });
  const session = createAgentSession({
    agent: fakeDriver(
      scripted([
        { type: 'call', id: 't', name: 'openTicket', input: { id: 'ACME-1' } },
      ]),
    ),
    tools: { openTicket },
  });
  session.send('open it');
  await until(() => session.snapshot.status === 'idle');
  assert.deepEqual(opened, ['ACME-1'], 'ran without asking: the app wrote it');
  const part = tool(session, 't')!;
  assert.equal(part.app, true);
  assert.equal(part.state, 'done');
  assert.deepEqual(part.output, [
    { type: 'value', value: { id: 'ACME-1', title: 'Crash on start' } },
  ]);
});

test('bad arguments go back to the model as a tool error, not a throw', async () => {
  const session = createAgentSession({
    agent: fakeDriver(
      scripted([{ type: 'call', id: 't', name: 'count', input: { n: 'x' } }]),
    ),
    tools: {
      count: defineTool({
        description: 'count',
        parameters: z.object({ n: z.number() }),
        run: ({ n }) => n + 1,
      }),
    },
  });
  session.send('go');
  await until(() => session.snapshot.status === 'idle');
  assert.equal(tool(session, 't')!.state, 'error');
  assert.match(tool(session, 't')!.error!, /Invalid arguments: n:/);
});

test('allow for the session is remembered for that tool', async () => {
  const call = (id: string) =>
    ({
      type: 'call',
      id,
      name: 'Bash',
      kind: 'execute',
      input: {},
      result: 'ok',
    }) as const;
  const session = createAgentSession({
    agent: fakeDriver(scripted([call('a'), call('b')])),
  });
  session.send('go');
  await until(() => tool(session, 'a')?.state === 'awaiting-approval');
  session.respond('a', 'allow-session');
  await until(() => session.snapshot.status === 'idle');
  assert.equal(tool(session, 'b')!.state, 'done', 'b never asked');
});

test('pause holds the next tool call at the gate until resume', async () => {
  const turn = heldTurn([
    {
      type: 'call',
      id: 'r',
      name: 'Read',
      kind: 'read',
      input: {},
      result: 'x',
    },
  ]);
  const session = createAgentSession({ agent: fakeDriver(() => turn.steps) });
  session.send('go');
  session.pause();
  turn.open();
  await until(
    () =>
      tool(session, 'r')?.state === 'awaiting-approval' ||
      session.snapshot.status === 'paused',
  );
  // a read would run unasked, but the session is paused: it is held
  await until(() => !!tool(session, 'r'));
  assert.notEqual(tool(session, 'r')!.state, 'done');
  session.resume();
  await until(() => session.snapshot.status === 'idle', 'idle after resume');
  assert.equal(tool(session, 'r')!.state, 'done');
});

test('a message sent mid-turn queues, and stop gives it back to the composer', async () => {
  const session = createAgentSession({
    agent: fakeDriver(scripted([{ type: 'wait', ms: 10_000 }])),
  });
  session.send('first');
  await until(() => session.snapshot.status === 'running');
  session.send('second');
  assert.equal(session.snapshot.messages.at(-1)!.queued, true);
  await session.stop();
  assert.equal(session.snapshot.status, 'idle');
  assert.equal(session.snapshot.restored, 'second');
  assert.equal(
    session.snapshot.messages.some((m) => m.queued),
    false,
    'the queued message left the transcript',
  );
  assert.equal(session.takeRestored(), 'second');
  assert.equal(session.snapshot.restored, undefined);
});

test('a queued message is sent when the turn ends', async () => {
  const first = heldTurn([{ type: 'say', text: 'one' }]);
  const agent = fakeDriver((_message, n) =>
    n === 0 ? first.steps : [{ type: 'say', text: 'two' }],
  );
  const session = createAgentSession({ agent });
  session.send('first');
  session.send('second');
  await until(() => agent.sent.length === 1, 'the first message');
  assert.equal(
    session.snapshot.messages.at(-1)!.queued,
    true,
    'the second waits for the first turn',
  );
  first.open();
  await until(
    () => agent.sent.length === 2 && session.snapshot.status === 'idle',
    'the second turn',
  );
  assert.deepEqual(
    agent.sent.map((m) => m.text),
    ['first', 'second'],
  );
  assert.match(textOf(session.snapshot), /first\|one\|second\|two/);
});

test('a question waits for its answer', async () => {
  const session = createAgentSession({
    agent: fakeDriver(
      scripted([
        {
          type: 'ask',
          id: 'q',
          questions: [
            {
              question: 'Which?',
              options: [{ label: 'A' }, { label: 'B' }],
              multiSelect: false,
            },
          ],
        },
        { type: 'say', text: 'thanks' },
      ]),
    ),
  });
  session.send('go');
  await until(() => session.snapshot.status === 'waiting');
  session.answer('q', { 'Which?': 'B' });
  await until(() => session.snapshot.status === 'idle');
  const q = session.snapshot.messages[1]!.parts.find(
    (p) => p.type === 'question',
  );
  assert.deepEqual(q && q.type === 'question' ? q.answers : null, {
    'Which?': 'B',
  });
});

test('a harness that cannot run here is unavailable, not an error', async () => {
  const session = createAgentSession({
    agent: fakeDriver(scripted([]), {
      failStart: new AgentUnavailableError('no SDK'),
    }),
  });
  session.send('hi');
  await until(() => session.snapshot.status === 'unavailable');
  assert.equal(session.snapshot.error, 'no SDK');
});

test('a fence or component with describe becomes an instruction line', () => {
  const lines = describeRenderers({
    fences: {
      chart: { render: () => null, describe: 'a Vega-Lite spec' },
      plain: () => null,
    },
    components: {
      Ticket: { component: () => null, describe: 'a ticket link' },
    },
  });
  assert.equal(lines.length, 3);
  assert.match(lines[1]!, /tagged `chart`.*Vega-Lite/);
  assert.match(lines[2]!, /<Ticket\/>.*ticket link/);
  assert.deepEqual(describeRenderers({ fences: { plain: () => null } }), []);
});

test('toMarkdown writes the transcript as it was said', async () => {
  const session = createAgentSession({
    agent: fakeDriver(scripted([{ type: 'say', text: '`2 * 3` is 6' }])),
  });
  session.send('what is 2 * 3?');
  await until(() => session.snapshot.status === 'idle');
  assert.equal(
    session.toMarkdown(),
    '**You:**\n\nwhat is 2 * 3?\n\n---\n\n`2 * 3` is 6',
  );
});

test("a second turn's tool call is its own card, though the driver reuses its id", async () => {
  // a driver's ids are unique within a turn, not across a session: the demo's
  // script names its calls, and every reply runs the same script
  const turn = [
    {
      type: 'call' as const,
      id: 'bash',
      name: 'Bash',
      kind: 'execute' as const,
      input: { command: 'npm test' },
      result: 'ok',
    },
  ];
  const session = createAgentSession({
    agent: fakeDriver(scripted(turn, turn)),
  });
  session.send('first');
  await until(() => session.snapshot.status === 'waiting');
  session.respond('bash', 'allow-once');
  await until(() => session.snapshot.status === 'idle');

  session.send('second');
  await until(
    () => session.snapshot.status === 'waiting',
    'the second approval',
  );
  const messages = () => session.snapshot.messages;
  const stateIn = (i: number) =>
    messages()[i]!.parts.find(
      (p): p is ToolPart => p.type === 'tool' && p.id === 'bash',
    )?.state;
  assert.equal(messages().length, 4);
  assert.equal(stateIn(1), 'done', 'the first turn keeps its card as it ended');
  assert.equal(
    stateIn(3),
    'awaiting-approval',
    'the approval is in the turn that asked',
  );
  session.respond('bash', 'allow-once');
  await until(() => session.snapshot.status === 'idle');
  assert.equal(stateIn(1), 'done');
  assert.equal(stateIn(3), 'done');
});

test('a message sent for another session says so, to the transcript and the driver', async () => {
  const agent = fakeDriver(scripted([{ type: 'say', text: 'noted' }]));
  const session = createAgentSession({ agent });
  const from = { kind: 'peer', id: 'writer', name: 'Writer' } as const;
  session.send({ text: 'The draft is ready.', from });
  await until(() => session.snapshot.status === 'idle');
  assert.deepEqual(agent.sent[0]!.from, from);
  assert.deepEqual(session.snapshot.messages[0]!.from, from);
  assert.equal(
    session.toMarkdown(),
    '**From Writer:**\n\nThe draft is ready.\n\n---\n\nnoted',
  );
});

test("stop gives back the user's queued text, and drops another session's", async () => {
  const session = createAgentSession({
    agent: fakeDriver(scripted([{ type: 'wait', ms: 10_000 }])),
  });
  session.send('first');
  await until(() => session.snapshot.status === 'running');
  session.send('mine');
  session.send({ text: 'theirs', from: { kind: 'peer', id: 'writer' } });
  await session.stop();
  assert.equal(session.snapshot.restored, 'mine');
  assert.equal(
    session.snapshot.messages.some((m) => m.queued),
    false,
  );
});

test('a message the harness took from elsewhere is drawn as theirs, and runs a turn', async () => {
  const agent = fakeDriver(scripted([{ type: 'say', text: 'on it' }]));
  const session = createAgentSession({ agent });
  await session.start();
  const seen: string[] = [session.snapshot.status];
  session.subscribe(() => {
    if (seen.at(-1) !== session.snapshot.status) {
      seen.push(session.snapshot.status);
    }
  });
  agent.receive('CI failed on main', { kind: 'channel', server: 'ci' });
  await until(
    () => session.snapshot.status === 'idle' && textOf(session.snapshot) !== '',
    'the turn it ran',
  );
  assert.deepEqual(seen, ['idle', 'running', 'idle']);
  const [message] = session.snapshot.messages;
  assert.equal(message!.role, 'user');
  assert.deepEqual(message!.from, { kind: 'channel', server: 'ci' });
  assert.equal(textOf(session.snapshot), 'CI failed on main|on it');
  assert.equal(agent.sent.length, 0, 'it arrived; nothing was sent');
});
