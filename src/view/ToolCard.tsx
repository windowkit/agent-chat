// One tool call: a line saying what it is and how it went, the approval row
// while it waits for the user, and its output when opened. A tool with
// `card: false` is its own `render` and nothing around it, until it needs
// the user or does not go through.
//
// Approval is drawn here, on the call, not in a dialog: what is being
// approved is right above the buttons.

import {
  memo,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Button, Icon, type IconName } from 'react-x11';
import { Code } from '@react-x11/components/code';
import { Markdown } from '@react-x11/components/markdown';
import { TerminalOutput } from '@react-x11/components/terminal-output';

import { parsePartialJson } from '../core/partial-json.js';
import type { ToolRenderInfo } from '../core/tools.js';
import type { ToolOutput, ToolPart } from '../core/types.js';
import { useChat } from './context.js';
import { ImageView } from './ImageView.js';
import { clipLines, useLook, type ChatLook } from './look.js';
import { MessageList } from './MessageList.js';

const STATE_LABEL: Readonly<Record<ToolPart['state'], string>> = {
  'input-streaming': 'preparing',
  pending: 'queued',
  'awaiting-approval': 'needs approval',
  running: 'running',
  done: '',
  error: 'failed',
  denied: 'denied',
  cancelled: 'stopped',
};

export interface ToolCardProps {
  part: ToolPart;
}

/** The states a `card: false` tool is drawn as a card in anyway: each needs
 *  the user to act, or says that what they were shown did not happen. */
const CARD_STATES: ReadonlySet<ToolPart['state']> = new Set([
  'awaiting-approval',
  'error',
  'denied',
  'cancelled',
]);

export const ToolCard = memo(function ToolCard({
  part,
}: ToolCardProps): ReactElement | null {
  const { session, renderTool } = useChat();
  const look = useLook();
  const [open, setOpen] = useState(false);

  const def = session.tools.get(part.label);
  const value = part.output.find((o) => o.type === 'value');
  const render = def?.render ?? renderTool[part.label] ?? renderTool['*'];
  const streaming = part.state === 'input-streaming';
  // the arguments so far, for a renderer that draws the call as it is
  // written; parsed only for a tool that has one
  const partial = useMemo(
    () =>
      render !== undefined && streaming
        ? parsePartialJson(part.inputText)
        : undefined,
    [render, streaming, part.inputText],
  );
  const info: ToolRenderInfo = {
    part,
    output: value?.type === 'value' ? value.value : undefined,
    ...(streaming
      ? { streaming: true, input: partial }
      : { streaming: false, input: part.input }),
  };
  const custom = render ? (render(info) as ReactNode) : null;
  const waiting = part.state === 'awaiting-approval';
  const expanded = open || waiting;
  const [glyph, colour] = glyphOf(part.state, look);

  if (def?.card === false && !CARD_STATES.has(part.state)) {
    return custom ? (
      <box style={{ flexDirection: 'column' }}>{custom}</box>
    ) : null;
  }

  return (
    <box
      style={{
        flexDirection: 'column',
        borderWidth: 1,
        borderColor: waiting ? look.warning : look.border,
        borderRadius: 6,
      }}
    >
      <box
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingLeft: 8,
          paddingRight: 8,
          paddingTop: 4,
          paddingBottom: 4,
          cursor: 'pointer',
        }}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon
          name={expanded ? 'chevronDown' : 'chevronRight'}
          size={12}
          color={look.muted}
        />
        <Icon name={glyph} size={12} color={colour} />
        <text
          style={{ color: look.text, flexGrow: 1, flexShrink: 1, maxLines: 1 }}
        >
          {part.title}
        </text>
        {STATE_LABEL[part.state] ? (
          <text style={{ color: look.muted, fontSize: 11 }}>
            {STATE_LABEL[part.state]}
          </text>
        ) : null}
      </box>

      {custom ? (
        <box style={{ padding: 8, paddingTop: 0 }}>{custom}</box>
      ) : null}

      {expanded && !custom ? (
        <box
          style={{ flexDirection: 'column', gap: 6, padding: 8, paddingTop: 0 }}
        >
          {waiting || !part.output.length ? <InputPreview part={part} /> : null}
          {part.output.map((o, i) => (
            <Output key={i} output={o} look={look} />
          ))}
          {part.error ? (
            <text style={{ color: look.danger }}>
              {clipLines(part.error, 40)}
            </text>
          ) : null}
        </box>
      ) : null}

      {part.children?.length && expanded ? (
        <box
          style={{
            paddingLeft: 12,
            marginLeft: 8,
            borderLeftWidth: 2,
            borderLeftColor: look.border,
            marginBottom: 8,
          }}
        >
          <MessageList messages={part.children} />
        </box>
      ) : null}

      {waiting && part.approval ? (
        <box
          style={{
            flexDirection: 'row',
            gap: 6,
            padding: 8,
            borderTopWidth: 1,
            borderTopColor: look.border,
            alignItems: 'center',
          }}
        >
          {part.approval.options.map((option, i) => (
            <Button
              key={option.id}
              size="small"
              label={option.label}
              primary={i === 0}
              variant={
                option.kind === 'deny' ? 'ghost' : i === 0 ? 'solid' : 'outline'
              }
              onPress={() => session.respond(part.id, option.id)}
            />
          ))}
        </box>
      ) : null}
    </box>
  );
});

