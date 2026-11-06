// The slice of `@anthropic-ai/claude-agent-sdk` this driver uses, written out
// structurally, and the loader that reaches it.
//
// Two reasons it is not an `import type` from the package. The SDK is an
// optional peer — some 200 MB with its native binary — and an `import type`
// would put it in the type graph, so an app that never installed it could no
// longer type-check against this package. And tests hand the driver a fake
// SDK, which is all a structural type asks of them.

import { AgentUnavailableError } from '../../core/driver.js';
import type { ToolResult } from '../../core/tools.js';

/** One user turn, as streaming input takes it. */
export interface SdkUserMessage {
  type: 'user';
  message: {
    role: 'user';
    content: string | Array<Record<string, unknown>>;
  };
  parent_tool_use_id: null;
  priority?: 'now' | 'next' | 'later';
}

/** What the query yields. Read loosely: the union grows every month. */
export interface SdkMessage {
  type: string;
  subtype?: string;
  [key: string]: unknown;
}

export interface SdkQuery extends AsyncIterable<SdkMessage> {
  interrupt(): Promise<unknown>;
  setPermissionMode?(mode: string): Promise<void>;
  setModel?(model?: string): Promise<void>;
  supportedModels?(): Promise<
    Array<{ value: string; displayName: string; description?: string }>
  >;
  supportedCommands?(): Promise<Array<{ name: string; description?: string }>>;
  close?(): void;
}

export type SdkToolHandler = (
  args: Record<string, unknown>,
  extra: unknown,
) => Promise<ToolResult>;

export interface ClaudeSdk {
  query(args: {
    prompt: AsyncIterable<SdkUserMessage>;
    options?: Record<string, unknown>;
  }): SdkQuery;
  tool(
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: SdkToolHandler,
  ): unknown;
  createSdkMcpServer(options: {
    name: string;
    version?: string;
    tools?: unknown[];
  }): unknown;
}

export const CLAUDE_SDK = '@anthropic-ai/claude-agent-sdk';

/**
 * The SDK, or `AgentUnavailableError` saying what is wrong: not installed —
 * with the line that installs it — or installed and failing to load, with
 * the reason. A missing package the SDK itself needs is the second kind, not
 * the first: telling someone who has just installed the SDK to install it
 * sends them round in a circle.
 */
export async function loadClaudeSdk(
  specifier: string = CLAUDE_SDK,
): Promise<ClaudeSdk> {
  try {
    // The specifier is a variable so neither the compiler nor a bundler
    // follows it: the package is an optional peer.
    return (await import(specifier)) as ClaudeSdk;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: unknown } | null)?.code;
    const missing =
      (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') &&
      message.includes(`'${specifier}'`);
    throw new AgentUnavailableError(
      missing
        ? `The Claude Agent SDK is not installed. Install it beside this ` +
            `package: npm install ${specifier}`
        : `The Claude Agent SDK is installed but did not load: ${message}`,
    );
  }
}

/**
 * Zod, for the SDK's in-process tools: `tool()` takes a zod shape. An app
 * whose parameters are zod already hands its own over; a JSON Schema is
 * turned into one with the zod the SDK brought (a peer of the SDK, so
 * installed beside it).
 */
export interface ZodLike {
  string(): ZodTypeLike;
  number(): ZodTypeLike & { int(): ZodTypeLike };
  boolean(): ZodTypeLike;
  array(item: ZodTypeLike): ZodTypeLike;
  object(shape: Record<string, ZodTypeLike>): ZodTypeLike;
  enum(values: [string, ...string[]]): ZodTypeLike;
  unknown(): ZodTypeLike;
  record(key: ZodTypeLike, value: ZodTypeLike): ZodTypeLike;
  union(options: [ZodTypeLike, ZodTypeLike, ...ZodTypeLike[]]): ZodTypeLike;
  literal(value: string | number | boolean | null): ZodTypeLike;
  null(): ZodTypeLike;
}

export interface ZodTypeLike {
  optional(): ZodTypeLike;
  describe(description: string): ZodTypeLike;
}

export async function loadZod(): Promise<ZodLike> {
  try {
    const name: string = 'zod';
    const mod = (await import(name)) as { z?: ZodLike } & ZodLike;
    return mod.z ?? mod;
  } catch {
    throw new Error(
      'A tool with a JSON Schema needs zod to reach the Claude Agent SDK, ' +
        'which installs it as a peer. Install zod, or define the parameters ' +
        'with z.object().',
    );
  }
}
