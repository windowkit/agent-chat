// The Claude driver: Claude Code, through the Claude Agent SDK, in-process.
//
// One `query()` in streaming-input mode is one harness process for the
// session's life; each `send` is a user message pushed into its input. What
// the SDK yields is mapped to `DriverEvent`s, and every question it asks the
// client goes to the session:
//
// - **A `PreToolUse` hook sees every call** and asks the session's gate —
//   the app's `onToolCall`, then the policy. The gate never waits on the
//   user, because a hook has a timeout. When the user must decide (or the
//   session is paused), the hook answers `ask`, and the harness routes the
//   call to `canUseTool`, which has none.
// - **`canUseTool` is the approval row**, and `AskUserQuestion`'s form.
// - **The app's tools run in this process**, in an SDK MCP server: the
//   handler is the app's function. `toolAliases` routes a built-in the app
//   replaced (`coreTools: { shell: tool }`) to it, so a model that calls
//   `Bash` anyway reaches the app's function.

import { stat } from 'node:fs/promises';

import { AgentUnavailableError } from '../../core/driver.js';
import type {
  AgentDriver,
  DriverHost,
  DriverSession,
  GateDecision,
  OutgoingMessage,
} from '../../core/driver.js';
import { jsonSchemaOf } from '../../core/tools.js';
import type {
  Capabilities,
  CoreToolKey,
  PermissionPolicy,
  PlanEntry,
  Question,
  ToolCall,
} from '../../core/types.js';
import { InputQueue } from './input.js';
import { TASK_TOOLS, TaskFold, dataOf, imagesOf } from './results.js';
import { incomingOf, originOf, peerEnvelope } from './peers.js';
import { shapeFromJsonSchema, zodShapeOf } from './schema.js';
import {
  loadClaudeSdk,
  loadZod,
  type ClaudeSdk,
  type SdkMessage,
  type SdkQuery,
  type SdkUserMessage,
  type ZodLike,
} from './sdk.js';
import {
  APP_PREFIX,
  APP_SERVER,
  CATEGORY_TOOLS,
  HIDDEN_TOOLS,
  isAppTool,
  kindOf,
  labelOf,
  outputOf,
  titleOf,
} from './tools.js';

export type { ClaudeSdk, SdkMessage, SdkQuery, SdkUserMessage } from './sdk.js';

export interface ClaudeDriverOptions {
  /** The SDK module. Default: `@anthropic-ai/claude-agent-sdk`, imported
   *  when the session starts. A test hands a fake. */
  sdk?: ClaudeSdk;
  /** Where to import the SDK from, when `sdk` is not given. Default
   *  `@anthropic-ai/claude-agent-sdk`. */
  module?: string;
}

export const CLAUDE_CAPABILITIES: Capabilities = Object.freeze({
  tools: 'in-process',
  systemPrompt: Object.freeze({ replace: true, append: true }),
  coreTools: 'remove',
  gate: 'every-call',
  steer: true,
  fork: false,
  rewindFiles: false,
  models: true,
  modes: true,
  images: true,
}) as Capabilities;

/** Claude Code's permission modes, as the mode picker offers them. */
export const CLAUDE_MODES = Object.freeze([
  { id: 'default', label: 'Ask before changes' },
  { id: 'acceptEdits', label: 'Accept edits' },
  { id: 'plan', label: 'Plan first' },
  { id: 'auto', label: 'Auto' },
]);

/** The policy as a starting permission mode. Always passed: the SDK's docs
 *  and its declarations disagree about where a session starts otherwise. */
const MODES: Readonly<Record<PermissionPolicy, string>> = {
  ask: 'default',
  edits: 'acceptEdits',
  'read-only': 'default',
  auto: 'auto',
};

export function claudeDriver(options: ClaudeDriverOptions = {}): AgentDriver {
  return {
    name: 'claude',
    async start(host) {
      const sdk = options.sdk ?? (await loadClaudeSdk(options.module));
      return startClaude(sdk, host);
    },
  };
}

