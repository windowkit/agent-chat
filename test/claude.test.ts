// The Claude driver against a fake SDK: the options it hands `query()`, and
// what a session's messages become. The fake plays the SDK's side of the
// conversation — hooks, `canUseTool`, the in-process tool handler — in the
// order Claude Code calls them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

import { createAgentSession } from '../src/core/session.js';
import { defineTool } from '../src/core/tools.js';
import {
  claudeDriver,
  type ClaudeSdk,
  type SdkMessage,
} from '../src/drivers/claude/index.js';
import { loadClaudeSdk } from '../src/drivers/claude/sdk.js';
import { textOf, tool, until } from './helpers.js';

interface FakeTool {
  name: string;
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
}

function fakeSdk() {
  const out: SdkMessage[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  const state = {
    options: null as Record<string, unknown> | null,
    prompts: [] as Array<{ message: { content: unknown }; priority?: string }>,
    tools: [] as FakeTool[],
    interrupted: 0,
    emit(m: SdkMessage) {
      out.push(m);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
    /** What Claude Code does before running a tool: the hook, then, if the
     *  hook asked, `canUseTool`. Answers whether the tool may run. */
    async permit(name: string, input: Record<string, unknown>, id: string) {
      const hooks = (
        state.options!.hooks as { PreToolUse: Array<{ hooks: Function[] }> }
      ).PreToolUse[0]!.hooks;
      const out = (await hooks[0]!({
        tool_name: name,
        tool_input: input,
        tool_use_id: id,
      })) as {
        hookSpecificOutput?: { permissionDecision?: string };
      };
      const decision = out.hookSpecificOutput?.permissionDecision;
      if (decision === 'allow') return true;
      if (decision === 'deny') return false;
      const can = state.options!.canUseTool as Function;
      const result = (await can(name, input, {
        signal: new AbortController().signal,
        toolUseID: id,
      })) as { behavior: string };
      return result.behavior === 'allow';
    },
  };
  const sdk: ClaudeSdk = {
    tool: (name, _description, _shape, handler) => {
      const t = { name, handler };
      state.tools.push(t);
      return t;
    },
    createSdkMcpServer: (o) => ({ type: 'sdk', name: o.name, tools: o.tools }),
    query({ prompt, options }) {
      state.options = options ?? {};
      void (async () => {
        for await (const m of prompt) state.prompts.push(m);
      })();
      return {
        async *[Symbol.asyncIterator]() {
          for (;;) {
            if (out.length) {
              yield out.shift()!;
              continue;
            }
            if (ended) return;
            await new Promise<void>((r) => (wake = r));
            wake = null;
          }
        },
        async interrupt() {
          state.interrupted++;
        },
        async supportedModels() {
          return [{ value: 'opus', displayName: 'Opus' }];
        },
        close() {
          state.end();
        },
      };
    },
  };
  return { sdk, state };
}

const assistant = (
  id: string,
  content: unknown[],
  parent: string | null = null,
) =>
  ({
    type: 'assistant',
    message: { id, content },
    parent_tool_use_id: parent,
  }) as SdkMessage;
const toolResult = (id: string, content: string, isError = false) =>
  ({
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: id, content, is_error: isError },
      ],
    },
    parent_tool_use_id: null,
  }) as SdkMessage;
const success = {
  type: 'result',
  subtype: 'success',
  total_cost_usd: 0.01,
  num_turns: 1,
} as SdkMessage;

