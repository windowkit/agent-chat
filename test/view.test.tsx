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
import { useEffect, useState, type ReactElement } from 'react';
import { PNG } from 'pngjs';
import { z } from 'zod';
import {
  renderX11,
  cleanup,
  screen,
  userEvent,
  act,
  roleOf,
  textOf,
  waitFor,
  within,
} from 'react-x11/test';

import {
  AgentChat,
  attachFiles,
  attachImages,
  copyCode,
  createAgentSession,
  defineTool,
  type AttachSource,
  type Attachment,
  type CodeAction,
} from '../src/index.js';
import { HOVER_DELAY } from '../src/view/hover.js';
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

/** A fence drawn small, then grown after mount, as a diagram compiled after
 *  its first layout is: `grow()` lets it, once the turn has ended, so no
 *  later snapshot change scrolls the pane for it. */
const growers = new Set<() => void>();
const grow = () => growers.forEach((g) => g());
function Growing(): ReactElement {
  const [height, setHeight] = useState(20);
  useEffect(() => {
    const g = () => setHeight(900);
    growers.add(g);
    return () => void growers.delete(g);
  }, []);
  return (
    <box style={{ height }}>
      <text>diagram</text>
    </box>
  );
}

type Scroller = {
  abs: { y: number; height: number };
  scrollY: number;
  contentHeight: number;
};

/** A reply with a growing fence above a last line, in a short window. */
async function growingReply(prompt: string) {
  const session = createAgentSession({
    agent: fakeDriver(
      scripted([{ type: 'say', text: '```grow\nx\n```\n\n```tail\ny\n```\n' }]),
    ),
  });
  await renderX11(
    <AgentChat
      session={session}
      header={false}
      fences={{
        grow: { render: () => <Growing />, describe: 'a diagram' },
        tail: { render: () => <text>LAST LINE</text>, describe: 'the end' },
      }}
    />,
    { ...options, height: 300 },
  );
  await act(() => session.send(prompt));
  await until(() => session.snapshot.status === 'idle', 'the turn to end');
  const pane = (await screen.findByTestName(
    'agent-chat-transcript',
  )) as unknown as Scroller;
  const last = (await screen.findByText('LAST LINE')) as unknown as Scroller;
  const inView = () =>
    last.abs.y >= pane.abs.y &&
    last.abs.y + last.abs.height <= pane.abs.y + pane.abs.height;
  await act();
  assert.ok(inView(), 'in view before the fence grows');
  const grown = async () => {
    await act(grow);
    await until(() => pane.contentHeight > 900, 'the fence to grow');
    await act();
  };
  return { session, pane, inView, grown };
}

test('the transcript follows the end when a fence grows after it was laid out', async () => {
  const { session, inView, grown } = await growingReply('draw it');
  await grown();
  await until(inView, 'the last line to be in view');
  await session.close();
});

