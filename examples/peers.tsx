// Two sessions, side by side, and the app passing messages between them:
// each time the writer finishes a turn, its reply goes to the reviewer as a
// message from the writer — drawn on the reviewer's side as the writer's,
// named, and told to the reviewer's agent as another session's words, not
// the user's.
//
//   npm run examples:peers
//
// Over real Claude Code, two sessions working in one directory. Every turn
// of the writer starts one of the reviewer, so each message costs two:
//
//   DEMO_AGENT=claude DEMO_CWD=~/scratch/demo npm run examples:peers
//
// What it shows is the app watching one session and messaging another, with
// nothing between them but the app: `subscribe`, and `send` with `from`.

import { mkdirSync } from 'node:fs';
import { createRoot } from 'react-x11';

import {
  AgentChat,
  createAgentSession,
  messageMarkdown,
  type AgentOptions,
  type AgentSession,
} from '../src/index.js';
import { fakeDriver, scripted } from '../src/testing/index.js';

const CLAUDE = process.env.DEMO_AGENT === 'claude';
const CWD = expandHome(process.env.DEMO_CWD) ?? process.cwd();
const CLAUDE_PATH = expandHome(process.env.CLAUDE_PATH);
if (CLAUDE) mkdirSync(CWD, { recursive: true });

function expandHome(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith('~/') ? `${process.env.HOME}${path.slice(1)}` : path;
}

function options(
  name: string,
  instructions: string,
  reply: string,
): AgentOptions {
  return CLAUDE
    ? {
        agent: 'claude',
        cwd: CWD,
        instructions,
        ...(CLAUDE_PATH
          ? { driverOptions: { pathToClaudeCodeExecutable: CLAUDE_PATH } }
          : {}),
      }
    : {
        agent: fakeDriver(
          scripted([{ type: 'say', text: reply, chunk: 6, delay: 15 }]),
          { name },
        ),
      };
}

const writer = createAgentSession(
  options(
    'writer',
    'You draft short release notes. Another session reviews each reply you write.',
    'Here is a draft:\n\n' +
      '## 0.2.0\n\n' +
      '- Messages from other sessions are drawn as theirs.\n' +
      '- `send` takes `from`.\n',
  ),
);
const reviewer = createAgentSession(
  options(
    'reviewer',
    'The writer session sends you drafts. Reply with at most three short review notes.',
    '1. Say what `from` is for, not only that it exists.\n' +
      '2. Name the channel case too.\n' +
      '3. Otherwise good.',
  ),
);

/** Each time `session` finishes a turn, hand `listener` what it wrote. */
function onReply(
  session: AgentSession,
  listener: (reply: string) => void,
): () => void {
  let busy = false;
  return session.subscribe(() => {
    const { status, messages } = session.snapshot;
    const last = messages.at(-1);
    if (busy && status === 'idle' && last?.role === 'assistant') {
      listener(messageMarkdown(last));
    }
    busy = status === 'running' || status === 'waiting' || status === 'paused';
  });
}

onReply(writer, (reply) =>
  reviewer.send({
    text: reply,
    from: { kind: 'peer', id: 'writer', name: 'Writer' },
  }),
);

function Pane({
  title,
  session,
  placeholder,
}: {
  title: string;
  session: AgentSession;
  placeholder: string;
}) {
  return (
    <box style={{ flexDirection: 'column', flexGrow: 1, flexBasis: 0, gap: 6 }}>
      <text style={{ fontWeight: 'bold' }}>{title}</text>
      <AgentChat
        session={session}
        header={false}
        placeholder={placeholder}
        style={{ flexGrow: 1 }}
      />
    </box>
  );
}

const root = await createRoot();
root.render(
  <window
    width={1100}
    height={680}
    title={CLAUDE ? `Two sessions — Claude in ${CWD}` : 'Two sessions — demo'}
  >
    <box style={{ flexDirection: 'row', flexGrow: 1, gap: 12, padding: 12 }}>
      <Pane
        title="Writer"
        session={writer}
        placeholder="Ask the writer for a draft"
      />
      <Pane
        title="Reviewer"
        session={reviewer}
        placeholder="The writer's replies arrive here"
      />
    </box>
  </window>,
);
