// The scrolling transcript. It follows the newest message while the reader
// is at the bottom, and stops following once they scroll up to read.

import {
  useLayoutEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { ScrollableNode, ScrollEvent } from 'react-x11';

import { useChat } from './context.js';
import { useLook } from './look.js';
import { MessageList } from './MessageList.js';
import { useSessionSnapshot } from './use-agent.js';

/** Within this many pixels of the end counts as at the end. */
const STICK_PX = 24;

export function Transcript({ empty }: { empty?: ReactNode }): ReactElement {
  const { session } = useChat();
  const snap = useSessionSnapshot(session);
  const look = useLook();
  const pane = useRef<ScrollableNode | null>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    // a layout effect: `scrollTo(Infinity)` here follows the new rows to the
    // end in the frame that shows them (react-x11's ScrollableNode)
    if (stick.current) pane.current?.scrollTo(Infinity);
  }, [snap.messages, snap.status]);

  const onScroll = (ev: ScrollEvent) => {
    stick.current =
      ev.scrollY + ev.viewportHeight >= ev.contentHeight - STICK_PX;
  };

  const activity = activityOf(snap.status, snap.messages);
  return (
    <box
      ref={pane}
      onScroll={onScroll}
      style={{ flexGrow: 1, flexShrink: 1, minHeight: 0, overflow: 'scroll' }}
      data-testname="agent-chat-transcript"
    >
      <box style={{ flexDirection: 'column', gap: 14, padding: 14 }}>
        {snap.messages.length ? (
          <MessageList messages={snap.messages} />
        ) : (
          (empty ?? null)
        )}
        {activity ? (
          <text style={{ color: look.muted, fontSize: 12 }}>{activity}</text>
        ) : null}
      </box>
    </box>
  );
}

function activityOf(
  status: string,
  messages: ReturnType<typeof useSessionSnapshot>['messages'],
): string | null {
  switch (status) {
    case 'starting':
      return 'Starting the agent…';
    case 'paused':
      return 'Paused. The agent stops at its next action until you resume.';
    case 'waiting':
      return 'Waiting for you.';
    case 'running': {
      const last = messages[messages.length - 1];
      const streaming = last?.parts.some(
        (p) => (p.type === 'text' || p.type === 'reasoning') && p.streaming,
      );
      return streaming ? null : 'Working…';
    }
    default:
      return null;
  }
}
