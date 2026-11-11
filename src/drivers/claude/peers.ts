// Messages that are not the user's, in Claude Code's own terms.
//
// Claude Code tells who wrote a user turn by its `origin`. A host that types
// for the user says `{ kind: 'human' }`: a turn with no origin is
// unattributed, and fails closed where Claude Code asks whether a human
// said it. A message from another session is `{ kind: 'peer', from }`, its
// text wrapped in the envelope Claude Code itself writes for one — so the
// model reads it as reported speech from that session, which is how Claude
// Desktop hands a session its peers' messages. And what Claude Code takes
// from another session or an MCP channel comes back out with its origin, the
// envelope still on its text.
//
// The envelope's shape is Claude Code 2.1's, read from what it accepts: the
// attributes in this order, each held to the characters it allows, and the
// body on lines of its own.

import type { MessageSource, PeerSource } from '../../core/types.js';
import type { SdkMessage } from './sdk.js';

const PEER_TAG = 'cross-session-message';
const CHANNEL_TAG = 'channel';

/** `from` keeps to these characters; anything else is percent-encoded, as
 *  Claude Code encodes the ids it makes. */
const ID_UNSAFE = /[^A-Za-z0-9:_/.\\-]/gu;
const ID_MAX = 300;
const SESSION_ID = /^[A-Za-z0-9_-]{1,80}$/;
const NAME_MAX = 64;

/** The origin a turn is sent with: the user's, or a peer's. */
export function originOf(
  from: PeerSource | undefined,
): Record<string, unknown> {
  if (!from) return { kind: 'human' };
  const name = nameOf(from.name);
  return {
    kind: 'peer',
    from: idOf(from.id),
    ...(name ? { name } : {}),
    ...(from.session && SESSION_ID.test(from.session)
      ? { fromSession: from.session }
      : {}),
  };
}

/** A peer's message, wrapped as Claude Code wraps one. */
export function peerEnvelope(from: PeerSource, body: string): string {
  const attrs = [`from="${idOf(from.id)}"`];
  if (from.session && SESSION_ID.test(from.session)) {
    attrs.push(`from-session="${from.session}"`);
  }
  const name = nameOf(from.name);
  if (name) attrs.push(`from-name="${name}"`);
  // a body cannot close the envelope it is in
  const safe = body.replace(new RegExp(`<\\/?(?=${PEER_TAG})`, 'gi'), '<\\');
  return `<${PEER_TAG} ${attrs.join(' ')}>\n${safe}\n</${PEER_TAG}>`;
}

/**
 * A user turn Claude Code took from someone other than the user — another
 * session, a channel — as the session draws it. `null` for anything else:
 * the user's own turns, tool results, a subagent's input.
 */
export function incomingOf(
  m: SdkMessage,
): { text: string; from: MessageSource } | null {
  if (m.parent_tool_use_id) return null;
  const origin = m.origin as Record<string, unknown> | undefined;
  if (!origin || (origin.kind !== 'peer' && origin.kind !== 'channel')) {
    return null;
  }
  const text = textOf(
    (m.message as { content?: unknown } | undefined)?.content,
  );
  if (text === null) return null;
  if (origin.kind === 'channel') {
    const server = typeof origin.server === 'string' ? origin.server : '';
    const body = unwrap(text, CHANNEL_TAG);
    return body.trim()
      ? { text: body, from: { kind: 'channel', server } }
      : null;
  }
  const body =
    typeof origin.body === 'string' ? origin.body : unwrap(text, PEER_TAG);
  if (!body.trim()) return null;
  const id = typeof origin.from === 'string' ? decode(origin.from) : 'unknown';
  return {
    text: body,
    from: {
      kind: 'peer',
      id,
      ...(typeof origin.name === 'string' && origin.name
        ? { name: origin.name }
        : {}),
      ...(typeof origin.fromSession === 'string'
        ? { session: origin.fromSession }
        : {}),
    },
  };
}

function idOf(id: string): string {
  const bytes = new TextEncoder();
  const encoded = id.replace(ID_UNSAFE, (c) =>
    Array.from(
      bytes.encode(c),
      (b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`,
    ).join(''),
  );
  // a cut must not leave half an escape
  return (encoded || 'app').slice(0, ID_MAX).replace(/%[0-9A-F]?$/, '');
}

function nameOf(name: string | undefined): string {
  if (!name) return '';
  const clean = name
    .replace(/["<>]/g, '')
    // control, format and separator characters: what Claude Code strips
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, '')
    .trim();
  return [...clean].slice(0, NAME_MAX).join('');
}

function decode(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/** The text of a turn's content, or `null` when it is not text alone. */
function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const texts: string[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
    } else if (block.type === 'tool_result') {
      return null;
    }
  }
  return texts.length ? texts.join('\n') : null;
}

/** What is inside `<tag …>…</tag>`, when that is the whole of the text. */
function unwrap(text: string, tag: string): string {
  const match = new RegExp(
    `^\\s*<${tag}(?:\\s[^>]*)?>\\n?([\\s\\S]*?)\\n?</${tag}>\\s*$`,
  ).exec(text);
  return match ? match[1]!.trim() : text;
}
