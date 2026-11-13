// A session: the transcript, the harness behind it, and every question the
// harness asks the client — answered by the app's policy, or by the user.
//
// It is a store in the `useSyncExternalStore` sense: `snapshot` is one
// immutable object, replaced on every change, and `subscribe` hears each
// replacement. Nothing in it is React's, so a terminal or DOM front end can
// drive the same object.

import {
  AgentUnavailableError,
  type AgentDriver,
  type ApprovalResult,
  type DriverConfig,
  type DriverEvent,
  type DriverHost,
  type DriverSession,
  type GateDecision,
  type OutgoingMessage,
} from './driver.js';
import { transcriptMarkdown } from './markdown.js';
import { policyDecision } from './policy.js';
import {
  reduce,
  restore,
  findLivePart,
  type TranscriptAction,
} from './reducer.js';
import {
  errorResult,
  normalizeResult,
  validateInput,
  type AnyToolDef,
  type ToolResult,
} from './tools.js';
import {
  NO_CAPABILITIES,
  type AgentMessage,
  type AgentStatus,
  type ApprovalChoice,
  type ApprovalOption,
  type Capabilities,
  type ComposedMessage,
  type CoreToolKey,
  type Part,
  type PermissionPolicy,
  type Question,
  type SessionInfo,
  type ToolCall,
  type ToolDecision,
} from './types.js';

/** A `coreTools` value: on, off, always asking, or replaced by a tool. */
export type CoreToolSetting = boolean | 'ask' | AnyToolDef;

export interface AgentOptions {
  /** Which harness. Default `'claude'`: the Claude Agent SDK. */
  agent?: 'claude' | AgentDriver;
  /** Where it works. Default: the process's working directory. */
  cwd?: string;
  /** More directories it may read and write. */
  folders?: readonly string[];
  /** Appended to the harness's own system prompt. An array is joined with
   *  blank lines — `describeRenderers()` returns one. */
  instructions?: string | readonly string[];
  /** Replaces the harness's system prompt. `instructions` still follow it. */
  systemPrompt?: string;
  /**
   * The harness's built-in tools, by what they do — `shell`, `read`, `edit`,
   * `web`, `agents`, `todos` — or by a harness's own name (`NotebookEdit`).
   * `false` removes one, `'ask'` makes it always ask, and a tool of the app's
   * replaces it, which the agent then reaches by the built-in's name.
   */
  coreTools?: Readonly<Partial<Record<CoreToolKey, CoreToolSetting>>> &
    Readonly<Record<string, CoreToolSetting | undefined>>;
  /** The app's own tools, by name. */
  tools?: Readonly<Record<string, AnyToolDef>>;
  /** What runs without asking. Default `'ask'`. */
  permissions?: PermissionPolicy;
  /** Before every tool call the session sees: the app's say, ahead of the
   *  policy. `undefined` leaves it to the policy. */
  onToolCall?: (call: ToolCall) => ToolDecision | Promise<ToolDecision>;
  model?: string;
  mode?: string;
  /** A harness session to resume, by its id. */
  resume?: string;
  /**
   * The transcript to start from: an earlier session's `snapshot.messages`,
   * saved by the app. It is shown as it was, with anything left open
   * settled as a stopped turn. The harness remembers the conversation only
   * through `resume`, so pass its `info.id` beside it.
   */
  messages?: readonly AgentMessage[];
  /**
   * `'cli'` (default): the harness behaves as it does on the command line,
   * with the user's settings and project instructions (`CLAUDE.md`).
   * `'isolated'`: none of them.
   */
  settings?: 'cli' | 'isolated';
  /** Passed to the driver as they are, after everything above. */
  driverOptions?: Readonly<Record<string, unknown>>;
}

export interface SessionSnapshot {
  readonly status: AgentStatus;
  /** The transcript. */
  readonly messages: readonly AgentMessage[];
  readonly info: SessionInfo;
  readonly capabilities: Capabilities;
  /** Why the status is `'error'` or `'unavailable'`. */
  readonly error?: string;
  readonly paused: boolean;
  /** Text taken back out of the queue by `stop()`, for the composer. */
  readonly restored?: string;
  /** Replies the harness suggests the user might send next, offered once a
   *  turn is over and dropped when the next message is sent. */
  readonly suggestions: readonly string[];
}

