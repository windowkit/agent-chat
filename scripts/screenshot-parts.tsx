// One screenshot per part the chat draws beyond text and tool cards — the
// plan, the link cards, images, attachments, suggested replies — each
// rendered by its own component over the fake driver, headlessly, in the
// light scheme or the dark. For a PR's description; not committed.
//
//   npx tsx scripts/screenshot-parts.tsx <out-dir> [light|dark]

import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderX11, act, userEvent, screen } from 'react-x11/test';
import { PNG } from 'pngjs';

import { AgentChat, createAgentSession } from '../src/index.js';
import { fakeDriver, type FakeStep } from '../src/testing/index.js';

const out = process.argv[2] ?? 'screenshots';
const scheme = process.argv[3] === 'dark' ? 'dark' : 'light';
mkdirSync(out, { recursive: true });
const fonts = existsSync('/System/Library/Fonts/Supplemental/Arial.ttf')
  ? {
      'sans-serif': '/System/Library/Fonts/Supplemental/Arial.ttf',
      monospace: '/System/Library/Fonts/Monaco.ttf',
    }
  : undefined;

/** A picture to show: a gradient with a band across it. */
function picture(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const band = Math.abs(y - height / 2) < height / 10;
      png.data[i] = band ? 250 : Math.round(40 + (180 * x) / width);
      png.data[i + 1] = band ? 250 : Math.round(90 + (120 * y) / height);
      png.data[i + 2] = band ? 250 : 200;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const cwd = mkdtempSync(path.join(tmpdir(), 'agent-chat-shots-'));
writeFileSync(path.join(cwd, 'after.png'), picture(360, 200));
const screenshot = picture(320, 180).toString('base64');

interface Shot {
  name: string;
  height: number;
  prompt: string | { text: string; image: string };
  steps: FakeStep[];
  suggestion?: string;
  /** What to press once the turn is over. */
  press?: string;
}

const shots: Shot[] = [
  {
    name: 'plan',
    height: 260,
    prompt: 'Fix the flaky composer test',
    steps: [
      {
        type: 'plan',
        entries: [
          { text: 'Read the composer and its test', status: 'completed' },
          { text: 'Find why Stop loses the draft', status: 'in_progress' },
          { text: 'Fix it and run the suite', status: 'pending' },
          { text: 'Open a pull request', status: 'pending' },
        ],
      },
    ],
  },
  {
    name: 'pull-request',
    height: 220,
    prompt: 'Open a PR',
    steps: [
      { type: 'say', text: 'Opened the pull request.' },
      {
        type: 'data',
        id: 'b1:pr',
        name: 'pull-request',
        value: {
          number: 42,
          url: 'https://github.com/windowkit/agent-chat/pull/42',
          action: 'created',
        },
      },
    ],
  },
  {
    name: 'session',
    height: 220,
    prompt: 'Port the tests in the cloud',
    steps: [
      { type: 'say', text: 'Started a cloud session for it.' },
      {
        type: 'data',
        id: 'a1:session',
        name: 'session',
        value: {
          url: 'https://claude.ai/code/session_01ABCdef',
          title: 'Port the view tests to the new harness',
        },
      },
    ],
  },
  {
    name: 'artifact',
    height: 220,
    prompt: 'Publish the report',
    steps: [
      { type: 'say', text: 'Published it.' },
      {
        type: 'data',
        id: 'p1:artifact',
        name: 'artifact',
        value: {
          url: 'https://claude.ai/artifact/3f2a9c',
          title: 'Test run report',
          path: 'report.html',
        },
      },
    ],
  },
  {
    name: 'attachments',
    height: 500,
    prompt: 'Send me the screenshots',
    steps: [
      {
        type: 'data',
        id: 's1:files',
        name: 'attachments',
        value: {
          caption: 'The composer after the fix, and the notes',
          files: [
            { path: 'after.png', size: 18_432, isImage: true },
            { path: 'notes/fix.md', size: 1_536, isImage: false },
          ],
        },
      },
    ],
  },
  {
    name: 'tool-image',
    height: 420,
    prompt: 'What does the logo look like?',
    steps: [
      {
        type: 'call',
        id: 'r1',
        name: 'Read',
        kind: 'read',
        title: 'Read docs/img/logo.png',
        input: { file_path: 'docs/img/logo.png' },
        result: [
          {
            type: 'image',
            mime: 'image/png',
            data: screenshot,
            width: 320,
            height: 180,
          },
        ],
      },
    ],
    press: 'Read docs/img/logo.png',
  },
  {
    name: 'pasted-image',
    height: 440,
    prompt: { text: 'Why is this cut off? [Image #1]', image: screenshot },
    steps: [{ type: 'say', text: 'The transcript is 0 px high.' }],
  },
  {
    name: 'suggested-replies',
    height: 250,
    prompt: 'Fix it',
    steps: [{ type: 'say', text: 'Fixed, and the suite passes.' }],
    suggestion: 'Open a pull request for it',
  },
];

for (const shot of shots) {
  const driver = fakeDriver(() => shot.steps, { name: 'demo agent' });
  const session = createAgentSession({ agent: driver, cwd });
  const r = await renderX11(
    <window width={640} height={shot.height} title={shot.name}>
      <AgentChat session={session} header={false} onLink={() => {}} />
    </window>,
    {
      wrap: false,
      width: 640,
      height: shot.height,
      ...(fonts ? { fonts } : {}),
      colorScheme: scheme,
    } as never,
  );
  await act(() =>
    session.send(
      typeof shot.prompt === 'string'
        ? shot.prompt
        : {
            text: shot.prompt.text,
            attachments: [
              {
                kind: 'image',
                label: 'Image #1',
                mime: 'image/png',
                data: shot.prompt.image,
              },
            ],
          },
    ),
  );
  for (let i = 0; i < 400 && session.snapshot.status !== 'idle'; i++)
    await new Promise((res) => setTimeout(res, 5));
  if (shot.suggestion) {
    await act(() =>
      driver.host!.emit({ type: 'suggestion', text: shot.suggestion! }),
    );
  }
  await act();
  if (shot.press) await userEvent.click(await screen.findByText(shot.press));
  // a file decodes off the commit
  await new Promise((res) => setTimeout(res, 300));
  await act();
  const { width: w, height: h } = (r.windowNode as any).abs;
  const data: Uint8ClampedArray = await new Promise((res) =>
    (r.ctx as any).getImageData(0, 0, w, h, (_e: unknown, d: any) =>
      res(d.data ?? d),
    ),
  );
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(data);
  const file = path.join(out, `${shot.name}-${scheme}.png`);
  writeFileSync(file, PNG.sync.write(png));
  console.log('wrote', file);
  await session.close();
  await r.unmount();
}
process.exit(0);
