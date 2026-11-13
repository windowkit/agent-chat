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

| Prop            | Type                                             | Notes                                                                                                                                                                                  |
| --------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`         | `'claude' \| AgentDriver`                        | Which harness. Default `'claude'`. A driver of the app's own is an [`AgentDriver`](drivers.md).                                                                                        |
| `cwd`           | `string`                                         | Where the agent works. Default: the process's working directory.                                                                                                                       |
| `folders`       | `string[]`                                       | More directories it may read and write.                                                                                                                                                |
| `instructions`  | `string \| string[]`                             | Appended to the harness's own system prompt.                                                                                                                                           |
| `systemPrompt`  | `string`                                         | Replaces the harness's system prompt; `instructions` still follow it.                                                                                                                  |
| `coreTools`     | `{ [key]: boolean \| 'ask' \| ToolDef }`         | The harness's built-ins by what they do — `shell`, `read`, `edit`, `web`, `agents`, `todos` — or by a harness's own name. `false` removes, `'ask'` always asks, a tool replaces.       |
| `tools`         | `{ [name]: ToolDef }`                            | The app's own tools. See [Tools](#tools).                                                                                                                                              |
| `permissions`   | `'ask' \| 'edits' \| 'read-only' \| 'auto'`      | What runs without asking. Default `'ask'`. See [The gate](#the-gate).                                                                                                                  |
| `onToolCall`    | `(call: ToolCall) => ToolDecision \| Promise<…>` | Before every tool call: the app's say, ahead of the policy.                                                                                                                            |
| `model`, `mode` | `string`                                         | The harness's model and permission mode to start in.                                                                                                                                   |
| `resume`        | `string`                                         | A harness session id to resume.                                                                                                                                                        |
| `messages`      | `AgentMessage[]`                                 | A transcript to start from: an earlier `snapshot.messages` the app saved, shown settled. Pass the harness session id (`info.id`) as `resume` beside it, so the agent remembers it too. |
| `settings`      | `'cli' \| 'isolated'`                            | `'cli'` (default): the harness as on the command line, with the user's settings and `CLAUDE.md`. `'isolated'`: none of them.                                                           |
| `driverOptions` | `Record<string, unknown>`                        | Passed to the driver as they are, after everything above — for Claude, any `query()` option.                                                                                           |

## The view's props

| Prop          | Type                                                 | Notes                                                                                                        |
| ------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `session`     | `AgentSession`                                       | A session from `useAgent`. With it, none of the session's props above are allowed: they are the session's.   |
| `fences`      | `{ [lang]: render \| { render, describe } }`         | Fenced blocks the app draws, by language. See [Rendering](#rendering).                                       |
| `components`  | `{ [Name]: Component \| { component, describe } }`   | Tags a reply may write on their own line. A tag is a component iff its name is a key; nothing is evaluated.  |
| `renderTool`  | `{ [label]: (info) => ReactNode }`                   | Tool calls the app draws, by the tool's label; `'*'` for every other. A tool's own `render` comes first.     |
| `codeActions` | `CodeAction[]`                                       | Buttons on every fenced code block. Default `[copyCode]`. Nothing runs a block unless an action here does.   |
| `onLink`      | `(href) => void`                                     | A link in a reply, or a link card's Open, was pressed. Nothing navigates by itself; without it, no Open.     |
| `placeholder` | `string`                                             | The composer's. Default "Ask the agent… @ for a file, / for a command".                                      |
| `composer`    | `{ markup?, files?, commands?, pasteAsAttachment? }` | The message box. See [The composer](#the-composer).                                                          |
| `header`      | `boolean \| (session) => ReactNode`                  | The session's line: agent, model and mode pickers, cost, Copy chat. Default `true`.                          |
| `empty`       | `ReactNode`                                          | Shown while the transcript is empty.                                                                         |
| `fallback`    | `ReactNode \| (snapshot) => ReactNode`               | Shown instead of the chat when the harness cannot run here. Default: a line saying why, above an empty chat. |
| `fontSize`    | `number`                                             | Base text size. Default: the theme's.                                                                        |
| `autoFocus`   | `boolean`                                            | Focus the composer on mount. Default `true`.                                                                 |
| `style`       | `StyleProp`                                          | The root box. It fills what it is put in by default (`flexGrow: 1`).                                         |

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

## The composer

The message box is [`<RichTextEditor>`](https://github.com/sidorares/react-x11-components/blob/master/docs/components/rich-text-editor.md#composer)
as a hybrid composer. **What is sent is exactly what was typed** — `2 * 3`
reaches the agent as `2 * 3`, `src/**/*.ts` as `src/**/*.ts` — and markdown
is drawn over it as it is typed: a fence in the code face, coloured; inline
code on a tint; emphasis, headings, quotes and lists with their markers kept
and dimmed. **Once sent, the message is drawn as full markdown** in the
transcript, with the same fences, components and code actions as a reply.

| Key                   | Does                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| Enter                 | Sends. Inside an open fence, or on the line that opens one, it is a new line; on the closing line it sends. |
| Shift+Enter           | A new line.                                                                                                 |
| Tab, Shift+Tab        | In a fence, indent and dedent.                                                                              |
| `@`                   | Lists the files under the agent's `cwd`; a choice is written `@path`, which Claude Code reads.              |
| `/` at a line's start | Lists the agent's commands.                                                                                 |
| Up, on the first line | Brings back what was sent, newest first; Down goes forward to the draft.                                    |
| Escape                | Stops a running turn.                                                                                       |

A paste past ten lines or 2,000 characters becomes an attachment: its token,
`[Pasted text #1 +312 lines]`, stands in the text, and the paste is sent
beside it. A pasted image (a screenshot) is an image attachment.

`composer` turns parts of it off:

```tsx
<AgentChat
  agent="claude"
  composer={{ markup: 'code', files: false, pasteAsAttachment: false }}
/>
```

`markup` is `'markdown'` (default), `'code'` (fences and inline code only) or
`'none'`; nothing it draws changes what is sent.

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

| Member                                      | Notes                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `snapshot`                                  | `{ status, messages, info, capabilities, error, paused, restored, suggestions }`, one immutable object. |
| `subscribe(listener)`                       | Bound, for `useSyncExternalStore(session.subscribe, …)`.                                                |
| `send(text \| { text, attachments, from })` | Mid-turn it steers where the harness can, and queues where it cannot. `from`: see below.                |
| `stop()`                                    | Stops the turn. Queued messages come back as `snapshot.restored`, which the composer takes.             |
| `pause()`, `resume()`                       | Holds the gate.                                                                                         |
| `respond(toolId, choice)`                   | Answers an approval: `'allow-once'`, `'allow-session'`, `'deny'`.                                       |
| `answer(questionId, answers \| null)`       | Answers a question the agent asked.                                                                     |
| `setModel(id)`, `setMode(id)`               | Where `capabilities.models` / `modes`.                                                                  |
| `notify(level, text)`                       | A line in the transcript from the app.                                                                  |
| `toMarkdown()`                              | The transcript, as Copy chat writes it.                                                                 |
| `start()`, `close()`                        | The harness starts at the first `send` unless started; `useAgent` closes it on unmount.                 |

`status` is `'idle'`, `'starting'`, `'running'`, `'waiting'` (on the user),
`'paused'`, `'unavailable'` (the harness cannot run here), `'error'` or
`'closed'`.

### Messages

`messages` is `{ id, role, parts, from?, done?, queued? }[]`. A part is one of:

- `text` and `reasoning`, with `streaming`;
- `tool`: `name`, `label`, `kind`, `title`, `input`, `state` (`input-streaming`
  → `pending` → `awaiting-approval` → `running` → `done`, `error`, `denied`,
  `cancelled`), `output` (`text`, `terminal`, `diff`, `image`, `value`), and
  `children` for a subagent's thread;
- `plan` (Claude's task list, or `TodoWrite`), `question`
  (`AskUserQuestion`), `file`, `notice` and `data`.

Parts are plain data. Approval is a state of the tool part, drawn on its
card, never a dialog.

`suggestions` is what the harness suggests the user might send next
(Claude's `prompt_suggestion`): set once a turn is over, emptied when the
next message is sent.

### What the chat draws

Each of these is a default component in `src/view/`, in a file of its own,
with its sizes and colours from the chat's look:

| Part                                  | Drawn as                                                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan`                                | A checklist, `PLAN · 1 OF 3 DONE` over it: done muted, under way in bold (`PlanChecklist`).                                                     |
| `data` named `pull-request`           | A card: `#7`, what happened to it and where (`PullRequestCard`).                                                                                |
| `data` named `session`                | A card for a session started elsewhere: what it is doing and its address (`SessionCard`).                                                       |
| `data` named `artifact`               | A card for a page the agent published: its title, file and address (`ArtifactCard`).                                                            |
| `data` named `attachments`            | Files the agent sent: an image drawn, read from its path under `cwd`; any other file a row with its size and Open (`AttachmentCard`).           |
| `data` of any other name              | Nothing.                                                                                                                                        |
| a tool's `image` output               | The image, in the opened card, at its size and no taller than the look's `imageHeight` (`ImageView`).                                           |
| an image `file` in the user's message | The picture, no taller than `thumbHeight`, in place of its token.                                                                               |
| `suggestions`                         | Chips under the last reply, once the turn is over. Pressing one puts it in the composer to edit or send; it sends nothing (`SuggestedReplies`). |

A link card's Open, and an attachment's, hands the address to `onLink` (a
file as a `file:` URL). Without `onLink` there is no button, and the
address is still there to read. Copy writes each card as a line with its
link: `> Pull request [#7](https://…) created`.

### Messages from other sessions

A user-role message the user did not write says who did, in `from`:

- `{ kind: 'peer', id, name?, session? }`: another agent session, or a
  process speaking as one. `id` addresses it, `name` is shown.
- `{ kind: 'channel', server }`: an event pushed into the session from
  outside, such as one of Claude Code's MCP channels.

The chat draws such a message on the agent's side, framed and labelled
`Writer · another session` or `ci · channel`, never in the user's bubble.
Copy chat writes it as `**From Writer:**`.

They arrive two ways. The harness may take one itself (a peer's
`SendMessage`, a channel's event), and the driver reports it; a turn starts
with it if none is running. Or the app sends one, by giving `send` a
`from`:

```ts
reviewer.send({
  text: draft,
  from: { kind: 'peer', id: 'writer', name: 'Writer' },
});
```

The harness is told it is not the user's. For Claude that means
`origin: { kind: 'peer' }` and the text wrapped in Claude Code's own
`<cross-session-message>` envelope, delivered as written, with no `@path`
expansion and no slash commands (see [Drivers](drivers.md#claude)). A
message without `from` is the user's, whether they typed it or the app sent
it for them, and the driver says so too.

Stop gives the user back only their own queued messages. A queued message
from another session is not theirs to edit, so it goes with the turn.

Watching one session and messaging another is the app's own code: the
session is a store, so `subscribe` and compare statuses. This hands the
writer's every finished reply to the reviewer:

```ts
let busy = false;
writer.subscribe(() => {
  const { status, messages } = writer.snapshot;
  const last = messages.at(-1);
  if (busy && status === 'idle' && last?.role === 'assistant') {
    reviewer.send({
      text: messageMarkdown(last),
      from: { kind: 'peer', id: 'writer', name: 'Writer' },
    });
  }
  busy = status === 'running' || status === 'waiting' || status === 'paused';
});
```

`examples/peers.tsx` is that, in two panes side by side.

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
DEMO_AGENT=claude DEMO_CWD=~/scratch/demo npm run examples:demo   # the same app, over Claude
npm run examples:claude -- ~/src/my-project
npm run examples:tools       # the app's tools and renderers
npm run examples:intercept   # Run buttons, the gate, a replaced shell
npm run examples:peers       # two sessions; the writer's replies go to the reviewer
```