async function startClaude(
  sdk: ClaudeSdk,
  host: DriverHost,
): Promise<DriverSession> {
  const config = host.config;
  // Unless the app runs Claude Code somewhere else, its directories are
  // this machine's.
  if (!config.driverOptions.spawnClaudeCodeProcess) {
    await mustBeDirectories([config.cwd, ...config.folders]);
  }
  const input = new InputQueue<SdkUserMessage>();

  // --- what is turned off, and what is replaced ----------------------------
  const disallowed = new Set<string>();
  const aliases: Record<string, string> = {};
  const namesOf = (key: string) => CATEGORY_TOOLS[key as CoreToolKey] ?? [key];
  for (const key of config.removed)
    for (const n of namesOf(key)) disallowed.add(n);
  for (const [key, tool] of Object.entries(config.replaced)) {
    for (const n of namesOf(key)) {
      disallowed.add(n);
      aliases[n] = `${APP_PREFIX}${tool}`;
    }
  }
  if (config.permissions === 'read-only') {
    for (const n of CATEGORY_TOOLS.edit) disallowed.add(n);
  }

  // --- the app's tools, in this process ------------------------------------
  // The SDK's handler is not told which tool_use it serves, so the hook,
  // which is, queues the ids per tool, and the handler takes the next one.
  const callIds = new Map<string, string[]>();
  const queueCall = (label: string, id: string) => {
    const ids = callIds.get(label) ?? [];
    if (!ids.includes(id)) ids.push(id);
    callIds.set(label, ids);
  };
  const dropCall = (label: string, id: string) => {
    const ids = callIds.get(label);
    if (ids)
      callIds.set(
        label,
        ids.filter((x) => x !== id),
      );
  };
  let zod: ZodLike | null = null;
  const sdkTools: unknown[] = [];
  for (const [name, def] of config.tools) {
    let shape = zodShapeOf(def.parameters);
    if (!shape) {
      zod ??= await loadZod();
      shape = shapeFromJsonSchema(jsonSchemaOf(def.parameters), zod);
    }
    sdkTools.push(
      sdk.tool(name, def.description, shape, (args) =>
        host.runTool(name, args, { callId: callIds.get(name)?.shift() }),
      ),
    );
  }

  // --- tool calls, as the session sees them --------------------------------
  const seen = new Map<
    string,
    { name: string; input: unknown; parent?: string }
  >();
  const tasks = new TaskFold();
  const denied = new Set<string>();
  const hidden = new Set<string>();

  const callOf = (name: string, toolInput: unknown, id: string): ToolCall => {
    const resolved = aliases[name] ?? name;
    const app = isAppTool(resolved);
    const label = labelOf(resolved);
    const def = app ? config.tools.get(label) : undefined;
    return {
      id,
      name,
      label,
      kind: def?.kind ?? kindOf(name),
      title: def
        ? (safeTitle(def.title, toolInput) ?? label)
        : titleOf(name, toolInput),
      input: toolInput,
      app,
    };
  };

  const preToolUse = async (hookInput: unknown) => {
    const i = hookInput as {
      tool_name: string;
      tool_input: unknown;
      tool_use_id: string;
    };
    if (HIDDEN_TOOLS.has(i.tool_name) || i.tool_name === 'ExitPlanMode')
      return {};
    const call = callOf(i.tool_name, i.tool_input, i.tool_use_id);
    const decision = await host.gate(call);
    if (decision.behavior === 'deny') denied.add(call.id);
    else if (call.app) queueCall(call.label, call.id);
    return hookOutput(decision);
  };

  const canUseTool = async (
    toolName: string,
    toolInput: Record<string, unknown>,
    opts: { signal: AbortSignal; toolUseID: string },
  ) => {
    if (toolName === 'AskUserQuestion') {
      const answers = await host.ask(
        opts.toolUseID,
        questionsOf(toolInput),
        opts.signal,
      );
      if (!answers) {
        return {
          behavior: 'deny',
          message: 'The user dismissed the question.',
        };
      }
      return { behavior: 'allow', updatedInput: { ...toolInput, answers } };
    }
    const call = callOf(toolName, toolInput, opts.toolUseID);
    const result = await host.approve(call, opts.signal);
    if (result.behavior === 'allow') {
      if (call.app) queueCall(call.label, call.id);
      return {
        behavior: 'allow',
        updatedInput:
          (result.input as Record<string, unknown> | undefined) ?? toolInput,
      };
    }
    denied.add(call.id);
    if (call.app) dropCall(call.label, call.id);
    return {
      behavior: 'deny',
      message: result.message,
      ...(result.interrupt ? { interrupt: true } : {}),
    };
  };

  // --- the query ------------------------------------------------------------
  // The app's tools are not put in `allowedTools`: the hook's gate allows
  // them (the policy runs an app tool unless its `ask` says otherwise), so
  // every call takes one path, `onToolCall` included. A bare `allowedTools`
  // entry would also keep `canUseTool` from an `ask: true` tool, and the SDK
  // warns about exactly that at every start.
  const options: Record<string, unknown> = {
    cwd: config.cwd,
    systemPrompt: config.systemPrompt
      ? [config.systemPrompt, config.instructions].filter(Boolean).join('\n\n')
      : {
          type: 'preset',
          preset: 'claude_code',
          ...(config.instructions ? { append: config.instructions } : {}),
        },
    settingSources:
      config.settings === 'isolated' ? [] : ['user', 'project', 'local'],
    permissionMode: config.mode ?? MODES[config.permissions],
    includePartialMessages: true,
    // Thinking as text to show. On Opus 4.7 and later the SDK's default is
    // `display: 'omitted'`: a thinking block arrives with no text, only its
    // signature, and the chat had an empty "Thought" to open. `adaptive` is
    // already the default for the models that think; `driverOptions.thinking`
    // overrides it, for an older model or for none.
    thinking: { type: 'adaptive', display: 'summarized' },
    // a reply the user might send next, after each turn: drawn as a chip
    // that fills the composer
    promptSuggestions: true,
    hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
    canUseTool,
    env: {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: '@windowkit/agent-chat',
    },
  };
  if (config.folders.length)
    options.additionalDirectories = [...config.folders];
  if (disallowed.size) options.disallowedTools = [...disallowed];
  if (Object.keys(aliases).length) options.toolAliases = aliases;
  if (sdkTools.length) {
    options.mcpServers = {
      [APP_SERVER]: sdk.createSdkMcpServer({
        name: APP_SERVER,
        version: '1.0.0',
        tools: sdkTools,
      }),
    };
  }
  if (config.model) options.model = config.model;
  if (config.resume) options.resume = config.resume;
  Object.assign(options, config.driverOptions);

  const query = sdk.query({ prompt: input, options });

  host.emit({
    type: 'info',
    info: {
      agent: 'claude',
      modes: CLAUDE_MODES,
      mode: options.permissionMode as string,
    },
  });

  // --- what the query yields ------------------------------------------------
  let inTurn = false;
  let swallow = 0;
  let received = 0;
  let asked = false;
  let message = '';
  const blocks = new Map<
    number,
    { kind: 'text' | 'reasoning' | 'tool'; id: string }
  >();
  const streamed = new Map<string, { text: string[]; reasoning: string[] }>();
  const finished = new Map<string, { text: number; reasoning: number }>();

  const handle = (m: SdkMessage) => {
    const parent =
      (m.parent_tool_use_id as string | null | undefined) ?? undefined;
    switch (m.type) {
      case 'system':
        return onSystem(m);
      case 'stream_event':
        return onStream(m.event as Record<string, unknown>, parent);
      case 'assistant':
        return onAssistant(m, parent);
      case 'user': {
        if (m.isReplay) return;
        const incoming = incomingOf(m);
        if (!incoming) return onToolResults(m);
        // a turn Claude Code took from another session or a channel: it is
        // acting on it, so a stop has a result to swallow
        inTurn = true;
        host.emit({
          type: 'message',
          id: typeof m.uuid === 'string' ? `in:${m.uuid}` : `in:${++received}`,
          ...incoming,
        });
        return;
      }
      case 'result':
        return onResult(m);
      case 'prompt_suggestion':
        if (typeof m.suggestion === 'string') {
          host.emit({ type: 'suggestion', text: m.suggestion });
        }
        return;
    }
  };

  const onSystem = (m: SdkMessage) => {
    if (m.subtype === 'init') {
      host.emit({
        type: 'info',
        info: {
          ...(typeof m.session_id === 'string' ? { id: m.session_id } : {}),
          ...(typeof m.model === 'string' ? { model: m.model } : {}),
          ...(typeof m.cwd === 'string' ? { cwd: m.cwd } : {}),
          ...(typeof m.permissionMode === 'string'
            ? { mode: m.permissionMode }
            : {}),
          ...(Array.isArray(m.slash_commands)
            ? {
                commands: (m.slash_commands as string[]).map((name) => ({
                  name,
                })),
              }
            : {}),
        },
      });
      if (!asked) {
        asked = true;
        void describeHarness(query, host);
      }
    } else if (m.subtype === 'compact_boundary') {
      host.emit({
        type: 'notice',
        level: 'info',
        text: 'The conversation was compacted.',
      });
    }
  };

  const onStream = (
    event: Record<string, unknown>,
    parent: string | undefined,
  ) => {
    switch (event.type) {
      case 'message_start': {
        message = String(
          (event.message as { id?: unknown } | undefined)?.id ?? '',
        );
        blocks.clear();
        return;
      }
      case 'content_block_start': {
        const index = Number(event.index);
        const block = event.content_block as Record<string, unknown>;
        if (block.type === 'text' || block.type === 'thinking') {
          const kind = block.type === 'text' ? 'text' : 'reasoning';
          const id = `${message}:${index}`;
          blocks.set(index, { kind, id });
          const list = streamed.get(message) ?? { text: [], reasoning: [] };
          list[kind].push(id);
          streamed.set(message, list);
        } else if (block.type === 'tool_use') {
          const id = String(block.id);
          const name = String(block.name);
          blocks.set(index, { kind: 'tool', id });
          seen.set(id, {
            name,
            input: undefined,
            ...(parent ? { parent } : {}),
          });
          if (HIDDEN_TOOLS.has(name)) {
            hidden.add(id);
            return;
          }
          const call = callOf(name, undefined, id);
          host.emit({
            type: 'tool-start',
            id,
            name,
            label: labelOf(aliases[name] ?? name),
            kind: call.kind,
            app: call.app,
            ...(parent ? { parent } : {}),
          });
        }
        return;
      }
      case 'content_block_delta': {
        const block = blocks.get(Number(event.index));
        const delta = event.delta as Record<string, unknown>;
        if (!block) return;
        if (delta.type === 'text_delta' && block.kind === 'text') {
          host.emit({
            type: 'text',
            id: block.id,
            delta: String(delta.text ?? ''),
          });
        } else if (
          delta.type === 'thinking_delta' &&
          block.kind === 'reasoning'
        ) {
          host.emit({
            type: 'text',
            id: block.id,
            reasoning: true,
            delta: String(delta.thinking ?? ''),
          });
        } else if (delta.type === 'input_json_delta' && block.kind === 'tool') {
          if (!hidden.has(block.id)) {
            host.emit({
              type: 'tool-input',
              id: block.id,
              delta: String(delta.partial_json ?? ''),
            });
          }
        }
        return;
      }
    }
  };

  const onAssistant = (m: SdkMessage, parent: string | undefined) => {
    const msg = m.message as { id?: unknown; content?: unknown } | undefined;
    const msgId = String(msg?.id ?? m.uuid ?? '');
    const content = Array.isArray(msg?.content)
      ? (msg.content as Record<string, unknown>[])
      : [];
    for (const block of content) {
      if (block.type === 'text' || block.type === 'thinking') {
        const kind = block.type === 'text' ? 'text' : 'reasoning';
        const count = finished.get(msgId) ?? { text: 0, reasoning: 0 };
        const k = count[kind]++;
        finished.set(msgId, count);
        const id = streamed.get(msgId)?.[kind][k] ?? `${msgId}:${kind}${k}`;
        const text = String(
          (kind === 'text' ? block.text : block.thinking) ?? '',
        );
        host.emit({
          type: 'text',
          id,
          text,
          done: true,
          ...(kind === 'reasoning' ? { reasoning: true } : {}),
          ...(parent ? { parent } : {}),
        });
      } else if (block.type === 'tool_use') {
        const id = String(block.id);
        const name = String(block.name);
        seen.set(id, {
          name,
          input: block.input,
          ...(parent ? { parent } : {}),
        });
        if (name === 'TodoWrite') {
          hidden.add(id);
          host.emit({
            type: 'plan',
            entries: planOf(block.input),
            ...(parent ? { parent } : {}),
          });
          continue;
        }
        if (HIDDEN_TOOLS.has(name)) {
          hidden.add(id);
          continue;
        }
        const call = callOf(name, block.input, id);
        host.emit({
          type: 'tool-start',
          id,
          name,
          label: labelOf(aliases[name] ?? name),
          kind: call.kind,
          title: call.title,
          input: block.input,
          app: call.app,
          ...(parent ? { parent } : {}),
        });
      }
    }
  };

  const onToolResults = (m: SdkMessage) => {
    const msg = m.message as { content?: unknown } | undefined;
    if (!Array.isArray(msg?.content)) return;
    const results = (msg.content as Record<string, unknown>[]).filter(
      (b) => b.type === 'tool_result',
    );
    // the tool's own output object, which is one per message: a message
    // with several results says nothing of which it belongs to
    const structured = results.length === 1 ? m.tool_use_result : undefined;
    for (const block of results) {
      const id = String(block.tool_use_id);
      const call = seen.get(id);
      const isError = block.is_error === true;
      if (
        call &&
        TASK_TOOLS.has(call.name) &&
        !isError &&
        tasks.apply(call.name, call.input, structured)
      ) {
        host.emit({
          type: 'plan',
          entries: tasks.entries(),
          ...(call.parent ? { parent: call.parent } : {}),
        });
      }
      if (hidden.has(id)) continue;
      const text = resultText(block.content);
      const name = call?.name ?? '';
      const app = isAppTool(aliases[name] ?? name);
      if (denied.has(id)) {
        host.emit({ type: 'tool-end', id, state: 'denied', error: text });
        continue;
      }
      host.emit({
        type: 'tool-end',
        id,
        state: isError ? 'error' : 'done',
        ...(isError ? { error: text } : {}),
        // an app tool's outputs are the session's, from the value `run` returned
        ...(app
          ? {}
          : {
              output: [
                ...outputOf(name, call?.input, text, isError),
                ...imagesOf(block.content, structured),
              ],
            }),
      });
      if (isError || app) continue;
      for (const d of dataOf(name, call?.input, structured)) {
        host.emit({
          type: 'data',
          id: `${id}:${d.key}`,
          name: d.name,
          value: d.value,
          ...(call?.parent ? { parent: call.parent } : {}),
        });
      }
    }
  };

  const onResult = (m: SdkMessage) => {
    const usage = (m.usage ?? {}) as {
      input_tokens?: number;
      output_tokens?: number;
    };
    host.emit({
      type: 'usage',
      usage: {
        ...(typeof m.total_cost_usd === 'number'
          ? { costUsd: m.total_cost_usd }
          : {}),
        ...(typeof usage.input_tokens === 'number'
          ? { inputTokens: usage.input_tokens }
          : {}),
        ...(typeof usage.output_tokens === 'number'
          ? { outputTokens: usage.output_tokens }
          : {}),
        ...(typeof m.num_turns === 'number' ? { turns: m.num_turns } : {}),
      },
    });
    inTurn = false;
    if (swallow > 0) {
      swallow--;
      return;
    }
    if (m.subtype === 'success') {
      host.emit({ type: 'turn-end', reason: 'done' });
      return;
    }
    const errors = Array.isArray(m.errors)
      ? (m.errors as unknown[]).map(String)
      : [];
    const limit =
      m.subtype === 'error_max_turns' || m.subtype === 'error_max_budget_usd';
    host.emit({
      type: 'turn-end',
      reason: limit ? 'limit' : 'error',
      error:
        errors.join('\n') ||
        (limit
          ? 'The turn reached its limit.'
          : `The turn failed (${String(m.subtype)}).`),
    });
  };

  void (async () => {
    try {
      for await (const m of query) handle(m);
      if (inTurn) {
        inTurn = false;
        host.emit({
          type: 'turn-end',
          reason: 'error',
          error: 'Claude Code exited.',
        });
      }
    } catch (err) {
      inTurn = false;
      host.emit({
        type: 'turn-end',
        reason: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return {
    capabilities: CLAUDE_CAPABILITIES,
    send(outgoing: OutgoingMessage) {
      if (!outgoing.steer) inTurn = true;
      const from = outgoing.from;
      input.push({
        type: 'user',
        message: {
          role: 'user',
          content: contentOf(
            from
              ? { ...outgoing, text: peerEnvelope(from, outgoing.text) }
              : outgoing,
          ),
        },
        parent_tool_use_id: null,
        origin: originOf(from),
        // another session's words, delivered as written: no `@path`
        // expansion, no slash commands
        ...(from ? { client_composed: true as const } : {}),
        ...(outgoing.steer ? { priority: 'next' as const } : {}),
      });
    },
    async interrupt() {
      if (inTurn) {
        inTurn = false;
        swallow++;
      }
      await query.interrupt();
    },
    async setModel(id: string) {
      await query.setModel?.(id);
    },
    async setMode(id: string) {
      await query.setPermissionMode?.(id);
    },
    async close() {
      input.end();
      query.close?.();
    },
  };
}

function hookOutput(decision: GateDecision): Record<string, unknown> {
  switch (decision.behavior) {
    case 'defer':
      return {};
    case 'allow':
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          ...(decision.input !== undefined
            ? { updatedInput: decision.input }
            : {}),
        },
      };
    case 'deny':
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: decision.message,
        },
      };
    case 'ask':
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'ask',
        },
      };
  }
}

