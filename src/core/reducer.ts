// The transcript, as a pure function of what happened to it.
//
// Every change makes new objects along the path it touched and shares the
// rest: a streamed token replaces one text part, its message and the array,
// and every other message is the object it was. The view memoizes a message
// by identity, so a token re-renders one message.

import type { DriverEvent } from './driver.js';
import type {
  AgentMessage,
  ApprovalOption,
  Part,
  Question,
  ToolOutput,
  ToolPart,
  ToolState,
} from './types.js';

export type TranscriptAction =
  | DriverEvent
  /** The user sent a message. */
  | { type: 'user'; message: AgentMessage }
  /** A queued message is being sent now. */
  | { type: 'unqueue'; id: string }
  /** A tool call waits for the user. */
  | {
      type: 'approval';
      id: string;
      options: readonly ApprovalOption[];
      reason?: string;
    }
  /** The user, or the policy, answered it. */
  | { type: 'approved'; id: string; allowed: boolean }
  | { type: 'question'; id: string; questions: readonly Question[] }
  | {
      type: 'answered';
      id: string;
      answers: Readonly<Record<string, string>> | null;
    }
  /** The turn was stopped: what was open is cancelled. */
  | { type: 'stopped' };

type Messages = readonly AgentMessage[];

const OPEN_TOOL: ReadonlySet<ToolState> = new Set([
  'input-streaming',
  'pending',
  'awaiting-approval',
  'running',
]);

export function reduce(
  messages: Messages,
  action: TranscriptAction,
  now: number = Date.now(),
): Messages {
  switch (action.type) {
    case 'user':
      return [...messages, action.message];
    case 'unqueue':
      return mapMessage(messages, action.id, (m) => ({
        ...m,
        queued: false,
      }));
    case 'text':
      return action.parent
        ? inChildren(messages, action.parent, now, (kids) =>
            text(kids, action, now),
          )
        : text(messages, action, now);
    case 'tool-start':
      return action.parent
        ? inChildren(messages, action.parent, now, (kids) =>
            toolStart(kids, action, now),
          )
        : toolStart(messages, action, now);
    case 'tool-input':
      return mapPart(messages, action.id, (p) => {
        if (p.type !== 'tool') return p;
        const inputText = p.inputText + action.delta;
        return { ...p, inputText, input: parseJson(inputText) ?? p.input };
      });
    case 'tool-update':
      return mapPart(messages, action.id, (p) => {
        if (p.type !== 'tool') return p;
        const next: ToolPart = { ...p };
        if (action.input !== undefined) {
          next.input = action.input;
          next.inputText = JSON.stringify(action.input);
          if (next.state === 'input-streaming') next.state = 'pending';
        }
        if (action.title !== undefined) next.title = action.title;
        if (action.kind !== undefined) next.kind = action.kind;
        if (action.state !== undefined) next.state = action.state;
        if (action.output) next.output = action.output;
        if (action.append) next.output = [...next.output, action.append];
        if (action.progress !== undefined) {
          next.output = [
            ...next.output.filter((o) => !isProgress(o)),
            { type: 'text', text: action.progress, progress: true },
          ];
        }
        return next;
      });
    case 'tool-end':
      return mapPart(messages, action.id, (p) => {
        if (p.type !== 'tool') return p;
        const kept = p.output.filter((o) => !isProgress(o));
        const next: ToolPart = {
          ...p,
          state: action.state,
          output: action.output ? [...kept, ...action.output] : kept,
        };
        delete next.approval;
        if (action.error !== undefined) next.error = action.error;
        if (next.state === 'done' && next.inputText === '') {
          next.inputText = JSON.stringify(next.input ?? {});
        }
        return next;
      });
    case 'message':
      return incoming(messages, action, now);
    case 'plan':
      return action.parent
        ? inChildren(messages, action.parent, now, (kids) =>
            plan(kids, action.entries, now),
          )
        : plan(messages, action.entries, now);
    case 'data':
      return action.parent
        ? inChildren(messages, action.parent, now, (kids) =>
            data(kids, action, now),
          )
        : data(messages, action, now);
    case 'notice':
      return appendPart(messages, now, (m) => ({
        type: 'notice',
        id: `${m.id}:n${m.parts.length}`,
        level: action.level,
        text: action.text,
      }));
    case 'approval':
      return mapPart(messages, action.id, (p) =>
        p.type === 'tool'
          ? {
              ...p,
              state: 'awaiting-approval',
              approval: { options: action.options, reason: action.reason },
            }
          : p,
      );
    case 'approved':
      return mapPart(messages, action.id, (p) => {
        if (p.type !== 'tool') return p;
        const next: ToolPart = {
          ...p,
          state: action.allowed
            ? p.state === 'awaiting-approval'
              ? 'running'
              : p.state
            : 'denied',
        };
        delete next.approval;
        return next;
      });
    case 'question':
      return appendPart(messages, now, () => ({
        type: 'question',
        id: action.id,
        questions: action.questions,
        state: 'open',
      }));
    case 'answered':
      return mapPart(messages, action.id, (p) =>
        p.type === 'question'
          ? action.answers
            ? { ...p, state: 'answered', answers: action.answers }
            : { ...p, state: 'cancelled' }
          : p,
      );
    case 'stopped':
      return closeTurn(messages, true);
    case 'turn-end':
      return closeTurn(messages, action.reason === 'stopped');
    case 'info':
    case 'usage':
    case 'suggestion':
      return messages;
  }
}