export interface AgentSession {
  readonly snapshot: SessionSnapshot;
  /** Bound, so `useSyncExternalStore(session.subscribe, …)` works as is. */
  readonly subscribe: (listener: () => void) => () => void;
  /** The app's tools, replacements included, by name: what the view asks
   *  for a tool's `render`. */
  readonly tools: ReadonlyMap<string, AnyToolDef>;
  /** Start the harness now, rather than at the first `send`. */
  start(): Promise<void>;
  /**
   * Send a message: the user's, or, with `from`, another session's. Sent
   * mid-turn it steers where the harness can, and otherwise waits its turn.
   */
  send(input: string | ComposedMessage): void;
  /** Stop the turn. Queued messages come back as `snapshot.restored`. */
  stop(): Promise<void>;
  /** Hold every tool call at the gate. Needs `capabilities.gate` to be
   *  `'every-call'`; elsewhere it holds only the calls the agent asks about. */
  pause(): void;
  resume(): void;
  /** Answer a tool call waiting for approval. */
  respond(toolId: string, choice: ApprovalChoice, note?: string): void;
  /** Answer a question; `null` dismisses it. */
  answer(questionId: string, answers: Record<string, string> | null): void;
  setModel(id: string): Promise<void>;
  setMode(id: string): Promise<void>;
  /** A line in the transcript from the app: an action's result, a failure. */
  notify(level: 'info' | 'warning' | 'error', text: string): void;
  /** The transcript as markdown, for Copy. */
  toMarkdown(): string;
  /** Mark `restored` as taken. */
  takeRestored(): string | undefined;
  close(): Promise<void>;
}

const APPROVAL_OPTIONS: readonly ApprovalOption[] = Object.freeze([
  { id: 'allow-once', label: 'Allow', kind: 'allow' },
  { id: 'allow-session', label: 'Allow for this session', kind: 'allow' },
  { id: 'deny', label: 'Deny', kind: 'deny' },
]);

const BUSY: ReadonlySet<AgentStatus> = new Set([
  'starting',
  'running',
  'waiting',
  'paused',
]);

export function createAgentSession(options: AgentOptions = {}): AgentSession {
  return new Session(options);
}

/** Lines that tell the agent what the UI can draw — see `describe` on a
 *  fence or a component. */
export function describeRenderers(
  renderers: {
    fences?: Readonly<Record<string, unknown>>;
    components?: Readonly<Record<string, unknown>>;
  } = {},
): string[] {
  const lines: string[] = [];
  for (const [lang, entry] of Object.entries(renderers.fences ?? {})) {
    const describe = describeOf(entry);
    if (describe) {
      lines.push(
        `The UI draws a fenced code block tagged \`${lang}\` as: ${describe}`,
      );
    }
  }
  for (const [name, entry] of Object.entries(renderers.components ?? {})) {
    const describe = describeOf(entry);
    if (describe) {
      lines.push(
        `The UI draws a <${name}/> tag, alone on its line, as: ${describe}. ` +
          'Its attributes are strings or JSON.',
      );
    }
  }
  return lines.length
    ? ['You are shown in a chat UI that renders markdown.', ...lines]
    : [];
}

function describeOf(entry: unknown): string | undefined {
  return entry && typeof entry === 'object' && 'describe' in entry
    ? String((entry as { describe: unknown }).describe)
    : undefined;
}

class Session implements AgentSession {
  readonly #options: AgentOptions;
  readonly #config: DriverConfig;
  #snapshot: SessionSnapshot;
  readonly #listeners = new Set<() => void>();
  #driver: DriverSession | null = null;
  #starting: Promise<DriverSession | null> | null = null;
  #turn: AbortController | null = null;
  readonly #queue: OutgoingMessage[] = [];
  #ids = 0;

  readonly #decisions = new Map<string, GateDecision>();
  readonly #sessionAllowed = new Set<string>();
  readonly #approvals = new Map<string, (r: ApprovalResult) => void>();
  readonly #questions = new Map<
    string,
    (a: Record<string, string> | null) => void
  >();
  #paused = false;
  readonly #resumers = new Set<() => void>();

