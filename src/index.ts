// `@windowkit/agent-chat`: `<AgentChat>` and the hooks around it, with the
// core's types and helpers re-exported, so an app imports from one place.
//
// The drivers are not re-exported: each is its own subpath
// (`/drivers/claude`), loaded when a session starts, so a bundle carries the
// one it uses.

export {
  AgentChat,
  type AgentChatProps,
  type AgentChatViewProps,
} from './view/AgentChat.js';
export { useAgent, useSessionSnapshot } from './view/use-agent.js';
export type { ComposerOptions } from './view/Composer.js';
export {
  copyCode,
  defineTool,
  type CodeAction,
  type CodeActionContext,
  type ComponentEntry,
  type FenceEntry,
  type FenceInfo,
  type ToolRenderer,
} from './view/types.js';
export { splitFences, type Segment } from './view/fences.js';

export {
  AgentUnavailableError,
  categoryOf,
  createAgentSession,
  describeRenderers,
  messageMarkdown,
  sourceLabel,
  transcriptMarkdown,
  type AgentDriver,
  type AgentOptions,
  type AgentSession,
  type AnyToolDef,
  type CoreToolSetting,
  type DriverConfig,
  type DriverEvent,
  type DriverHost,
  type DriverSession,
  type SessionSnapshot,
  type ToolContext,
  type ToolDef,
  type ToolParameters,
  type ToolRenderInfo,
  type ToolResult,
} from './core/index.js';
export type * from './core/types.js';