/** The models and the commands, once the harness is up. Best effort: an
 *  older SDK without the methods leaves the lists as `init` gave them. */
async function describeHarness(
  query: SdkQuery,
  host: DriverHost,
): Promise<void> {
  try {
    const models = await query.supportedModels?.();
    if (models?.length) {
      host.emit({
        type: 'info',
        info: {
          models: models.map((m) => ({
            id: m.value,
            label: m.displayName,
            ...(m.description ? { description: m.description } : {}),
          })),
        },
      });
    }
  } catch {
    // the picker stays empty
  }
  try {
    const commands = await query.supportedCommands?.();
    if (commands?.length) {
      host.emit({
        type: 'info',
        info: {
          commands: commands.map((c) => ({
            name: c.name,
            ...(c.description ? { description: c.description } : {}),
          })),
        },
      });
    }
  } catch {
    // the commands stay as `init` named them
  }
}

function contentOf(
  message: OutgoingMessage,
): SdkUserMessage['message']['content'] {
  if (!message.attachments.length) return message.text;
  const blocks: Array<Record<string, unknown>> = [];
  if (message.text) blocks.push({ type: 'text', text: message.text });
  for (const a of message.attachments) {
    if (a.kind === 'image' && a.data) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: a.mime ?? 'image/png',
          data: a.data,
        },
      });
    } else if (a.kind === 'paste' && a.data) {
      blocks.push({ type: 'text', text: a.data });
    } else if (a.path) {
      blocks.push({ type: 'text', text: `@${a.path}` });
    }
  }
  return blocks;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) =>
      c && typeof c === 'object' && (c as { type?: unknown }).type === 'text'
        ? String((c as { text?: unknown }).text ?? '')
        : '',
    )
    .filter(Boolean)
    .join('\n');
}