  constructor(options: AgentOptions) {
    this.#options = options;
    this.#config = resolveConfig(options);
    const messages = restore(options.messages ?? []);
    // the user's next message continues the saved ones' numbering, so its
    // id is not one already in the transcript
    for (const m of messages) {
      const n = /^u(\d+)$/.exec(m.id);
      if (n) this.#ids = Math.max(this.#ids, Number(n[1]));
    }
    const driverName =
      typeof options.agent === 'object' ? options.agent.name : 'claude';
    this.#snapshot = Object.freeze({
      status: 'idle',
      messages,
      info: {
        agent: driverName,
        cwd: this.#config.cwd,
        models: [],
        modes: [],
        commands: [],
      },
      capabilities: NO_CAPABILITIES,
      paused: false,
      suggestions: [],
    });
  }

  get snapshot(): SessionSnapshot {
    return this.#snapshot;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  get tools(): ReadonlyMap<string, AnyToolDef> {
    return this.#config.tools;
  }

  #set(patch: Partial<SessionSnapshot>): void {
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch });
    for (const l of [...this.#listeners]) l();
  }

  #dispatch(action: TranscriptAction): void {
    const messages = reduce(this.#snapshot.messages, action);
    if (messages !== this.#snapshot.messages) this.#set({ messages });
  }

  // --- the harness -----------------------------------------------------------

  start(): Promise<void> {
    return this.#start().then(() => undefined);
  }

  #start(): Promise<DriverSession | null> {
    if (this.#driver) return Promise.resolve(this.#driver);
    if (this.#starting) return this.#starting;
    this.#set({ status: 'starting', error: undefined });
    this.#starting = (async () => {
      try {
        const driver = await loadDriver(this.#options.agent);
        const session = await driver.start(this.#host());
        this.#driver = session;
        this.#set({
          capabilities: session.capabilities,
          status: this.#turn ? 'running' : 'idle',
        });
        return session;
      } catch (err) {
        const unavailable = err instanceof AgentUnavailableError;
        this.#set({
          status: unavailable ? 'unavailable' : 'error',
          error: err instanceof Error ? err.message : String(err),
        });
        this.#turn = null;
        return null;
      } finally {
        this.#starting = null;
      }
    })();
    return this.#starting;
  }

  #host(): DriverHost {
    return {
      config: this.#config,
      emit: (event) => this.#onEvent(event),
      gate: (call) => this.#gate(call, true),
      approve: (call, signal) => this.#approve(call, signal),
      ask: (id, questions, signal) => this.#ask(id, questions, signal),
      runTool: (name, input, ctx) => this.#runTool(name, input, ctx),
    };
  }

  #onEvent(event: DriverEvent): void {
    switch (event.type) {
      case 'info':
        this.#set({ info: { ...this.#snapshot.info, ...event.info } });
        return;
      case 'usage':
        this.#set({
          info: {
            ...this.#snapshot.info,
            usage: { ...this.#snapshot.info.usage, ...event.usage },
          },
        });
        return;
      case 'suggestion':
        if (!event.text.trim()) return;
        this.#set({
          suggestions: [
            ...this.#snapshot.suggestions.filter((t) => t !== event.text),
            event.text,
          ],
        });
        return;
      case 'message':
        // the harness took it and is acting on it: a turn, if none runs,
        // and the replies suggested for the last one no longer fit
        this.#dispatch(event);
        if (this.#snapshot.suggestions.length) this.#set({ suggestions: [] });
        if (!this.#turn) {
          this.#turn = new AbortController();
          this.#set({ status: this.#paused ? 'paused' : 'running' });
        }
        return;
      case 'turn-end':
        this.#dispatch(event);
        if (event.reason === 'error' && event.error) {
          this.#dispatch({ type: 'notice', level: 'error', text: event.error });
        }
        this.#endTurn();
        return;
      default:
        this.#dispatch(event);
    }
  }

  #endTurn(): void {
    this.#turn = null;
    this.#decisions.clear();
    const next = this.#queue.shift();
    if (next) {
      this.#dispatch({ type: 'unqueue', id: next.id });
      void this.#deliver(next);
      return;
    }
    if (BUSY.has(this.#snapshot.status)) this.#set({ status: 'idle' });
  }

  // --- the user's side -------------------------------------------------------

  send(input: string | ComposedMessage): void {
    const composed: ComposedMessage =
      typeof input === 'string' ? { text: input } : input;
    const text = composed.text;
    const attachments = composed.attachments ?? [];
    const from = composed.from;
    if (!text.trim() && !attachments.length) return;
    if (this.#snapshot.status === 'closed') return;

    if (this.#snapshot.suggestions.length) this.#set({ suggestions: [] });
    const id = `u${++this.#ids}`;
    const parts: Part[] = [];
    if (text)
      parts.push({ type: 'text', id: `${id}:t`, text, streaming: false });
    attachments.forEach((a, i) =>
      parts.push({
        type: 'file',
        id: `${id}:f${i}`,
        label: a.label,
        mime: a.mime ?? (a.kind === 'image' ? 'image/png' : 'text/plain'),
        ...(a.path ? { path: a.path } : {}),
        ...(a.data !== undefined ? { data: a.data } : {}),
      }),
    );

    const busy = !!this.#turn;
    const steer = busy && this.#snapshot.capabilities.steer;
    const queued = busy && !steer;
    this.#dispatch({
      type: 'user',
      message: {
        id,
        role: 'user',
        parts,
        createdAt: Date.now(),
        ...(from ? { from } : {}),
        ...(queued ? { queued: true } : {}),
      },
    });
    const out: OutgoingMessage = {
      id,
      text,
      attachments,
      steer,
      ...(from ? { from } : {}),
    };
    if (queued) this.#queue.push(out);
    else void this.#deliver(out);
  }

  async #deliver(message: OutgoingMessage): Promise<void> {
    if (!message.steer) this.#turn = new AbortController();
    if (!this.#paused) this.#set({ status: 'running', restored: undefined });
    const driver = await this.#start();
    if (!driver) return;
    if (!this.#turn && !message.steer) return; // stopped while starting
    if (!BUSY.has(this.#snapshot.status)) this.#set({ status: 'running' });
    try {
      driver.send(message);
    } catch (err) {
      this.#onEvent({
        type: 'turn-end',
        reason: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async stop(): Promise<void> {
    if (!this.#turn && !this.#queue.length) return;
    // what the user typed goes back to the composer; what another session
    // sent is not theirs to edit, and goes with the turn
    const restored = this.#queue
      .filter((m) => !m.from)
      .map((m) => m.text)
      .join('\n\n');
    const dropped = new Set(this.#queue.map((m) => m.id));
    this.#queue.length = 0;
    this.#turn?.abort();
    for (const [id, resolve] of this.#approvals) {
      this.#approvals.delete(id);
      resolve({
        behavior: 'deny',
        message: 'Stopped by the user.',
        interrupt: true,
      });
    }
    for (const [id, resolve] of this.#questions) {
      this.#questions.delete(id);
      resolve(null);
    }
    this.#wake();
    if (dropped.size) {
      this.#set({
        messages: this.#snapshot.messages.filter((m) => !dropped.has(m.id)),
        restored: restored || undefined,
      });
    }
    const driver = this.#driver;
    this.#dispatch({ type: 'stopped' });
    this.#turn = null;
    this.#decisions.clear();
    this.#set({ status: 'idle' });
    try {
      await driver?.interrupt();
    } catch {
      // the harness is already gone; the transcript says stopped either way
    }
  }

  takeRestored(): string | undefined {
    const restored = this.#snapshot.restored;
    if (restored !== undefined) this.#set({ restored: undefined });
    return restored;
  }

  pause(): void {
    if (this.#paused) return;
    this.#paused = true;
    this.#set({
      paused: true,
      ...(this.#turn ? { status: 'paused' as const } : {}),
    });
  }

  resume(): void {
    if (!this.#paused) return;
    this.#paused = false;
    this.#set({
      paused: false,
      ...(this.#snapshot.status === 'paused'
        ? {
            status:
              this.#approvals.size || this.#questions.size
                ? 'waiting'
                : 'running',
          }
        : {}),
    } as Partial<SessionSnapshot>);
    this.#wake();
  }

  #wake(): void {
    const resumers = [...this.#resumers];
    this.#resumers.clear();
    for (const r of resumers) r();
  }

  #unpaused(signal?: AbortSignal): Promise<void> {
    if (!this.#paused || signal?.aborted || !this.#turn)
      return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        this.#resumers.delete(done);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      this.#resumers.add(done);
      signal?.addEventListener('abort', done, { once: true });
    });
  }

  respond(toolId: string, choice: ApprovalChoice, note?: string): void {
    const resolve = this.#approvals.get(toolId);
    if (!resolve) return;
    this.#approvals.delete(toolId);
    if (choice === 'deny') {
      resolve({
        behavior: 'deny',
        message: note?.trim()
          ? `Denied by the user: ${note.trim()}`
          : 'Denied by the user.',
      });
      return;
    }
    if (choice === 'allow-session') {
      const part = findLivePart(this.#snapshot.messages, toolId);
      if (part?.type === 'tool') this.#sessionAllowed.add(part.label);
    }
    resolve({ behavior: 'allow' });
  }

  answer(questionId: string, answers: Record<string, string> | null): void {
    const resolve = this.#questions.get(questionId);
    if (!resolve) return;
    this.#questions.delete(questionId);
    resolve(answers);
  }

  async setModel(id: string): Promise<void> {
    const driver = this.#driver ?? (await this.#start());
    if (!driver?.setModel) return;
    await driver.setModel(id);
    this.#set({ info: { ...this.#snapshot.info, model: id } });
  }

  async setMode(id: string): Promise<void> {
    const driver = this.#driver ?? (await this.#start());
    if (!driver?.setMode) return;
    await driver.setMode(id);
    this.#set({ info: { ...this.#snapshot.info, mode: id } });
  }

  notify(level: 'info' | 'warning' | 'error', text: string): void {
    // a notice goes in the turn under way, or in a message of its own
    if (!this.#turn) {
      this.#dispatch({
        type: 'user',
        message: {
          id: `n${++this.#ids}`,
          role: 'assistant',
          parts: [{ type: 'notice', id: `n${this.#ids}:0`, level, text }],
          createdAt: Date.now(),
          done: true,
        },
      });
      return;
    }
    this.#dispatch({ type: 'notice', level, text });
  }

  toMarkdown(): string {
    return transcriptMarkdown(this.#snapshot.messages);
  }

  async close(): Promise<void> {
    if (this.#snapshot.status === 'closed') return;
    await this.stop();
    const driver = this.#driver;
    this.#driver = null;
    this.#set({ status: 'closed' });
    await driver?.close();
  }

  // --- the harness's questions -------------------------------------------------

  async #gate(call: ToolCall, remember: boolean): Promise<GateDecision> {
    if (this.#paused && this.#turn) return { behavior: 'ask' };
    const known = this.#decisions.get(call.id);
    if (known) return known;
    if (this.#sessionAllowed.has(call.label)) return { behavior: 'allow' };

    let decision: GateDecision;
    let fromApp: ToolDecision;
    try {
      fromApp = await this.#options.onToolCall?.(call);
    } catch (err) {
      fromApp = {
        deny: `The app's check failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (fromApp === undefined) decision = policyDecision(call, this.#config);
    else if (fromApp === 'allow') decision = { behavior: 'allow' };
    else if (fromApp === 'allow-session') {
      this.#sessionAllowed.add(call.label);
      decision = { behavior: 'allow' };
    } else if (fromApp === 'deny') {
      decision = { behavior: 'deny', message: 'Denied by the app.' };
    } else if (fromApp === 'ask') decision = { behavior: 'ask' };
    else if ('deny' in fromApp)
      decision = { behavior: 'deny', message: fromApp.deny };
    else decision = { behavior: 'allow', input: fromApp.input };

    if (remember) this.#decisions.set(call.id, decision);
    if (decision.behavior === 'deny') {
      this.#dispatch({ type: 'approved', id: call.id, allowed: false });
    }
    return decision;
  }

  async #approve(
    call: ToolCall,
    signal?: AbortSignal,
  ): Promise<ApprovalResult> {
    await this.#unpaused(signal);
    if (signal?.aborted || !this.#turn) {
      return {
        behavior: 'deny',
        message: 'Stopped by the user.',
        interrupt: true,
      };
    }
    const decision = await this.#gate(call, true);
    if (decision.behavior === 'allow') {
      return { behavior: 'allow', input: decision.input };
    }
    if (decision.behavior === 'deny') {
      return { behavior: 'deny', message: decision.message };
    }

    if (!findLivePart(this.#snapshot.messages, call.id)) {
      this.#dispatch({
        type: 'tool-start',
        id: call.id,
        name: call.name,
        label: call.label,
        kind: call.kind,
        title: call.title,
        input: call.input,
        app: call.app,
      });
    }
    this.#dispatch({
      type: 'approval',
      id: call.id,
      options: APPROVAL_OPTIONS,
    });
    this.#set({ status: 'waiting' });
    const result = await new Promise<ApprovalResult>((resolve) => {
      this.#approvals.set(call.id, resolve);
      signal?.addEventListener(
        'abort',
        () => {
          if (!this.#approvals.delete(call.id)) return;
          resolve({ behavior: 'deny', message: 'Stopped.', interrupt: true });
        },
        { once: true },
      );
    });
    this.#decisions.set(
      call.id,
      result.behavior === 'allow'
        ? { behavior: 'allow', input: result.input }
        : { behavior: 'deny', message: result.message },
    );
    this.#dispatch({
      type: 'approved',
      id: call.id,
      allowed: result.behavior === 'allow',
    });
    this.#settleWaiting();
    return result;
  }

  async #ask(
    id: string,
    questions: readonly Question[],
    signal?: AbortSignal,
  ): Promise<Record<string, string> | null> {
    this.#dispatch({ type: 'question', id, questions });
    this.#set({ status: 'waiting' });
    const answers = await new Promise<Record<string, string> | null>(
      (resolve) => {
        this.#questions.set(id, resolve);
        signal?.addEventListener(
          'abort',
          () => {
            if (this.#questions.delete(id)) resolve(null);
          },
          { once: true },
        );
      },
    );
    this.#dispatch({ type: 'answered', id, answers });
    this.#settleWaiting();
    return answers;
  }

  #settleWaiting(): void {
    if (this.#approvals.size || this.#questions.size) return;
    if (this.#snapshot.status === 'waiting') {
      this.#set({
        status: this.#turn ? (this.#paused ? 'paused' : 'running') : 'idle',
      });
    }
  }

  async #runTool(
    name: string,
    input: unknown,
    ctx: { callId?: string; signal?: AbortSignal },
  ): Promise<ToolResult> {
    const tool = this.#config.tools.get(name);
    if (!tool) return errorResult(new Error(`No tool named ${name}.`));
    const checked = await validateInput(tool.parameters, input);
    if (!checked.ok) return errorResult(new Error(checked.message));
    const callId = ctx.callId ?? `${name}:${++this.#ids}`;
    const signal =
      ctx.signal ?? this.#turn?.signal ?? new AbortController().signal;
    if (ctx.callId) {
      this.#dispatch({ type: 'tool-update', id: callId, state: 'running' });
    }
    try {
      const returned = await tool.run(checked.value, {
        signal,
        callId,
        progress: (text) => {
          if (ctx.callId) {
            this.#dispatch({ type: 'tool-update', id: callId, progress: text });
          }
        },
      });
      const { result, output } = normalizeResult(returned);
      if (ctx.callId) {
        this.#dispatch({ type: 'tool-update', id: callId, output });
      }
      return result;
    } catch (err) {
      if (ctx.callId) {
        this.#dispatch({
          type: 'tool-update',
          id: callId,
          output: [],
        });
      }
      return errorResult(err);
    }
  }
}

function resolveConfig(options: AgentOptions): DriverConfig {
  const tools = new Map<string, AnyToolDef>(
    Object.entries(options.tools ?? {}),
  );
  const removed: string[] = [];
  const asking: string[] = [];
  const replaced: Partial<Record<CoreToolKey, string>> = {};
  for (const [key, setting] of Object.entries(options.coreTools ?? {})) {
    if (setting === undefined || setting === true) continue;
    if (setting === false) removed.push(key);
    else if (setting === 'ask') asking.push(key);
    else {
      tools.set(key, setting);
      replaced[key as CoreToolKey] = key;
    }
  }
  const instructions = Array.isArray(options.instructions)
    ? options.instructions.filter(Boolean).join('\n\n')
    : ((options.instructions as string | undefined) ?? '');
  return {
    cwd: options.cwd ?? process.cwd(),
    folders: options.folders ?? [],
    instructions,
    ...(options.systemPrompt !== undefined
      ? { systemPrompt: options.systemPrompt }
      : {}),
    removed,
    asking,
    replaced,
    tools,
    permissions: options.permissions ?? 'ask',
    ...(options.model ? { model: options.model } : {}),
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.resume ? { resume: options.resume } : {}),
    settings: options.settings ?? 'cli',
    driverOptions: options.driverOptions ?? {},
  };
}

async function loadDriver(agent: AgentOptions['agent']): Promise<AgentDriver> {
  if (agent && typeof agent === 'object') return agent;
  // A dynamic import, so a bundle that never names Claude carries none of it.
  const { claudeDriver } = await import('../drivers/claude/index.js');
  return claudeDriver();
}
