// Messages, and the parts inside them. Each message is memoized by
// identity: the reducer replaces only the message a change touched, so a
// streamed token re-renders one message.

import { memo, useState, type ReactElement } from 'react';
import { Button, Icon, useClipboard } from 'react-x11';

import { messageMarkdown } from '../core/markdown.js';
import type { AgentMessage, Part, PlanPart } from '../core/types.js';
import { useLook, type ChatLook } from './look.js';
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
  return (
    <box style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
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
          backgroundColor: look.bubble,
          opacity: message.queued ? 0.6 : 1,
        }}
      >
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
          ) : p.type === 'file' && !textOf(message).includes(`[${p.label}]`) ? (
            // an attachment the composer made is already in the text as its
            // token; one sent some other way gets a line of its own
            <text key={p.id} style={{ color: look.muted, fontSize: 11 }}>
              {`[${p.label}]`}
            </text>
          ) : null,
        )}
      </box>
      <box style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
        {message.queued ? (
          <text style={{ color: look.muted, fontSize: 11 }}>Queued</text>
        ) : null}
        <CopyButton message={message} />
      </box>
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
  return (
    <box style={{ flexDirection: 'column', gap: 8 }}>
      {message.parts.map((p) => (
        <PartView key={p.id} part={p} message={message} look={look} />
      ))}
      {message.done && hasText ? (
        <box style={{ flexDirection: 'row' }}>
          <CopyButton message={message} />
        </box>
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
      return <Plan part={part} look={look} />;
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
      return (
        <text
          style={{ color: look.muted, fontSize: 11 }}
        >{`[${part.label}]`}</text>
      );
    case 'data':
      return null;
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
}): ReactElement {
  const [open, setOpen] = useState(false);
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

function Plan({
  part,
  look,
}: {
  part: PlanPart;
  look: ChatLook;
}): ReactElement {
  return (
    <box style={{ flexDirection: 'column', gap: 2 }}>
      {part.entries.map((e, i) => (
        <box
          key={i}
          style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}
        >
          {e.status === 'completed' ? (
            <Icon name="check" size={12} color={look.success} />
          ) : e.status === 'in_progress' ? (
            <Icon name="dot" size={12} color={look.accent} />
          ) : (
            <Icon name="dash" size={12} color={look.muted} />
          )}
          <text
            style={{
              color: e.status === 'completed' ? look.muted : look.text,
              fontWeight: e.status === 'in_progress' ? 'bold' : 'normal',
            }}
          >
            {e.text}
          </text>
        </box>
      ))}
    </box>
  );
}

function CopyButton({ message }: { message: AgentMessage }): ReactElement {
  const clipboard = useClipboard();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="small"
      variant="ghost"
      label={copied ? 'Copied' : 'Copy'}
      onPress={() => {
        void clipboard.writeText(messageMarkdown(message)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    />
  );
}

function textOf(message: AgentMessage): string {
  return message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
}
