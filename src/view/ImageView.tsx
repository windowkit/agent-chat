// An image the agent read, a tool returned, or the user pasted: base64
// bytes, or a file on this machine. No taller than the look says, never
// wider than the space on offer, and in its own proportions.
//
// A format this runtime cannot decode (GIF under Node) draws nothing, as a
// missing file does; `alt` is still what a screen reader says.

import path from 'node:path';
import { useMemo, type ReactElement } from 'react';

import { useLook } from './look.js';

export interface ImageViewProps {
  /** base64 bytes, or a path, relative to `cwd` unless absolute. */
  source: { data: string } | { path: string; cwd?: string };
  /** Pixels, where known: drawn at that size, scaled down to fit. */
  width?: number;
  height?: number;
  /** `look.imageHeight` unless said. */
  maxHeight?: number;
  alt: string;
}

export function ImageView({
  source,
  width,
  height,
  maxHeight,
  alt,
}: ImageViewProps): ReactElement {
  const look = useLook();
  const limit = maxHeight ?? look.imageHeight;
  const data = 'data' in source ? source.data : undefined;
  const file =
    'path' in source
      ? source.cwd
        ? path.resolve(source.cwd, source.path)
        : source.path
      : undefined;
  const src = useMemo(
    () => (data !== undefined ? Buffer.from(data, 'base64') : file!),
    [data, file],
  );
  const size =
    width && height
      ? (() => {
          const scale = Math.min(1, limit / height);
          return { width: width * scale, height: height * scale };
        })()
      : { maxHeight: limit };
  return (
    <image
      src={src}
      alt={alt}
      style={{
        ...size,
        maxWidth: '100%',
        objectFit: 'contain',
        alignSelf: 'flex-start',
        borderRadius: look.radius,
      }}
    />
  );
}
