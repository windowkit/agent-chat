// The bottom rung: a chat with Claude Code, in the directory given or the
// current one.
//
//   npm install @anthropic-ai/claude-agent-sdk
//   ANTHROPIC_API_KEY=… npm run examples:claude -- ~/src/my-project

import { createRoot } from 'react-x11';

import { AgentChat } from '../src/index.js';

const cwd = process.argv[2] ?? process.cwd();

const root = await createRoot();
root.render(
  <window width={820} height={760} title={`Claude — ${cwd}`}>
    <AgentChat agent="claude" cwd={cwd} />
  </window>,
);
