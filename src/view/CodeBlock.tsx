// A fenced code block with a header of actions: Copy by default, and
// whatever the app's `codeActions` add. Nothing here runs code; an action
// that does is the app's.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button, useClipboard } from 'react-x11';
import { Code } from '@react-x11/components/code';
import type { FenceInfo } from '@react-x11/components/markdown';

import type { AgentMessage } from '../core/types.js';
import { useChat } from './context.js';
import { useLook } from './look.js';
import type { CodeAction, CodeActionContext } from './types.js';

export interface CodeBlockProps {
  fence: FenceInfo;
  message: AgentMessage;
}

export function CodeBlock({ fence, message }: CodeBlockProps): ReactElement {
  const { codeActions, session } = useChat();
  const look = useLook();
  const clipboard = useClipboard();
  const [done, setDone] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // an action on code still streaming in would act on half of it
  const actions = fence.partial
    ? []
    : codeActions.filter((a) => !a.when || a.when(fence));

  const run = (action: CodeAction) => {
    const ctx: CodeActionContext = {
      session,
      message,
      copy: (text) => clipboard.writeText(text),
    };
    Promise.resolve()
      .then(() => action.run(fence, ctx))
      .then(
        () => {
          if (!action.doneLabel) return;
          setDone(action.id);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setDone(null), 1500);
        },
        (err: unknown) =>
          session.notify(
            'error',
            `${action.label} failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
      );
  };

  return (
    <box
      style={{
        flexDirection: 'column',
        borderWidth: 1,
        borderColor: look.border,
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      <box
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingLeft: 10,
          paddingRight: 4,
          minHeight: 26,
          borderBottomWidth: 1,
          borderBottomColor: look.border,
        }}
      >
        <text style={{ color: look.muted, fontSize: 11, flexGrow: 1 }}>
          {fence.lang || 'text'}
        </text>
        {actions.map((action) => (
          <Button
            key={action.id}
            size="small"
            variant="ghost"
            label={
              done === action.id
                ? (action.doneLabel ?? action.label)
                : action.label
            }
            onPress={() => run(action)}
          />
        ))}
      </box>
      <Code
        source={fence.text}
        {...(fence.lang ? { lang: fence.lang } : {})}
        wrap
        style={{ borderWidth: 0, borderRadius: 0 }}
      />
    </box>
  );
}
