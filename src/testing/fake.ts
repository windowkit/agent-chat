// A driver that plays a script: no harness, no key, no network.
//
// It goes through the real session — the gate, the policy, the approval
// row, the app's tools — so a test of the UI tests what an app ships, and the
// demo example runs on a machine with nothing installed.

import type {
  AgentDriver,
  DriverEvent,
  DriverHost,
  DriverSession,
  OutgoingMessage,
} from '../core/driver.js';
import {
  NO_CAPABILITIES,
  type Capabilities,
  type Question,
  type SessionInfo,
  type ToolCall,
  type ToolKind,
  type ToolOutput,
} from '../core/types.js';

export type FakeStep =
  | DriverEvent
  /** Pause the script. */
  | { type: 'wait'; ms: number }
  /** Stream text in chunks of `chunk` characters, `delay` ms apart. */
  | {
      type: 'say';
      text: string;
      chunk?: number;
      delay?: number;
      reasoning?: boolean;
    }
  /**
   * A tool call, through the gate: an app tool (one in `tools`) runs the
   * app's function; any other ends with `result`.
   */
  | {
      type: 'call';
      id?: string;
      name: string;
      input?: unknown;
      kind?: ToolKind;
      title?: string;
      result?: string | readonly ToolOutput[];
      error?: string;
    }
  /** A question for the user; the script goes on once it is answered. */
  | { type: 'ask'; id?: string; questions: readonly Question[] };

export type FakeScript = (
  message: OutgoingMessage,
  turn: number,
) =>
  readonly FakeStep[] | Promise<readonly FakeStep[]> | AsyncIterable<FakeStep>;

export interface FakeDriverOptions {
  name?: string;
  capabilities?: Partial<Capabilities>;
  info?: Partial<SessionInfo>;
  /** Throw this from `start`, as a harness that cannot run would. */
  failStart?: Error;
}

export interface FakeDriver extends AgentDriver {
  /** Every message the session sent. */
  readonly sent: readonly OutgoingMessage[];
  /** The host, once started. */
  readonly host: DriverHost | null;
  /** How many times `interrupt` was called. */
  readonly interrupts: number;
}

const FAKE_CAPABILITIES: Capabilities = Object.freeze({
  ...NO_CAPABILITIES,
  tools: 'in-process',
  systemPrompt: Object.freeze({ replace: true, append: true }),
  coreTools: 'remove',
  gate: 'every-call',
}) as Capabilities;

