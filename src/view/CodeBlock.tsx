// A fenced code block with a header of actions: Copy by default, and
// whatever the app's `codeActions` add. Nothing here runs code; an action
// that does is the app's. It is drawn as `<Markdown>` draws a fence, with
// the header inside the block's fill.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button, useClipboard } from 'react-x11';
import { Code } from '@react-x11/components/code';
import type { FenceInfo } from '@react-x11/components/markdown';

import type { AgentMessage } from '../core/types.js';
import { useChat } from './context.js';
import { useCodeLook, useLook } from './look.js';
import type { CodeAction, CodeActionContext } from './types.js';

export interface CodeBlockProps {
  fence: FenceInfo;
  message: AgentMessage;
}

export function CodeBlock({ fence, message }: CodeBlockProps): ReactElement {
  const { codeActions, session, fontSize } = useChat();
  const look = useLook();
  const code = useCodeLook(fontSize);
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
        backgroundColor: code.fill,
        borderRadius: code.radius,
        overflow: 'hidden',
      }}
    >
      <box
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingLeft: code.padding,
          paddingRight: Math.round(code.padding / 3),
          paddingTop: Math.round(code.padding / 3),
          minHeight: 26,
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
        fontSize={code.size}
        wrap
        // the frame holds the fill: the code's own, a tint, would lay a
        // second over it
        style={{
          backgroundColor: 'transparent',
          borderRadius: 0,
          paddingTop: Math.round(code.padding / 3),
        }}
      />
    </box>
  );
}