function glyphOf(state: ToolPart['state'], look: ChatLook): [IconName, string] {
  switch (state) {
    case 'done':
      return ['check', look.success];
    case 'error':
    case 'denied':
      return ['close', look.danger];
    case 'cancelled':
      return ['dash', look.muted];
    case 'awaiting-approval':
      return ['dot', look.warning];
    default:
      return ['dot', look.accent];
  }
}

/** What the call will do, for the user deciding whether it may. */
function InputPreview({ part }: { part: ToolPart }): ReactElement | null {
  const input = (
    part.input && typeof part.input === 'object' ? part.input : {}
  ) as Record<string, unknown>;
  if (part.label === 'ExitPlanMode' && typeof input.plan === 'string') {
    return <Markdown source={input.plan} partial={false} />;
  }
  if (part.kind === 'execute' && typeof input.command === 'string') {
    return <Code source={input.command} lang="sh" wrap />;
  }
  if (part.kind === 'edit' && typeof input.file_path === 'string') {
    if (
      typeof input.old_string === 'string' ||
      typeof input.new_string === 'string'
    ) {
      return (
        <Diff
          output={{
            type: 'diff',
            path: input.file_path,
            oldText: String(input.old_string ?? ''),
            newText: String(input.new_string ?? ''),
          }}
        />
      );
    }
    if (typeof input.content === 'string') {
      return (
        <Diff
          output={{
            type: 'diff',
            path: input.file_path,
            oldText: null,
            newText: input.content,
          }}
        />
      );
    }
  }
  if (part.inputText === '' && part.input === undefined) return null;
  return <Code source={clipLines(json(part.input), 60)} lang="json" wrap />;
}

function Output({
  output,
  look,
}: {
  output: ToolOutput;
  look: ChatLook;
}): ReactElement | null {
  switch (output.type) {
    case 'text':
      return output.progress ? (
        <text style={{ color: look.muted }}>{output.text}</text>
      ) : (
        <Code source={clipLines(output.text)} wrap />
      );
    case 'terminal':
      return <TerminalOutput data={clipLines(output.text)} mode="flow" />;
    case 'diff':
      return <Diff output={output} />;
    case 'image':
      return (
        <ImageView
          source={{ data: output.data }}
          {...(output.width && output.height
            ? { width: output.width, height: output.height }
            : {})}
          alt={`An image, ${output.mime}`}
        />
      );
    case 'value':
      return (
        <Code source={clipLines(json(output.value), 80)} lang="json" wrap />
      );
  }
}

/** A change as lines in red and green: what Claude Code's own edit shows. */
function Diff({
  output,
}: {
  output: Extract<ToolOutput, { type: 'diff' }>;
}): ReactElement {
  const look = useLook();
  const removed = output.oldText === null ? [] : output.oldText.split('\n');
  const added = output.newText.split('\n');
  const lines = [
    ...removed.map((l) => ['-', l] as const),
    ...added.map((l) => ['+', l] as const),
  ].slice(0, 300);
  return (
    <box style={{ flexDirection: 'column' }}>
      <text style={{ color: look.muted, fontSize: 11 }}>{output.path}</text>
      {lines.map(([sign, line], i) => (
        <text
          key={i}
          style={{
            fontFamily: look.mono,
            color: sign === '-' ? look.danger : look.success,
          }}
        >
          {`${sign} ${line}`}
        </text>
      ))}
    </box>
  );
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
}
