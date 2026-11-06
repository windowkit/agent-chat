// `<AgentChat>`: a chat with a local agent harness.
//
// One element, one ladder. At the bottom, `<AgentChat agent="claude" />` is a
// working chat. Each rung up is a prop: context (`cwd`, `instructions`,
// `coreTools`), the app's own tools (`tools`), its renderers (`fences`,
// `components`, `renderTool`), its interception (`codeActions`,
// `onToolCall`). The top rung lifts the session out (`useAgent`, then
// `session`) with the same options, moved rather than rewritten.

import { useMemo, useRef, type ReactElement, type ReactNode } from 'react';
import type { StyleProp } from 'react-x11';

import {
  describeRenderers,
  type AgentOptions,
  type AgentSession,
  type SessionSnapshot,
} from '../core/session.js';
import type { ToolCall } from '../core/types.js';
import { Composer } from './Composer.js';
import {
  ChatContext,
  componentMap,
  fenceMap,
  type ChatContextValue,
} from './context.js';
import { Header } from './Header.js';
import { useLook } from './look.js';
import { Transcript } from './Transcript.js';
import {
  copyCode,
  type CodeAction,
  type ComponentEntry,
  type FenceEntry,
  type ToolRenderer,
} from './types.js';
import { useAgent, useSessionSnapshot } from './use-agent.js';

/** What the view takes, whoever owns the session. */
export interface AgentChatViewProps {
  /** Fenced blocks drawn by the app, by language. An entry with `describe`
   *  also tells the agent the format exists. */
  fences?: Readonly<Record<string, FenceEntry>>;
  /** Components a reply may name as a tag on its own line. */
  components?: Readonly<Record<string, ComponentEntry>>;
  /** Tool calls drawn by the app, by the tool's label; `'*'` for the rest.
   *  A tool's own `render` comes first. */
  renderTool?: Readonly<Record<string, ToolRenderer>>;
  /** Buttons on every fenced code block. Default `[copyCode]`. Nothing runs
   *  a block unless an action here does. */
  codeActions?: readonly CodeAction[];
  /** A link in a reply was pressed. Nothing navigates by itself. */
  onLink?: (href: string) => void;
  placeholder?: string;
  /** `true` for the session's line (agent, model, mode, cost, Copy), or a
   *  function of the session for the app's own. Default `true`. */
  header?: boolean | ((session: AgentSession) => ReactNode);
  /** Shown while the transcript is empty. */
  empty?: ReactNode;
  /** Shown instead of the chat when the harness cannot run here. Default: a
   *  line saying why. */
  fallback?: ReactNode | ((snapshot: SessionSnapshot) => ReactNode);
  /** Base text size. Default: the theme's. */
  fontSize?: number;
  autoFocus?: boolean;
  style?: StyleProp;
}

type NoOptions = { readonly [K in keyof AgentOptions]?: never };

/**
 * Either the session's options — the chat owns its session — or a
 * `session` from `useAgent`, and none of the options: they are the
 * session's, and a chat handed one does not change it.
 */
export type AgentChatProps = AgentChatViewProps &
  (
    | (AgentOptions & { session?: undefined })
    | (NoOptions & { session: AgentSession })
  );

export function AgentChat(props: AgentChatProps): ReactElement {
  return props.session ? (
    <ChatView session={props.session} view={props} />
  ) : (
    <OwnSession {...(props as AgentOptions & AgentChatViewProps)} />
  );
}

function OwnSession(props: AgentOptions & AgentChatViewProps): ReactElement {
  // Options are read once, but `onToolCall` is usually an inline arrow over
  // the app's state: the session calls the latest one.
  const latest = useRef(props);
  latest.current = props;
  const session = useAgent({
    ...props,
    instructions: [
      ...(Array.isArray(props.instructions)
        ? props.instructions
        : props.instructions
          ? [props.instructions as string]
          : []),
      ...describeRenderers({
        fences: props.fences,
        components: props.components,
      }),
    ],
    ...(props.onToolCall
      ? { onToolCall: (call: ToolCall) => latest.current.onToolCall?.(call) }
      : {}),
  });
  return <ChatView session={session} view={props} />;
}

function ChatView({
  session,
  view,
}: {
  session: AgentSession;
  view: AgentChatViewProps;
}): ReactElement {
  const snap = useSessionSnapshot(session);
  const look = useLook();
  const { fences, components, renderTool, codeActions, onLink, fontSize } =
    view;
  const context = useMemo<ChatContextValue>(
    () => ({
      session,
      fences: fenceMap(fences),
      components: componentMap(components),
      renderTool: renderTool ?? {},
      codeActions: codeActions ?? [copyCode],
      onLink,
      fontSize,
    }),
    [session, fences, components, renderTool, codeActions, onLink, fontSize],
  );

  if (snap.status === 'unavailable' && view.fallback !== undefined) {
    return (
      <box style={[{ flexDirection: 'column', flexGrow: 1 }, view.style]}>
        {typeof view.fallback === 'function'
          ? view.fallback(snap)
          : view.fallback}
      </box>
    );
  }

  const header = view.header ?? true;
  return (
    <ChatContext.Provider value={context}>
      <box
        style={[
          {
            // fills what it is put in: the one-line usage needs no style
            flexDirection: 'column',
            flexGrow: 1,
            flexShrink: 1,
            minHeight: 0,
            backgroundColor: look.background,
          },
          view.style,
        ]}
        data-testname="agent-chat"
      >
        {header === true ? (
          <Header />
        ) : typeof header === 'function' ? (
          header(session)
        ) : null}
        {snap.status === 'unavailable' || snap.status === 'error' ? (
          <box
            style={{
              padding: 10,
              borderBottomWidth: 1,
              borderBottomColor: look.border,
            }}
          >
            <text
              style={{
                color: snap.status === 'error' ? look.danger : look.muted,
              }}
            >
              {snap.error ?? 'The agent could not start.'}
            </text>
          </box>
        ) : null}
        <Transcript empty={view.empty} />
        <Composer
          {...(view.placeholder !== undefined
            ? { placeholder: view.placeholder }
            : {})}
          {...(view.autoFocus !== undefined
            ? { autoFocus: view.autoFocus }
            : {})}
        />
      </box>
    </ChatContext.Provider>
  );
}
