// What the composer's "+" offers: each entry a source of attachments.
//
// A source is a label and a `pick` that returns plain `Attachment`s — the
// core's type, so whatever an app attaches reaches the driver as a paste or
// a screenshot does. What it picked goes into the message box as chips, to
// be removed or sent with the text; nothing is sent by picking.
//
// `<AgentChat composer={{ attach: [...] }}>` is the seam: the two below by
// default, `[]` for no "+", and an app's own beside or instead of them — a
// screenshot of its canvas, a record from its database.

import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { FileDialogOptions } from 'react-x11';

import type { AgentSession, SessionSnapshot } from '../core/session.js';
import type { Attachment } from '../core/types.js';
import type { ChatIcon } from './icons.js';

/** What `pick` is handed. */
export interface AttachContext {
  session: AgentSession;
  /** The desktop's file dialog, on the chat's window. Absolute paths, or
   *  `null` when cancelled. */
  openFile(options?: FileDialogOptions): Promise<string[] | null>;
}

/** An entry in the composer's "+" menu. */
export interface AttachSource {
  id: string;
  label: string;
  icon?: ChatIcon;
  /** Offered only where it works: an image source where the agent takes
   *  images. Default: always. */
  when?: (snapshot: SessionSnapshot) => boolean;
  /** What to attach. `null` or nothing, when the user cancelled. A throw is
   *  shown in the transcript. */
  pick(
    ctx: AttachContext,
  ):
    | readonly Attachment[]
    | null
    | undefined
    | Promise<readonly Attachment[] | null | undefined>;
}

/** Files, by path: the agent reads them itself (`@path` to Claude Code).
 *  An image among them is sent as an image where the agent takes images,
 *  as `attachImages` sends one; one too large stays a path. */
export const attachFiles: AttachSource = Object.freeze({
  id: 'files',
  label: 'Files…',
  icon: 'file' as const,
  async pick({ session, openFile }: AttachContext) {
    const cwd = session.snapshot.info.cwd;
    const paths = await openFile({
      title: 'Attach files',
      acceptLabel: 'Attach',
      multiple: true,
      ...(cwd ? { defaultFolder: cwd } : {}),
    });
    if (!paths) return null;
    const images = session.snapshot.capabilities.images;
    const out: Attachment[] = [];
    for (const path of paths) {
      const file: Attachment = { kind: 'file', label: basename(path), path };
      out.push(
        images && isImagePath(path)
          ? await imageAttachment(path).catch(() => file)
          : file,
      );
    }
    return out;
  },
});

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** The largest image sent: Claude's limit for one, base64 aside. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Images, sent as their bytes: the agent sees them. Offered where the
 *  agent takes images (`capabilities.images`). */
export const attachImages: AttachSource = Object.freeze({
  id: 'images',
  label: 'Images…',
  icon: 'image' as const,
  when: (snapshot: SessionSnapshot) => snapshot.capabilities.images,
  async pick({ session, openFile }: AttachContext) {
    const cwd = session.snapshot.info.cwd;
    const paths = await openFile({
      title: 'Attach images',
      acceptLabel: 'Attach',
      multiple: true,
      filters: [{ name: 'Images', extensions: Object.keys(IMAGE_TYPES) }],
      ...(cwd ? { defaultFolder: cwd } : {}),
    });
    if (!paths) return null;
    const out: Attachment[] = [];
    for (const path of paths) out.push(await imageAttachment(path));
    return out;
  },
});

/** The default `composer.attach`. */
export const DEFAULT_ATTACH: readonly AttachSource[] = Object.freeze([
  attachFiles,
  attachImages,
]);

/** A PNG, JPEG, GIF or WebP, by its name. */
export function isImagePath(path: string): boolean {
  return extensionOf(path) in IMAGE_TYPES;
}

function extensionOf(path: string): string {
  const name = basename(path);
  return name.slice(name.lastIndexOf('.') + 1).toLowerCase();
}

/** An image file as an attachment: its bytes, base64, and its type. Throws
 *  for a file that is not one of the types a model reads, or too large. */
export async function imageAttachment(path: string): Promise<Attachment> {
  const name = basename(path);
  const mime = IMAGE_TYPES[extensionOf(path)];
  if (!mime) throw new Error(`${name} is not a PNG, JPEG, GIF or WebP image.`);
  const { size } = await stat(path);
  if (size > MAX_IMAGE_BYTES) {
    throw new Error(
      `${name} is ${(size / 1024 / 1024).toFixed(1)} MB; the most an image may be is 5 MB.`,
    );
  }
  const data = (await readFile(path)).toString('base64');
  return { kind: 'image', label: name, mime, data };
}
