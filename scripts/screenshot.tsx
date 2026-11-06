// The README's screenshots: the demo flow rendered headlessly — react-x11's
// in-process X server — in both colour schemes, read back and written as
// PNGs. No display needed.
//
//   npm run screenshots        # writes docs/img/chat-light.png and chat-dark.png

import { writeFileSync, existsSync } from 'node:fs';
import { renderX11, act, screen, userEvent } from 'react-x11/test';
import { PNG } from 'pngjs';
import { z } from 'zod';
import {
  AgentChat,
  copyCode,
  createAgentSession,
  defineTool,
  type CodeAction,
} from '../src/index.js';
import { fakeDriver, type FakeStep } from '../src/testing/index.js';

const fonts = existsSync('/System/Library/Fonts/Supplemental/Arial.ttf')
  ? {
      'sans-serif': '/System/Library/Fonts/Supplemental/Arial.ttf',
      monospace: '/System/Library/Fonts/Monaco.ttf',
    }
  : undefined;
const openTicket = defineTool({
  description: 'Open a ticket',
  parameters: z.object({ id: z.string(), title: z.string() }),
  title: ({ id }) => `Open ticket ${id}`,
  run: ({ id, title }) => ({ id, title, status: 'open' }),
  render: ({ output }) =>
    output ? (
      <box style={{ flexDirection: 'row', gap: 8 }}>
        <text style={{ fontWeight: 'bold' }}>{output.id}</text>
        <text>{output.title}</text>
      </box>
    ) : null,
});
const steps: FakeStep[] = [
  {
    type: 'plan',
    entries: [
      { text: 'Look at the failing test', status: 'completed' },
      { text: 'Run the suite', status: 'in_progress' },
      { text: 'Open a ticket', status: 'pending' },
    ],
  },
  {
    type: 'say',
    text: 'Let me run the tests first. This needs your **approval**, since it runs a command.',
  },
  {
    type: 'call',
    id: 'ticket',
    name: 'openTicket',
    input: { id: 'ACME-42', title: 'Composer loses its draft on Stop' },
  },
  {
    type: 'say',
    text: 'I opened **ACME-42**. To reproduce:\n\n```sh\nnpm test -- --test-name-pattern="keeps a draft"\n```\n\nThen check `src/view/Composer.tsx`.',
  },
  {
    type: 'call',
    id: 'bash',
    name: 'Bash',
    kind: 'execute',
    title: 'Run the test suite',
    input: { command: 'npm test' },
    result: 'ok',
  },
];
const run: CodeAction = {
  id: 'run',
  label: 'Run',
  when: (f) => f.lang === 'sh',
  run: () => {},
};
async function shot(scheme: 'light' | 'dark', out: string): Promise<void> {
  const session = createAgentSession({
    agent: fakeDriver(() => steps, { name: 'demo agent' }),
    tools: { openTicket },
  });
  const r = await renderX11(
    <window width={720} height={760} title="demo">
      <AgentChat session={session} codeActions={[copyCode, run]} />
    </window>,
    {
      wrap: false,
      width: 720,
      height: 760,
      ...(fonts ? { fonts } : {}),
      colorScheme: scheme,
    } as never,
  );
  await act(() =>
    session.send(
      'Why does the **composer** test fail? It lives in `src/view/Composer.tsx`.',
    ),
  );
  for (let i = 0; i < 400 && session.snapshot.status !== 'waiting'; i++)
    await new Promise((res) => setTimeout(res, 5));
  await act();
  // a draft in the composer, to show markdown drawn as it is typed
  await userEvent.type(
    screen.getByTestName('agent-chat-composer'),
    'Also: why does **Stop** lose the draft in `Composer.tsx`?',
  );
  await new Promise((res) => setTimeout(res, 800));
  await act();
  const { width: w, height: h } = (r.windowNode as any).abs;
  const data: Uint8ClampedArray = await new Promise((res) =>
    (r.ctx as any).getImageData(0, 0, w, h, (_e: unknown, d: any) =>
      res(d.data ?? d),
    ),
  );
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(data);
  writeFileSync(out, PNG.sync.write(png));
  console.log('wrote', out);
  await r.unmount();
}

await shot('light', 'docs/img/chat-light.png');
await shot('dark', 'docs/img/chat-dark.png');
process.exit(0);
