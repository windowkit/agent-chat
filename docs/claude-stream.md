# What the Claude stream carries

A catalogue of everything the Claude Agent SDK's message stream can hand a
chat, documented or not, grouped by the component that should draw it, and
what agent-chat draws for it today. It is the input to
[customising.md](customising.md)'s `renderData` and `parts`.

## Where this comes from

- **Types**: `@anthropic-ai/claude-agent-sdk` 0.3.318 in `node_modules`.
  `sdk.d.ts` holds the `SDKMessage` union and the control protocol;
  `sdk-tools.d.ts` the built-in tools' inputs and outputs. Content blocks
  are `@anthropic-ai/sdk`'s `BetaContentBlock`.
- **Transcripts**: Claude Code's session files, `~/.claude/projects/*/*.jsonl`,
  sampled for their shapes only.
- **The live stream was not run.** Anything said of it comes from the types.
  The transcript differs from it in three ways: camelCase where the stream is
  snake_case (`toolUseResult` for `tool_use_result`), many entries the stream
  never carries (marked _transcript_ below), and many stream-only `system`
  messages a transcript never records.

**Observed** below means seen in transcripts. **Declared** means in the
types and not seen. **Inferred** is a guess, and says so.

## The stream's envelope

`query()` yields `SDKMessage`s:

| `type`                                                   | What it is                                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `assistant`                                              | One model message: `message.content[]` blocks. A transcript writes one entry per finished block, sharing `message.id`. |
| `user`                                                   | A prompt, or a tool's result: `tool_use_result` is the tool's structured output, typed `unknown`.                      |
| `result`                                                 | End of a turn: cost, tokens, duration, `permission_denials[]`, errors.                                                 |
| `system`                                                 | About thirty subtypes: session init, compaction, tasks, hooks, notices, retries (below).                               |
| `stream_event`                                           | Partial deltas, with `includePartialMessages`: text, thinking, tool input as JSON, citations.                          |
| `tool_progress`                                          | A running tool's elapsed seconds.                                                                                      |
| `tool_use_summary`                                       | One line summing up a run of tool calls.                                                                               |
| `rate_limit_event`                                       | Usage against the five-hour and weekly limits.                                                                         |
| `prompt_suggestion`, `auth_status`, `conversation_reset` | A suggested reply; login state; the conversation cleared.                                                              |

`parent_tool_use_id` and `agent_id` on a message place it inside a
subagent's thread. `origin.kind` on a user message says who sent it:
`human`, `peer` (another session), `channel`, `task-notification`,
`coordinator`, `auto-continuation`.

## By component

Each entry: where it comes from, its shape, a suggested view, and what
agent-chat does with it now. Driver references are to
`src/drivers/claude/`.

### Prose and thinking

- **Text**: `text` block; `citations[]` declared, not observed. Markdown.
  _Today_: drawn.
- **Thinking**: `thinking` block, `redacted_thinking` declared. A collapsed
  section; the transcript adds `thinkingDurationMs` for a "Thought for 12s"
  label. _Today_: drawn; the driver asks for summarized thinking.
- **Model switched**: `fallback` block `{ from: { model }, to: { model } }`,
  observed; `system/model_refusal_fallback`. A notice. _Today_: dropped.

### Tool calls

A `tool_use` block, then a user message with its `tool_result` and the
structured `tool_use_result`. Shapes per tool:

| Tool                                                                  | Structured result                                                                                                                            | View                                                     | Today                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| **Bash**                                                              | `stdout`, `stderr`, `interrupted`, `returnCodeInterpretation?`, `backgroundTaskId?`, `gitOperation?`; observed `bashEditDiff`                | Terminal block                                           | Terminal output, from the result text        |
| **Read**                                                              | by `type`: `text { file { filePath, content, numLines, startLine, totalLines } }`, `image { base64, dimensions }`, `pdf`, `notebook`         | File preview with line numbers; image viewer             | Text                                         |
| **Edit**, **Write**                                                   | `structuredPatch [{ oldStart, oldLines, newStart, newLines, lines[] }]`, `originalFile`, `gitDiff?`; Write `type: 'create' \| 'update'`      | Unified diff                                             | A diff rebuilt from the input, not the patch |
| MultiEdit, NotebookEdit                                               | NotebookEdit: `old_source`, `new_source`, `cell_type`                                                                                        | Diff                                                     | Text                                         |
| Glob, Grep                                                            | `filenames[]`, `numFiles`, `truncated`; Grep `content`, `numMatches`                                                                         | File or match list, each a link                          | Text                                         |
| **WebFetch**                                                          | `url`, `code`, `codeText`, `bytes`, `durationMs`, `result`                                                                                   | Link card with status                                    | Text                                         |
| **WebSearch**                                                         | `results: ({ content: [{ title, url }] } \| string)[]`                                                                                       | Results list; the strings are the model's own commentary | Text                                         |
| **Agent** (was Task)                                                  | `completed { agentId, content, totalTokens, totalDurationMs, toolStats }`, `async_launched { outputFile }`, `remote_launched { sessionUrl }` | Subagent card, its thread nested                         | Nested thread                                |
| **AskUserQuestion**                                                   | input `questions [{ question, header, options[2–4] { label, description, preview? }, multiSelect }]`; result `answers`, `annotations`        | Question card                                            | Question card                                |
| ExitPlanMode                                                          | input `plan` (markdown); result `plan`, `filePath?`, `planWasEdited?`                                                                        | Plan card, approve or keep planning                      | The plan as markdown in the card             |
| **Monitor**                                                           | `taskId`, `timeoutMs`, `persistent?`; its events arrive later as task notifications                                                          | A live watcher                                           | A plain card                                 |
| TaskStop, TaskOutput                                                  | `task_id`, `task_type`; TaskOutput observed, not declared                                                                                    | Status chip; background output                           | Plain cards                                  |
| **Artifact**                                                          | publish: `url`, `path`, `title`, `version`                                                                                                   | Artifact link card                                       | A plain card                                 |
| Skill                                                                 | observed `{ commandName, success }`                                                                                                          | A "used skill" chip                                      | A plain card                                 |
| SendUserFile                                                          | observed `attachments [{ path, size, isImage, media_type }]`, `caption`                                                                      | Attachment card, image inline                            | A plain card                                 |
| SendMessage, ListAgents, SubagentHandback                             | observed: a message to another session                                                                                                       | Outgoing peer message                                    | Plain cards                                  |
| Workflow, CronCreate, ScheduleWakeup, PushNotification, EnterWorktree | `sessionUrl?`, schedule, worktree path…                                                                                                      | Small chips                                              | Plain cards                                  |
| ToolSearch                                                            | observed; `tool_reference` blocks                                                                                                            | Collapse it                                              | A plain card                                 |
| `mcp__<server>__<tool>`                                               | `string`, or `[{ type: 'text' }, { type: 'image', source }]`                                                                                 | Generic card with the server's name; images inline       | A card under the tool's name                 |

A string `tool_use_result` is an error message, observed for every tool.

### Planned tasks

A checklist of what the agent means to do, kept current as it works.

- **TaskCreate / TaskUpdate / TaskList / TaskGet**: what Claude Code uses
  now. Observed many times; `TodoWrite` was never called in the sample.
  Create takes `subject`, `description`, `activeForm?`; Update takes
  `taskId`, `status`, `addBlocks`, `owner`; List returns
  `tasks [{ id, subject, status, blockedBy }]`. The list is the fold of
  every create and update.
- **TodoWrite**: declared, `todos [{ content, status, activeForm }]`, the
  result `oldTodos` and `newTodos`.
- _transcript_: `task_reminder` attachments carry the current list.