export function fakeDriver(
  script: FakeScript,
  options: FakeDriverOptions = {},
): FakeDriver {
  const sent: OutgoingMessage[] = [];
  let host: DriverHost | null = null;
  let interrupts = 0;
  const capabilities: Capabilities = {
    ...FAKE_CAPABILITIES,
    ...options.capabilities,
  };

  const driver: FakeDriver = {
    name: options.name ?? 'fake',
    get sent() {
      return sent;
    },
    get host() {
      return host;
    },
    get interrupts() {
      return interrupts;
    },
    async start(h) {
      if (options.failStart) throw options.failStart;
      host = h;
      h.emit({
        type: 'info',
        info: {
          agent: driver.name,
          model: 'fake',
          models: [],
          ...options.info,
        },
      });
      let turn = 0;
      let running: AbortController | null = null;
      let chain = Promise.resolve();

      const session: DriverSession = {
        capabilities,
        send(message) {
          sent.push(message);
          if (message.steer) return;
          const n = turn++;
          chain = chain.then(async () => {
            const abort = new AbortController();
            running = abort;
            try {
              await play(h, script(message, n), n, abort.signal);
              if (!abort.signal.aborted)
                h.emit({ type: 'turn-end', reason: 'done' });
            } catch (err) {
              if (!abort.signal.aborted) {
                h.emit({
                  type: 'turn-end',
                  reason: 'error',
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            } finally {
              if (running === abort) running = null;
            }
          });
        },
        async interrupt() {
          interrupts++;
          running?.abort();
        },
        async setModel(id) {
          h.emit({ type: 'info', info: { model: id } });
        },
        async setMode(id) {
          h.emit({ type: 'info', info: { mode: id } });
        },
        async close() {
          running?.abort();
        },
      };
      return session;
    },
  };
  return driver;
}

/** A script that answers turn `n` with `turns[n]`, and the last one after. */
export function scripted(
  ...turns: ReadonlyArray<readonly FakeStep[]>
): FakeScript {
  return (_message, n) => turns[Math.min(n, turns.length - 1)] ?? [];
}

async function play(
  host: DriverHost,
  steps: ReturnType<FakeScript>,
  turn: number,
  signal: AbortSignal,
): Promise<void> {
  const resolved = await steps;
  let i = 0;
  const iterable: Iterable<FakeStep> | AsyncIterable<FakeStep> =
    Symbol.asyncIterator in (resolved as object)
      ? (resolved as AsyncIterable<FakeStep>)
      : (resolved as readonly FakeStep[]);
  for await (const step of iterable) {
    if (signal.aborted) return;
    await run(host, step, `f${turn}:${i++}`, signal);
  }
}

async function run(
  host: DriverHost,
  step: FakeStep,
  key: string,
  signal: AbortSignal,
): Promise<void> {
  switch (step.type) {
    case 'wait':
      await sleep(step.ms, signal);
      return;
    case 'say': {
      const size = Math.max(1, step.chunk ?? step.text.length);
      for (let at = 0; at < step.text.length; at += size) {
        if (signal.aborted) return;
        host.emit({
          type: 'text',
          id: key,
          delta: step.text.slice(at, at + size),
          ...(step.reasoning ? { reasoning: true } : {}),
        });
        await sleep(step.delay ?? 0, signal);
      }
      host.emit({
        type: 'text',
        id: key,
        text: step.text,
        done: true,
        ...(step.reasoning ? { reasoning: true } : {}),
      });
      return;
    }
    case 'call':
      await call(host, step, step.id ?? key, signal);
      return;
    case 'ask': {
      await host.ask(step.id ?? key, step.questions, signal);
      return;
    }
    default:
      host.emit(step);
  }
}

async function call(
  host: DriverHost,
  step: Extract<FakeStep, { type: 'call' }>,
  id: string,
  signal: AbortSignal,
): Promise<void> {
  const app = host.config.tools.has(step.name);
  const def = app ? host.config.tools.get(step.name) : undefined;
  const kind = step.kind ?? def?.kind ?? 'other';
  const title =
    step.title ??
    (def?.title && step.input !== undefined
      ? def.title(step.input)
      : step.name);
  host.emit({
    type: 'tool-start',
    id,
    name: step.name,
    label: step.name,
    kind,
    title,
    input: step.input ?? {},
    app,
  });
  const toolCall: ToolCall = {
    id,
    name: step.name,
    label: step.name,
    kind,
    title,
    input: step.input ?? {},
    app,
  };
  const gate = await host.gate(toolCall);
  let input: unknown = step.input ?? {};
  if (gate.behavior === 'deny') {
    host.emit({ type: 'tool-end', id, state: 'denied', error: gate.message });
    return;
  }
  if (gate.behavior === 'allow' && gate.input !== undefined) input = gate.input;
  if (gate.behavior === 'ask') {
    const approval = await host.approve(toolCall, signal);
    if (approval.behavior === 'deny') {
      if (!signal.aborted) {
        host.emit({
          type: 'tool-end',
          id,
          state: 'denied',
          error: approval.message,
        });
      }
      return;
    }
    if (approval.input !== undefined) input = approval.input;
  }
  if (signal.aborted) return;
  host.emit({ type: 'tool-update', id, state: 'running' });
  if (app) {
    const result = await host.runTool(step.name, input, { callId: id, signal });
    if (signal.aborted) return;
    const text = result.content
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('\n');
    host.emit({
      type: 'tool-end',
      id,
      state: result.isError ? 'error' : 'done',
      ...(result.isError ? { error: text } : {}),
    });
    return;
  }
  if (step.error !== undefined) {
    host.emit({ type: 'tool-end', id, state: 'error', error: step.error });
    return;
  }
  const output: readonly ToolOutput[] =
    typeof step.result === 'string'
      ? [{ type: 'text', text: step.result }]
      : (step.result ?? []);
  host.emit({ type: 'tool-end', id, state: 'done', output });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
