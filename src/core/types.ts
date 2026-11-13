// The message model, and everything a session says about itself.
//
// Plain data throughout: a part is never a function, never a class, never a
// handle into the driver. That is what lets the view memoize a message by
// identity, a test compare transcripts with `deepStrictEqual`, and a recorder
// write a session to JSONL. Anything a part needs to *do* — answer an
// approval, answer a question — is a method on the session, keyed by the
// part's id.

/** What a session is doing. */
export type AgentStatus =
  /** Nothing is running; the next `send` starts a turn. */
  | 'idle'
  /** The driver is starting the harness. */
  | 'starting'
  /** A turn is under way. */
  | 'running'
  /** A turn is waiting on the user: an approval or a question. */
  | 'waiting'
  /** A turn is held at the gate until `resume()`. */
  | 'paused'
  /** The harness could not be started here: no SDK, no binary, no key. */
  | 'unavailable'
  /** The harness failed; `error` says how. A new `send` tries again. */
  | 'error'
  | 'closed';

/** What a tool does, in ACP's vocabulary, whichever harness named it. */
export type ToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'other';

export type ToolState =
  /** Its arguments are still streaming. */
  | 'input-streaming'
  /** Called, not yet running. */
  | 'pending'
  /** Waiting for the user to allow or deny it. */
  | 'awaiting-approval'
  | 'running'
  | 'done'
  | 'error'
  | 'denied'
  | 'cancelled';

/** One piece of what a tool produced. */
export type ToolOutput =
  /** `progress`: a line the tool replaces as it runs, dropped when it ends. */
  | { type: 'text'; text: string; progress?: boolean }
  /** Program output, escapes and all. */
  | { type: 'terminal'; text: string; exitCode?: number }
  /** A file's change. `oldText` null for a new file. */
  | { type: 'diff'; path: string; oldText: string | null; newText: string }
  /** `width` and `height` in pixels, where the harness says. */
  | {
      type: 'image';
      mime: string;
      data: string /* base64 */;
      width?: number;
      height?: number;
    }
  /** What an app tool's `run` returned, as it returned it. */
  | { type: 'value'; value: unknown };

export type ApprovalChoice = 'allow-once' | 'allow-session' | 'deny';

export interface ApprovalOption {
  id: ApprovalChoice;
  label: string;
  kind: 'allow' | 'deny';
}

export interface TextPart {
  type: 'text';
  id: string;
  text: string;
  /** More of it may still arrive. */
  streaming: boolean;
}

export interface ReasoningPart {
  type: 'reasoning';
  id: string;
  text: string;
  streaming: boolean;
}

export interface ToolPart {
  type: 'tool';
  id: string;
  /** What the model called it: `Bash`, `mcp__app__openTicket`. */
  name: string;
  /** What is shown, and what `renderTool` is keyed by: `Bash`, `openTicket`. */
  label: string;
  kind: ToolKind;
  /** One line: `Read src/app.ts`, `make test`. */
  title: string;
  input: unknown;
  /** The arguments' JSON as it streams; `input` once it parses. */
  inputText: string;
  state: ToolState;
  /** Present while `state` is `'awaiting-approval'`. */
  approval?: { options: readonly ApprovalOption[]; reason?: string };
  output: readonly ToolOutput[];
  error?: string;
  /** The tool is one of the app's own (`tools`). */
  app: boolean;
  /** A subagent's own thread, for a tool that runs one. */
  children?: readonly AgentMessage[];
}

export interface PlanEntry {
  text: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface PlanPart {
  type: 'plan';
  id: string;
  entries: readonly PlanEntry[];
}

export interface Question {
  question: string;
  header?: string;
  options: readonly { label: string; description?: string }[];
  multiSelect: boolean;
}

export interface QuestionPart {
  type: 'question';
  id: string;
  questions: readonly Question[];
  state: 'open' | 'answered' | 'cancelled';
  /** By question text: the chosen label, labels joined by `, `, or free text. */
  answers?: Readonly<Record<string, string>>;
}

export interface FilePart {
  type: 'file';
  id: string;
  label: string;
  mime: string;
  path?: string;
  /** base64, for an image or a pasted blob sent with the message. */
  data?: string;
}

export interface NoticePart {
  type: 'notice';
  id: string;
  level: 'info' | 'warning' | 'error';
  text: string;
}

/** A driver's or an app's own data, reconciled by `id`. */
export interface DataPart {
  type: 'data';
  id: string;
  name: string;
  value: unknown;
}

/** `DataPart.name`s a driver of this package writes, and their values. */
export interface DataValues {
  /** A pull request a command opened, edited or merged. */
  'pull-request': PullRequestData;
  /** An agent session started elsewhere: a cloud session, a workflow. */
  session: SessionLinkData;
  /** A page the agent published. */
  artifact: ArtifactData;
  /** Files the agent sent the user. */
  attachments: AttachmentsData;
}

export interface PullRequestData {
  number: number;
  url?: string;
  /** `'created'`, `'edited'`, `'merged'`, or what else the harness says. */
  action: string;
}

export interface SessionLinkData {
  url: string;
  /** What the session was started to do. */
  title?: string;
}

export interface ArtifactData {
  url: string;
  title?: string;
  /** The local file it was published from. */
  path?: string;
}

export interface AttachmentsData {
  caption?: string;
  files: readonly {
    path: string;
    /** Bytes. */
    size?: number;
    mime?: string;
    isImage: boolean;
  }[];
}

export type Part =
  | TextPart
  | ReasoningPart
  | ToolPart
  | PlanPart
  | QuestionPart
  | FilePart
  | NoticePart
  | DataPart;

/**
 * Who wrote a message that reached the agent from somewhere other than the
 * person at the keyboard.
 */
export type MessageSource =
  /** Another agent session, or a process speaking as one. `id` addresses
   *  it and `name` is what is shown; `session` is the harness's own id for
   *  it, where it has one. */
  | { kind: 'peer'; id: string; name?: string; session?: string }
  /** An event pushed into the session from outside, named by what pushed
   *  it: one of Claude Code's MCP channels. */
  | { kind: 'channel'; server: string };

/** A message an app sends on another session's behalf. */
export type PeerSource = Extract<MessageSource, { kind: 'peer' }>;

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: readonly Part[];
  createdAt: number;
  /** A user-role message the user did not write: who did. */
  from?: MessageSource;
  /** A user message sent while the agent was running, waiting its turn. */
  queued?: boolean;
  /** An assistant message whose turn has ended. */
  done?: boolean;
}

