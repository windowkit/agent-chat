// What is about to be sent besides the text: a row of tiles above it, in the
// message box. An image is its picture, cropped to a square; a file is its
// name. Each has a remove button, there while the pointer is on the tile.

import { useMemo, useState, type ReactElement } from 'react';

import type { Attachment } from '../core/types.js';
import { isImagePath } from './attach.js';
import { Glyph } from './icons.js';
import { useLook } from './look.js';

/** A tile's side. */
export const TILE = 96;

export interface TrayItem {
  /** The tray's own key, so two pastes of one image are two tiles. */
  key: string;
  attachment: Attachment;
}

export interface AttachmentTrayProps {
  items: readonly TrayItem[];
  onRemove(key: string): void;
  /** Where the tiles start: under the text, not under "+". */
  inset: number;
}

export function AttachmentTray({
  items,
  onRemove,
  inset,
}: AttachmentTrayProps): ReactElement {
  return (
    <box
      data-testname="agent-chat-tray"
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        paddingLeft: inset,
        paddingRight: inset,
        paddingTop: 10,
      }}
    >
      {items.map((item) => (
        <Tile key={item.key} item={item} onRemove={onRemove} />
      ))}
    </box>
  );
}

function Tile({
  item,
  onRemove,
}: {
  item: TrayItem;
  onRemove(key: string): void;
}): ReactElement {
  const look = useLook();
  const [hover, setHover] = useState(false);
  const a = item.attachment;
  // the bytes, or an image file sent by its path: drawn from the file
  const picture: { data: string } | { path: string } | null =
    a.kind === 'image' && a.data
      ? { data: a.data }
      : a.path && isImagePath(a.path)
        ? { path: a.path }
        : null;
  return (
    <box
      data-testname="agent-chat-attachment"
      aria-label={a.label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: TILE,
        height: TILE,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: look.border,
        backgroundColor: look.bubble,
        overflow: 'hidden',
      }}
    >
      {picture ? (
        <Thumb source={picture} alt={a.label} />
      ) : (
        <box
          style={{
            flexGrow: 1,
            padding: 10,
            gap: 8,
            justifyContent: 'center',
            alignItems: 'center',
            color: look.muted,
          }}
        >
          <Glyph name="file" size={22} />
          <text
            style={{
              color: look.text,
              fontSize: look.smallSize,
              textAlign: 'center',
              maxLines: 2,
              textOverflow: 'ellipsis',
            }}
          >
            {a.label}
          </text>
        </box>
      )}
      {/* laid out always, shown on hover: nothing moves when it appears */}
      <box
        role="button"
        aria-label={`Remove ${a.label}`}
        focusable
        onClick={() => onRemove(item.key)}
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          width: 20,
          height: 20,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: look.background,
          borderWidth: 1,
          borderColor: look.border,
          color: look.text,
          cursor: 'pointer',
          visibility: hover ? 'visible' : 'hidden',
        }}
      >
        <Glyph name="close" size={8} />
      </box>
    </box>
  );
}

function Thumb({
  source,
  alt,
}: {
  source: { data: string } | { path: string };
  alt: string;
}): ReactElement {
  const data = 'data' in source ? source.data : undefined;
  const path = 'path' in source ? source.path : undefined;
  const src = useMemo(
    () => (data !== undefined ? Buffer.from(data, 'base64') : path!),
    [data, path],
  );
  return (
    <image
      src={src}
      alt={alt}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
}