test('a reader who scrolled up stays where they are when a fence grows', async () => {
  const { session, pane, inView, grown } = await growingReply(
    Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n\n'),
  );
  await userEvent.wheel(pane as never, { deltaY: -2 });
  await act();
  const at = pane.scrollY;
  assert.ok(!inView(), 'scrolled away from the end');
  await grown();
  for (let i = 0; i < 5; i++) await act();
  assert.equal(pane.scrollY, at, 'not pulled back down');
  await session.close();
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

test('a thought with no text is not drawn, and one with text can be opened', async () => {
  const session = createAgentSession({
    agent: fakeDriver(
      scripted(
        [
          { type: 'say', text: '', reasoning: true },
          { type: 'say', text: 'first' },
        ],
        [
          { type: 'say', text: 'weighing the options', reasoning: true },
          { type: 'say', text: 'second' },
        ],
      ),
    ),
  });
  await renderX11(<AgentChat session={session} header={false} />, options);
  await act(() => session.send('one'));
  await until(() => session.snapshot.status === 'idle');
  await act();
  assert.equal(
    screen.queryByText('Thought', { exact: true }),
    null,
    'an empty thought is not drawn',
  );

  await act(() => session.send('two'));
  await until(() => session.snapshot.status === 'idle');
  const thought = await screen.findByText('Thought', { exact: true });
  assert.equal(
    screen.queryByText('weighing the options'),
    null,
    'closed until opened',
  );
  await userEvent.click(thought);
  assert.ok(await screen.findByText('weighing the options'));
  await session.close();
});

test("a message from another session is drawn as theirs: named, on the agent's side", async () => {
  const session = createAgentSession({
    agent: fakeDriver(scripted([{ type: 'say', text: 'thanks' }])),
  });
  await renderX11(<AgentChat session={session} header={false} />, options);
  await act(() =>
    session.send({
      text: 'The **draft** is ready.',
      from: { kind: 'peer', id: 'writer', name: 'Writer' },
    }),
  );
  await until(() => session.snapshot.status === 'idle', 'the turn to end');
  const label = await screen.findByText('Writer · another session');
  await until(
    () => richText().includes('The draft is ready.'),
    'its text, as markdown',
  );
  const x = (label as unknown as { abs: { x: number } }).abs.x;
  assert.ok(x < options.width / 4, `on the left, not the user's side: ${x}`);
  await session.close();
});

test('Send is a ghost icon inside the field, and sends what was typed', async () => {
  const agent = fakeDriver(scripted([{ type: 'say', text: 'ok' }]));
  const session = createAgentSession({ agent });
  await renderX11(<AgentChat session={session} header={false} />, options);
  const field = await screen.findByTestName('agent-chat-field');
  const composer = await screen.findByTestName('agent-chat-composer');
  await userEvent.type(composer, 'hello');
  const send = await iconButton('Send');
  assert.ok(within(field).all((n) => n === send).length, 'inside the border');
  await userEvent.click(send);
  await until(() => agent.sent.length === 1, 'the message');
  assert.equal(agent.sent[0]!.text, 'hello');
  await session.close();
});

test('"+" offers the sources that work here, and what one picks is sent with the text', async () => {
  const agent = fakeDriver(scripted([{ type: 'say', text: 'ok' }]));
  const session = createAgentSession({ agent });
  const shot: Attachment = {
    kind: 'image',
    label: 'canvas.png',
    mime: 'image/png',
    data: 'iVBORw0KGgo=',
  };
  const canvas: AttachSource = {
    id: 'canvas',
    label: 'Screenshot of the canvas',
    icon: 'image',
    pick: () => [shot],
  };
  await renderX11(
    <AgentChat
      session={session}
      header={false}
      composer={{ attach: [attachImages, canvas] }}
    />,
    options,
  );
  await session.start();
  await userEvent.click(await iconButton('Attach'));
  await screen.findByRole('menuitem', { name: 'Screenshot of the canvas' });
  assert.equal(
    screen.queryByRole('menuitem', { name: 'Images…' }),
    null,
    'no images for an agent that does not take them',
  );
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Screenshot of the canvas' }),
  );
  // a tile above the text, not a token in it
  const tile = await screen.findByTestName('agent-chat-attachment');
  assert.equal(labelOf(tile), 'canvas.png');
  const composer = await screen.findByTestName('agent-chat-composer');
  await userEvent.type(composer, 'what is this?', { skipClick: true });
  await userEvent.key(RETURN);
  await until(() => agent.sent.length === 1, 'the message');
  assert.deepEqual(agent.sent[0]!.attachments, [shot]);
  assert.equal(agent.sent[0]!.text, 'what is this?');
  await waitFor(() =>
    assert.equal(screen.queryByTestName('agent-chat-attachment'), null),
  );
  await session.close();
});

test('a tile in the tray can be removed before sending', async () => {
  const agent = fakeDriver(scripted([{ type: 'say', text: 'ok' }]));
  const session = createAgentSession({ agent });
  const note: AttachSource = {
    id: 'note',
    label: 'Notes',
    pick: () => [{ kind: 'file', label: 'notes.md', path: '/tmp/notes.md' }],
  };
  await renderX11(
    <AgentChat
      session={session}
      header={false}
      composer={{ attach: [note] }}
    />,
    options,
  );
  await userEvent.click(await iconButton('Attach'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Notes' }));
  const tile = await screen.findByTestName('agent-chat-attachment');
  await userEvent.hover(tile);
  const remove = await waitFor(() => {
    const [n] = within(tile).all((n) => labelOf(n) === 'Remove notes.md');
    assert.ok(n);
    return n;
  });
  await userEvent.click(remove);
  await waitFor(() =>
    assert.equal(screen.queryByTestName('agent-chat-attachment'), null),
  );
  await session.close();
});

test("a message's actions show once the pointer has rested on it", async () => {
  const session = createAgentSession({
    agent: fakeDriver(scripted([{ type: 'say', text: 'Hello' }])),
  });
  await renderX11(<AgentChat session={session} header={false} />, options);
  await act(() => session.send('hi'));
  await until(() => session.snapshot.status === 'idle', 'the turn to end');
  await act();
  const reply = await waitFor(() => {
    const [node] = screen.all(
      (n) => n.kind === 'richtext' && richTextOf(n) === 'Hello',
    );
    assert.ok(node);
    return node;
  });
  // the reply's row: the last message's
  const row = () => screen.getAllByTestName('agent-chat-actions').at(-1)!;
  const shown = () =>
    (row() as unknown as { props: { style: { visibility: string } } }).props
      .style.visibility === 'visible';
  const place = () => {
    const { x, y, width, height } = (row() as unknown as { abs: Rect }).abs;
    return { x, y, width, height };
  };
  assert.equal(shown(), false, 'hidden before a hover');
  assert.ok(
    within(row()).all((n) => labelOf(n) === 'Copy').length,
    'laid out while hidden',
  );
  const before = place();
  const at = Date.now();
  await userEvent.hover(reply);
  // passing over is not resting: nothing yet, unless this machine took the
  // whole delay to get here
  if (Date.now() - at < HOVER_DELAY) assert.equal(shown(), false);
  await waitFor(() => assert.equal(shown(), true), { timeout: 3000 });
  assert.deepEqual(place(), before, 'showing it moves nothing');
  await userEvent.unhover(reply);
  await waitFor(() => assert.equal(shown(), false));
  await session.close();
});

test('the header names the session, and the app hears each new name', async () => {
  const session = createAgentSession({
    agent: fakeDriver(scripted([])),
    title: 'Draft',
  });
  const names: string[] = [];
  await renderX11(
    <AgentChat session={session} onTitleChange={(t) => names.push(t)} />,
    options,
  );
  const title = await screen.findByTestName('agent-chat-title');
  assert.equal(textOf(title), 'Draft');
  await act(() => session.rename('The flaky test'));
  await waitFor(() =>
    assert.equal(
      textOf(screen.getByTestName('agent-chat-title')),
      'The flaky test',
    ),
  );
  assert.deepEqual(names, ['Draft', 'The flaky test']);
  await session.close();
});

function richTextOf(n: unknown): string {
  return ((n as { props: { runs?: Array<{ text: string }> } }).props.runs ?? [])
    .map((r) => r.text)
    .join('');
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function labelOf(n: unknown): unknown {
  return (n as { props: Record<string, unknown> }).props['aria-label'];
}

/** An icon button, by the name it is read out by: it has no text. */
function iconButton(label: string) {
  return waitFor(() => {
    const [node] = screen.all(
      (n) => roleOf(n) === 'button' && labelOf(n) === label,
    );
    assert.ok(node, `a button named ${label}`);
    return node;
  });
}

test('a pasted image leaves the text for the tray, and is sent as itself', async () => {
  const agent = fakeDriver(scripted([{ type: 'say', text: 'ok' }]));
  const session = createAgentSession({ agent });
  await renderX11(<AgentChat session={session} header={false} />, options);
  const composer = await screen.findByTestName('agent-chat-composer');
  await userEvent.type(composer, 'look');
  // what a paste of a screenshot puts in the document: an image atom
  const view = (composer as unknown as { props: { host: EditorViewLike } })
    .props.host;
  const dot = new PNG({ width: 1, height: 1 });
  const png = new Uint8Array(PNG.sync.write(dot));
  const atom = view.state.schema.nodes.attachment!.create({
    kind: 'image',
    id: null,
    label: 'Image #1',
    data: png,
  });
  await act(() => view.dispatch(view.state.tr.replaceSelectionWith(atom)));
  const tile = await screen.findByTestName('agent-chat-attachment');
  assert.equal(labelOf(tile), 'Image #1');
  await userEvent.key(RETURN);
  await until(() => agent.sent.length === 1, 'the message');
  assert.equal(agent.sent[0]!.text, 'look', 'no token left in the text');
  assert.deepEqual(agent.sent[0]!.attachments, [
    {
      kind: 'image',
      label: 'Image #1',
      mime: 'image/png',
      data: Buffer.from(png).toString('base64'),
    },
  ]);
  await session.close();
});

interface EditorViewLike {
  state: {
    schema: { nodes: Record<string, { create(attrs: object): unknown }> };
    tr: { replaceSelectionWith(node: unknown): unknown };
  };
  dispatch(tr: unknown): void;
}

test('"+" opened before the first message offers images once the agent says it takes them', async () => {
  const session = createAgentSession({
    agent: fakeDriver(scripted([]), { capabilities: { images: true } }),
  });
  await renderX11(<AgentChat session={session} header={false} />, options);
  assert.equal(session.snapshot.capabilities.images, false, 'not started yet');
  await userEvent.click(await iconButton('Attach'));
  await screen.findByRole('menuitem', { name: 'Images…' });
  await screen.findByRole('menuitem', { name: 'Files…' });
  await session.close();
});

test('Files… sends an image file as an image where the agent takes images, and the tray shows it', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-chat-files-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const png = path.join(dir, 'shot.png');
  writeFileSync(png, PNG.sync.write(new PNG({ width: 1, height: 1 })));
  const notes = path.join(dir, 'notes.md');
  writeFileSync(notes, '# notes');
  const openFile = async () => [png, notes];

  const seeing = createAgentSession({
    agent: fakeDriver(scripted([]), { capabilities: { images: true } }),
  });
  await seeing.start();
  const picked = await attachFiles.pick({ session: seeing, openFile });
  assert.deepEqual(
    picked?.map((a) => [a.kind, a.label, a.mime ?? null]),
    [
      ['image', 'shot.png', 'image/png'],
      ['file', 'notes.md', null],
    ],
  );
  await seeing.close();

  const blind = createAgentSession({ agent: fakeDriver(scripted([])) });
  await blind.start();
  const asPaths = await attachFiles.pick({ session: blind, openFile });
  assert.deepEqual(
    asPaths?.map((a) => [a.kind, a.path]),
    [
      ['file', png],
      ['file', notes],
    ],
    'an agent that cannot see images is given the path',
  );

  // and an image sent by its path is still drawn as its picture
  const source: AttachSource = { id: 'p', label: 'Pick', pick: () => asPaths };
  await renderX11(
    <AgentChat
      session={blind}
      header={false}
      composer={{ attach: [source] }}
    />,
    options,
  );
  await userEvent.click(await iconButton('Attach'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Pick' }));
  const [tile] = await waitFor(() => {
    const tiles = screen.getAllByTestName('agent-chat-attachment');
    assert.equal(tiles.length, 2);
    return tiles;
  });
  assert.equal(
    within(tile!).all((n) => n.kind === 'image').length,
    1,
    'a picture, not a file icon',
  );
  await blind.close();
});
