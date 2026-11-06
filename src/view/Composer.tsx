// The message box: `<RichTextEditor>` as a hybrid composer — the value is
// exactly what was typed, Enter sends, Shift+Enter breaks the line, Escape
// stops a running turn.
//
// The composer props (`markup`, `composerSchema`, `pasteAsAttachment`,
// `recall`, `composerParts`) arrive in `@react-x11/components` 0.38.0. They
// are read at run time, so on 0.37 the composer is a plain text editor and
// on 0.38 it formats fences and inline code as they are typed, recalls
// earlier prompts with Up, and turns a long paste into an attachment. When
// the floor moves to 0.38, the detection goes and the props are typed.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Button, type KeyboardEvent } from 'react-x11';
import { XK_ESCAPE } from 'react-x11/keysyms';
import * as rte from '@react-x11/components/rich-text-editor';
import type {
  RichTextEditorEvent,
  RichTextEditorHandle,
} from '@react-x11/components/rich-text-editor';

import type { Attachment } from '../core/types.js';
import { useChat } from './context.js';
import { useLook } from './look.js';
import { useSessionSnapshot } from './use-agent.js';

/** `composerParts` as 0.38 answers it, written out until the floor moves. */
interface ComposerAtom {
  type: 'mention' | 'attachment';
  kind: string;
  id: string;
  label: string;
  data: unknown;
  token: string;
  at: number;
}
type ComposerParts = (doc: unknown) => {
  text: string;
  mentions: readonly ComposerAtom[];
  attachments: readonly ComposerAtom[];
};

const extras = rte as unknown as {
  composerSchema?: unknown;
  composerParts?: ComposerParts;
};
const HYBRID = !!(extras.composerSchema && extras.composerParts);

export interface ComposerProps {
  placeholder?: string;
  autoFocus?: boolean;
}

export function Composer({
  placeholder,
  autoFocus,
}: ComposerProps): ReactElement {
  const { session } = useChat();
  const snap = useSessionSnapshot(session);
  const look = useLook();
  const editor = useRef<RichTextEditorHandle | null>(null);
  const [sent, setSent] = useState<readonly string[]>([]);

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

  const submit = () => {
    const handle = editor.current;
    if (!handle) return;
    const value = handle.getValue('text');
    if (!value.trim()) return;
    const attachments: Attachment[] = [];
    if (HYBRID) {
      const parts = extras.composerParts!(handle.state.doc);
      for (const atom of parts.attachments)
        attachments.push(attachmentOf(atom));
    }
    session.send({ text: value, attachments });
    setSent((all) => [...all, value]);
    handle.setValue('');
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.keysym === XK_ESCAPE && busy) {
      ev.preventDefault();
      void session.stop();
    }
  };

  const hybrid = HYBRID
    ? {
        markup: 'code',
        schema: extras.composerSchema,
        pasteAsAttachment: true,
        recall: sent,
      }
    : {};

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
      <rte.RichTextEditor
        ref={editor}
        format="text"
        submitOnEnter
        onSubmit={(_ev: RichTextEditorEvent) => submit()}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? 'Ask the agent…'}
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
        {...(hybrid as object)}
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
