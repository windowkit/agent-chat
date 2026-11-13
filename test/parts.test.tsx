// The parts the Claude stream carries beyond text and tool cards, drawn by
// their default components over the fake driver: the plan, link cards,
// images and attachments, and suggested replies.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { renderX11, cleanup, screen, userEvent, act } from 'react-x11/test';

import { AgentChat, createAgentSession } from '../src/index.js';
import { fakeDriver, scripted, type FakeStep } from '../src/testing/index.js';
import { until } from './helpers.js';

afterEach(cleanup);

const fonts = existsSync('/System/Library/Fonts/Supplemental/Arial.ttf')
  ? {
      'sans-serif': '/System/Library/Fonts/Supplemental/Arial.ttf',
      monospace: '/System/Library/Fonts/Monaco.ttf',
    }
  : existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    ? {
        'sans-serif': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        monospace: '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
      }
    : undefined;
const options = { width: 720, height: 640, ...(fonts ? { fonts } : {}) };
const RETURN = 0xff0d;

/** A 1×1 PNG. */
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function images(): Array<{ src: unknown; alt?: string }> {
  return screen
    .all((n) => n.kind === 'image')
    .map(
      (n) => (n as unknown as { props: { src: unknown; alt?: string } }).props,
    );
}

async function run(steps: FakeStep[], view: Record<string, unknown> = {}) {
  const driver = fakeDriver(scripted(steps));
  const session = createAgentSession({ agent: driver, cwd: '/work' });
  await renderX11(
    <AgentChat session={session} header={false} {...view} />,
    options,
  );
  await act(() => session.send('go'));
  await until(() => session.snapshot.status === 'idle', 'the turn to end');
  await act();
  return { driver, session };
}

test('the plan is a checklist that says how far along it is', async () => {
  const { session } = await run([
    {
      type: 'plan',
      entries: [
        { text: 'Read the code', status: 'completed' },
        { text: 'Fix the bug', status: 'in_progress' },
        { text: 'Ship it', status: 'pending' },
      ],
    },
  ]);
  assert.ok(await screen.findByText('PLAN · 1 OF 3 DONE'));
  assert.ok(await screen.findByText('Fix the bug'));
  assert.ok(await screen.findByText('Ship it'));
  await session.close();
});

const links: FakeStep[] = [
  {
    type: 'data',
    id: 'b1:pr',
    name: 'pull-request',
    value: {
      number: 7,
      url: 'https://github.com/o/r/pull/7',
      action: 'created',
    },
  },
  {
    type: 'data',
    id: 'a1:session',
    name: 'session',
    value: { url: 'https://claude.ai/code/s1', title: 'Port the tests' },
  },
  {
    type: 'data',
    id: 'p1:artifact',
    name: 'artifact',
    value: {
      url: 'https://claude.ai/artifact/abc',
      title: 'Test report',
      path: 'report.html',
    },
  },
];

test('a pull request, a session and an artifact are cards that open through onLink', async () => {
  const opened: string[] = [];
  const { session } = await run(links, {
    onLink: (href: string) => opened.push(href),
  });
  assert.ok(await screen.findByText('#7'));
  assert.ok(await screen.findByText('Created · github.com/o/r/pull/7'));
  assert.ok(await screen.findByText('Port the tests'));
  assert.ok(await screen.findByText('Test report'));
  const open = screen.getAllByRole('button', { name: 'Open', exact: true });
  assert.equal(open.length, 3);
  for (const b of open) await userEvent.click(b);
  assert.deepEqual(opened, [
    'https://github.com/o/r/pull/7',
    'https://claude.ai/code/s1',
    'https://claude.ai/artifact/abc',
  ]);
  await session.close();
});

test('without onLink a link card has no button: nothing navigates by itself', async () => {
  const { session } = await run(links);
  assert.ok(await screen.findByText('#7'));
  assert.equal(
    screen.queryAllByRole('button', { name: 'Open', exact: true }).length,
    0,
  );
  await session.close();
});

test('an image a tool returned is drawn as one, at its size, in the card', async () => {
  const { session } = await run([
    {
      type: 'call',
      id: 'r1',
      name: 'Read',
      kind: 'read',
      title: 'Read logo.png',
      input: { file_path: 'logo.png' },
      result: [
        { type: 'image', mime: 'image/png', data: PIXEL, width: 1, height: 1 },
      ],
    },
  ]);
  assert.equal(images().length, 0, 'the card is closed');
  await userEvent.click(await screen.findByText('Read logo.png'));
  await until(() => images().length === 1, 'the image');
  const [img] = images();
  assert.ok(img!.src instanceof Uint8Array, 'the bytes, decoded from base64');
  assert.equal(Buffer.from(img!.src as Uint8Array).toString('base64'), PIXEL);
  assert.equal(screen.queryByText('[image, image/png]'), null);
  await session.close();
});

test("a pasted image is drawn in the user's message", async () => {
  const driver = fakeDriver(scripted([]));
  const session = createAgentSession({ agent: driver });
  await renderX11(<AgentChat session={session} header={false} />, options);
  await act(() =>
    session.send({
      text: 'what is this [Image #1]',
      attachments: [
        { kind: 'image', label: 'Image #1', mime: 'image/png', data: PIXEL },
      ],
    }),
  );
  await until(() => session.snapshot.status === 'idle', 'the turn to end');
  await act();
  await until(() => images().length === 1, 'the pasted image');
  assert.equal(images()[0]!.alt, 'Image #1');
  await session.close();
});

test('files the agent sent are an attachment card: images drawn, files opened through onLink', async () => {
  const opened: string[] = [];
  const { session } = await run(
    [
      {
        type: 'data',
        id: 's1:files',
        name: 'attachments',
        value: {
          caption: 'Before and after',
          files: [
            { path: 'shot.png', size: 2048, mime: 'image/png', isImage: true },
            { path: 'notes/plan.md', size: 1536, isImage: false },
          ],
        },
      },
    ],
    { onLink: (href: string) => opened.push(href) },
  );
  assert.ok(await screen.findByText('Before and after'));
  assert.ok(await screen.findByText('shot.png · 2 KB'));
  assert.ok(await screen.findByText('plan.md'));
  assert.ok(await screen.findByText('1.5 KB'));
  // the image is read from where the agent left it, under the cwd
  assert.deepEqual(
    images().map((i) => [i.src, i.alt]),
    [['/work/shot.png', 'shot.png']],
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Open', exact: true }),
  );
  assert.deepEqual(opened, ['file:///work/notes/plan.md']);
  await session.close();
});

test('a suggested reply is a chip that fills the composer and sends nothing', async () => {
  const { driver, session } = await run([{ type: 'say', text: 'Done.' }]);
  await act(() =>
    driver.host!.emit({ type: 'suggestion', text: 'Now run the tests' }),
  );
  const chip = await screen.findByRole('button', {
    name: 'Now run the tests',
    exact: true,
  });
  await userEvent.click(chip);
  await act();
  assert.equal(driver.sent.length, 1, 'pressing a chip sends nothing');
  // what was filled is what Enter sends, and sending drops the chips
  await userEvent.key(RETURN);
  await until(() => driver.sent.length === 2, 'the filled reply to be sent');
  assert.equal(driver.sent[1]!.text, 'Now run the tests');
  assert.deepEqual(session.snapshot.suggestions, []);
  await until(() => session.snapshot.status === 'idle', 'the second turn');
  await act();
  assert.equal(
    screen.queryAllByRole('button', { name: 'Now run the tests', exact: true })
      .length,
    0,
  );
  await session.close();
});