test('the options say what the session asked for', async () => {
  const { sdk, state } = fakeSdk();
  const session = createAgentSession({
    agent: claudeDriver({ sdk }),
    cwd: '/work',
    folders: ['/docs'],
    instructions: 'Be brief.',
    coreTools: { web: false, edit: 'ask' },
    permissions: 'edits',
    settings: 'isolated',
    tools: {
      openTicket: defineTool({
        description: 'Open a ticket',
        parameters: z.object({ id: z.string() }),
        run: () => 'ok',
      }),
    },
    driverOptions: { maxTurns: 3 },
  });
  await session.start();
  const o = state.options!;
  assert.equal(o.cwd, '/work');
  assert.deepEqual(o.additionalDirectories, ['/docs']);
  assert.deepEqual(o.systemPrompt, {
    type: 'preset',
    preset: 'claude_code',
    append: 'Be brief.',
  });
  assert.deepEqual(o.settingSources, []);
  assert.equal(o.permissionMode, 'acceptEdits');
  assert.deepEqual(o.disallowedTools, ['WebFetch', 'WebSearch']);
  assert.equal(o.allowedTools, undefined, 'the gate allows app tools');
  assert.equal(o.includePartialMessages, true);
  assert.equal(o.maxTurns, 3, 'driverOptions are passed through, last');
  assert.ok((o.mcpServers as Record<string, unknown>).app);
  assert.equal(
    (o.env as Record<string, string>).CLAUDE_AGENT_SDK_CLIENT_APP,
    '@windowkit/agent-chat',
  );
  await session.close();
});

test('a system prompt replaces the preset, with the instructions after it', async () => {
  const { sdk, state } = fakeSdk();
  const session = createAgentSession({
    agent: claudeDriver({ sdk }),
    systemPrompt: 'You are a SQL assistant.',
    instructions: ['Use Postgres.'],
  });
  await session.start();
  assert.equal(
    state.options!.systemPrompt,
    'You are a SQL assistant.\n\nUse Postgres.',
  );
  assert.equal(
    state.options!.permissionMode,
    'default',
    'always passed explicitly',
  );
  await session.close();
});

test('a replaced built-in is removed and aliased to the app tool', async () => {
  const { sdk, state } = fakeSdk();
  const shell = defineTool({
    description: 'Run a command in the app sandbox',
    parameters: z.object({ command: z.string() }),
    run: () => 'sandboxed',
  });
  const session = createAgentSession({
    agent: claudeDriver({ sdk }),
    coreTools: { shell },
  });
  await session.start();
  assert.deepEqual(state.options!.toolAliases, {
    Bash: 'mcp__app__shell',
    BashOutput: 'mcp__app__shell',
    KillShell: 'mcp__app__shell',
  });
  assert.ok((state.options!.disallowedTools as string[]).includes('Bash'));
  assert.deepEqual(
    state.tools.map((t) => t.name),
    ['shell'],
  );
  await session.close();
});

test('a streamed reply, then its finished block, is one text part', async () => {
  const { sdk, state } = fakeSdk();
  const session = createAgentSession({ agent: claudeDriver({ sdk }) });
  session.send('hi');
  await until(() => state.prompts.length === 1);
  assert.equal(state.prompts[0]!.message.content, 'hi');
  state.emit({
    type: 'system',
    subtype: 'init',
    session_id: 's1',
    model: 'opus',
    slash_commands: ['review'],
  });
  state.emit({
    type: 'stream_event',
    event: { type: 'message_start', message: { id: 'm1' } },
  });
  state.emit({
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text' },
    },
  });
  state.emit({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hel' },
    },
  });
  await until(() => textOf(session.snapshot) === 'hi|Hel');
  state.emit(assistant('m1', [{ type: 'text', text: 'Hello.' }]));
  state.emit(success);
  await until(() => session.snapshot.status === 'idle');
  assert.equal(textOf(session.snapshot), 'hi|Hello.');
  assert.equal(session.snapshot.info.id, 's1');
  assert.deepEqual(session.snapshot.info.commands, [{ name: 'review' }]);
  await until(() => session.snapshot.info.models.length === 1);
  assert.equal(session.snapshot.info.usage?.costUsd, 0.01);
  await session.close();
});

