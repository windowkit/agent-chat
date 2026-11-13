// Claude Code's built-in tools: which `coreTools` category each is in, its
// kind, and the one line its card shows.

import type { CoreToolKey, ToolKind, ToolOutput } from '../../core/types.js';

/** The built-ins each category names. A name Claude Code no longer has is
 *  harmless in `disallowedTools`. */
export const CATEGORY_TOOLS: Readonly<Record<CoreToolKey, readonly string[]>> =
  {
    shell: ['Bash', 'BashOutput', 'KillShell'],
    read: ['Read', 'Glob', 'Grep', 'LS'],
    edit: ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'],
    web: ['WebFetch', 'WebSearch'],
    agents: ['Agent', 'Task'],
    todos: ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'],
  };

/** The prefix in-process tools are named under: `mcp__app__openTicket`. */
export const APP_SERVER = 'app';
export const APP_PREFIX = `mcp__${APP_SERVER}__`;

const KINDS: Readonly<Record<string, ToolKind>> = {
  Bash: 'execute',
  BashOutput: 'execute',
  KillShell: 'execute',
  Read: 'read',
  LS: 'read',
  NotebookRead: 'read',
  Glob: 'search',
  Grep: 'search',
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  WebFetch: 'fetch',
  WebSearch: 'fetch',
  Agent: 'think',
  Task: 'think',
  ExitPlanMode: 'think',
};

/** The tools this driver draws as something other than a tool card: the
 *  plan (`TodoWrite`, and the task tools Claude Code plans with now) and the
 *  question card. */
export const HIDDEN_TOOLS: ReadonlySet<string> = new Set([
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'AskUserQuestion',
]);

export function labelOf(name: string): string {
  return name.startsWith(APP_PREFIX) ? name.slice(APP_PREFIX.length) : name;
}

export function isAppTool(name: string): boolean {
  return name.startsWith(APP_PREFIX);
}

export function kindOf(name: string): ToolKind {
  return KINDS[name] ?? 'other';
}

/** The card's line: `Read src/app.ts`, `make test`, `Fetch https://…`. */
export function titleOf(name: string, input: unknown): string {
  const label = labelOf(name);
  const i = (input && typeof input === 'object' ? input : {}) as Record<
    string,
    unknown
  >;
  const s = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '');
  switch (name) {
    case 'Bash':
      return s('description') || firstLine(s('command')) || 'Bash';
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return s('file_path') ? `${name} ${s('file_path')}` : name;
    case 'NotebookEdit':
      return s('notebook_path') ? `${name} ${s('notebook_path')}` : name;
    case 'Glob':
      return s('pattern') ? `Find ${s('pattern')}` : name;
    case 'Grep':
      return s('pattern') ? `Search for ${s('pattern')}` : name;
    case 'LS':
      return s('path') ? `List ${s('path')}` : name;
    case 'WebFetch':
      return s('url') ? `Fetch ${s('url')}` : name;
    case 'WebSearch':
      return s('query') ? `Search the web for ${s('query')}` : name;
    case 'Agent':
    case 'Task':
      return s('description') || 'Agent';
    case 'ExitPlanMode':
      return 'Approve the plan';
    default:
      return label;
  }
}

/** What a finished built-in call shows, worked out from its input where the
 *  input says more than the result: an edit is its diff. */
export function outputOf(
  name: string,
  input: unknown,
  resultText: string,
  isError: boolean,
): ToolOutput[] {
  const i = (input && typeof input === 'object' ? input : {}) as Record<
    string,
    unknown
  >;
  if (!isError) {
    if (name === 'Edit' && typeof i.file_path === 'string') {
      return [
        {
          type: 'diff',
          path: i.file_path,
          oldText: String(i.old_string ?? ''),
          newText: String(i.new_string ?? ''),
        },
      ];
    }
    if (name === 'Write' && typeof i.file_path === 'string') {
      return [
        {
          type: 'diff',
          path: i.file_path,
          oldText: null,
          newText: String(i.content ?? ''),
        },
      ];
    }
  }
  if (!resultText) return [];
  if (kindOf(name) === 'execute')
    return [{ type: 'terminal', text: resultText }];
  return [{ type: 'text', text: resultText }];
}

function firstLine(text: string): string {
  const line = text.split('\n')[0] ?? '';
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}
