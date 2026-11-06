# Drivers

A driver turns one harness's protocol into what a session understands. The
UI never asks which agent it is driving; it asks what the session can do
(`snapshot.capabilities`), and draws only the actions that work.

| Driver   | Subpath                                | Harness                                                                                           | State                         |
| -------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------- |
| `claude` | `@windowkit/agent-chat/drivers/claude` | Claude Code, through the Claude Agent SDK                                                         | Built                         |
| `fake`   | `@windowkit/agent-chat/testing`        | A script: tests and demos                                                                         | Built                         |
| `acp`    |                                        | Any ACP agent: Gemini, Copilot, Cursor, opencode, goose, Grok Build, Codex through its adapter, … | Planned ([design](design.md)) |
| `codex`  |                                        | `codex app-server`                                                                                | Planned                       |

## Claude

```bash
npm install @anthropic-ai/claude-agent-sdk
```

The Agent SDK is an optional peer: some 200 MB with its native binary, and
installed only by an app that drives Claude. Without it a session is
`'unavailable'`, with the install line as its `error`. Authenticate the way
the SDK does: `ANTHROPIC_API_KEY`, or Bedrock, Vertex or Foundry through
their environment variables.

What the driver does with the session's options:

| Session                   | Agent SDK                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `instructions`            | `systemPrompt: { type: 'preset', preset: 'claude_code', append }`                          |
| `systemPrompt`            | `systemPrompt`, a string, with `instructions` after it                                     |
| `cwd`, `folders`          | `cwd`, `additionalDirectories`                                                             |
| `settings`                | `settingSources`: all three for `'cli'`, none for `'isolated'`                             |
| `coreTools: { x: false }` | `disallowedTools`                                                                          |
| `coreTools: { x: tool }`  | `disallowedTools`, and `toolAliases` from each built-in to the tool                        |
| `tools`                   | one in-process `createSdkMcpServer`, named `app`; the gate allows them, not `allowedTools` |
| `permissions`             | `permissionMode`, always passed: `default`, `acceptEdits`, `default`, `auto`               |
| the gate                  | a `PreToolUse` hook, and `canUseTool` for the approval row                                 |
| `model`, `resume`         | `model`, `resume`                                                                          |
| `driverOptions`           | merged over all of it                                                                      |

Three things about it that are decisions:

- **The gate is split in two, because hooks have a timeout.** The
  `PreToolUse` hook sees every call and asks the session's gate — the app's
  `onToolCall`, then the policy — which never waits on the user. When the
  user must decide, or the session is paused, the hook answers `ask`, and
  Claude Code routes the call to `canUseTool`, which waits as long as it
  takes.
- **One query for the session's life.** `query()` in streaming-input mode is
  one Claude Code process; each message is pushed into its input. A message
  sent mid-turn goes with `priority: 'next'`, so the agent reads it at its
  next step rather than after the turn.
- **Stop swallows the result it causes.** `interrupt()` ends the turn with a
  result message, which may arrive after the next turn has begun; the driver
  counts the interrupts and does not let that result end the new turn.

`TodoWrite` is drawn as the turn's plan rather than as a tool card, and
`AskUserQuestion` as a question form whose answers go back through
`canUseTool`'s `updatedInput`. A subagent's messages nest under the tool call
that started it.

## Writing a driver

A driver is two calls. `start(host)` is handed a `DriverHost` and returns a
`DriverSession`:

```ts
import type { AgentDriver } from '@windowkit/agent-chat/core';

export function myDriver(): AgentDriver {
  return {
    name: 'mine',
    async start(host) {
      const harness = await connect(host.config.cwd); // throw AgentUnavailableError if it cannot
      harness.on('text', (id, delta) => host.emit({ type: 'text', id, delta }));
      harness.on('tool', async (call) => {
        host.emit({
          type: 'tool-start',
          id: call.id,
          name: call.name,
          input: call.input,
        });
        const decision = await host.gate(toToolCall(call));
        // 'ask' and 'defer' go to the user:
        const ok =
          decision.behavior === 'allow' ||
          (decision.behavior !== 'deny' &&
            (await host.approve(toToolCall(call))).behavior === 'allow');
        call.answer(ok);
      });
      harness.on('done', () => host.emit({ type: 'turn-end', reason: 'done' }));
      return {
        capabilities: { ...NO_CAPABILITIES, gate: 'asked-calls' },
        send: (m) => harness.prompt(m.text),
        interrupt: () => harness.cancel(),
        close: () => harness.close(),
      };
    },
  };
}
```

What the host offers:

| `DriverHost`                  | Notes                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `config`                      | The session's options, resolved: `cwd`, `instructions`, `removed`, `replaced`, `tools`, `permissions`… |
| `emit(event)`                 | What happened: text, tool calls, plans, notices, usage, `turn-end`. Deltas, never snapshots.           |
| `gate(call)`                  | The app's `onToolCall`, then the policy. Never waits on the user.                                      |
| `approve(call, signal?)`      | The approval row. Waits on the user and while paused; no timeout.                                      |
| `ask(id, questions, signal?)` | A question form. `null` if dismissed.                                                                  |
| `runTool(name, input, ctx)`   | One of the app's tools. Never throws: a failure is a result.                                           |

`fakeDriver` in `src/testing/fake.ts` is the smallest complete driver, and
`test/claude.test.ts` shows how to test one against a fake of its far side.