test('a built-in tool asks, runs, and shows its result; an edit shows its diff', async () => {
  const { sdk, state } = fakeSdk();
  const session = createAgentSession({ agent: claudeDriver({ sdk }) });
  session.send('fix it');
  await until(() => state.prompts.length === 1);
  state.emit(
    assistant('m1', [
      {
        type: 'tool_use',
        id: 'b1',
        name: 'Bash',
        input: { command: 'npm test', description: 'Run the tests' },
      },
    ]),
  );
  await until(() => !!tool(session, 'b1'));
  assert.equal(tool(session, 'b1')!.title, 'Run the tests');
  assert.equal(tool(session, 'b1')!.kind, 'execute');

  const permitted = state.permit('Bash', { command: 'npm test' }, 'b1');
  await until(() => tool(session, 'b1')!.state === 'awaiting-approval');
  session.respond('b1', 'allow-once');
  assert.equal(await permitted, true);
  state.emit(toolResult('b1', '2 passing'));
  await until(() => tool(session, 'b1')!.state === 'done');
  assert.deepEqual(tool(session, 'b1')!.output, [
    { type: 'terminal', text: '2 passing' },
  ]);

  state.emit(
    assistant('m2', [
      {
        type: 'tool_use',
        id: 'e1',
        name: 'Edit',
        input: { file_path: 'a.ts', old_string: 'x', new_string: 'y' },
      },
    ]),
  );
  state.emit(toolResult('e1', 'ok'));
  await until(() => tool(session, 'e1')?.state === 'done');
  assert.deepEqual(tool(session, 'e1')!.output, [
    { type: 'diff', path: 'a.ts', oldText: 'x', newText: 'y' },
  ]);
  state.emit(success);
  await until(() => session.snapshot.status === 'idle');
  await session.close();
});

test('an app tool runs in this process, and the card gets what run returned', async () => {
  const { sdk, state } = fakeSdk();
  const session = createAgentSession({
    agent: claudeDriver({ sdk }),
    tools: {
      openTicket: defineTool({
        description: 'Open a ticket',
        parameters: z.object({ id: z.string() }),
        run: ({ id }) => ({ id, title: 'Crash' }),
        title: ({ id }) => `Open ${id}`,
      }),
    },
  });
  session.send('open ACME-1');
  await until(() => state.prompts.length === 1);
  state.emit(
    assistant('m1', [
      {
        type: 'tool_use',
        id: 't1',
        name: 'mcp__app__openTicket',
        input: { id: 'ACME-1' },
      },
    ]),
  );
  await until(() => !!tool(session, 't1'));
  assert.equal(tool(session, 't1')!.label, 'openTicket');
  assert.equal(tool(session, 't1')!.title, 'Open ACME-1');
  assert.equal(
    await state.permit('mcp__app__openTicket', { id: 'ACME-1' }, 't1'),
    true,
  );
  const result = (await state.tools[0]!.handler({ id: 'ACME-1' }, {})) as {
    content: Array<{ text: string }>;
  };
  assert.match(result.content[0]!.text, /"title": "Crash"/);
  state.emit(toolResult('t1', result.content[0]!.text));
  await until(() => tool(session, 't1')!.state === 'done');
  assert.deepEqual(tool(session, 't1')!.output, [
    { type: 'value', value: { id: 'ACME-1', title: 'Crash' } },
  ]);
  await session.close();
});

test('AskUserQuestion is a question part, answered through canUseTool', async () => {
  const { sdk, state } = fakeSdk();
  const session = createAgentSession({ agent: claudeDriver({ sdk }) });
  session.send('help me choose');
  await until(() => state.prompts.length === 1);
  const input = {
    questions: [
      {
        question: 'Which database?',
        header: 'DB',
        options: [{ label: 'Postgres' }, { label: 'SQLite' }],
        multiSelect: false,
      },
    ],
  };
  state.emit(
    assistant('m1', [
      { type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input },
    ]),
  );
  const answer = (state.options!.canUseTool as Function)(
    'AskUserQuestion',
    input,
    {
      signal: new AbortController().signal,
      toolUseID: 'q1',
    },
  ) as Promise<{
    behavior: string;
    updatedInput: { answers: Record<string, string> };
  }>;
  await until(() => session.snapshot.status === 'waiting');
  assert.equal(tool(session, 'q1'), undefined, 'not drawn as a tool card');
  session.answer('q1', { 'Which database?': 'SQLite' });
  const result = await answer;
  assert.equal(result.behavior, 'allow');
  assert.deepEqual(result.updatedInput.answers, {
    'Which database?': 'SQLite',
  });
  await session.close();
});

