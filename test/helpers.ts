// Waiting on a session without a wall clock: a condition is checked after
// each turn of the event loop, up to a count of turns, never a time.

import type { AgentSession, SessionSnapshot } from '../src/core/session.js';
import type { Part, ToolPart } from '../src/core/types.js';

export async function until(
  check: () => boolean,
  message = 'condition',
  turns = 500,
): Promise<void> {
  for (let i = 0; i < turns; i++) {
    if (check()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${message}`);
}

export function parts(snap: SessionSnapshot): Part[] {
  return snap.messages.flatMap((m) => m.parts);
}

export function tool(session: AgentSession, id: string): ToolPart | undefined {
  const all = session.snapshot.messages.flatMap((m) => m.parts);
  return all.find((p): p is ToolPart => p.type === 'tool' && p.id === id);
}

export function textOf(snap: SessionSnapshot): string {
  return parts(snap)
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text: string }).text)
    .join('|');
}
