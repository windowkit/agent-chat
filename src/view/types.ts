// The view's own props: renderers and actions. Nothing here reaches the
// session, but `describe` does reach the agent, as instructions.

import type { ComponentType, ReactNode } from 'react';
import type { IconName } from 'react-x11';
import type { FenceInfo } from '@react-x11/components/markdown';

import type { AgentSession } from '../core/session.js';
import type {
  ToolDef,
  ToolParameters,
  InferInput,
  ToolRenderInfo,
} from '../core/tools.js';
import type { AgentMessage } from '../core/types.js';

export type { FenceInfo };

/**
 * How a fenced block with this language is drawn: a function, or the
 * function and a line that tells the agent the format exists.
 */
export type FenceEntry =
  | ((fence: FenceInfo) => ReactNode)
  | { render: (fence: FenceInfo) => ReactNode; describe?: string };

/**
 * A component a reply may name as a tag on its own line: `<Ticket id="12"/>`.
 * A tag is a component iff its name is a key here; nothing is evaluated.
 */
export type ComponentEntry =
  | ComponentType<Record<string, unknown>>
  | { component: ComponentType<Record<string, unknown>>; describe?: string };

/** What a code action is handed besides the fence. */
export interface CodeActionContext {
  session: AgentSession;
  message: AgentMessage;
  /** Put text on the clipboard. */
  copy(text: string): Promise<void>;
}

/** A button on a fenced code block's header. */
export interface CodeAction {
  id: string;
  label: string;
  icon?: IconName;
  /** Shown for a moment after `run` resolves: `'Copied'`. */
  doneLabel?: string;
  /** Default: every block. */
  when?: (fence: FenceInfo) => boolean;
  run(fence: FenceInfo, ctx: CodeActionContext): void | Promise<void>;
}

/** The built-in Copy. The default `codeActions` is `[copyCode]`. */
export const copyCode: CodeAction = Object.freeze({
  id: 'copy',
  label: 'Copy',
  doneLabel: 'Copied',
  run: (fence: FenceInfo, ctx: CodeActionContext) => ctx.copy(fence.text),
});

/** Draws a tool call: the part, its parsed input, and what `run` returned. */
export type ToolRenderer = (info: ToolRenderInfo) => ReactNode;

/** `defineTool`, with `render` typed for this view. */
export function defineTool<P extends ToolParameters, O>(
  def: ToolDef<InferInput<P>, O, ReactNode> & { parameters: P },
): ToolDef<InferInput<P>, O, ReactNode> {
  return def;
}
