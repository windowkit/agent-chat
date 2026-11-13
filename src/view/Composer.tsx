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
//   its token (`[Pasted text #1 +312 lines]`) and sent beside the text.
// - A pasted image, and whatever "+" picks, waits in a tray of tiles above
//   the text — an image as its picture, a file as its name — until sent.
// - Up on the first line brings back what was sent, newest first.
// - Escape stops a running turn.
// - "+" offers the app's attachment sources (`attach`).
//
// The send button is a ghost glyph inside the field's border, beside "+":
// the field is one control, not a box and a button next to it.

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  useTheme,
  type KeyboardEvent,
  type LayoutEvent,
  type StyleProp,
} from 'react-x11';
import { XK_ESCAPE } from 'react-x11/keysyms';
import {
  RichTextEditor,
  composerParts,
  composerSchema,
  type ComposerAtom,
  type RichTextEditorChangeEvent,
  type RichTextEditorHandle,
  type Suggester,
} from '@react-x11/components/rich-text-editor';

import type { AgentSession } from '../core/session.js';
import type { Attachment } from '../core/types.js';
import { DEFAULT_ATTACH, type AttachSource } from './attach.js';
import { AttachMenu } from './AttachMenu.js';
import { AttachmentTray, type TrayItem } from './AttachmentTray.js';
import { useChat } from './context.js';
import { listFiles, matchFiles } from './files.js';
import { ICON_BUTTON, IconButton } from './icons.js';
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
  /**
   * What "+" offers. Default `[attachFiles, attachImages]` — images only
   * where the agent takes them. `[]` draws no "+"; an app's own source
   * (`AttachSource`) goes beside or instead of them.
   */
  attach?: readonly AttachSource[];
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
  const { session, composer } = useChat();
  const snap = useSessionSnapshot(session);
  const look = useLook();
  const theme = useTheme();
  const editor = useRef<RichTextEditorHandle | null>(null);

  // a suggested reply, put in the box to edit or send
  useEffect(() => {
    composer.attach((text) => {
      editor.current?.setValue(text);
      editor.current?.focus();
    });
    return () => composer.attach(null);
  }, [composer]);

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

  // Images and files wait in the tray above the text, as their pictures
  // and names; a long paste stays in the text as its token.
  const [tray, setTray] = useState<readonly TrayItem[]>([]);
  const trayKeys = useRef(0);
  const attach = (picked: readonly Attachment[]) => {
    setTray((t) => [
      ...t,
      ...picked.map((attachment) => ({
        key: `t${++trayKeys.current}`,
        attachment,
      })),
    ]);
    editor.current?.focus();
  };
  const unattach = (key: string) =>
    setTray((t) => t.filter((i) => i.key !== key));

  const submit = () => {
    const handle = editor.current;
    if (!handle) return;
    const { text, attachments } = composerParts(handle.state.doc);
    const all = [
      ...tray.map((i) => i.attachment),
      ...attachments.map(attachmentOf),
    ];
    if (!text.trim() && !all.length) return;
    session.send({ text, attachments: all });
    handle.setValue('');
    setTray([]);
  };

  // A pasted image arrives as an atom in the text: it is lifted out into
  // the tray, where it is drawn as itself.
  const onChange = (ev: RichTextEditorChangeEvent) => {
    if (!hasImageAtom(ev.doc)) return;
    // after the editor has finished the transaction that brought it
    queueMicrotask(() => {
      const handle = editor.current;
      if (!handle) return;
      const found: { pos: number; size: number; atom: ComposerAtom }[] = [];
      handle.state.doc.descendants((node, pos) => {
        if (node.type.name === 'attachment' && node.attrs.kind === 'image') {
          found.push({
            pos,
            size: node.nodeSize,
            atom: {
              type: 'attachment',
              kind: 'image',
              id: node.attrs.id ?? null,
              label: String(node.attrs.label ?? 'image'),
              data: node.attrs.data,
              token: '',
              at: 0,
            },
          });
        }
      });
      if (!found.length) return;
      let tr = handle.state.tr;
      for (const f of [...found].reverse())
        tr = tr.delete(f.pos, f.pos + f.size);
      handle.view.dispatch(tr);
      attach(found.map((f) => attachmentOf(f.atom)));
    });
  };
  const sources = options.attach ?? DEFAULT_ATTACH;

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.keysym === XK_ESCAPE && busy) {
      ev.preventDefault();
      void session.stop();
    }
  };

  const canPause = snap.capabilities.gate === 'every-call';
  const focusColor = String(theme.borderFocus ?? look.accent);
  // the buttons' room from the field's edge and from the text: half an em,
  // as Claude's own composer has it
  const em = Math.round(Number(theme.fontSize ?? 14) / 2);
  // The field is one line high until the text is longer, and a button sits
  // centred on the last line, as tall as the editor is with one line in it:
  // the least height it has been laid out at.
  const [line, setLine] = useState<number | null>(null);
  const onEditorLayout = (ev: LayoutEvent) =>
    setLine((l) => (l === null ? ev.height : Math.min(l, ev.height)));
  // the tiles start where the text does
  const inset = (sources.length ? em + ICON_BUTTON + em : em) + 3;
  const buttons: StyleProp = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: em,
    marginRight: em,
    ...(line ? { height: line } : {}),
  };
  return (
    <box
      style={{
        padding: 10,
        borderTopWidth: 1,
        borderTopColor: look.border,
      }}
    >
      <box
        data-testname="agent-chat-field"
        style={{
          flexDirection: 'column',
          borderWidth: 1,
          borderColor: look.border,
          borderRadius: 10,
          opacity: disabled ? 0.6 : 1,
          // the field is the control, so it is what shows the focus
          ...(disabled ? {} : { ':focus-within': { borderColor: focusColor } }),
        }}
      >
        {tray.length ? (
          <AttachmentTray items={tray} onRemove={unattach} inset={inset} />
        ) : null}
        <box style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          {sources.length ? (
            <box style={buttons}>
              <AttachMenu sources={sources} onAttach={attach} />
            </box>
          ) : null}
          <box
            style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}
            onLayout={onEditorLayout}
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
              onChange={onChange}
              onKeyDown={onKeyDown}
              placeholder={
                placeholder ?? 'Ask the agent…  @ for a file, / for a command'
              }
              autoFocus={autoFocus ?? true}
              disabled={disabled}
              aria-label="Message"
              data-testname="agent-chat-composer"
              styles={EDITOR_STYLES}
              // the field draws the border; the editor is the text inside it
              style={{
                flexGrow: 1,
                flexShrink: 1,
                maxHeight: 220,
                borderWidth: 0,
                borderColor: 'transparent',
                backgroundColor: 'transparent',
                ':focus-within': { borderColor: 'transparent' },
                // the field around it shows the focus; a ring here would be a
                // second one inside it
                outlineWidth: 0,
              }}
            />
          </box>
          <box style={buttons}>
            {busy && canPause ? (
              <IconButton
                label={snap.paused ? 'Resume' : 'Pause'}
                icon={snap.paused ? 'play' : 'pause'}
                onPress={() =>
                  snap.paused ? session.resume() : session.pause()
                }
              />
            ) : null}
            {busy ? (
              <IconButton
                label="Stop"
                icon="stop"
                onPress={() => void session.stop()}
              />
            ) : (
              // the ink "+" has: one field, one weight of control
              <IconButton
                label="Send"
                icon="send"
                disabled={disabled}
                onPress={submit}
              />
            )}
          </box>
        </box>
      </box>
    </box>
  );
}

/** The text's inset: the buttons' margin is the room beside it, so the
 *  editor's own is cut to a hair, and the text starts as close to "+" as
 *  Claude's composer has it. Its height (the vertical inset) stays. */
const EDITOR_STYLES = { content: { paddingLeft: 3, paddingRight: 3 } };

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

function hasImageAtom(doc: RichTextEditorChangeEvent['doc']): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.type.name === 'attachment' && node.attrs.kind === 'image')
      found = true;
    return !found;
  });
  return found;
}
