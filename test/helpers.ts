// Waiting on a session without a wall clock: a condition is checked after
// each turn of the event loop, up to a count of turns, never a time.

import type { AgentSession, SessionSnapshot } from '../src/core/session.js';
import type { Part, ToolPart } from '../src/core/types.js';
import type { FakeStep } from '../src/testing/index.js';

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

/**
 * A turn the test lets go of: its steps play once `open()` is called. It
 * stands in for a turn that takes a while, with no timer for `until` to race —
 * a `wait` of a few milliseconds is over or not by the time `until` has spent
 * its turns, depending on how fast the machine gets through them.
 */
export function heldTurn(steps: readonly FakeStep[]): {
  steps: AsyncIterable<FakeStep>;
  open: () => void;
} {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return {
    open,
    steps: (async function* () {
      await opened;
      yield* steps;
    })(),
  };
}
