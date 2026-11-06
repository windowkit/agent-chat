// What every part of the view reads: the session, the app's renderers and
// actions, normalized once with stable identities.
//
// Stable identities matter: `<Markdown>` keeps a block cache keyed on its
// `fences` and `components` maps, and a new map per render would re-parse
// every message on every token.

import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from 'react';
import type { FenceInfo } from '@react-x11/components/markdown';

import type { AgentSession } from '../core/session.js';
import type {
  CodeAction,
  ComponentEntry,
  FenceEntry,
  ToolRenderer,
} from './types.js';

export interface ChatContextValue {
  session: AgentSession;
  /** For `<Markdown fences>`: language → renderer. */
  fences: Record<string, (fence: FenceInfo) => ReactNode> | undefined;
  /** For `<Markdown components>`. */
  components:
    Record<string, ComponentType<Record<string, unknown>>> | undefined;
  renderTool: Readonly<Record<string, ToolRenderer>>;
  codeActions: readonly CodeAction[];
  onLink: ((href: string) => void) | undefined;
  /** Base text size, the theme's unless the app said. */
  fontSize: number | undefined;
}

export const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error('A chat part was rendered outside <AgentChat>.');
  return value;
}

export function fenceMap(
  fences: Readonly<Record<string, FenceEntry>> | undefined,
): Record<string, (fence: FenceInfo) => ReactNode> | undefined {
  if (!fences) return undefined;
  const out: Record<string, (fence: FenceInfo) => ReactNode> = {};
  for (const [lang, entry] of Object.entries(fences)) {
    out[lang.toLowerCase()] =
      typeof entry === 'function' ? entry : entry.render;
  }
  return out;
}

export function componentMap(
  components: Readonly<Record<string, ComponentEntry>> | undefined,
): Record<string, ComponentType<Record<string, unknown>>> | undefined {
  if (!components) return undefined;
  const out: Record<string, ComponentType<Record<string, unknown>>> = {};
  for (const [name, entry] of Object.entries(components)) {
    out[name] =
      typeof entry === 'object' && entry !== null && 'component' in entry
        ? entry.component
        : (entry as ComponentType<Record<string, unknown>>);
  }
  return out;
}
