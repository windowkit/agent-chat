// Interception, at three levels:
//
// 1. A Run button on shell code blocks that calls the app — here, a runner
//    that only prints — and hands the output back to the agent.
// 2. A gate on every tool call: reads run, anything that executes asks, and
//    anything touching `.env` is refused outright.
// 3. The agent's own shell replaced by the app's function: Claude's `Bash`
//    is removed and routed to `shell`, which runs nothing real.
//
//   npm install @anthropic-ai/claude-agent-sdk
//   ANTHROPIC_API_KEY=… npm run examples:intercept

import { createRoot } from 'react-x11';
import { z } from 'zod';

import {
  AgentChat,
  copyCode,
  defineTool,
  type CodeAction,
} from '../src/index.js';

/** The app's runner. A real app would use its own sandbox. */
async function runInSandbox(command: string): Promise<string> {
  return `(sandbox) $ ${command}\nnothing was executed: this is the example runner`;
}

const shell = defineTool({
  description: 'Run a shell command in the app sandbox.',
  parameters: z.object({ command: z.string() }),
  kind: 'execute',
  title: ({ command }) => command,
  run: ({ command }) => runInSandbox(command),
});

const run: CodeAction = {
  id: 'run',
  label: 'Run',
  when: (fence) => ['sh', 'bash', 'shell', 'zsh'].includes(fence.lang),
  run: async (fence, { session }) => {
    const output = await runInSandbox(fence.text);
    session.send(`I ran it. The output:\n\n\`\`\`\n${output}\n\`\`\``);
  },
};

const root = await createRoot();
root.render(
  <window width={820} height={760} title="Agent chat — interception">
    <AgentChat
      agent="claude"
      coreTools={{ shell }}
      codeActions={[copyCode, run]}
      onToolCall={(call) => {
        if (JSON.stringify(call.input ?? {}).includes('.env')) {
          return { deny: 'Secrets are off limits in this app.' };
        }
        return undefined; // the policy decides: reads run, the rest asks
      }}
    />
  </window>,
);
