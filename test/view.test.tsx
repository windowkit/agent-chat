// <AgentChat> rendered headlessly — react-x11's harness runs an X server in
// this process — over the fake driver: a reply is drawn, an approval is
// answered from its buttons, a code action calls the app, and the app's
// renderers draw what they are keyed by.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { renderX11, cleanup, screen, userEvent, act } from 'react-x11/test';

import {
  AgentChat,
  copyCode,
  createAgentSession,
  defineTool,
  type CodeAction,
} from '../src/index.js';
import { AgentUnavailableError } from '../src/core/driver.js';
import { fakeDriver, scripted } from '../src/testing/index.js';
import { tool, until } from './helpers.js';

afterEach(cleanup);

// Text resolves through fc-match without fonts, which differs per machine;
// with them, every run lays text out the same.
const CANDIDATES: Array<[string, string]> = [
  [
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Monaco.ttf',
  ],
  [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  ],
];
const found = CANDIDATES.find(([a, b]) => existsSync(a) && existsSync(b));
const fonts = found
  ? { 'sans-serif': found[0], monospace: found[1] }
  : undefined;
const RETURN = 0xff0d;
const options = { width: 720, height: 560, ...(fonts ? { fonts } : {}) };

/** What `<Markdown>` drew: its text is in `<richtext>` runs, which the
 *  harness's text queries do not read. */
function richText(): string {
  return screen
    .all((n) => n.kind === 'richtext')
    .map(
      (n) =>
        (n as unknown as { props: { runs?: Array<{ text: string }> } }).props
          .runs ?? [],
    )
    .map((runs) => runs.map((r) => r.text).join(''))
    .join('\n');
}

test('a reply is drawn as it streams in, as markdown', async () => {
  const session = createAgentSession({
    agent: fakeDriver(
      scripted([{ type: 'say', text: 'Hello **there**', chunk: 5 }]),
    ),
  });
  await renderX11(<AgentChat session={session} header={false} />, options);
  await act(() => session.send('hi'));
  await until(() => session.snapshot.status === 'idle', 'the turn to end');
  await act();
  // the user's message is markdown too, so it is in <richtext> runs
  await until(() => richText().split('\n').includes('hi'), 'the user message');
  await until(
    () => richText().includes('Hello there'),
    'the reply to be drawn',
  );
  await session.close();
});

test('an approval is answered from the buttons on the tool card', async () => {
  const session = createAgentSession({
    agent: fakeDriver(
      scripted([
        {
          type: 'call',
          id: 't1',
          name: 'Bash',
          kind: 'execute',
          title: 'Run the tests',
          input: { command: 'npm test' },
          result: 'all good',
        },
      ]),
    ),
  });
  await renderX11(<AgentChat session={session} header={false} />, options);
  await act(() => session.send('test it'));
  const allow = await screen.findByRole('button', {
    name: 'Allow',
    exact: true,
  });
  assert.ok(await screen.findByText('Run the tests'));
  await userEvent.click(allow);
  await until(() => tool(session, 't1')?.state === 'done', 'the tool ran');
  await session.close();
});

test("a code action calls the app's function, never a shell", async () => {
  const ran: string[] = [];
  const run: CodeAction = {
    id: 'run',
    label: 'Run',
    when: (f) => f.lang === 'sh',
    run: (f) => {
      ran.push(f.text);
    },
  };
  const session = createAgentSession({
    agent: fakeDriver(
      scripted([{ type: 'say', text: 'Try:\n\n```sh\nmake test\n```\n' }]),
    ),
  });
  await renderX11(
    <AgentChat
      session={session}
      header={false}
      codeActions={[copyCode, run]}
    />,
    options,
  );
  await act(() => session.send('how do I test?'));
  await until(() => session.snapshot.status === 'idle', 'the turn to end');
  const button = await screen.findByRole('button', {
    name: 'Run',
    exact: true,
  });
  await userEvent.click(button);
  await until(() => ran.length === 1, 'the action to run');
  assert.deepEqual(ran, ['make test']);
  await session.close();
});

