// `@windowkit/agent-chat/core`: the session, the message model, the driver
// seam and the tool helpers. No React, and no renderer: a DOM or terminal
// front end can drive the same session.

export {
  createAgentSession,
  describeRenderers,
  type AgentOptions,
  type AgentSession,
  type CoreToolSetting,
  type SessionSnapshot,
} from './session.js';
export {
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
export {
  defineTool,
  errorResult,
  isStandardSchema,
  jsonSchemaOf,
  normalizeResult,
  validateInput,
  type AnyToolDef,
  type InferInput,
  type JsonObjectSchema,
  type StandardSchemaLike,
  type ToolContext,
  type ToolDef,
  type ToolParameters,
  type ToolRenderInfo,
  type ToolResult,
} from './tools.js';
export {
  reduce,
  restore,
  findLivePart,
  findPart,
  type TranscriptAction,
} from './reducer.js';
export { categoryOf, policyDecision } from './policy.js';
export {
  messageMarkdown,
  sourceLabel,
  transcriptMarkdown,
} from './markdown.js';
export * from './types.js';
