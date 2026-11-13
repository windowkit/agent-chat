// A transcript as markdown: what Copy puts on the clipboard, and what an app
// saves. Text is written as the agent wrote it; a tool call is one line,
// since its output is the harness's and usually long.

import type { AgentMessage, MessageSource, Part } from './types.js';

/** What a message's author is called: a peer's name, or its id; a
 *  channel's server. */
export function sourceLabel(from: MessageSource): string {
  return from.kind === 'peer' ? from.name || from.id : from.server;
}

export function messageMarkdown(message: AgentMessage): string {
  return message.parts.map(partMarkdown).filter(Boolean).join('\n\n');
}

export function transcriptMarkdown(messages: readonly AgentMessage[]): string {
  return messages
    .map((m) => {
      const body = messageMarkdown(m);
      if (!body) return '';
      if (m.role !== 'user') return body;
      const who = m.from ? `From ${sourceLabel(m.from)}` : 'You';
      return `**${who}:**\n\n${body}`;
    })
    .filter(Boolean)
    .join('\n\n---\n\n');
}

function partMarkdown(part: Part): string {
  switch (part.type) {
    case 'text':
      return part.text;
    case 'reasoning':
      return '';
    case 'tool':
      return `> ${part.title}${part.state === 'done' ? '' : ` (${part.state})`}`;
    case 'plan':
      return part.entries
        .map((e) => `- [${e.status === 'completed' ? 'x' : ' '}] ${e.text}`)
        .join('\n');
    case 'question':
      return part.questions
        .map((q) => {
          const a = part.answers?.[q.question];
          return a ? `> ${q.question}\n>\n> ${a}` : `> ${q.question}`;
        })
        .join('\n\n');
    case 'file':
      return `[${part.label}]`;
    case 'notice':
      return `_${part.text}_`;
    case 'data':
      return dataMarkdown(part.name, part.value);
  }
}

/** A data part this package's drivers write, as a line with its link. */
function dataMarkdown(name: string, value: unknown): string {
  const v = (value && typeof value === 'object' ? value : {}) as Record<
    string,
    unknown
  >;
  const s = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '');
  const link = (label: string, url: string) =>
    url ? `[${label}](${url})` : label;
  switch (name) {
    case 'pull-request':
      return typeof v.number === 'number'
        ? `> Pull request ${link(`#${v.number}`, s('url'))} ${s('action').replace(/-/g, ' ')}`.trimEnd()
        : '';
    case 'session':
      return s('url')
        ? `> Session started: ${link(s('title') || s('url'), s('url'))}`
        : '';
    case 'artifact':
      return s('url')
        ? `> Published ${link(s('title') || s('path') || s('url'), s('url'))}`
        : '';
    case 'attachments': {
      const files = Array.isArray(v.files) ? (v.files as unknown[]) : [];
      const paths = files
        .map((f) => (f as { path?: unknown } | null)?.path)
        .filter((p): p is string => typeof p === 'string');
      return paths.length ? `> Sent ${paths.join(', ')}` : '';
    }
    default:
      return '';
  }
}