// --- the assistant message a turn writes to --------------------------------

/**
 * The index of the message the current turn writes to, making one if the
 * turn has none yet. A queued user message sits after the running turn's
 * message, so it is passed over.
 */
function current(messages: Messages, now: number): [Messages, number] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === 'user' && m.queued) continue;
    if (m.role === 'assistant' && !m.done) return [messages, i];
    break;
  }
  const fresh: AgentMessage = {
    id: `a${messages.length}:${now.toString(36)}`,
    role: 'assistant',
    parts: [],
    createdAt: now,
  };
  const at = beforeQueued(messages);
  return [[...messages.slice(0, at), fresh, ...messages.slice(at)], at];
}

/** Where something the harness is acting on now goes: before any queued
 *  user messages, which wait for the turn to end. */
function beforeQueued(messages: Messages): number {
  let at = messages.length;
  while (
    at > 0 &&
    messages[at - 1]!.role === 'user' &&
    messages[at - 1]!.queued
  ) {
    at--;
  }
  return at;
}

/** A message from someone other than the user, which the harness took. A
 *  driver that reports one twice is reporting the same message. */
function incoming(
  messages: Messages,
  ev: Extract<DriverEvent, { type: 'message' }>,
  now: number,
): Messages {
  if (messages.some((m) => m.id === ev.id)) return messages;
  const message: AgentMessage = {
    id: ev.id,
    role: 'user',
    parts: [
      { type: 'text', id: `${ev.id}:t`, text: ev.text, streaming: false },
    ],
    createdAt: now,
    from: ev.from,
  };
  const at = beforeQueued(messages);
  return [...messages.slice(0, at), message, ...messages.slice(at)];
}

function appendPart(
  messages: Messages,
  now: number,
  make: (m: AgentMessage) => Part,
): Messages {
  const [all, i] = current(messages, now);
  const m = all[i]!;
  return replaceAt(all, i, { ...m, parts: [...m.parts, make(m)] });
}

function text(
  messages: Messages,
  ev: Extract<DriverEvent, { type: 'text' }>,
  now: number,
): Messages {
  const kind = ev.reasoning ? 'reasoning' : 'text';
  const found = findLivePart(messages, ev.id);
  if (found) {
    return mapPart(messages, ev.id, (p) =>
      p.type === 'text' || p.type === 'reasoning'
        ? {
            ...p,
            text: ev.text ?? p.text + (ev.delta ?? ''),
            streaming: !ev.done,
          }
        : p,
    );
  }
  return appendPart(messages, now, () => ({
    type: kind,
    id: ev.id,
    text: ev.text ?? ev.delta ?? '',
    streaming: !ev.done,
  }));
}

function toolStart(
  messages: Messages,
  ev: Extract<DriverEvent, { type: 'tool-start' }>,
  now: number,
): Messages {
  if (findLivePart(messages, ev.id)) {
    // a driver that saw the call twice (a stream event, then the block)
    return mapPart(messages, ev.id, (p) =>
      p.type === 'tool'
        ? {
            ...p,
            ...(ev.input !== undefined
              ? { input: ev.input, inputText: JSON.stringify(ev.input) }
              : {}),
            ...(ev.title ? { title: ev.title } : {}),
            ...(ev.kind ? { kind: ev.kind } : {}),
          }
        : p,
    );
  }
  const label = ev.label ?? ev.name;
  return appendPart(messages, now, () => ({
    type: 'tool',
    id: ev.id,
    name: ev.name,
    label,
    kind: ev.kind ?? 'other',
    title: ev.title ?? label,
    input: ev.input,
    inputText: ev.input === undefined ? '' : JSON.stringify(ev.input),
    state: ev.input === undefined ? 'input-streaming' : 'pending',
    output: [],
    app: ev.app ?? false,
  }));
}

function plan(
  messages: Messages,
  entries: Extract<DriverEvent, { type: 'plan' }>['entries'],
  now: number,
): Messages {
  const [all, i] = current(messages, now);
  const m = all[i]!;
  // one plan a turn, updated in place: a checklist, not a log of checklists
  const at = m.parts.findIndex((p) => p.type === 'plan');
  const part: Part = {
    type: 'plan',
    id: at >= 0 ? m.parts[at]!.id : `${m.id}:plan`,
    entries,
  };
  const parts =
    at >= 0
      ? [...m.parts.slice(0, at), part, ...m.parts.slice(at + 1)]
      : [...m.parts, part];
  return replaceAt(all, i, { ...m, parts });
}