test('TodoWrite is the plan, and a subagent nests under its call', async () => {
  const { sdk, state } = fakeSdk();
  const session = createAgentSession({ agent: claudeDriver({ sdk }) });
  session.send('go');
  await until(() => state.prompts.length === 1);
  state.emit(
    assistant('m1', [
      {
        type: 'tool_use',
        id: 'todo',
        name: 'TodoWrite',
        input: {
          todos: [
            { content: 'Read', status: 'completed' },
            { content: 'Fix', status: 'in_progress' },
          ],
        },
      },
      {
        type: 'tool_use',
        id: 'task',
        name: 'Agent',
        input: { description: 'Explore the repo' },
      },
    ]),
  );
  state.emit(
    assistant('m2', [{ type: 'text', text: 'Looking around' }], 'task'),
  );
  await until(() => !!tool(session, 'task')?.children?.length);
  const parts = session.snapshot.messages[1]!.parts;
  assert.deepEqual(
    parts.map((p) => p.type),
    ['plan', 'tool'],
  );
  const plan = parts[0]!;
  assert.deepEqual(plan.type === 'plan' ? plan.entries : null, [
    { text: 'Read', status: 'completed' },
    { text: 'Fix', status: 'in_progress' },
  ]);
  assert.equal(tool(session, 'task')!.title, 'Explore the repo');
  await session.close();
});

test('stop interrupts the query and the result it causes ends nothing new', async () => {
  const { sdk, state } = fakeSdk();
  const session = createAgentSession({ agent: claudeDriver({ sdk }) });
  session.send('long task');
  await until(() => state.prompts.length === 1);
  await session.stop();
  assert.equal(state.interrupted, 1);
  session.send('next');
  await until(() => state.prompts.length === 2);
  assert.equal(session.snapshot.status, 'running');
  // the interrupted turn's result arrives after the next turn began
  state.emit({
    type: 'result',
    subtype: 'error_during_execution',
  } as SdkMessage);
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  assert.equal(
    session.snapshot.status,
    'running',
    'it did not end the new turn',
  );
  state.emit(success);
  await until(() => session.snapshot.status === 'idle');
  await session.close();
});

test('a message sent mid-turn steers rather than queues', async () => {
  const { sdk, state } = fakeSdk();
  const session = createAgentSession({ agent: claudeDriver({ sdk }) });
  session.send('start');
  await until(() => state.prompts.length === 1);
  session.send('also check the docs');
  await until(() => state.prompts.length === 2);
  assert.equal(state.prompts[1]!.priority, 'next');
  assert.equal(
    session.snapshot.messages.some((m) => m.queued),
    false,
  );
  await session.close();
});

test('a missing SDK makes the session unavailable, saying how to install it', async () => {
  // never the real import: with the SDK installed (a devDependency here) it
  // would start Claude Code
  const session = createAgentSession({
    agent: claudeDriver({ module: '@anthropic-ai/claude-agent-sdk-not-here' }),
  });
  session.send('hi');
  await until(
    () =>
      session.snapshot.status !== 'starting' &&
      session.snapshot.status !== 'running',
  );
  assert.equal(session.snapshot.status, 'unavailable');
  assert.match(
    session.snapshot.error!,
    /not installed.*npm install @anthropic-ai\/claude-agent-sdk-not-here/,
  );
});

test('an SDK that fails to load says why, not that it is missing', async () => {
  const broken = `data:text/javascript,${encodeURIComponent(
    "import 'some-package-the-sdk-needs';",
  )}`;
  await assert.rejects(loadClaudeSdk(broken), (err: Error) => {
    assert.equal(err.name, 'AgentUnavailableError');
    assert.match(
      err.message,
      /installed but did not load: .*some-package-the-sdk-needs/,
    );
    return true;
  });
});
