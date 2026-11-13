// Files the agent sent the user (`SendUserFile`): an image is drawn, read
// from where the agent left it; any other file is a row with its size and,
// where the app takes links, an Open button with its `file:` URL.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ReactElement } from 'react';
import { Button } from 'react-x11';

import type { AttachmentsData } from '../core/types.js';
import { useChat } from './context.js';
import { ImageView } from './ImageView.js';
import { useLook } from './look.js';
import { useSessionSnapshot } from './use-agent.js';

export function AttachmentCard({
  value,
}: {
  value: AttachmentsData;
}): ReactElement {
  const { session, onLink } = useChat();
  const cwd = useSessionSnapshot(session).info.cwd;
  const look = useLook();
  return (
    <box
      style={{
        flexDirection: 'column',
        gap: look.gap,
        padding: look.inset,
        borderWidth: 1,
        borderColor: look.border,
        borderRadius: look.radius,
      }}
      aria-label="Attachments"
    >
      {value.caption ? (
        <text style={{ color: look.text }}>{value.caption}</text>
      ) : null}
      {value.files.map((f, i) => {
        const name = path.basename(f.path);
        if (f.isImage) {
          return (
            <box key={i} style={{ flexDirection: 'column', gap: 2 }}>
              <ImageView
                source={cwd ? { path: f.path, cwd } : { path: f.path }}
                alt={name}
              />
              <text style={{ color: look.muted, fontSize: look.smallSize }}>
                {[name, sizeOf(f.size)].filter(Boolean).join(' · ')}
              </text>
            </box>
          );
        }
        const full = cwd ? path.resolve(cwd, f.path) : f.path;
        return (
          <box
            key={i}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: look.gap,
            }}
          >
            <text style={{ color: look.text, flexShrink: 1, maxLines: 1 }}>
              {name}
            </text>
            <text
              style={{
                color: look.muted,
                fontSize: look.smallSize,
                flexGrow: 1,
              }}
            >
              {sizeOf(f.size)}
            </text>
            {onLink && path.isAbsolute(full) ? (
              <Button
                size="small"
                variant="ghost"
                label="Open"
                onPress={() => onLink(pathToFileURL(full).href)}
              />
            ) : null}
          </box>
        );
      })}
    </box>
  );
}

/** `2 KB`, `1.4 MB`. */
export function sizeOf(bytes: number | undefined): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes / 1024;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${n < 10 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n)} ${units[u]}`;
}
