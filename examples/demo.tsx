// The whole chat, with nothing installed: a scripted agent (the fake driver)
// that streams markdown, asks before it runs a command, calls one of the
// app's tools, and writes a code block whose Run button calls the app.
//
//   npm run examples:demo
//
// The same app over real Claude Code — the same tool, the same `chart` fence
// (its `describe` tells Claude it exists), the same Run button. The Claude
// Agent SDK is a devDependency here, so `npm install` has brought it:
//
//   DEMO_AGENT=claude DEMO_CWD=~/scratch/demo npm run examples:demo
//
// `DEMO_CWD` is where Claude works: the process's directory, this repo, if it
// is not set. It asks before it changes anything there. Authentication is
// Claude Code's: `ANTHROPIC_API_KEY`, or what it is already configured with.
// `CLAUDE_PATH` runs the `claude` you have installed rather than the SDK's
// own copy; SDK 0.3.N ships Claude Code 2.1.N, so keep the two in step.

import { useState, type ReactElement } from 'react';
import { createRoot } from 'react-x11';
import { z } from 'zod';

import {
  AgentChat,
  copyCode,
  defineTool,
  type CodeAction,
} from '../src/index.js';
import { fakeDriver, type FakeStep } from '../src/testing/index.js';

const CLAUDE = process.env.DEMO_AGENT === 'claude';
const CWD = expandHome(process.env.DEMO_CWD) ?? process.cwd();
const CLAUDE_PATH = expandHome(process.env.CLAUDE_PATH);

/** The session's props: the scripted agent, or Claude in `CWD`. */
const AGENT = CLAUDE
  ? {
      agent: 'claude' as const,
      cwd: CWD,
      ...(CLAUDE_PATH
        ? { driverOptions: { pathToClaudeCodeExecutable: CLAUDE_PATH } }
        : {}),
    }
  : { agent: fakeDriver(() => REPLY, { name: 'demo agent' }) };

function expandHome(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith('~/') ? `${process.env.HOME}${path.slice(1)}` : path;
}

const REPLY: FakeStep[] = [
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
    chunk: 6,
    delay: 25,
  },
  {
    type: 'call',
    id: 'bash',
    name: 'Bash',
    kind: 'execute',
    title: 'Run the test suite',
    input: { command: 'npm test' },
    result: [
      {
        type: 'terminal',
        text: '\u001b[32m✔\u001b[0m parses a fence\n\u001b[31m✖\u001b[0m keeps a draft\n\n1 failing',
      },
    ],
  },
  { type: 'wait', ms: 300 },
  {
    type: 'call',
    id: 'ticket',
    name: 'openTicket',
    input: { id: 'ACME-42', title: 'Composer loses its draft on Stop' },
  },
  {
    type: 'say',
    text:
      'One test fails. I opened **ACME-42** for it. To reproduce:\n\n' +
      '```sh\nnpm test -- --test-name-pattern="keeps a draft"\n```\n\n' +
      'The progress so far:\n\n```chart\n{"passing": 41, "failing": 1}\n```\n',
    chunk: 8,
    delay: 20,
  },
];

function App(): ReactElement {
  const [log, setLog] = useState<string[]>([]);

  const openTicket = defineTool({
    description: 'Open a ticket in the tracker.',
    parameters: z.object({ id: z.string(), title: z.string() }),
    title: ({ id }) => `Open ticket ${id}`,
    run: async ({ id, title }) => ({ id, title, status: 'open' }),
    render: ({ output }) =>
      output ? (
        <box style={{ flexDirection: 'row', gap: 8 }}>
          <text style={{ fontWeight: 'bold' }}>{output.id}</text>
          <text>{output.title}</text>
          <text style={{ color: '#27ae60' }}>{output.status}</text>
        </box>
      ) : null,
  });

  // The Run button calls the app. Nothing in the chat spawns a shell.
  const run: CodeAction = {
    id: 'run',
    label: 'Run',
    doneLabel: 'Sent to the app',
    when: (fence) => fence.lang === 'sh',
    run: (fence) => setLog((l) => [...l, `app would run: ${fence.text}`]),
  };

  return (
    <window
      width={760}
      height={720}
      title={CLAUDE ? `Agent chat — Claude in ${CWD}` : 'Agent chat — demo'}
    >
      <box style={{ flexDirection: 'column', flexGrow: 1 }}>
        <AgentChat
          {...AGENT}
          tools={{ openTicket }}
          codeActions={[copyCode, run]}
          fences={{
            chart: {
              describe: 'a JSON object of counts, drawn as bars',
              render: (fence) => <Bars json={fence.text} />,
            },
          }}
          placeholder={
            CLAUDE
              ? 'Ask Claude — try “open a ticket for the flaky test”'
              : 'Ask anything — the demo agent always does the same thing'
          }
          empty={
            <text style={{ color: '#7f8c8d' }}>
              {CLAUDE
                ? `Claude, working in ${CWD}. It asks before it changes anything.`
                : 'Send any message to start the demo.'}
            </text>
          }
        />
        {log.length ? (
          <box
            style={{ padding: 8, borderTopWidth: 1, borderTopColor: '#b2bec3' }}
          >
            {log.map((line, i) => (
              <text key={i} style={{ fontFamily: 'monospace' }}>
                {line}
              </text>
            ))}
          </box>
        ) : null}
      </box>
    </window>
  );
}

function Bars({ json }: { json: string }): ReactElement {
  let counts: Record<string, number> = {};
  try {
    counts = JSON.parse(json) as Record<string, number>;
  } catch {
    // still streaming: draw what parsed last time, which is nothing
  }
  const max = Math.max(1, ...Object.values(counts));
  return (
    <box style={{ flexDirection: 'column', gap: 4 }}>
      {Object.entries(counts).map(([label, n]) => (
        <box
          key={label}
          style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}
        >
          <text style={{ width: 70 }}>{label}</text>
          <box
            style={{
              height: 14,
              width: Math.round((n / max) * 300),
              backgroundColor: label === 'failing' ? '#c0392b' : '#27ae60',
              borderRadius: 3,
            }}
          />
          <text>{String(n)}</text>
        </box>
      ))}
    </box>
  );
}

const root = await createRoot();
root.render(<App />);