function data(
  messages: Messages,
  ev: Extract<DriverEvent, { type: 'data' }>,
  now: number,
): Messages {
  if (findLivePart(messages, ev.id)) {
    return mapPart(messages, ev.id, (p) =>
      p.type === 'data' ? { ...p, value: ev.value } : p,
    );
  }
  return appendPart(messages, now, () => ({
    type: 'data',
    id: ev.id,
    name: ev.name,
    value: ev.value,
  }));
}

/** Apply `fn` to the children of the tool call `parent` — a subagent. */
function inChildren(
  messages: Messages,
  parent: string,
  now: number,
  fn: (children: Messages) => Messages,
): Messages {
  if (!findLivePart(messages, parent)) return fn(messages);
  return mapPart(messages, parent, (p) =>
    p.type === 'tool' ? { ...p, children: fn(p.children ?? []) } : p,
  );
}

/**
 * A transcript saved from an earlier session, made ready to show again:
 * whatever was queued was never sent and is dropped, and whatever was still
 * open ends as a stopped turn does — a stream stops streaming, a tool call
 * is cancelled, a question is closed. Nothing in it is live any more.
 */
export function restore(messages: Messages): Messages {
  return closeTurn(
    messages.filter((m) => !(m.role === 'user' && m.queued)),
    true,
  );
}

function closeTurn(messages: Messages, stopped: boolean): Messages {
  let changed = false;
  const out = messages.map((m) => {
    if (m.role !== 'assistant' || m.done) return m;
    changed = true;
    return { ...m, done: true, parts: m.parts.map((p) => settle(p, stopped)) };
  });
  return changed ? out : messages;
}

function settle(p: Part, stopped: boolean): Part {
  if ((p.type === 'text' || p.type === 'reasoning') && p.streaming) {
    return { ...p, streaming: false };
  }
  if (p.type === 'tool') {
    const children = p.children?.map((m) =>
      m.done
        ? m
        : { ...m, done: true, parts: m.parts.map((c) => settle(c, stopped)) },
    );
    if (OPEN_TOOL.has(p.state)) {
      const next: ToolPart = {
        ...p,
        state: stopped ? 'cancelled' : 'done',
        output: p.output.filter((o) => !isProgress(o)),
        ...(children ? { children } : {}),
      };
      delete next.approval;
      return next;
    }
    return children ? { ...p, children } : p;
  }
  if (p.type === 'question' && p.state === 'open') {
    return { ...p, state: 'cancelled' };
  }
  return p;
}

// --- finding and replacing, children included ------------------------------

/** The part with this id, in any message. */
export function findPart(messages: Messages, id: string): Part | undefined {
  return find(messages, id, false);
}

/**
 * The part with this id in a turn still under way: what an event may touch.
 * A driver's ids are unique within a turn, not across a session — a script
 * that names its calls runs the same names every turn — so a finished turn's
 * parts are never the ones an event means. They keep the state they ended in.
 */
export function findLivePart(messages: Messages, id: string): Part | undefined {
  return find(messages, id, true);
}

function find(messages: Messages, id: string, live: boolean): Part | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (live && m.done) continue;
    for (const p of m.parts) {
      if (p.id === id) return p;
      if (p.type === 'tool' && p.children) {
        const inner = find(p.children, id, live);
        if (inner) return inner;
      }
    }
  }
  return undefined;
}

/** Replace the live part with this id (`findLivePart`'s), and the path to it. */
function mapPart(
  messages: Messages,
  id: string,
  fn: (p: Part) => Part,
): Messages {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.done) continue;
    for (let j = 0; j < m.parts.length; j++) {
      const p = m.parts[j]!;
      let next: Part | undefined;
      if (p.id === id) next = fn(p);
      else if (
        p.type === 'tool' &&
        p.children &&
        findLivePart(p.children, id)
      ) {
        next = { ...p, children: mapPart(p.children, id, fn) };
      }
      if (next !== undefined) {
        if (next === p) return messages;
        return replaceAt(messages, i, {
          ...m,
          parts: [...m.parts.slice(0, j), next, ...m.parts.slice(j + 1)],
        });
      }
    }
  }
  return messages;
}

function mapMessage(
  messages: Messages,
  id: string,
  fn: (m: AgentMessage) => AgentMessage,
): Messages {
  const i = messages.findIndex((m) => m.id === id);
  return i < 0 ? messages : replaceAt(messages, i, fn(messages[i]!));
}

function replaceAt(messages: Messages, i: number, m: AgentMessage): Messages {
  return [...messages.slice(0, i), m, ...messages.slice(i + 1)];
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A tool's progress line: a text output it replaces as it goes, and drops
 *  when the tool ends. */
export function isProgress(o: ToolOutput): boolean {
  return o.type === 'text' && o.progress === true;
}
