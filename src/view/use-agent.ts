// The session as React state.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  createAgentSession,
  type AgentOptions,
  type AgentSession,
  type SessionSnapshot,
} from '../core/session.js';

/**
 * A session for this component's life: made at the first render from
 * `options`, which are read once (give the component a new `key` to start
 * over), and closed when the component unmounts. The component re-renders
 * whenever the session changes.
 */
export function useAgent(options: AgentOptions): AgentSession {
  const [session] = useState(() => createAgentSession(options));
  useSessionSnapshot(session);
  // Closed a turn after the unmount, not at it: StrictMode's development
  // double mount unmounts and mounts again at once, and the session should
  // survive that.
  const mounted = useRef(0);
  useEffect(() => {
    mounted.current++;
    return () => {
      const at = --mounted.current;
      setTimeout(() => {
        if (mounted.current === at && at === 0) void session.close();
      }, 0);
    };
  }, [session]);
  return session;
}

/** The session's current snapshot, re-rendering as it changes. */
export function useSessionSnapshot(session: AgentSession): SessionSnapshot {
  return useSyncExternalStore(session.subscribe, () => session.snapshot);
}
