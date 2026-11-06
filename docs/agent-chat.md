# AgentChat

```tsx
import { AgentChat } from '@windowkit/agent-chat';

<AgentChat agent="claude" />;
```

A chat with a local agent harness, for [react-x11](https://github.com/sidorares/react-x11).
That line is a working chat with Claude Code in the process's working
directory: replies stream in as markdown, tool calls show as cards, anything
that changes something asks first, and Enter sends, Escape stops.

`<AgentChat>` composes; it registers no element of its own. It draws
markdown with [`<Markdown>`](https://github.com/sidorares/react-x11-components/blob/master/docs/components/markdown.md),
code with `<Code>`, program output with `<TerminalOutput>`, and takes input in
`<RichTextEditor>`, all from `@react-x11/components`. It runs on every react-x11
backend, X11 and the native macOS one alike; the harness it drives runs as a
child process of the app, so it needs Node (or Bun), not a display server.

Every prop below is an opt-in on that one element. None replaces another, and
none changes what another means.

## The session's props

These configure the harness. They are read once, when the chat first
renders: give the chat a new `key` to start a new session with new ones.

| Prop            | Type                                             | Notes                                                                                                                                                                            |
| --------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`         | `'claude' \| AgentDriver`                        | Which harness. Default `'claude'`. A driver of the app's own is an [`AgentDriver`](drivers.md).                                                                                  |
| `cwd`           | `string`                                         | Where the agent works. Default: the process's working directory.                                                                                                                 |
| `folders`       | `string[]`                                       | More directories it may read and write.                                                                                                                                          |
| `instructions`  | `string \| string[]`                             | Appended to the harness's own system prompt.                                                                                                                                     |
| `systemPrompt`  | `string`                                         | Replaces the harness's system prompt; `instructions` still follow it.                                                                                                            |
| `coreTools`     | `{ [key]: boolean \| 'ask' \| ToolDef }`         | The harness's built-ins by what they do — `shell`, `read`, `edit`, `web`, `agents`, `todos` — or by a harness's own name. `false` removes, `'ask'` always asks, a tool replaces. |
| `tools`         | `{ [name]: ToolDef }`                            | The app's own tools. See [Tools](#tools).                                                                                                                                        |
| `permissions`   | `'ask' \| 'edits' \| 'read-only' \| 'auto'`      | What runs without asking. Default `'ask'`. See [The gate](#the-gate).                                                                                                            |
| `onToolCall`    | `(call: ToolCall) => ToolDecision \| Promise<…>` | Before every tool call: the app's say, ahead of the policy.                                                                                                                      |
| `model`, `mode` | `string`                                         | The harness's model and permission mode to start in.                                                                                                                             |
| `resume`        | `string`                                         | A harness session id to resume.                                                                                                                                                  |
| `settings`      | `'cli' \| 'isolated'`                            | `'cli'` (default): the harness as on the command line, with the user's settings and `CLAUDE.md`. `'isolated'`: none of them.                                                     |
| `driverOptions` | `Record<string, unknown>`                        | Passed to the driver as they are, after everything above — for Claude, any `query()` option.                                                                                     |

## The view's props

| Prop          | Type                                               | Notes                                                                                                        |
| ------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `session`     | `AgentSession`                                     | A session from `useAgent`. With it, none of the session's props above are allowed: they are the session's.   |
| `fences`      | `{ [lang]: render \| { render, describe } }`       | Fenced blocks the app draws, by language. See [Rendering](#rendering).                                       |
| `components`  | `{ [Name]: Component \| { component, describe } }` | Tags a reply may write on their own line. A tag is a component iff its name is a key; nothing is evaluated.  |
| `renderTool`  | `{ [label]: (info) => ReactNode }`                 | Tool calls the app draws, by the tool's label; `'*'` for every other. A tool's own `render` comes first.     |
| `codeActions` | `CodeAction[]`                                     | Buttons on every fenced code block. Default `[copyCode]`. Nothing runs a block unless an action here does.   |
| `onLink`      | `(href) => void`                                   | A link in a reply was pressed. Nothing navigates by itself.                                                  |
| `placeholder` | `string`                                           | The composer's. Default "Ask the agent…".                                                                    |
| `header`      | `boolean \| (session) => ReactNode`                | The session's line: agent, model and mode pickers, cost, Copy chat. Default `true`.                          |
| `empty`       | `ReactNode`                                        | Shown while the transcript is empty.                                                                         |
| `fallback`    | `ReactNode \| (snapshot) => ReactNode`             | Shown instead of the chat when the harness cannot run here. Default: a line saying why, above an empty chat. |
| `fontSize`    | `number`                                           | Base text size. Default: the theme's.                                                                        |
| `autoFocus`   | `boolean`                                          | Focus the composer on mount. Default `true`.                                                                 |
| `style`       | `StyleProp`                                        | The root box. It fills what it is put in by default (`flexGrow: 1`).                                         |

## The ladder

One chat, growing a prop at a time.

```tsx
// Context: where it works, what it is told, what it may use.
<AgentChat
  agent="claude"
  cwd={project.root}
  folders={[project.docs]}
  instructions="You are the build assistant for Acme. Prefer make targets."
  coreTools={{ web: false }}
/>

// The app's own tools, as functions.
<AgentChat agent="claude" cwd={project.root} tools={{ openTicket }} />

// Drawing what the agent writes.
<AgentChat
  agent="claude"
  tools={{ openTicket }}
  fences={{ chart: { render: (f) => <Chart spec={f.text} />, describe: 'a Vega-Lite spec, as JSON' } }}
/>

// Intercepting: a Run button that calls the app, a gate, the shell replaced.
<AgentChat
  agent="claude"
  tools={{ openTicket }}
  codeActions={[copyCode, runAction]}
  onToolCall={(call) => (call.kind === 'execute' && !trusted ? 'ask' : undefined)}
  coreTools={{ shell: sandboxShell }}
/>

// The app drives the session. Its props move into useAgent, unchanged.
const agent = useAgent({ agent: 'claude', cwd: project.root, tools: { openTicket } });
<AgentChat session={agent} codeActions={[copyCode, runAction]} />;
```

## Tools

```tsx
import { defineTool } from '@windowkit/agent-chat';
import { z } from 'zod';

const openTicket = defineTool({
  description: 'Open a ticket in the tracker by id.',
  parameters: z.object({ id: z.string().describe('like ACME-12') }),
  run: async ({ id }, { signal, progress }) => {
    progress('Looking it up…');
    return tracker.open(id, { signal });
  },
  title: ({ id }) => `Open ${id}`,
  render: ({ output }) => (output ? <TicketCard ticket={output} /> : null),
});
```

| Field         | Notes                                                                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description` | What the model reads to decide when to call it.                                                                                                                                                             |
| `parameters`  | A Standard Schema object (zod's `z.object`, valibot, arktype) or a JSON Schema. The arguments are validated before `run`; a bad one is a tool error the model can correct.                                  |
| `run`         | `(input, { signal, callId, progress }) => result`. A string is sent as text; a value as JSON, and kept as it is for `render`; MCP content passes through; a throw is an error result, and the turn goes on. |
| `ask`         | Ask the user before every call. Default false: the app wrote it.                                                                                                                                            |
| `title`       | The card's one line. Default: the tool's name.                                                                                                                                                              |
| `kind`        | `'read'`, `'edit'`, `'execute'`, … — what the policy and the card go by. Default `'other'`.                                                                                                                 |
| `render`      | Draws the call: `{ part, input, output }`, `output` being what `run` returned.                                                                                                                              |

How a function reaches the agent is the driver's business. On Claude it runs
in this process, in the Agent SDK's in-process MCP server: nothing is spawned
and nothing listens. The model sees it as `mcp__app__<name>`; the chat shows
its name.

**Replacing a built-in.** `coreTools={{ shell: myShell }}` removes Claude's
`Bash` and routes it to `myShell` through the SDK's `toolAliases`, so a model
that calls `Bash` anyway (a skill told it to) reaches the app's function. A
replacement for `shell` is handed Bash's arguments: `{ command, description?,
timeout? }`.

## The gate

Before a tool runs:

1. **`onToolCall(call)`** answers, if the app gave one:
   - `'allow'`, or `'allow-session'` (this tool, for the rest of the session);
   - `'deny'`, or `{ deny: reason }`, which the model is told;
   - `{ allow: true, input }`, which runs with changed arguments;
   - `'ask'`: the user decides;
   - `undefined`: the policy decides.
2. **The policy**, `permissions`:

   | policy        | reads                          | edits | anything else |
   | ------------- | ------------------------------ | ----- | ------------- |
   | `'ask'`       | run                            | ask   | ask           |
   | `'edits'`     | run                            | run   | ask           |
   | `'read-only'` | run                            | deny  | deny          |
   | `'auto'`      | the harness's own mode decides |       |               |

   An app tool runs unless its `ask` says otherwise; a `coreTools` entry set
   to `'ask'` always asks.

3. **The user**, through the approval row on the tool's card: Allow, Allow for
   this session, Deny.

Running everything unasked is not a preset. Pass Claude's
`permissionMode: 'bypassPermissions'` through `driverOptions` if you mean it.

**Pause** holds every tool call at the gate until **Resume**: text streams to
the end of the step, and the agent stops at its next action. It is drawn only
where every call passes through the app (`capabilities.gate ===
'every-call'`), which Claude's does.

## Rendering

- **`fences`** draw a fenced block by its language, handed `{ lang, text,
partial }`, `partial` while it is still streaming.
- **`components`** draw a tag a reply writes on its own line, `<Ticket
id="ACME-1"/>`, with its attributes as props: strings, `true`, or JSON.
- **`renderTool`** draws a tool call by its label, with `'*'` for the rest.

An entry given as `{ render, describe }` (or `{ component, describe }`) adds
a line to the instructions, so the agent knows the format exists:

> The UI draws a fenced code block tagged `chart` as: a Vega-Lite spec, as JSON

`describeRenderers({ fences, components })` returns those lines, for a
session made with `useAgent`.

## Intercepting actions

- **`codeActions`** are buttons on every fenced code block. `copyCode` is the
  default; a Run button is an action the app writes, calling the app:

  ```tsx
  const run: CodeAction = {
    id: 'run',
    label: 'Run',
    when: (fence) => fence.lang === 'sh',
    run: async (fence, { session }) => {
      const output = await app.sandbox.run(fence.text);
      session.send(`The output:\n\n\`\`\`\n${output}\n\`\`\``);
    },
  };
  ```

  An action is not drawn while its block is still streaming.

- **`onToolCall`** sees every call before it runs ([The gate](#the-gate)).
- **`coreTools`** replaces a built-in with the app's function
  ([Tools](#tools)).
- **The whole harness elsewhere**: Claude's `spawnClaudeCodeProcess`, through
  `driverOptions`, runs it in a container, a VM or over ssh.

## The session

`useAgent(options)` makes a session for a component's life, from the same
options `<AgentChat>` takes; `createAgentSession(options)` makes one outside
React (`@windowkit/agent-chat/core`). An `AgentSession`:

| Member                                | Notes                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `snapshot`                            | `{ status, messages, info, capabilities, error, paused, restored }`, one immutable object, replaced on change. |
| `subscribe(listener)`                 | Bound, for `useSyncExternalStore(session.subscribe, …)`.                                                       |
| `send(text \| { text, attachments })` | Mid-turn it steers where the harness can, and queues where it cannot.                                          |
| `stop()`                              | Stops the turn. Queued messages come back as `snapshot.restored`, which the composer takes.                    |
| `pause()`, `resume()`                 | Holds the gate.                                                                                                |
| `respond(toolId, choice)`             | Answers an approval: `'allow-once'`, `'allow-session'`, `'deny'`.                                              |
| `answer(questionId, answers \| null)` | Answers a question the agent asked.                                                                            |
| `setModel(id)`, `setMode(id)`         | Where `capabilities.models` / `modes`.                                                                         |
| `notify(level, text)`                 | A line in the transcript from the app.                                                                         |
| `toMarkdown()`                        | The transcript, as Copy chat writes it.                                                                        |
| `start()`, `close()`                  | The harness starts at the first `send` unless started; `useAgent` closes it on unmount.                        |

`status` is `'idle'`, `'starting'`, `'running'`, `'waiting'` (on the user),
`'paused'`, `'unavailable'` (the harness cannot run here), `'error'` or
`'closed'`.

### Messages

`messages` is `{ id, role, parts, done?, queued? }[]`. A part is one of:

- `text` and `reasoning`, with `streaming`;
- `tool`: `name`, `label`, `kind`, `title`, `input`, `state` (`input-streaming`
  → `pending` → `awaiting-approval` → `running` → `done`, `error`, `denied`,
  `cancelled`), `output` (`text`, `terminal`, `diff`, `image`, `value`), and
  `children` for a subagent's thread;
- `plan` (Claude's `TodoWrite`), `question` (`AskUserQuestion`), `file`,
  `notice` and `data`.

Parts are plain data. Approval is a state of the tool part, drawn on its
card, never a dialog.

## Decisions

- **The harness owns the session.** A chat is a view of a Claude Code (or
  other) session, with its transcript, its tools and its permission rules.
  The chat calls no model and runs no tool loop of its own.
- **An action is drawn only where it works.** No Pause where the driver
  cannot hold every call; no Edit where it cannot fork.
- **Nothing runs or navigates by itself.** No Run action by default,
  `components` reaches only the keys given, a reply's expressions are never
  evaluated, and links go to `onLink`.
- **Permissions start at `'ask'`**, and Allow for this session lasts the
  session: nothing writes a permission rule to disk.
- **A harness that cannot run is not an error.** No SDK, no key:
  `status: 'unavailable'`, the reason in `error`, and the `fallback`.
- **No claude.ai login.** Anthropic does not allow a third-party product built
  on the Agent SDK to offer it unless approved; the Claude driver uses the API
  key or the cloud provider the environment configures.

## Examples

```bash
npm run examples:demo        # no SDK, no key: a scripted agent
npm run examples:claude -- ~/src/my-project
npm run examples:tools       # the app's tools and renderers
npm run examples:intercept   # Run buttons, the gate, a replaced shell
```