function planOf(input: unknown): PlanEntry[] {
  const todos = (input as { todos?: unknown } | undefined)?.todos;
  if (!Array.isArray(todos)) return [];
  return todos.map((t: Record<string, unknown>) => ({
    text: String(t.content ?? t.activeForm ?? ''),
    status:
      t.status === 'completed' || t.status === 'in_progress'
        ? t.status
        : 'pending',
  }));
}

function questionsOf(input: Record<string, unknown>): Question[] {
  const questions = Array.isArray(input.questions) ? input.questions : [];
  return questions.map((q: Record<string, unknown>) => ({
    question: String(q.question ?? ''),
    ...(typeof q.header === 'string' ? { header: q.header } : {}),
    options: (Array.isArray(q.options) ? q.options : []).map(
      (o: Record<string, unknown>) => ({
        label: String(o.label ?? ''),
        ...(typeof o.description === 'string'
          ? { description: o.description }
          : {}),
      }),
    ),
    multiSelect: q.multiSelect === true,
  }));
}

function safeTitle(
  title: ((input: any) => string) | undefined,
  input: unknown,
): string | undefined {
  if (!title || input === undefined) return undefined;
  try {
    return title(input);
  } catch {
    return undefined;
  }
}

/**
 * A working directory that does not exist is the app's mistake to hear
 * about, said as such. Claude Code launched in one fails with `ENOENT`
 * naming the executable, which the SDK reads as a binary built for another
 * libc: "exists but failed to launch".
 */
async function mustBeDirectories(paths: readonly string[]): Promise<void> {
  const missing: string[] = [];
  for (const p of paths) {
    const found = await stat(p).catch(() => null);
    if (!found?.isDirectory()) missing.push(p);
  }
  if (missing.length) {
    throw new AgentUnavailableError(
      `Claude Code cannot start in a directory that does not exist: ${missing.join(', ')}. ` +
        'Create it, or pass another cwd.',
    );
  }
}