/** What a session can do. The view draws an action only where it works. */
export interface Capabilities {
  /** How the app's `tools` reach the agent. */
  tools: 'in-process' | 'bridge' | 'dynamic' | false;
  systemPrompt: { replace: boolean; append: boolean };
  /** What `coreTools: { x: false }` can do. */
  coreTools: 'remove' | 'deny-when-asked' | 'sandbox' | false;
  /** Which tool calls pass through the host: all of them, or only those the
   *  agent asks about. `pause()` needs `'every-call'`. */
  gate: 'every-call' | 'asked-calls';
  /** A message sent mid-turn reaches the agent at once, rather than queuing. */
  steer: boolean;
  fork: boolean;
  rewindFiles: 'edits' | false;
  models: boolean;
  modes: boolean;
  images: boolean;
}

export const NO_CAPABILITIES: Capabilities = Object.freeze({
  tools: false,
  systemPrompt: Object.freeze({ replace: false, append: false }),
  coreTools: false,
  gate: 'asked-calls',
  steer: false,
  fork: false,
  rewindFiles: false,
  models: false,
  modes: false,
  images: false,
}) as Capabilities;

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  /** Cumulative over the session, where the harness says. */
  costUsd?: number;
  turns?: number;
}

export interface SessionInfo {
  /** The driver's name: `'claude'`, `'fake'`. */
  agent: string;
  /** The harness's own session id, once it has one. */
  id?: string;
  cwd?: string;
  model?: string;
  models: readonly { id: string; label: string; description?: string }[];
  mode?: string;
  modes: readonly { id: string; label: string }[];
  commands: readonly { name: string; description?: string }[];
  usage?: Usage;
}

/** A tool call, as `onToolCall` and the policy see it. */
export interface ToolCall {
  id: string;
  name: string;
  label: string;
  kind: ToolKind;
  title: string;
  input: unknown;
  /** One of the app's own `tools`. */
  app: boolean;
}

/**
 * What `onToolCall` answers.
 *
 * - `'allow'`, `'allow-session'` (this tool, for the rest of the session);
 * - `'deny'`, or `{ deny: reason }`, which the model is told;
 * - `{ allow: true, input }`, which runs with changed arguments;
 * - `'ask'`: the user decides, through the approval row;
 * - `undefined`: the `permissions` policy decides.
 */
export type ToolDecision =
  | 'allow'
  | 'allow-session'
  | 'deny'
  | 'ask'
  | { deny: string }
  | { allow: true; input: unknown }
  | undefined;

/**
 * The policy under `onToolCall`.
 *
 * - `'ask'` (default): reads run, everything else asks.
 * - `'edits'`: edits run as well.
 * - `'read-only'`: nothing that changes anything runs.
 * - `'auto'`: the harness's own mode decides.
 */
export type PermissionPolicy = 'ask' | 'edits' | 'read-only' | 'auto';

/** The harness's built-in tools, by what they do. */
export type CoreToolKey =
  'shell' | 'read' | 'edit' | 'web' | 'agents' | 'todos';

/** An attachment sent with a message. */
export interface Attachment {
  kind: 'image' | 'file' | 'paste';
  label: string;
  mime?: string;
  path?: string;
  /** Text, or base64 for bytes. */
  data?: string;
}

/** What `send` takes besides a string. */
export interface ComposedMessage {
  text: string;
  attachments?: readonly Attachment[];
  /**
   * Sent on another session's behalf: drawn as theirs, and the harness is
   * told the user did not write it. Absent, the message is the user's,
   * whether they typed it or the app sent it for them.
   */
  from?: PeerSource;
}
