// The seam between the session and a harness.
//
// A driver turns one harness's protocol into `DriverEvent`s, and asks the
// session — through `DriverHost` — every question the protocol asks the
// client: may this tool run, what did the user answer, run the app's tool.
// It is public for the reason `ProcessHost` is in `@react-x11/components`:
// driving a harness nobody wrapped yet should not need a fork.

import type { AnyToolDef, ToolResult } from './tools.js';
import type {
  Attachment,
  Capabilities,
  CoreToolKey,
  PermissionPolicy,
  PlanEntry,
  Question,
  SessionInfo,
  ToolCall,
  ToolKind,
  ToolOutput,
  ToolState,
  Usage,
} from './types.js';

/**
 * What a driver reports. Deltas, never snapshots: the reducer accumulates
 * them, so a tool part cannot vanish because a driver forgot to repeat it.
 * `parent` names the tool call a subagent's event belongs under.
 */
export type DriverEvent =
  /** Assistant text: `delta` appends, `text` replaces (a finished block). */
  | {
      type: 'text';
      id: string;
      delta?: string;
      text?: string;
      done?: boolean;
      reasoning?: boolean;
      parent?: string;
    }
  | {
      type: 'tool-start';
      id: string;
      name: string;
      label?: string;
      kind?: ToolKind;
      title?: string;
      input?: unknown;
      app?: boolean;
      parent?: string;
    }
  /** A piece of the arguments' JSON. */
  | { type: 'tool-input'; id: string; delta: string }
  | {
      type: 'tool-update';
      id: string;
      input?: unknown;
      title?: string;
      kind?: ToolKind;
      state?: ToolState;
      /** Replaces the outputs. */
      output?: readonly ToolOutput[];
      /** Appended to them. */
      append?: ToolOutput;
      progress?: string;
    }
  | {
      type: 'tool-end';
      id: string;
      state: 'done' | 'error' | 'denied' | 'cancelled';
      output?: readonly ToolOutput[];
      error?: string;
    }
  | { type: 'plan'; entries: readonly PlanEntry[]; parent?: string }
  | { type: 'notice'; level: 'info' | 'warning' | 'error'; text: string }
  | { type: 'info'; info: Partial<SessionInfo> }
  | { type: 'usage'; usage: Usage }
  | {
      type: 'turn-end';
      reason: 'done' | 'stopped' | 'error' | 'limit';
      error?: string;
    };

/** The policy's answer, fast, with no user involved. */
export type GateDecision =
  | { behavior: 'allow'; input?: unknown }
  | { behavior: 'deny'; message: string }
  /** The user must decide: the driver routes the call to `approve`. */
  | { behavior: 'ask' }
  /** No opinion: the harness's own permission mode decides. */
  | { behavior: 'defer' };

/** The user's answer, through the approval row. */
export type ApprovalResult =
  | { behavior: 'allow'; input?: unknown }
  | { behavior: 'deny'; message: string; interrupt?: boolean };

/** What a driver may ask of the session. */
export interface DriverHost {
  readonly config: DriverConfig;
  emit(event: DriverEvent): void;
  /** Before a tool runs: the app's `onToolCall`, then the policy. Never
   *  waits on the user, so a harness hook with a timeout can call it. */
  gate(call: ToolCall): Promise<GateDecision>;
  /** The approval row: waits on the user, and while the session is paused.
   *  Has no timeout. */
  approve(call: ToolCall, signal?: AbortSignal): Promise<ApprovalResult>;
  /** A question for the user (`AskUserQuestion`). `null` if dismissed. */
  ask(
    id: string,
    questions: readonly Question[],
    signal?: AbortSignal,
  ): Promise<Record<string, string> | null>;
  /** Run one of the app's tools. Never throws: a failure is a result. */
  runTool(
    name: string,
    input: unknown,
    ctx: { callId?: string; signal?: AbortSignal },
  ): Promise<ToolResult>;
}

/** The session's options, resolved for a driver. */
export interface DriverConfig {
  cwd: string;
  folders: readonly string[];
  /** Appended to the harness's own system prompt. Empty for none. */
  instructions: string;
  /** Replaces the harness's system prompt. */
  systemPrompt?: string;
  /** Categories and harness names switched off. */
  removed: readonly string[];
  /** Categories and harness names that always ask. */
  asking: readonly string[];
  /** Categories replaced by one of `tools`, by the tool's name. */
  replaced: Readonly<Partial<Record<CoreToolKey, string>>>;
  /** The app's tools, replacements included, by name. */
  tools: ReadonlyMap<string, AnyToolDef>;
  permissions: PermissionPolicy;
  model?: string;
  mode?: string;
  /** A harness session id to resume. */
  resume?: string;
  settings: 'cli' | 'isolated';
  driverOptions: Readonly<Record<string, unknown>>;
}

/** A message on its way to the harness. */
export interface OutgoingMessage {
  /** The transcript's id for it. */
  id: string;
  text: string;
  attachments: readonly Attachment[];
  /** Sent while a turn runs; the driver delivers it as steering. */
  steer: boolean;
}

export interface DriverSession {
  readonly capabilities: Capabilities;
  send(message: OutgoingMessage): void;
  /** Stop the turn. The driver ends it with `turn-end` `'stopped'`. */
  interrupt(): Promise<void>;
  setModel?(id: string): Promise<void>;
  setMode?(id: string): Promise<void>;
  close(): Promise<void>;
}

export interface AgentDriver {
  /** `'claude'`, `'fake'`: shown, and `SessionInfo.agent`. */
  readonly name: string;
  /**
   * Start the harness. Throw `AgentUnavailableError` when it cannot run
   * here — no SDK, no binary, no key — which is an ordinary state of a
   * healthy machine, and the view shows the `fallback`.
   */
  start(host: DriverHost): Promise<DriverSession>;
}

/** The harness cannot run here. Not a bug: the view shows its `fallback`. */
export class AgentUnavailableError extends Error {
  override readonly name = 'AgentUnavailableError';
}
