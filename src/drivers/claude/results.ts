// What Claude Code's structured tool results say beyond their text.
//
// A tool's result reaches the client twice: as the `tool_result` block the
// model reads, and as the user message's `tool_use_result`, the tool's own
// output object (typed `unknown` by the SDK; the shapes here are its
// `sdk-tools.d.ts`). The text is what a card shows. The object is where the
// rest is: the task list's changes, the pull request a command opened, the
// page the agent published, the files it sent, the pixels of an image.

import type {
  ArtifactData,
  AttachmentsData,
  PlanEntry,
  PullRequestData,
  SessionLinkData,
  ToolOutput,
} from '../../core/types.js';

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? v : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** The tools whose calls are the plan, not cards. */
export const TASK_TOOLS: ReadonlySet<string> = new Set([
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
]);

type Status = PlanEntry['status'];
const statusOf = (v: unknown): Status | undefined =>
  v === 'pending' || v === 'in_progress' || v === 'completed' ? v : undefined;

/**
 * Claude Code's task list, as the fold of every `TaskCreate` and
 * `TaskUpdate` this session saw, corrected by what `TaskList` and `TaskGet`
 * report. It lives as long as the session: a task made in one turn is
 * updated in the next.
 */
export class TaskFold {
  readonly #tasks = new Map<string, { subject: string; status: Status }>();

  /** Fold one finished call in. True if the list changed. */
  apply(name: string, input: unknown, result: unknown): boolean {
    const i = obj(input) ?? {};
    const r = obj(result) ?? {};
    switch (name) {
      case 'TaskCreate': {
        const task = obj(r.task);
        const id = str(task?.id);
        const subject = str(task?.subject) ?? str(i.subject);
        if (!id || !subject) return false;
        this.#tasks.set(id, { subject, status: 'pending' });
        return true;
      }
      case 'TaskUpdate': {
        if (r.success === false) return false;
        const id = str(r.taskId) ?? str(i.taskId);
        if (!id) return false;
        if (i.status === 'deleted') return this.#tasks.delete(id);
        const known = this.#tasks.get(id);
        const subject = str(i.subject) ?? known?.subject;
        // a task from before this session, named by nothing here
        if (!subject) return false;
        const status =
          statusOf(obj(r.statusChange)?.to) ??
          statusOf(i.status) ??
          known?.status ??
          'pending';
        if (known && known.subject === subject && known.status === status) {
          return false;
        }
        this.#tasks.set(id, { subject, status });
        return true;
      }
      case 'TaskList': {
        if (!Array.isArray(r.tasks)) return false;
        const before = JSON.stringify(this.entries());
        this.#tasks.clear();
        for (const t of r.tasks as unknown[]) {
          const task = obj(t);
          const id = str(task?.id);
          const subject = str(task?.subject);
          if (id && subject) {
            this.#tasks.set(id, {
              subject,
              status: statusOf(task?.status) ?? 'pending',
            });
          }
        }
        return JSON.stringify(this.entries()) !== before;
      }
      case 'TaskGet': {
        const task = obj(r.task);
        const id = str(task?.id);
        const subject = str(task?.subject);
        if (!id || !subject) return false;
        const status = statusOf(task?.status) ?? 'pending';
        const known = this.#tasks.get(id);
        if (known && known.subject === subject && known.status === status) {
          return false;
        }
        this.#tasks.set(id, { subject, status });
        return true;
      }
    }
    return false;
  }

  entries(): PlanEntry[] {
    return [...this.#tasks.values()].map((t) => ({
      text: t.subject,
      status: t.status,
    }));
  }
}

/** A data part a finished call's result is worth, besides its card. */
export type ResultData =
  | { name: 'pull-request'; key: string; value: PullRequestData }
  | { name: 'session'; key: string; value: SessionLinkData }
  | { name: 'artifact'; key: string; value: ArtifactData }
  | { name: 'attachments'; key: string; value: AttachmentsData };

export function dataOf(
  name: string,
  input: unknown,
  result: unknown,
): ResultData[] {
  const r = obj(result);
  if (!r) return [];
  const i = obj(input) ?? {};
  switch (name) {
    case 'Bash': {
      const pr = obj(obj(r.gitOperation)?.pr);
      const number = num(pr?.number);
      if (!pr || number === undefined) return [];
      const url = str(pr.url);
      return [
        {
          name: 'pull-request',
          key: 'pr',
          value: {
            number,
            ...(url ? { url } : {}),
            action: str(pr.action) ?? 'created',
          },
        },
      ];
    }
    case 'Agent':
    case 'Task':
    case 'Workflow': {
      const url = str(r.sessionUrl);
      if (!url) return [];
      const title = str(r.description) ?? str(i.description);
      return [
        {
          name: 'session',
          key: 'session',
          value: { url, ...(title ? { title } : {}) },
        },
      ];
    }
    case 'Artifact': {
      // a publish: list, read and the rest return other shapes
      const url = str(r.url);
      const path = str(r.path);
      if (!url || !path) return [];
      const title = str(r.title);
      return [
        {
          name: 'artifact',
          key: 'artifact',
          value: { url, path, ...(title ? { title } : {}) },
        },
      ];
    }
    case 'SendUserFile': {
      if (!Array.isArray(r.attachments)) return [];
      const files = (r.attachments as unknown[]).flatMap((a) => {
        const f = obj(a);
        const path = str(f?.path);
        if (!f || !path) return [];
        const size = num(f.size);
        const mime = str(f.media_type);
        return [
          {
            path,
            ...(size !== undefined ? { size } : {}),
            ...(mime ? { mime } : {}),
            isImage: f.isImage === true || !!mime?.startsWith('image/'),
          },
        ];
      });
      if (!files.length) return [];
      const caption = str(r.caption) ?? str(i.caption);
      return [
        {
          name: 'attachments',
          key: 'files',
          value: { files, ...(caption ? { caption } : {}) },
        },
      ];
    }
  }
  return [];
}

/**
 * The images a result carries: `image` blocks in the `tool_result` (an MCP
 * tool's screenshot), or else Read's own of an image file.
 */
export function imagesOf(content: unknown, result: unknown): ToolOutput[] {
  const out: ToolOutput[] = [];
  if (Array.isArray(content)) {
    for (const c of content as unknown[]) {
      const block = obj(c);
      if (block?.type !== 'image') continue;
      const source = obj(block.source);
      const data = str(source?.data);
      if (source?.type !== 'base64' || !data) continue;
      out.push({
        type: 'image',
        mime: str(source.media_type) ?? 'image/png',
        data,
      });
    }
  }
  if (out.length) return out;
  const r = obj(result);
  const file = obj(r?.file);
  const data = str(file?.base64);
  if (r?.type !== 'image' || !file || !data) return [];
  const dims = obj(file.dimensions);
  const width = num(dims?.displayWidth) ?? num(dims?.originalWidth);
  const height = num(dims?.displayHeight) ?? num(dims?.originalHeight);
  return [
    {
      type: 'image',
      mime: str(file.type) ?? 'image/png',
      data,
      ...(width !== undefined && height !== undefined ? { width, height } : {}),
    },
  ];
}
