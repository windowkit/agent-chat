// Messages, and the parts inside them. Each message is memoized by
// identity: the reducer replaces only the message a change touched, so a
// streamed token re-renders one message.
//
// A message's actions are icons in a row under it, shown once the pointer
// has rested on the message (`useDelayedHover`): a sweep across the
// transcript does not flash them under every message it crosses. The row
// is always laid out and hidden by its `visibility`, so showing it moves
// nothing.

import { memo, useState, type ReactElement, type ReactNode } from 'react';
import { Icon, useClipboard } from 'react-x11';

import { messageMarkdown, sourceLabel } from '../core/markdown.js';
import type { AgentMessage, FilePart, Part } from '../core/types.js';
import { DataPartView } from './DataPartView.js';
import { useDelayedHover } from './hover.js';
import { IconButton } from './icons.js';
import { ImageView } from './ImageView.js';
import { useLook, type ChatLook } from './look.js';
import { PlanChecklist } from './PlanChecklist.js';
import { QuestionCard } from './QuestionCard.js';
import { TextBlock } from './TextBlock.js';
import { ToolCard } from './ToolCard.js';

export function MessageList({
  messages,
}: {
  messages: readonly AgentMessage[];
}): ReactElement {
  return (
    <box style={{ flexDirection: 'column', gap: 14 }}>
      {messages.map((m) => (
        <MessageView key={m.id} message={m} />
      ))}
    </box>
  );
}

export const MessageView = memo(function MessageView({
  message,
}: {
  message: AgentMessage;
}): ReactElement {
  const look = useLook();
  return message.role === 'user' ? (
    <UserMessage message={message} look={look} />
  ) : (
    <AssistantMessage message={message} look={look} />
  );
});

function UserMessage({
  message,
  look,
}: {
  message: AgentMessage;
  look: ChatLook;
}): ReactElement {
  // the user's own on the right, filled; anyone else's on the left, framed
  // and named, so a message another session sent is never read as the
  // user's
  const from = message.from;
  const hover = useDelayedHover();
  return (
    <box
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
      style={{
        flexDirection: 'column',
        alignItems: from ? 'flex-start' : 'flex-end',
        gap: 4,
      }}
    >
      <box
        style={{
          flexDirection: 'column',
          gap: 4,
          maxWidth: '85%',
          paddingLeft: 12,
          paddingRight: 12,
          paddingTop: 8,
          paddingBottom: 8,
          borderRadius: 10,
          ...(from
            ? { borderWidth: 1, borderColor: look.border }
            : { backgroundColor: look.bubble }),
          opacity: message.queued ? 0.6 : 1,
        }}
      >
        {from ? (
          <text style={{ color: look.muted, fontSize: 11, fontWeight: 'bold' }}>
            {`${sourceLabel(from)} · ${from.kind === 'peer' ? 'another session' : 'channel'}`}
          </text>
        ) : null}
        {message.parts.map((p) =>
          // what was typed as markdown is drawn as markdown once it is sent,
          // with the same fences, components and code actions as a reply
          p.type === 'text' ? (
            <TextBlock
              key={p.id}
              text={p.text}
              streaming={false}
              message={message}
            />
          ) : p.type === 'file' && isImage(p) ? (
            // a pasted screenshot is the picture, not its token
            <ImageView
              key={p.id}
              source={{ data: p.data! }}
              maxHeight={look.thumbHeight}
              alt={p.label}
            />
          ) : p.type === 'file' && !textOf(message).includes(`[${p.label}]`) ? (
            // an attachment the composer made is already in the text as its
            // token; one sent some other way gets a line of its own
            <text key={p.id} style={{ color: look.muted, fontSize: 11 }}>
              {`[${p.label}]`}
            </text>
          ) : null,
        )}
      </box>
      <MessageActions
        shown={hover.shown}
        message={message}
        look={look}
        align={from ? 'start' : 'end'}
        // `Queued` is news, not an action: it is there without a hover
        always={
          message.queued ? (
            <text style={{ color: look.muted, fontSize: 11 }}>Queued</text>
          ) : null
        }
      />
    </box>
  );
}