test("the app's fence renderer and a tool's own render draw what they are keyed by", async () => {
  const openTicket = defineTool({
    description: 'Open a ticket',
    parameters: z.object({ id: z.string() }),
    run: ({ id }) => ({ id, title: 'Crash on start' }),
    render: ({ output }) =>
      output ? <text>{`Ticket ${output.id}: ${output.title}`}</text> : null,
  });
  await renderX11(
    <AgentChat
      header={false}
      agent={fakeDriver(
        scripted([
          {
            type: 'call',
            id: 't',
            name: 'openTicket',
            input: { id: 'ACME-1' },
          },
          { type: 'say', text: '```chart\n{"bars":3}\n```' },
        ]),
      )}
      tools={{ openTicket }}
      fences={{
        chart: {
          render: (f) => <text>{`CHART ${f.text}`}</text>,
          describe: 'a chart',
        },
      }}
    />,
    options,
  );
  const composer = await screen.findByTestName('agent-chat-composer');
  await userEvent.type(composer, 'show me');
  await userEvent.key(0xff0d); // Return
  assert.ok(await screen.findByText('Ticket ACME-1: Crash on start'));
  assert.ok(await screen.findByText('CHART {"bars":3}'));
});

test('a harness that cannot run shows the fallback', async () => {
  await renderX11(
    <AgentChat
      agent={fakeDriver(scripted([]), {
        failStart: new AgentUnavailableError('no SDK'),
      })}
      fallback={(snap) => <text>{`Unavailable: ${snap.error}`}</text>}
    />,
    options,
  );
  const composer = await screen.findByTestName('agent-chat-composer');
  await userEvent.type(composer, 'hi');
  await userEvent.key(0xff0d);
  assert.ok(await screen.findByText('Unavailable: no SDK'));
});

test('what the user sent is drawn as markdown, not as its source', async () => {
  const session = createAgentSession({
    agent: fakeDriver(scripted([{ type: 'say', text: 'ok' }])),
  });
  await renderX11(<AgentChat session={session} header={false} />, options);
  await act(() =>
    session.send(
      'Please fix **this** in `Composer.tsx`:\n\n```ts\nlet x = 1\n```',
    ),
  );
  await until(() => session.snapshot.status === 'idle', 'the turn to end');
  await until(
    () => richText().includes('Please fix this in Composer.tsx'),
    'the markdown',
  );
  assert.equal(richText().includes('**'), false, 'the markers are gone');
  // the fence is a code block, its language in its header, in the bubble too
  assert.ok(screen.getByText('ts', { exact: true }));
  assert.ok(richText().includes('let x = 1'));
  await session.close();
});

test('the composer sends what was typed, and Enter inside a fence is a new line', async () => {
  const agent = fakeDriver(scripted([{ type: 'say', text: 'ok' }]));
  const session = createAgentSession({ agent });
  await renderX11(<AgentChat session={session} header={false} />, options);
  const composer = await screen.findByTestName('agent-chat-composer');
  await userEvent.type(composer, 'compute 2 * 3 over src/**/*.ts');
  await userEvent.key(RETURN);
  await until(() => agent.sent.length === 1, 'the first message');
  assert.equal(
    agent.sent[0]!.text,
    'compute 2 * 3 over src/**/*.ts',
    'nothing escaped',
  );
  await until(() => session.snapshot.status === 'idle');

  for (const line of ['```sh', 'ls -la']) {
    await userEvent.type(composer, line, { skipClick: true });
    await userEvent.key(RETURN);
  }
  await userEvent.type(composer, '```', { skipClick: true });
  assert.equal(agent.sent.length, 1, 'Enter inside the fence did not send');
  await userEvent.key(RETURN);
  await until(
    () => agent.sent.length === 2,
    'the fence, sent on its closing line',
  );
  assert.equal(agent.sent[1]!.text, '```sh\nls -la\n```');
  await session.close();
});

test('@ lists the files under the working directory and writes the choice as @path', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-chat-at-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'Composer.tsx'), '');
  writeFileSync(path.join(root, 'README.md'), '');
  const agent = fakeDriver(scripted([{ type: 'say', text: 'ok' }]));
  const session = createAgentSession({ agent, cwd: root });
  await renderX11(<AgentChat session={session} header={false} />, options);
  const composer = await screen.findByTestName('agent-chat-composer');
  await userEvent.type(composer, 'look at @compo');
  assert.ok(
    await screen.findByText('src/Composer.tsx'),
    'the list shows the file',
  );
  await userEvent.key(RETURN); // takes the row
  await userEvent.key(RETURN); // sends
  await until(() => agent.sent.length === 1, 'the message');
  assert.equal(agent.sent[0]!.text.trim(), 'look at @src/Composer.tsx');
  await session.close();
});
