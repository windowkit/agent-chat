// The message box: `<RichTextEditor>` as the hybrid composer
// (`@react-x11/components` 0.38). The value is exactly what was typed —
// `2 * 3` is sent as `2 * 3` — and markdown is drawn over it as it is typed:
// fences in the code face and coloured, inline code on a tint, emphasis,
// headings, quotes and lists with their markers kept and dimmed.
//
// - Enter sends; Shift+Enter breaks the line; Enter inside an open fence is
//   a new line, and on its closing line it sends.
// - `@` lists the files under the agent's working directory, and inserts one
//   as a mention, written `@path` — what Claude Code reads a file by.
// - `/` at the start of a line lists the agent's commands.
// - A paste past ten lines or 2,000 characters is an attachment, written as
//   its token (`[Pasted text #1 +312 lines]`) and sent beside the text; a
//   pasted image is one too.
// - Up on the first line brings back what was sent, newest first.
// - Escape stops a running turn.

import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { Button, type KeyboardEvent } from 'react-x11';
import { XK_ESCAPE } from 'react-x11/keysyms';
import {
  RichTextEditor,
  composerParts,
  composerSchema,
  type ComposerAtom,
  type RichTextEditorHandle,
  type Suggester,
} from '@react-x11/components/rich-text-editor';

import type { AgentSession } from '../core/session.js';
import type { Attachment } from '../core/types.js';
import { useChat } from './context.js';
import { listFiles, matchFiles } from './files.js';
import { useLook } from './look.js';
import { useSessionSnapshot } from './use-agent.js';

/** How the composer behaves: `<AgentChat composer={…}>`. */
export interface ComposerOptions {
  /** What is drawn over the text as it is typed. Default `'markdown'`:
   *  everything below plus emphasis, headings, quotes and lists. `'code'`
   *  draws fences and inline code alone. Nothing changes what is sent. */
  markup?: 'none' | 'code' | 'markdown';
  /** `@` lists the files under the working directory. Default true. */
  files?: boolean;
  /** `/` at the start of a line lists the agent's commands. Default true. */
  commands?: boolean;
  /** A long paste, and a pasted image, become attachments. Default true. */
  pasteAsAttachment?: boolean;
}

export interface ComposerProps {
  placeholder?: string;
  autoFocus?: boolean;
  options?: ComposerOptions;
}

export function Composer({
  placeholder,
  autoFocus,
  options = {},
}: ComposerProps): ReactElement {
  const { session } = useChat();
  const snap = useSessionSnapshot(session);
  const look = useLook();
  const editor = useRef<RichTextEditorHandle | null>(null);

  const busy =
    snap.status === 'running' ||
    snap.status === 'waiting' ||
    snap.status === 'paused' ||
    snap.status === 'starting';
  const disabled = snap.status === 'closed';

  // what `stop()` took back out of the queue comes back to the box
  useEffect(() => {
    if (snap.restored === undefined) return;
    const text = session.takeRestored();
    if (text) editor.current?.setValue(text);
  }, [snap.restored, session]);

  // Up brings back what the transcript says was sent, so a remount keeps it
  const recall = useMemo(() => sentTexts(snap.messages), [snap.messages]);

  const cwd = snap.info.cwd;
  const files = options.files !== false;
  const commands = options.commands !== false;
  const suggestions = useMemo(
    () => [
      ...(files && cwd ? [fileSuggester(cwd)] : []),
      ...(commands ? [commandSuggester(session)] : []),
    ],
    [files, commands, cwd, session],
  );

  const submit = () => {
    const handle = editor.current;
    if (!handle) return;
    const { text, attachments } = composerParts(handle.state.doc);
    if (!text.trim() && !attachments.length) return;
    session.send({ text, attachments: attachments.map(attachmentOf) });
    handle.setValue('');
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.keysym === XK_ESCAPE && busy) {
      ev.preventDefault();
      void session.stop();
    }
  };

  const canPause = snap.capabilities.gate === 'every-call';
  return (
    <box
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 8,
        padding: 10,
        borderTopWidth: 1,
        borderTopColor: look.border,
      }}
    >
      <RichTextEditor
        ref={editor}
        format="text"
        schema={composerSchema}
        markup={options.markup ?? 'markdown'}
        pasteAsAttachment={options.pasteAsAttachment ?? true}
        recall={recall}
        suggestions={suggestions}
        submitOnEnter
        onSubmit={submit}
        onKeyDown={onKeyDown}
        placeholder={
          placeholder ?? 'Ask the agent…  @ for a file, / for a command'
        }
        autoFocus={autoFocus ?? true}
        disabled={disabled}
        aria-label="Message"
        data-testname="agent-chat-composer"
        style={{
          flexGrow: 1,
          flexShrink: 1,
          maxHeight: 220,
          borderWidth: 1,
          borderColor: look.border,
          borderRadius: 8,
        }}
      />
      <box style={{ flexDirection: 'row', gap: 6 }}>
        {busy && canPause ? (
          <Button
            label={snap.paused ? 'Resume' : 'Pause'}
            variant="outline"
            onPress={() => (snap.paused ? session.resume() : session.pause())}
          />
        ) : null}
        {busy ? (
          <Button label="Stop" onPress={() => void session.stop()} />
        ) : (
          <Button label="Send" primary disabled={disabled} onPress={submit} />
        )}
      </box>
    </box>
  );
}

/** What was sent, oldest first: the composer's `recall`. */
export function sentTexts(
  messages: AgentSession['snapshot']['messages'],
): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.role !== 'user' || m.queued) continue;
    const text = m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
    if (text && out[out.length - 1] !== text) out.push(text);
  }
  return out;
}

function fileSuggester(cwd: string): Suggester {
  return {
    char: '@',
    items: async ({ query, state }) =>
      matchFiles(await listFiles(cwd), query).map((file) => ({
        label: file,
        insert: state.schema.nodes.mention!.create({
          kind: 'file',
          id: file,
          label: file,
        }),
      })),
  };
}

function commandSuggester(session: AgentSession): Suggester {
  return {
    char: '/',
    startOfLine: true,
    // read as asked: the harness names its commands once it is up
    items: ({ query }) =>
      session.snapshot.info.commands
        .filter((c) => c.name.toLowerCase().startsWith(query.toLowerCase()))
        .slice(0, 20)
        .map((c) => ({
          label: `/${c.name}`,
          ...(c.description ? { detail: c.description } : {}),
          insert: `/${c.name} `,
        })),
  };
}

function attachmentOf(atom: ComposerAtom): Attachment {
  if (atom.kind === 'image' && atom.data instanceof Uint8Array) {
    return {
      kind: 'image',
      label: atom.label,
      mime: 'image/png',
      data: Buffer.from(atom.data).toString('base64'),
    };
  }
  if (atom.kind === 'file' && typeof atom.data === 'string') {
    return { kind: 'file', label: atom.label, path: atom.data };
  }
  return {
    kind: 'paste',
    label: atom.label,
    data: typeof atom.data === 'string' ? atom.data : String(atom.data ?? ''),
  };
}