_Today_: the Task tools and `TodoWrite` are one plan part, drawn as the
checklist (`results.ts`'s `TaskFold`). Their cards are hidden.

### Links out

- **Pull request**: Bash's `gitOperation.pr { number, url, action:
'created' | 'edited' | 'merged' }`, observed and common; `gitOperation`
  also has `commit { sha, branch }`, `push`, `branch`. _transcript_: a
  `pr-link` entry `{ prNumber, prUrl, prRepository }`. A PR card.
- **Session**: Agent's `remote_launched.sessionUrl`; Workflow's
  `sessionUrl`. A session link.
- **Artifact**: the Artifact tool's `url` and `title`. _transcript_: a
  `frame-link` entry `{ path, frameUrl, title }`. An artifact card.
  Otherwise a Write of an `.html` file, which the app can offer to open.
- **Files**: every `filePath` in Read, Edit, Write, Glob and Grep results.
  The view's `onOpenFile(path, line)`, designed in `docs/design.md`, is
  where these go.

_Today_: a PR, a session and an artifact are `data` parts, drawn as cards
whose Open goes to `onLink`. Files are not yet links.

### Terminal sessions and background work

- **Bash**: `stdout` and `stderr` apart, `interrupted`,
  `returnCodeInterpretation`.
- **Backgrounded**: Bash `backgroundTaskId`, Agent `async_launched`,
  Monitor's `taskId`, then the stream's `system/task_started`,
  `task_progress { usage, last_tool_name, summary }`, `task_updated`,
  `task_notification { status, output_file, summary }`, and
  `background_tasks_changed` (the whole list, replacing the last).
  _transcript_: a task notification is a user message wrapped in a
  `<task-notification>` tag.
- **Running**: `tool_progress.elapsed_time_seconds`.

A background-tasks tray, and a live card per task. _Today_: Bash output is
drawn; the rest is dropped.

### Images

Read's `image` result; `image` blocks inside tool results (a browser's
screenshot); `image` blocks in a user message (a pasted screenshot);
SendUserFile's `isImage`. _Today_: drawn as images; SendUserFile's files as
an attachment card.

### Diffs

Edit and Write's `structuredPatch` and `gitDiff.patch`; Bash's
`bashEditDiff { files [{ filePath, hunks[], created?, deleted? }] }`,
observed, for files a shell command changed. _Today_: Edit and Write only,
from the input, old lines then new.

### Questions, permissions and forms

- **Permission**: the control request `can_use_tool { tool_name, input,
title, description, decision_reason, blocked_path,
permission_suggestions[] }`, surfacing as `canUseTool`. The suggestions
  are what "Always allow" should offer. Afterwards, `system/permission_denied`
  and `result.permission_denials`; _transcript_: `permissionDecision {
decision, source, reasonType }` on the result. _Today_: the approval row,
  fixed options, `decision_reason` not shown.
- **Question**: AskUserQuestion, above. _Today_: drawn.
- **MCP elicitation**: `elicitation { mcp_server_name, message, mode:
'form' | 'url', requested_schema? }` via `onElicitation`, closed by
  `system/elicitation_complete`. A form generated from the schema, or a
  link. _Today_: not handled.

### Session state

| Source                                                                                       | View                                               | Today              |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------ |
| `system/init`: tools, MCP servers and their status, model, mode, slash commands, skills, cwd | Header; MCP server chips                           | Model and commands |
| `result`: `total_cost_usd`, `usage`, `modelUsage`, `duration_ms`, `num_turns`                | Turn footer; the header's cost                     | Cost in the header |
| `rate_limit_event`: status, `utilization`, `resetsAt`, `rateLimitType`                       | Usage meter; warning                               | Dropped            |
| `system/compact_boundary`, `status: 'compacting'`                                            | "Context compacted" divider, the summary collapsed | Dropped            |
| `system/api_retry`; _transcript_ `system/api_error`                                          | "Retrying in 5s"                                   | Dropped            |
| `system/session_state_changed`: idle, running, requires_action                               | Busy and needs-you badges                          | Its own state      |
| `system/notification`, `system/informational`                                                | Toast; inline notice                               | Dropped            |
| `system/hook_started`, `hook_response`; _transcript_ `stop_hook_summary`                     | A collapsed hook log                               | Dropped            |
| `system/memory_recall`                                                                       | "Recalled memories"                                | Dropped            |
| `system/files_persisted`                                                                     | File chips                                         | Dropped            |
| `prompt_suggestion`                                                                          | A suggested-reply chip                             | Chips              |
| `tool_use_summary`                                                                           | A label over a collapsed run of tool cards         | Dropped            |
| `conversation_reset`                                                                         | Divider; clear the view                            | Dropped            |

### Text with tags in it

A user message's text can carry tags no type describes, all observed:

- `<system-reminder>`: context injected for the model. Hide it.
- `<task-notification>`: a background task finished. A chip.
- `<command-name>`, `<command-args>`, `<local-command-stdout>`: a slash
  command and its output. A command chip and an output block.
- `<cross-session-message>`, `<agent-message>`: another session's message.
  A peer bubble.
- Flags on the message: `isMeta` (hide), `isCompactSummary` (the
  compaction summary), `isSidechain` and `agentId` (a subagent's thread).

### Transcript only

What a resumed session reads from its file and the stream never sends:
`pr-link`, `frame-link`, `custom-title`/`ai-title` (the session's name),
`mode`, `cost-state`, `queue-operation`, `file-history-snapshot`
(checkpoints), and `attachment` entries. Most attachments are bookkeeping
for the model; the ones worth drawing are `queued_command`,
`edited_text_file`, `file` (an `@`-mentioned file), `task_reminder`,
`goal_status`, `structured_output` and `remote_session_change`.

A subagent's messages are in a file of their own,
`<session>/subagents/agent-<id>.jsonl`, beside `agent-<id>.meta.json`.

## What the driver should keep next

In order of what a user would notice:

1. The Task tools folded into the plan part: today a session shows no plan.
2. Structured results kept as `value` outputs beside the text, so a
   renderer by output type can draw them: Read's file, Edit's patch, Grep's
   matches, WebSearch's results.
3. Links: `gitOperation.pr`, `sessionUrl`, the Artifact tool's `url`, as
   `data` parts a `renderData` draws as cards.
4. Images, as images.
5. Background tasks: `task_*` and `background_tasks_changed`.
6. Session state: rate limits, compaction, retries, notices.