function AssistantMessage({
  message,
  look,
}: {
  message: AgentMessage;
  look: ChatLook;
}): ReactElement {
  const hasText = message.parts.some((p) => p.type === 'text');
  const hover = useDelayedHover();
  return (
    <box
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
      style={{ flexDirection: 'column', gap: 8 }}
    >
      {message.parts.map((p) => (
        <PartView key={p.id} part={p} message={message} look={look} />
      ))}
      {message.done && hasText ? (
        <MessageActions
          shown={hover.shown}
          message={message}
          look={look}
          align="start"
        />
      ) : null}
    </box>
  );
}

function PartView({
  part,
  message,
  look,
}: {
  part: Part;
  message: AgentMessage;
  look: ChatLook;
}): ReactElement | null {
  switch (part.type) {
    case 'text':
      return (
        <TextBlock
          text={part.text}
          streaming={part.streaming}
          message={message}
        />
      );
    case 'reasoning':
      return (
        <Reasoning text={part.text} streaming={part.streaming} look={look} />
      );
    case 'tool':
      return <ToolCard part={part} />;
    case 'question':
      return <QuestionCard part={part} />;
    case 'plan':
      return <PlanChecklist part={part} />;
    case 'notice':
      return (
        <text
          style={{
            color:
              part.level === 'error'
                ? look.danger
                : part.level === 'warning'
                  ? look.warning
                  : look.muted,
            fontSize: 12,
          }}
        >
          {part.text}
        </text>
      );
    case 'file':
      return isImage(part) ? (
        <ImageView source={{ data: part.data! }} alt={part.label} />
      ) : (
        <text
          style={{ color: look.muted, fontSize: 11 }}
        >{`[${part.label}]`}</text>
      );
    case 'data':
      return <DataPartView part={part} />;
  }
}

function Reasoning({
  text,
  streaming,
  look,
}: {
  text: string;
  streaming: boolean;
  look: ChatLook;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  // A harness may send a thought with its text left out (Claude's
  // `display: 'omitted'`): while it streams it is still news that the agent
  // is thinking; once it is over there is nothing to open, so nothing is drawn.
  if (!text.trim()) {
    return streaming ? (
      <text style={{ color: look.muted, fontSize: 12 }}>Thinking…</text>
    ) : null;
  }
  return (
    <box style={{ flexDirection: 'column', gap: 4 }}>
      <box
        style={{
          flexDirection: 'row',
          gap: 6,
          alignItems: 'center',
          cursor: 'pointer',
        }}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon
          name={open ? 'chevronDown' : 'chevronRight'}
          size={12}
          color={look.muted}
        />
        <text style={{ color: look.muted, fontSize: 12 }}>
          {streaming ? 'Thinking…' : 'Thought'}
        </text>
      </box>
      {open ? (
        <text style={{ color: look.muted, fontSize: 12, paddingLeft: 18 }}>
          {text}
        </text>
      ) : null}
    </box>
  );
}

/** The row under a message: its actions and when it was sent. */
function MessageActions({
  shown,
  message,
  look,
  align,
  always,
}: {
  shown: boolean;
  message: AgentMessage;
  look: ChatLook;
  align: 'start' | 'end';
  always?: ReactNode;
}): ReactElement {
  return (
    <box
      style={{
        flexDirection: align === 'end' ? 'row-reverse' : 'row',
        alignItems: 'center',
        gap: 2,
      }}
    >
      {always}
      {/* `visibility`: laid out always, so showing it reflows nothing;
          hidden, it is not drawn, clicked, focused or read out */}
      <box
        data-testname="agent-chat-actions"
        style={{
          flexDirection: align === 'end' ? 'row-reverse' : 'row',
          alignItems: 'center',
          gap: 2,
          visibility: shown ? 'visible' : 'hidden',
        }}
      >
        <CopyButton message={message} />
        <text style={{ color: look.muted, fontSize: look.smallSize }}>
          {` ${timeAgo(message.createdAt)} `}
        </text>
      </box>
    </box>
  );
}

function CopyButton({ message }: { message: AgentMessage }): ReactElement {
  const clipboard = useClipboard();
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      label={copied ? 'Copied' : 'Copy'}
      icon={copied ? 'check' : 'copy'}
      onPress={() => {
        void clipboard.writeText(messageMarkdown(message)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    />
  );
}

/** `just now`, `18 minutes ago`, `3 hours ago`, then the date. */
export function timeAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? 'a minute ago' : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  return new Date(at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function isImage(p: FilePart): boolean {
  return p.mime.startsWith('image/') && !!p.data;
}

function textOf(message: AgentMessage): string {
  return message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
}
