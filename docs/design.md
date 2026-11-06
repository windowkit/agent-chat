# Agent chat: the design

> **This is the design record, written in `@react-x11/components` before this
> repository existed.** "This package" and "this repository" in it mean
> `@react-x11/components`; links into it point there. What has been built
> since, and where the build departs from the design, is in
> [Where the build stands](#where-the-build-stands) at the end.

**Status: design (as written).** Nothing was built. The component lives in a package of its
own, `@windowkit/agent-chat`, and this page is its design until that repository
exists. The one part that lands in this repository, the hybrid composer, is
built as props on `<RichTextEditor>` and landed in [sidorares/react-x11-components#1344](https://github.com/sidorares/react-x11-components/pull/1344). Everything here was
checked on 2026-11-06; the versions named are the ones current that day.

```tsx
import { AgentChat } from '@windowkit/agent-chat';

<AgentChat agent="claude" style={{ flexGrow: 1 }} />;
```

That is a working chat with a local Claude Code agent:

- It runs in the process's working directory.
- It uses the harness's own tools, system prompt and permission prompts.
- Its replies stream in as markdown.
- It has stop, copy and a composer that sends on Enter.

Everything else on this page is an opt-in on that same element: the app's own
context, its own functions as tools, its own renderers for what the agent
writes, and its own handlers for anything the agent or the user does.

## What it is for

An app that wants an agent working on its own data, inside its own window:

- a build tool with an assistant that can run the build;
- a notes app whose agent edits the notes folder;
- a database client whose agent writes queries the app runs.

The app wants five things:

1. **Context.** A base prompt, the folders the agent may touch, and which of
   the harness's built-in tools are on.
2. **Its own tools, as functions.** `openTicket(id)` written in the app, with
   no MCP server for the app to run.
3. **Its own renderers.** A ` ```chart ` fence drawn as a chart, a
   `<Ticket id="…"/>` the agent writes drawn as the app's ticket card, and a
   tool's result drawn as something other than JSON.
4. **Chat.** Send, stop, pause, go back to an earlier message, copy.
5. **Interception.** A Run button on a code block calls the app rather than a
   shell, and the agent's own shell commands can go through the app as well.

What it is not:

- **Not a hosted chatbot.** The agent is a local harness the app spawns, which
  owns its session, its transcript and its tools. The UI drives it.
- **Not a model API client.** Calling a model and running the tool loop is the
  harness's job, and each harness does it better than a UI library would.

## Where it lives, and why not here

**In its own repository, `windowkit/agent-chat`, as `@windowkit/agent-chat`.** It does
not fit this package as the rules stand, and one rule decides it: no component
imports another.

**It is a composite.** It needs:

- [`<Markdown>`](https://github.com/sidorares/react-x11-components/blob/master/docs/components/markdown.md), with its fences and components;
- [`<RichTextEditor>`](https://github.com/sidorares/react-x11-components/blob/master/docs/components/rich-text-editor.md), as the composer;
- [`<Code>`](https://github.com/sidorares/react-x11-components/blob/master/docs/components/code.md);
- [`<TerminalOutput>`](https://github.com/sidorares/react-x11-components/blob/master/docs/components/terminal-output.md), for tool output.

This package is for things built on react-x11's public API. `<AgentChat>` is
built on _this_ package's public API. That is the boundary between core and
this package drawn again, one level up: the chat stands on `<Markdown>` and
`<RichTextEditor>` the way `<Flow>` stands on `<glarea>`.

Meeting the rule in place takes one of two contortions, and both are worse
than a package:

- **Promote what it needs into `src/internal/`.** That means `<Markdown>`'s
  whole block renderer and the whole of `<RichTextEditor>`, leaving both
  components as thin wrappers over internals for one consumer's sake.
- **Have the app hand the renderers in** (`markdown={Markdown}`,
  `composer={RichTextEditor}`). That turns rung 0 into wiring.

**Half of it is not UI.** The drivers, the session model and the bridge that
turns a function into a tool use no React. In this package they would ship
behind a `react-x11` peer, so a DOM or terminal front end could not take them
without installing a renderer it does not use.

Two reasons look as if they should count, and do not on their own:

- **It runs only under Node.** So do `<Terminal>`, `<MediaPlayer>` and
  `<Html scripts>`, which spawn processes through `ProcessHost` with the Node
  API written out structurally.
- **The harnesses move every month.** This package already tracks fast-moving
  optional peers (`node-pty`, `quico`, `werift`), and in 0.x a breaking change
  is a minor version.

If the import rule allowed it, both would be ordinary here.

### Considered: a tier for composites, here

The rule could grow an exception instead of the component moving out: a
**kit**, `src/<kit>/`, that may import components by subpath and that nothing
imports.

- **Tree-shaking survives.** A kit drags in what it composes and nothing else,
  and the barrel still bundles to nothing.
- **It keeps co-evolution.** A change to `<Markdown>` or `<RichTextEditor>`
  lands in the same PR as the chat that needs it, with no release in between.
  That is the real thing a separate package gives up.

Against it:

- **The package stops being independent components with one owner each**, and
  every later composite has a precedent to cite.
- **The React-free core ships behind a renderer**, as above.
- **The release wait it saves is the one already lived with** between core and
  this package. The composer and `codeActions` land here as ordinary props
  either way.

So the chat is a package of its own. If iteration across the boundary turns
out to be most of the work, the kit tier is the fallback. It needs a line in
`AGENTS.md`'s tree-shaking rules and an exception in the loop over
`COMPONENTS` in `test/treeshake.test.ts`.

What that costs:

- **`@react-x11/components` is a peer dependency**, for the same reason
  `react-x11` is one here. With two copies installed the app throws at import:
  `registerElement` refuses a second, different definition of `<richtext>`
  (react-x11's `src/registry.js`).
- **Components are imported by subpath only** (`/markdown`,
  `/rich-text-editor`, `/terminal-output`), never through the barrel.
- **A feature it needs from a component is a release of this package first**,
  the same wait as a core feature is for this one. While M0 to M2 move both
  sides at once, the agent package is developed against a linked checkout of
  this one (a `file:` spec), and the floor moves when a release lands.

The package:

| Entry                   | What                                                                                             | Depends on                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `@windowkit/agent-chat` | `<AgentChat>`, `useAgent`, `defineTool` (with `render`), the view's parts                        | peers: `react`, `react-x11`, `@react-x11/components`                             |
| `./core`                | `AgentSession`, the drivers, `defineTool` (without `render`), the tool bridge, the message model | nothing; optional peer `@anthropic-ai/claude-agent-sdk`; Node's modules directly |
| `./drivers/<name>`      | each driver, so a bundle that names one carries one                                              | as above                                                                         |
| `./testing`             | `FakeDriver`, the transcript recorder and player                                                 | none                                                                             |

Each driver is reached by a dynamic `import()` from the core, as
`<Terminal>`'s vt backend is: `<AgentChat agent="claude">` loads no ACP code,
and the reverse.

What this repository grows for it — each useful without the agent package:

| Change                                                                                           | Where                                  | State                                                                                                         |
| ------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| The hybrid composer: `markup`, fence-aware `submitOnEnter`, atoms, paste as attachment, `recall` | `<RichTextEditor>`                     | Landed in [#1344](https://github.com/sidorares/react-x11-components/pull/1344): [The composer](#the-composer) |
| `codeActions`: buttons on a fenced block that call the app                                       | `<Markdown>`                           | Designed here: [Intercepting actions](#intercepting-actions)                                                  |
| A `diff` tokenizer, for edit tool cards                                                          | `src/code-language/`                   | Small; with M1                                                                                                |
| The row windowing `<Tree>` and `<Table>` share, as a shared module with a subpath                | `src/internal/window.ts`, `heights.ts` | Only if long transcripts measure slow ([The view](#the-view))                                                 |

Nothing is asked of core.

## The harnesses an app can drive

Three surfaces matter, and the rest of the field reaches one of them.

### The Claude Agent SDK

`@anthropic-ai/claude-agent-sdk` 0.3.318. It bundles Claude Code 2.1.318 as a
native binary in a per-platform optional dependency, and `query()` spawns it
and speaks to it over stdio. One session is one process; budget about 1 GiB
for it. What it offers a UI is more than any other surface:

- **Streaming input.** `query({ prompt: AsyncIterable<SDKUserMessage> })`
  keeps one process across turns. `streamInput()` adds messages, and a
  message's `priority` (`now`, `next`, `later`) says how one sent mid-turn is
  delivered. This is the recommended mode, and the V2 session API was removed
  in favour of it.
- **The `Query`'s methods:**
  - control: `interrupt()`, `setPermissionMode()`, `setModel()`;
  - introspection: `supportedCommands()`, `supportedModels()`,
    `getContextUsage()`;
  - files: `rewindFiles(userMessageId)`.
- **Context:**
  - `systemPrompt`: a string, which replaces the prompt, or
    `{ type: 'preset', preset: 'claude_code', append }`;
  - `cwd`, `additionalDirectories`;
  - `settingSources`, which loads `CLAUDE.md` and settings;
  - `tools`, which sets what exists, and `disallowedTools`, which removes
    tools or denies matching calls.
- **In-process tools.** `createSdkMcpServer({ tools: [tool(name, description,
zodShape, handler)] })`. The handler is the app's function, in the app's
  process, named `mcp__<server>__<tool>` to the model.
- **`toolAliases`** routes a built-in name to the app's tool:
  `{ Bash: 'mcp__app__shell' }` makes the agent's shell calls run through a
  function the app wrote.
- **`canUseTool(name, input, { signal, suggestions, toolUseID })`** answers
  every call that falls through to a prompt. It returns `allow`, optionally
  with `updatedInput` and `updatedPermissions`, or `deny` with a message, and
  may stay pending as long as it likes. A `PreToolUse` hook sees every call,
  not only the ones that would prompt. `AskUserQuestion` is answered through
  `canUseTool`, by returning its answers in `updatedInput`.
- **Sessions:**
  - `listSessions()`, `getSessionMessages()`;
  - `forkSession(id, { upToMessageId })`, or `resume` with `forkSession` and
    `resumeSessionAt`;
  - with `enableFileCheckpointing`, `rewindFiles()` restores the files Edit,
    Write and NotebookEdit changed. Bash's changes are not tracked.
- **Placement.** `spawnClaudeCodeProcess(options)` runs the process wherever
  the app says: a container, a VM, a host over ssh.
- **Auth.** An API key, Bedrock, Vertex, Foundry, or Claude Platform on AWS.
  A third-party product built on the SDK may not offer claude.ai login unless
  Anthropic approved it, so this component never does.

Two traps the survey found:

- **Pass `permissionMode` explicitly.** The docs and `sdk.d.ts` disagree about
  where a session starts, and in `auto` mode a classifier decides calls that
  never reach `canUseTool`.
- **`env` replaces the environment** rather than adding to it.

### ACP, the Agent Client Protocol

JSON-RPC over the agent's stdio; `@agentclientprotocol/sdk` 2.4.0. Its agents
list has 49 entries:

- **Native:** Gemini CLI, GitHub Copilot CLI, Cursor's `agent`, opencode,
  goose, Cline, Kimi, Qwen Code, Mistral Vibe, OpenHands, and xAI's Grok Build
  (`grok agent stdio`).
- **Through adapters maintained under the ACP organisation:** Claude
  (`@agentclientprotocol/claude-agent-acp`) and Codex
  (`@agentclientprotocol/codex-acp`).

It is by far the widest reach, and the model it streams is close to the one
every UI library converged on:

- **`session/update`** carries `agent_message_chunk`, `agent_thought_chunk`,
  `tool_call` and `tool_call_update` (with a `kind`, a `status`, and content
  of type `content`, `diff` or `terminal`), `plan`,
  `available_commands_update`, `usage_update` and others.
- **`session/request_permission`** offers typed options: `allow_once`,
  `allow_always`, `reject_once`, `reject_always`.
- **Model and mode** are config options.
- **Sessions:** `session/list` and `session/load` or `session/resume`.

What v1 cannot say, and so what a driver over it loses:

- **The app's tools as functions.** Only as MCP servers passed to
  `session/new`. MCP-over-ACP, which tunnels a server through the protocol,
  is an active RFD with no shipping agent.
- **Turning built-in tools off**, hooks, and rewriting a tool's result.
- **Rewind.** Fork exists only as a draft that some adapters accept.
- **The system prompt.** `systemPrompt: { mode: 'append' | 'override' }` on
  `session/new` is a preview RFD (2026-10-30). claude-agent-acp takes both
  modes and codex-acp only `append`.
- **Steering mid-turn.**

And one thing it says now that it will stop saying: v1 has the client run the
agent's file reads and writes (`fs/*`) and its terminals (`terminal/*`). The v2
draft removes both ("Remove the v1 Client filesystem and terminal execution
surface from v2"). So interception is not built on the client executing tools.

### Codex

Codex has two surfaces, and the app-server is the one worth driving:

- **`@openai/codex-sdk` 0.167.0** spawns `codex exec --experimental-json`. It
  has threads, resume, item-level events, no token deltas, no approval
  callback, and no tools of the app's own.
- **`codex app-server`** speaks JSON-RPC over stdio:
  - `thread/start` takes `cwd`, `baseInstructions`,
    `developerInstructions`, `approvalPolicy`, `sandbox`, and
    `dynamicTools` (experimental; the server calls the client back for each
    use).
  - `thread/fork` and `thread/revert` (rewind: "remove a specified turn and
    every later turn").
  - `turn/steer`, `turn/interrupt`.
  - Deltas for text, reasoning, command output and diffs.
  - Approval requests answered `accept`, `acceptForSession`, `decline` or
    `cancel`.
  - `generate-ts` writes its schema as TypeScript.

### The rest

| Harness                              | Surface                   | Notes for a driver                                                                                  |
| ------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------- |
| Gemini CLI 0.67                      | ACP; `stream-json`        | Its SDK (`instructions`, `tool()`, sessions) is in the repo, not on npm                             |
| Grok Build (xAI, beta since 2026-05) | ACP; `streaming-json`     | No SDK                                                                                              |
| opencode 1.19                        | HTTP + OpenAPI + SSE; ACP | `system`, a tools map, fork, `revert` (rewind), a permission endpoint, tools as server-side plugins |
| GitHub Copilot SDK 1.0 (GA)          | JSON-RPC to the CLI; ACP  | `defineTool` (can override built-ins), `systemMessage`, `onPermissionRequest`, hooks; no fork found |
| Cursor SDK 1.3                       | In-process; ACP           | `customTools` (as MCP), `systemPrompt`, a host-supplied virtual fs; no approval callback            |
| pi 1.5                               | In-process SDK; JSONL RPC | `customTools`, a session tree with fork, `steer`; gating is an extension's                          |
| goose, Kimi, Qwen, Cline, Vibe       | ACP                       | Through the ACP driver                                                                              |
| Amp, OpenHands, Aider                | SDK or CLI                | Not in the first milestones                                                                         |

Three frontend protocols came up and none is a driver:

- **AG-UI.** CopilotKit's protocol between an app and an agent backend over
  HTTP: stateless per run, and no coding CLI speaks it.
- **A2A.** For remote agents talking to each other.
- **MCP Apps.** A tool result points at an HTML resource that a host draws in
  a sandboxed frame. That is a rendering question, and
  [`<Html>`](https://github.com/sidorares/react-x11-components/blob/master/docs/components/html.md) is the engine for it here, later
  ([Rendering custom data](#rendering-custom-data)).

## One library, not one per agent

**One UI and one session model, over a driver per harness family.** The UI
never asks which agent it is driving; it asks what the session can do.

Why not one component per agent:

- **The UI is the same.** Transcripts, streamed markdown, tool cards,
  approvals, the composer, copy and stop are the same whoever answers. The
  parts that differ are a handful of capabilities: whether the app's tools run
  in-process, whether a session can fork or rewind, whether every tool call
  passes through the host or only the ones that ask. A flag per capability
  says all of that. A component per agent would say it by copying the rest.
- **The model is converging.** Every surface above streams the same shapes:
  message deltas, thought deltas, tool calls with status and content, plans,
  typed permission options.

Why not ACP alone, though it reaches the most agents:

- **It cannot carry the app's functions** except as an MCP server the app's
  process has to host.
- **It cannot turn a built-in off, rewind, or (outside a preview) set the
  system prompt.**
- **The Claude adapter is itself built on the Agent SDK**, so driving Claude
  through it gives up `toolAliases`, `canUseTool`, hooks, `forkSession` and
  `rewindFiles` for nothing.

So there are three drivers:

| Driver   | Over                                  | Reaches                                                                                           | When |
| -------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- | ---- |
| `claude` | the Agent SDK, in-process             | Claude                                                                                            | M1   |
| `acp`    | ACP v1 over a spawned process's stdio | Gemini, Copilot, Cursor, opencode, goose, Grok Build, Kimi, Qwen, Cline, Vibe, Codex (adapter), … | M3   |
| `codex`  | `codex app-server` over stdio         | Codex, with `dynamicTools`, fork, revert and steer                                                | M4   |

An app can bring a fourth: `AgentDriver` is public, for the reason
`ProcessHost` and `PtyHost` are. Driving pi's RPC mode or opencode's server is
a real thing to want, and should not need a fork.

### What a session can do

Every session reports this, and the UI shows an action only where it works:

| Capability        | `claude`                              | `acp`                                       | `codex`                         |
| ----------------- | ------------------------------------- | ------------------------------------------- | ------------------------------- |
| `tools`           | `'in-process'`                        | `'bridge'` (MCP the app's process hosts)    | `'dynamic'`, else `'bridge'`    |
| `systemPrompt`    | `'replace'` and `'append'`            | where the agent takes the RFD, else `false` | `'replace'` and `'append'`      |
| `coreTools`       | `'remove'`                            | `'deny-when-asked'`                         | `'sandbox'`                     |
| `gate`            | `'every-call'` (a `PreToolUse` hook)  | `'asked-calls'`                             | `'asked-calls'`                 |
| `steer`           | `true` (`priority`)                   | `false`: queued to the turn's end           | `true` (`turn/steer`)           |
| `fork`            | `true`                                | where the adapter takes `session/fork`      | `true`                          |
| `rewindFiles`     | `'edits'` (not Bash's)                | `false`                                     | `false`                         |
| `rewind`          | `false`: a fork stands in             | `false`                                     | `true` (`thread/revert`)        |
| `sessions`        | list, read, resume                    | list, load or resume                        | list, resume                    |
| `models`, `modes` | `supportedModels()`, permission modes | config options                              | `model/list`, approval policies |

Two rules hold the table honest:

- **An action with no capability behind it is not drawn.** No Edit button
  where a session cannot fork. This is assistant-ui's rule, where Edit
  appears because `onEdit` exists.
- **A setting the driver can only approximate says so in its value.**
  `coreTools` over ACP is `'deny-when-asked'`, because an ACP agent that reads
  a file without asking cannot be stopped from the client.

## What the React libraries settled

None of them can be used under react-x11 as they are, since their components
are DOM elements. Their designs carry over, and so does a precedent:
assistant-ui runs a terminal binding, `@assistant-ui/react-ink`, over a core
whose only peer is React. A react-x11 view is that kind of sibling.

| Library                        | What it settles here                                                                                                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| assistant-ui 0.15              | A small runtime adapter; actions that appear because a handler exists; a client-side branch tree with a branch picker; tool renderers keyed by name with a fallback; a code-block header slot handed `{ language, code }`, which is where a Run button goes                         |
| Vercel AI SDK UI 7 (`useChat`) | The message model: `{ id, role, parts }`, with tool parts on a state machine (`input-streaming` … `approval-requested` … `output-available`, `output-error`, `output-denied`) and `data-*` parts reconciled by id. An in-process transport (`DirectChatTransport`) for desktop apps |
| CopilotKit 1.84 (`/v2`)        | `useFrontendTool({ name, parameters, handler, render })`: a tool and its renderer defined together. `useRenderTool` with a `"*"` wildcard                                                                                                                                           |
| LangChain `useStream` 1.x      | Per-message selector hooks, so a token re-renders one message. Branches as server checkpoints (`forkFrom`) once the server owns the session                                                                                                                                         |
| Streamdown 2.7                 | Fence renderers by language, handed `isIncomplete`. And a warning: adding a button to a code block means replacing its whole renderer                                                                                                                                               |
| Chainlit, ChatKit              | Actions inside content are data, `{ name, payload }`, dispatched to one handler of the host's                                                                                                                                                                                       |
| Zed's agent panel              | A session is a flat list of entries, and waiting for approval is a status of the tool call (`WaitingForConfirmation`), not a dialog                                                                                                                                                 |

The cliffs they show, which this design is built to avoid:

- **assistant-ui changes who owns the state** between its two runtimes.
- **CopilotKit keeps two generations of hooks**, with props renamed.
- **LangChain dropped branches in v1.**
- **AI SDK renamed `addToolResult` and moved approvals.** Its component kit is
  being deprecated this month.

## The ladder

**Ceremony is additive** (the rule [the table](https://github.com/sidorares/react-x11-components/blob/master/docs/prd-table.md#the-continuity-contract)
states). The bottom rung is the same element as the top one, and every rung is
a small diff to the code before it. One chat, growing:

**0. A chat with the local agent.**

```tsx
<AgentChat agent="claude" />
```

**1. Context:** where it works, what it is told, what it may use.

```tsx
<AgentChat
  agent="claude"
  cwd={project.root}
  folders={[project.docs]}
  instructions="You are the build assistant for Acme. Prefer `make` targets."
  coreTools={{ web: false }}
/>
```

**2. The app's own tools, as functions.** The chat gains one prop.

```tsx
const openTicket = defineTool({
  description: 'Open a ticket in the tracker by id.',
  parameters: z.object({ id: z.string() }),
  run: ({ id }) => tracker.open(id),
});

<AgentChat agent="claude" cwd={project.root} tools={{ openTicket }} />;
```

**3. Drawing what a tool returns, and what the agent writes.** The tool gains
`render`, and the chat gains `fences` and `components`.

```tsx
const openTicket = defineTool({
  description: 'Open a ticket in the tracker by id.',
  parameters: z.object({ id: z.string() }),
  run: ({ id }) => tracker.open(id),
  render: ({ output }) => output && <TicketCard ticket={output} />,
});

<AgentChat
  agent="claude"
  cwd={project.root}
  tools={{ openTicket }}
  fences={{
    chart: {
      render: (f) => <Chart spec={f.text} />,
      describe: 'a Vega-Lite spec, as JSON',
    },
  }}
  components={{
    Ticket: {
      component: TicketLink,
      describe: '<Ticket id="ACME-12"/> links a ticket',
    },
  }}
/>;
```

**4. Intercepting:** a Run button that calls the app, a gate on tool calls, and
the shell replaced by the app's own.

```tsx
<AgentChat
  agent="claude"
  cwd={project.root}
  tools={{ openTicket }}
  codeActions={[
    copyCode,
    {
      id: 'run',
      label: 'Run',
      when: (f) => f.lang === 'sh',
      run: (f) => app.run(f.text),
    },
  ]}
  onToolCall={(call) =>
    call.kind === 'execute' && !app.trusted ? 'ask' : undefined
  }
  coreTools={{ web: false, shell: app.shellTool }}
/>
```

**5. The app drives the session:** a menu sends, a status bar reads. The
session's props move into `useAgent`, unchanged.

```tsx
const agent = useAgent({
  agent: 'claude',
  cwd: project.root,
  tools: { openTicket },
});
menu.on('explain', () => agent.send('Explain the failing test'));

<AgentChat session={agent} codeActions={[copyCode, runAction]} />;
```

**6. A driver option nobody wrapped,** passed through and applied last.

```ts
useAgent({ agent: 'claude', driverOptions: { claude: { maxBudgetUsd: 2 } } });
```

**7. A harness of the app's own,** behind the same view.

```ts
useAgent({ agent: piDriver({ command: ['pi', '--mode', 'rpc'] }) });
```

| When the chat needs…                    | …it adds                                     | and nothing else moves                                     |
| --------------------------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| a chat                                  | `agent`                                      | —                                                          |
| its own working directory, more folders | `cwd`, `folders`                             | —                                                          |
| its own instructions                    | `instructions`, or `systemPrompt` to replace | the harness keeps its own prompt under `instructions`      |
| fewer built-in tools                    | `coreTools`                                  | permissions and the gate are unchanged                     |
| a function the agent can call           | `tools`                                      | its calls are drawn, gated and copied as any tool's        |
| that function's result drawn            | the tool's `render`                          | other tools keep the default card                          |
| a fence or tag drawn                    | `fences`, `components`                       | the same seams as `<Markdown>`'s, with the same keys       |
| a Run button                            | `codeActions`                                | Copy is still there; nothing runs unless an action says so |
| a policy on tool calls                  | `permissions`, `onToolCall`                  | approvals are still drawn inline for what the policy asks  |
| a built-in replaced by the app's        | that `coreTools` key set to a tool           | the agent still calls it by its old name                   |
| the session outside the view            | `useAgent(options)` and `session`            | the options are the same object, moved, not rewritten      |
| a driver option nobody wrapped          | `driverOptions`                              | applied last, over what the props set                      |

Three rules keep it a ladder:

1. **Opt-ins are orthogonal.** No prop changes what another means. The one
   deliberate coupling is `session`: a component handed a session ignores the
   session's options as props, and the type says so (a discriminated union, as
   `<Table>`'s selection is).
2. **The session's options are one type.** `useAgent(options)` takes exactly
   what `<AgentChat>` takes for its session, so lifting it is a move.
3. **A capability the driver lacks never changes a prop's meaning.** It hides
   an action or reports itself in `session.capabilities`, and a development
   build warns once when a prop asks for something the driver cannot do (a
   `systemPrompt` on an ACP agent without the RFD).

## The session model

`./core` keeps the session as plain data, reduced from what the driver
reports. The view reads it through per-message subscriptions
(`useSyncExternalStore` over a store), so a streamed token re-renders one
message and nothing above it.

```ts
interface AgentSession {
  readonly status:
    | 'starting'
    | 'idle'
    | 'running'
    | 'waiting'
    | 'paused'
    | 'unavailable'
    | 'error'
    | 'closed';
  readonly messages: readonly AgentMessage[]; // the branch being shown
  readonly capabilities: Capabilities;
  readonly info: SessionInfo; // id, cwd, model, models, modes, commands, usage
  send(input: string | ComposedMessage, opts?: { steer?: boolean }): void;
  stop(): Promise<void>;
  pause(): void; // where capabilities.gate is 'every-call'
  resume(): void;
  edit(messageId: string, input: string | ComposedMessage): Promise<void>; // where it can fork
  retry(messageId: string): Promise<void>;
  rewindFiles?(
    messageId: string,
    opts?: { dryRun?: boolean },
  ): Promise<RewindReport>;
  branches(messageId: string): BranchInfo; // which versions of this message exist
  switchBranch(messageId: string, index: number): Promise<void>;
  setModel(id: string): Promise<void>;
  setMode(id: string): Promise<void>;
  toMarkdown(): string;
  subscribe(listener: () => void): () => void;
  close(): Promise<void>;
}

interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: readonly Part[];
}

type Part =
  | { type: 'text'; text: string; streaming: boolean }
  | { type: 'reasoning'; text: string; streaming: boolean }
  | ToolPart
  | {
      type: 'plan';
      entries: readonly {
        text: string;
        status: 'pending' | 'in_progress' | 'completed';
      }[];
    }
  | QuestionPart // AskUserQuestion, ACP elicitation, Codex requestUserInput
  | {
      type: 'file';
      path?: string;
      mime: string;
      data?: Uint8Array;
      label: string;
    } // attachments
  | { type: 'notice'; level: 'info' | 'warning' | 'error'; text: string } // compaction, retries, limits
  | { type: 'data'; name: string; id: string; value: unknown }; // a driver's or the app's own

interface ToolPart {
  type: 'tool';
  id: string;
  name: string; // what the model called: 'Bash', 'mcp__app__openTicket'
  label: string; // what is shown: 'Bash', 'openTicket'
  kind:
    | 'read'
    | 'edit'
    | 'delete'
    | 'move'
    | 'search'
    | 'execute'
    | 'think'
    | 'fetch'
    | 'other';
  title: string; // 'Read src/app.ts', 'make test'
  input: unknown;
  inputText: string; // the JSON as it streams
  state:
    | 'input-streaming'
    | 'pending'
    | 'awaiting-approval'
    | 'running'
    | 'done'
    | 'error'
    | 'denied'
    | 'cancelled';
  approval?: {
    options: readonly ApprovalOption[];
    respond(option: ApprovalOption['id'], note?: string): void;
  };
  output: readonly ToolOutput[];
  children?: readonly AgentMessage[]; // a subagent's own thread
}

type ToolOutput =
  | { type: 'text'; text: string }
  | { type: 'terminal'; data: string | Uint8Array; exitCode?: number }
  | { type: 'diff'; path: string; oldText: string | null; newText: string }
  | { type: 'image'; mime: string; data: Uint8Array }
  | { type: 'value'; value: unknown }; // what an app tool returned, for its render
```

The shape is the one the libraries converged on, with ACP's tool `kind` and
content types. Four decisions in it:

- **Approval is a state of the tool part**, not a dialog. A tool waiting for
  the user is drawn where it is in the transcript, with its typed options
  (allow once, allow for the session, deny, deny with a note). That is what
  Zed, the AI SDK and assistant-ui each arrived at. A modal hides the very
  thing being approved.
- **Deltas, not snapshots.** A driver reports increments and the reducer
  accumulates them. assistant-ui's runtime takes cumulative content, and its
  docs warn that a tool part vanishes if it is not carried across yields. One
  rule for every driver closes that.
- **Branches are a tree of harness sessions.** An edit forks the harness's
  session at the edited message. The new session becomes the shown branch and
  the old one stays, resumable, behind the branch picker. With an agent that
  owns its transcript, that is the only way a branch is real. A client-side
  tree over one session would show history the agent no longer has.
- **Data parts are reconciled by id** (the AI SDK's rule). A driver or an app
  tool that updates a progress card sends the same id again rather than
  appending cards.

## Custom tools

The app writes a function and names its arguments. Getting it to the agent is
the driver's business.

```ts
const openTicket = defineTool({
  description: 'Open a ticket in the tracker by id.',
  parameters: z.object({ id: z.string().describe('like ACME-12') }),
  run: async ({ id }, { signal, progress }) => {
    progress('Looking it up…');
    return tracker.open(id, { signal }); // a value, a string, or MCP content
  },
  ask: false, // the app wrote it, so it runs without asking (the default)
  title: ({ id }) => `Open ${id}`,
});
```

- **`parameters`** is a Standard Schema (zod 4, valibot, arktype) or a plain
  JSON Schema object. The schema validates the input before `run` sees it,
  and a failure goes back to the model as a tool error rather than throwing
  in the app.
- **`run`** may return:
  - a string, which is sent as text;
  - a value, sent as JSON text with `structuredContent` and handed to
    `render` as is;
  - MCP content.

  A throw is an error result the model sees, and the turn goes on.

- **The calls are tool parts like any other.** They are drawn, gated by
  `onToolCall`, stopped by `stop()`, and labelled `openTicket` rather than
  `mcp__app__openTicket`.

How each driver carries it:

| Driver   | How the function reaches the agent                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude` | `createSdkMcpServer` in the app's process. Nothing is spawned and nothing listens; the handler is the function. Its names go in `allowedTools`, unless `ask`                                                                                                                                                                                                                                                                       |
| `codex`  | `dynamicTools` on `thread/start`, answered when the server calls back. Experimental: behind `capabilities.experimentalApi`, and the bridge where it is refused                                                                                                                                                                                                                                                                     |
| `acp`    | **The bridge:** a small MCP server (`initialize`, `tools/list`, `tools/call`) the core runs in the app's process, passed in `session/new.mcpServers`. Over HTTP on `127.0.0.1` with a random path where the agent declares `mcpCapabilities.http`; otherwise a stdio entry naming a bridge script in the package, which connects back over a Unix socket. MCP-over-ACP replaces both where an agent declares `mcpCapabilities.acp` |

The bridge is a few hundred lines of JSON-RPC and needs no MCP SDK. It is the
whole difference between "an MCP server" and "a function" from the app's side.

## Context: prompts, folders, core tools

| Prop           | `claude`                                                  | `acp`                                                                                                     | `codex`                 |
| -------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------- |
| `instructions` | preset `claude_code` with `append`                        | `systemPrompt: { mode: 'append' }` where taken; otherwise sent as a first context message, with a warning | `developerInstructions` |
| `systemPrompt` | a string `systemPrompt`                                   | `mode: 'override'` where taken; otherwise refused, with a warning                                         | `baseInstructions`      |
| `cwd`          | `cwd`                                                     | `session/new.cwd`                                                                                         | `cwd`                   |
| `folders`      | `additionalDirectories`                                   | `additionalDirectories`                                                                                   | `additionalDirectories` |
| `settings`     | `settingSources`: `'cli'` is all three, `'isolated'` none | n/a: the agent's own                                                                                      | `config` overrides      |

**`coreTools`** names what the agent can do, not what one harness calls it.
Each key is `true` (the default), `false` (removed), `'ask'` (always asks), or
a tool of the app's that replaces the built-in:

| Key      | `claude`                          | `codex`                           | `acp` (by tool `kind`)   |
| -------- | --------------------------------- | --------------------------------- | ------------------------ |
| `shell`  | `Bash`, `BashOutput`, `KillShell` | command execution; sandbox        | `execute`                |
| `read`   | `Read`, `Glob`, `Grep`            | always on (the sandbox reads)     | `read`, `search`         |
| `edit`   | `Edit`, `Write`, `NotebookEdit`   | file changes; sandbox `read-only` | `edit`, `delete`, `move` |
| `web`    | `WebFetch`, `WebSearch`           | `webSearchMode`, network access   | `fetch`                  |
| `agents` | `Agent`                           | n/a                               | n/a                      |
| `todos`  | `TodoWrite` and the Task tools    | the plan, always on               | the plan, always on      |

A harness's own name is a key too (`coreTools={{ NotebookEdit: false }}`), for
what the categories do not cover.

**`settings` defaults to `'cli'`:** the harness behaves as it does when the
user runs it, with their `CLAUDE.md` and permission rules. An app that must not
pick those up passes `'isolated'`. See [Open questions](#open-questions).

## Rendering custom data

Three seams, each keyed the way the libraries key them:

- **`fences`**, by the fence's language. This is `<Markdown>`'s seam, handed
  through, and the renderer gets `partial` while the fence is still arriving.
- **`components`**, by tag name. Also `<Markdown>`'s seam: a tag is a
  component iff its name is a key, and nothing is evaluated. `scope` is never
  passed, because what an agent writes is a document nobody here wrote.
- **`renderTool`**, by the tool's label, with `'*'` for every other tool, and
  each `defineTool`'s own `render` ahead of it. A renderer gets the
  `ToolPart`, so it can draw the input while it streams, the approval row, and
  the output.

**An entry may describe itself, and then the agent is told.** A fence or a
component given as `{ render, describe }` (or `{ component, describe }`)
rather than a bare function adds one line per entry to the instructions:

> The UI draws a fenced block tagged `chart` as a chart: a Vega-Lite spec, as
> JSON.

Without `describe`, nothing is added, and the app says it in `instructions`
itself. This is the bridge from what the UI can draw to what the model knows to
write. Without it, a renderer would wait for a fence nobody tells the agent to
write.

**MCP Apps, later.** A tool whose result points at a `ui://` HTML resource is
drawn by [`<Html scripts>`](https://github.com/sidorares/react-x11-components/blob/master/docs/components/html.md) in a frame of its own, with the
postMessage bridge the extension specifies. This needs nothing from the drivers,
since it is a property of the tool's result. It is the stretch rung, after M5.

## Intercepting actions

Three levels, from what the user does to where the agent runs.

### What the user does inside a message

- **`codeActions`** are buttons on a fenced block's header.
  ```ts
  interface CodeAction {
    id: string;
    label: string;
    icon?: IconName; // core's affordance set
    when?: (fence: FenceInfo) => boolean;
    run: (
      fence: FenceInfo,
      ctx: { session: AgentSession; message: AgentMessage },
    ) => void | Promise<void>;
  }
  ```
  - The default list is `[copyCode]`. **Nothing runs a fence unless the app
    passed an action that does**, the same posture `<Html>` takes with
    `scripts`.
  - An action is not drawn while its fence is still streaming: `partial`
    hides it.
  - `ctx.session.send()` is how an action reports back. Run the block, then
    hand the output to the agent as the next message, or attach it to the
    draft.
  - This is a `<Markdown>` prop first. A header slot handed `{ language,
code }` is the shape assistant-ui found. Streamdown shows the shape to
    avoid: there a button means replacing the whole code renderer.
- **`messageActions`** extend Copy, Edit and Retry on a message.
- **`onLink(href)`** and **`onOpenFile(path, line)`**: nothing navigates and
  nothing opens by itself. A path the agent mentions, or a tool card names, is
  a link to the app.

### What the agent is about to do

**`onToolCall(call)`** runs before a tool call executes and answers:

- `'allow'` or `'allow-always'` (for the session);
- `'deny'`, or `{ deny: reason }`, which goes back to the model;
- `{ allow: true, input }`, which runs with changed arguments;
- `'ask'` or `undefined`: the user decides, through the approval row.

**`permissions`** is the policy under it:

- `'ask'` (the default): reads run, everything else asks.
- `'edits'`: edits run as well.
- `'read-only'`: nothing that changes anything runs.
- `'auto'`: the harness's own classifier, where it has one.

Running everything unasked is `driverOptions`' business, not a preset, so it is
never one keystroke away.

Where the gate sits, by driver:

- **`claude`:** `onToolCall` runs from a `PreToolUse` hook, so it sees every
  call, and the approval row answers `canUseTool`. `permissionMode` is always
  passed explicitly, for the reason given above.
- **`codex`:** approvals and the sandbox.
- **`acp`:** `session/request_permission`, which only sees the calls the agent
  asks about. `capabilities.gate` says `'asked-calls'`.

"Allow always" lasts the session unless `rememberApprovals` is set. The SDK
would otherwise write a rule into the project's `.claude/settings.local.json`,
which an embedded app should not do behind the user's back.

### Where the agent's actions run

- **A built-in replaced by the app's function.** `coreTools={{ shell:
app.shellTool }}` removes the built-in and adds the tool. On `claude` it also
  sets `toolAliases`, so a model that calls `Bash` anyway (because a skill
  told it to) reaches the app's function rather than an unknown tool. On
  `codex` the sandbox goes read-only and the tool is a dynamic one. On `acp`,
  where nothing can be removed, the function is added and execute-kind calls
  are denied when asked. That is weaker, and `coreTools` reports it.
- **The whole agent somewhere else.** `spawn`, `ProcessHost`-shaped with
  stdin added, places the harness process in a container, a VM or over ssh.
  It is Claude's `spawnClaudeCodeProcess`, and the process the `acp` and
  `codex` drivers start.
- **ACP's client fs and terminal (v1 only).** An `acp` session advertises
  `fs` and `terminal` when the app passes `host` (`readFile`, `writeFile`,
  `terminal`): an overlay filesystem, or a terminal in the app's runner.
  Because v2 removes them, nothing else here depends on them.

### Pause and steer

- **`pause()`** holds every tool call at the gate until `resume()`. Text keeps
  streaming to the end of the step, and the agent stops at its next action.
  It exists where `capabilities.gate` is `'every-call'` (`claude`). Elsewhere
  the button is not drawn: holding only the calls that ask would be a pause
  that sometimes does not pause.
- **Sending while the agent runs** steers where the driver can
  (`priority: 'next'`, `turn/steer`). Otherwise the message is queued, drawn
  as queued, and sent as the turn ends.

## Chat functionality

| Action                  | What it does                                                                                                                      | Where it is not drawn                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Send                    | Enter in the composer, or the button. Attachments and mentions go as parts (a `resource_link` over ACP, an image block to Claude) | —                                     |
| Stop                    | Escape, or the button: `interrupt()`, `turn/interrupt`, `session/cancel` (which answers pending approvals as cancelled)           | —                                     |
| Pause                   | Above                                                                                                                             | `gate !== 'every-call'`               |
| Edit an earlier message | Forks at it, sends the edit, and leaves the old branch behind a picker                                                            | no `fork`                             |
| Retry                   | Forks at the user message before it and sends that message again                                                                  | no `fork`                             |
| Restore files           | Offered with Edit and Retry. A dry run first lists what would change and what cannot be undone (Bash's edits)                     | no `rewindFiles`                      |
| Copy                    | A message's markdown, a block's code, or `toMarkdown()` for the transcript                                                        | —                                     |
| Answer a question       | `AskUserQuestion`, an ACP elicitation and Codex's `requestUserInput` are one `QuestionPart`, a form in the transcript             | —                                     |
| Approve a plan          | A plan card with Approve and Keep planning, for Claude's `ExitPlanMode`                                                           | see [Open questions](#open-questions) |
| Switch model or mode    | From `info.models` and `info.modes`                                                                                               | none reported                         |
| Slash commands          | The composer's `/` list, from the harness's commands plus the app's own                                                           | —                                     |
| Sessions                | `<AgentSessions>`, a list a session can be resumed from, over each driver's listing                                               | no `sessions`                         |

## The composer

**It is `<RichTextEditor>`, not a new component, and not WYSIWYG.** Most
harness UIs format some text as it is typed (fences, inline code, mentions) and
leave the rest plain. The balance chosen here is that **the value is exactly
what was typed**. Formatting is drawn over the literal text as decorations and
never converts it. That is the posture of Discord, Zed's agent panel and VS
Code's chat input.

The editor's markdown mode is the wrong side of that line for a prompt,
because its serializer normalizes and escapes (`src/internal/markdown/stringify.ts`):

- `2 * 3` would reach the agent as `2 \* 3`;
- `src/**/*.ts` as `src/\*\*/\*.ts`;
- a `*` bullet comes back as `-`.

That is right for notes and wrong for an instruction.

`format="text"` is most of the answer already: one paragraph per line, written
back literally, inline atoms serialized through `leafText`, with suggestions,
undo, IME and paste as they are. What it gains, as opt-in props on
`<RichTextEditor>` in this repository:

1. **Lines without the paragraph gap** in a text document. Today it reads
   double-spaced.
2. **`markup`** (`'none'`, `'code'`, `'markdown'`), decorations from a scan of
   the literal text:
   - fences: the fence lines dimmed, the body monospace on one band and
     syntax-coloured by the existing tokenizers;
   - inline code: monospace on a tint, with the backticks dimmed;
   - `'markdown'` adds emphasis, headings, quotes and list markers, with the
     markers left visible.
3. **`submitOnEnter` that knows a fence:** Enter inside an open fence, or on
   a line that opens one, breaks the line. Tab indents there.
4. **Atoms for a composer:**
   - mentions and attachments, in a `composerSchema`, each writing a token
     such as `@src/app.ts` into the value;
   - a paste past a threshold becomes an attachment;
   - `composerParts(doc)` reads the text and the atoms on submit.
5. **`recall`:** Up on the first line brings back earlier prompts, keeping
   the draft.

`<AgentChat>` sets those props and fills the `@` list from files under `cwd`
and the `/` list from the session's commands.

## The view

`<AgentChat>` composes; it registers no element of its own. Nothing about a
transcript is a transform, so by the rule in `AGENTS.md` it is boxes. It is:

- **A transcript** in a scroll pane that sticks to the bottom while the agent
  writes, and stops sticking when the user scrolls up.
- **Messages:**
  - A user message is its text, its atoms and its attachments.
  - An assistant message is its parts in order:
    - text through `<Markdown partial>` (whose block cache keeps a growing
      reply to the cost of its tail);
    - reasoning, collapsed;
    - tool cards;
    - plans as checklists;
    - questions as forms;
    - notices as one muted line.
- **Tool cards**, collapsed by default to a line (`Read src/app.ts`,
  `make test`, `Edit src/app.ts +4 −1`) with the approval row under it when
  it waits. Opened:
  - `terminal` output through `<TerminalOutput>`, cut to its first and last
    hundred lines until asked;
  - diffs through `<Code>` with the `diff` tokenizer;
  - an app tool's `value` through its `render`, or as JSON.
- **The composer**, with the attach, model and stop or send controls beside it.
- **`header`**, `true` for the session's title, model, mode and usage, or a
  function of the session for the app's own.

Not built at first: windowing the transcript. A message's tool output is
collapsed, so a transcript of a few hundred messages is a few thousand nodes.
If a long session measures slow, the windowing `<Tree>` and `<Table>` share
(`src/internal/window.ts`, `heights.ts`) is promoted to a shared module with a
subpath here, and the transcript stands on it.

Units: nothing here compares an event with `abs`. The one geometry it reads is
the scroll pane's position, for sticking to the bottom, and its tests run at
`scale: 2`, as `AGENTS.md` asks of anything that reads geometry back.

## Security posture

The agent is a program with the user's authority, and what it writes is a
document nobody here wrote. So the defaults:

- **Nothing runs unless the app asked.** There is no Run action by default,
  `scope` is never passed to `<Markdown>`, and `components` reaches only the
  keys the app gave it.
- **Nothing navigates or opens.** Links and paths go to `onLink` and
  `onOpenFile`.
- **Permissions start at `'ask'`.** Approvals last the session, and nothing
  writes a permission rule to disk unless `rememberApprovals` says so.
- **Auth is the harness's.** The component never offers a claude.ai login, as
  the Agent SDK's terms require. It uses the API key or the cloud provider
  the environment configures.
- **A missing agent is not an error.** No SDK installed, no `gemini` on
  `PATH`, no key: `status: 'unavailable'` and the `fallback`, never a throw,
  as `<Terminal>` and `<MediaPlayer>` do.

## Testing

- **`FakeDriver`** (in `./testing`) plays a script of driver events with the
  real reducer, gate and view. It is how every UI behaviour is tested: no
  agent, no key, no network in CI.
- **Recorded transcripts.** A driver's events from a real session, saved as
  JSONL, are replayed through the reducer and compared with the session they
  made. A harness release that changes its stream fails a replay rather than
  a user.
- **A contract test per driver**, against a fake of its far side:
  - a structural stand-in for the SDK's `query()`;
  - an ACP agent over a pipe, made with `@agentclientprotocol/sdk`'s agent
    half, as a devDependency;
  - an app-server speaking JSONL.
- **Real agents** are opt-in behind `REACT_X11_AGENT_REAL=1`, for the reason
  `<Terminal>`'s real pty is. A test that spawns a harness by accident hangs
  the suite or spends money.

## Milestones

| Milestone | Where                       | What                                                                                                                                                                                                                                                             |
| --------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0        | this repository             | The composer props (landed, [#1344](https://github.com/sidorares/react-x11-components/pull/1344)); `<Markdown codeActions>`; the `diff` tokenizer                                                                                                                |
| M1        | `@windowkit/agent-chat` 0.1 | `./core` and the `claude` driver. `<AgentChat>`: the transcript, streamed markdown, tool cards, inline approvals, `tools`, `instructions`, `systemPrompt`, `folders`, `coreTools`, `fences`, `components`, `codeActions`, stop, copy. `FakeDriver` and its tests |
| M2        |                             | Edit, retry and branches over forks; restore files; steering and the queue; pause; questions and plan approval; `@` and `/` in the composer; model and mode; attachments                                                                                         |
| M3        |                             | The `acp` driver and the tool bridge: Gemini, Copilot, Cursor, opencode, goose, Grok Build, Qwen, Kimi, Cline, Vibe, and Codex through its adapter. The system-prompt RFD where it is taken; `host` for v1's fs and terminal                                     |
| M4        |                             | The `codex` driver over the app-server: `dynamicTools`, fork, revert, steer                                                                                                                                                                                      |
| M5        |                             | `<AgentSessions>`; subagent threads drawn nested; usage and context meters; MCP Apps through `<Html>`                                                                                                                                                            |

## Open questions

Each has a proposed default:

1. **`settings` default: `'cli'` or `'isolated'`?** Proposed `'cli'`. The app
   embeds the user's own agent, and their `CLAUDE.md` is part of what makes it
   theirs. An app shipping to people who never ran the CLI should say
   `'isolated'`, and the docs page says so in its first screenful.
2. **JSON Schema for Claude's in-process tools.** `tool()` takes a zod shape.
   Proposed: pass a zod schema through and convert a JSON Schema at the
   bridge. Two things to check in M1: that `createSdkMcpServer` takes a
   low-level MCP server instance, which accepts JSON Schema as is; and that the
   Standard JSON Schema interface is implemented by the libraries named above.
3. **Plan approval.** The SDK's docs do not say how a host approves
   `ExitPlanMode`, or where the plan text is in its input. Proposed: it reaches
   `canUseTool` like any gated tool. Approve allows it and calls
   `setPermissionMode('default')`; Keep planning denies it with the user's
   note. Verify against a real session before M2 ships it.
4. **ACP's client terminal, given v2 drops it.** Proposed: build `host` in M3
   for `fs` (an overlay filesystem is worth having while it lasts) and the
   terminal behind the same `spawn` seam. Mark both v1-only, and build nothing
   else on them.
5. **Codex through ACP before M4?** Proposed: yes. `codex-acp` wraps the
   app-server, so the `acp` driver reaches Codex from M3. The native driver
   is for `dynamicTools`, revert and steer.
6. **The package name.** Proposed: `@windowkit/agent-chat` in `windowkit/agent-chat`,
   which matches the scope and says what it drives rather than what it draws.

## Sources

Checked 2026-11-06.

- **The Claude Agent SDK.**
  - [The overview](https://code.claude.com/docs/en/agent-sdk/overview) and
    the [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript).
  - [Permissions](https://code.claude.com/docs/en/agent-sdk/permissions),
    [sessions](https://code.claude.com/docs/en/agent-sdk/sessions) and
    [file checkpointing](https://code.claude.com/docs/en/agent-sdk/file-checkpointing).
  - The `sdk.d.ts` of `@anthropic-ai/claude-agent-sdk` 0.3.318.
- **ACP.**
  - [The schema](https://agentclientprotocol.com/protocol/schema) and
    [the agents list](https://agentclientprotocol.com/overview/agents).
  - The RFDs: [the v2 overview](https://agentclientprotocol.com/rfds/v2/overview),
    [MCP-over-ACP](https://agentclientprotocol.com/rfds/mcp-over-acp) and
    [client system prompt](https://agentclientprotocol.com/rfds/client-system-prompt).
- **Codex.**
  - [The app-server docs](https://learn.chatgpt.com/docs/app-server).
  - [The TypeScript SDK](https://github.com/openai/codex/tree/main/sdk/typescript).
- **The other harnesses.**
  - [Grok Build](https://x.ai/news/grok-build-cli).
  - [opencode's server](https://opencode.ai/docs/server/).
  - [The GitHub Copilot SDK](https://github.com/github/copilot-sdk).
  - [The Cursor SDK](https://cursor.com/docs/api/sdk/typescript).
- **The React libraries.**
  - assistant-ui:
    [the external store](https://www.assistant-ui.com/docs/runtimes/custom/external-store.md)
    and [tool UI](https://www.assistant-ui.com/docs/tools/tool-ui.md).
  - [The AI SDK's `useChat`](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat.md)
    and [its tool usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage.md).
  - [CopilotKit's `useRenderTool`](https://docs.copilotkit.ai/reference/hooks/useRenderTool).
  - [Streamdown's interactivity](https://streamdown.ai/docs/interactivity).
- **The frontend protocols.**
  - [AG-UI's events](https://docs.ag-ui.com/concepts/events).
  - [MCP Apps](https://github.com/modelcontextprotocol/ext-apps).

## Where the build stands

Milestone 1 is built here, as `@windowkit/agent-chat` (the design called it
`@react-x11/agent`):

- `./core`: the session, the reducer, the policy, the tool helpers and the
  driver seam, with no React.
- The `claude` driver over the Agent SDK: streaming input, the `PreToolUse`
  gate and `canUseTool` approval, in-process tools, `toolAliases` for a
  replaced built-in, `AskUserQuestion`, `TodoWrite` as the plan, subagents
  nested, steering with `priority: 'next'`.
- `<AgentChat>` with `useAgent`, `fences`, `components`, `renderTool`,
  `codeActions` and the header, transcript and composer.
- `fakeDriver` in `./testing`, which every test and the demo run on.

Where it departs from the design:

- **`codeActions` without `<Markdown codeActions>`.** The design puts the
  buttons in `<Markdown>` first. Until that lands in `@react-x11/components`,
  a reply is cut at its top-level fences here (`src/view/fences.ts`) and each
  fence is drawn as a code block with a header. A fence indented under a list
  item stays in its list, without actions.
- **The composer is 0.38's, with markdown markup by default.** It draws
  emphasis, headings, quotes and lists as well as fences and inline code
  (`markup="markdown"`, where the design proposed `'code'`), lists files at
  `@` and the agent's commands at `/`, and a sent message is drawn as full
  markdown in the transcript.
- **Edit, retry and branches are M2**, as planned: `capabilities.fork` is
  false on every driver so far, so no Edit button is drawn.
