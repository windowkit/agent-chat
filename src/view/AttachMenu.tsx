// The composer's "+": a menu of the app's attachment sources, offered where
// they work. What a source picks comes back through `onAttach`; the menu
// sends nothing.

import { useRef, useState, type ReactElement } from 'react';
import { useFileDialog } from 'react-x11';

import type { Attachment } from '../core/types.js';
import type { AttachSource } from './attach.js';
import { useChat } from './context.js';
import { Glyph, IconButton } from './icons.js';
import { useLook } from './look.js';
import { useSessionSnapshot } from './use-agent.js';

export interface AttachMenuProps {
  sources: readonly AttachSource[];
  onAttach(attachments: readonly Attachment[]): void;
}

export function AttachMenu({
  sources,
  onAttach,
}: AttachMenuProps): ReactElement | null {
  const { session } = useChat();
  const snap = useSessionSnapshot(session);
  const look = useLook();
  const dialogs = useFileDialog();
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  // A press on "+" while the menu is up dismisses it through the grab, and
  // then lands on "+" as well: without this it would open again at once.
  const closedAt = useRef(0);
  const close = () => {
    closedAt.current = Date.now();
    setOpen(false);
  };

  const offered = sources.filter((s) => !s.when || s.when(snap));
  if (!offered.length || snap.status === 'closed') return null;

  const choose = (source: AttachSource) => {
    close();
    Promise.resolve()
      .then(() => source.pick({ session, openFile: dialogs.openFile }))
      .then(
        (picked) => {
          if (picked?.length) onAttach(picked);
        },
        (err: unknown) =>
          session.notify(
            'error',
            `Could not attach: ${err instanceof Error ? err.message : String(err)}`,
          ),
      );
  };

  return (
    <box ref={anchor}>
      <IconButton
        label="Attach"
        icon="plus"
        data-testname="agent-chat-attach"
        onPress={() => {
          if (Date.now() - closedAt.current < 250) return;
          // What the agent takes is known once it is up — a session starts at
          // its first message — so an image source would be missing from a
          // menu opened before then. Opening the menu starts it, and the
          // entries that need it appear as it says what it takes.
          if (!open) void session.start();
          setOpen((o) => !o);
        }}
      />
      {open ? (
        <popup
          anchor={{ to: anchor, placement: 'top', align: 'start', offset: 4 }}
          grab
          transparent
          onDismiss={close}
        >
          <box
            role="menu"
            aria-label="Attach"
            style={{
              flexDirection: 'column',
              minWidth: 160,
              padding: 4,
              borderWidth: 1,
              borderColor: look.border,
              borderRadius: 8,
              backgroundColor: look.background,
            }}
          >
            {offered.map((source) => (
              <box
                key={source.id}
                role="menuitem"
                aria-label={source.label}
                onClick={() => choose(source)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingLeft: 8,
                  paddingRight: 12,
                  paddingTop: 6,
                  paddingBottom: 6,
                  borderRadius: 5,
                  cursor: 'pointer',
                  color: look.text,
                  ':hover': { backgroundColor: look.bubble },
                }}
              >
                {source.icon ? (
                  <Glyph name={source.icon} size={14} />
                ) : (
                  <box style={{ width: 14 }} />
                )}
                <text>{source.label}</text>
              </box>
            ))}
          </box>
        </popup>
      ) : null}
    </box>
  );
}
