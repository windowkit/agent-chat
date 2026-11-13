// Hover that has to last: a message's actions show once the pointer has
// rested on it, not as it passes over on its way somewhere else — a sweep
// across the transcript would otherwise flash a row of buttons under every
// message it crossed.

import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the pointer rests before a message shows its actions. */
export const HOVER_DELAY = 150;

export interface DelayedHover {
  /** The pointer has rested here `delay` ms, and has not left since. */
  shown: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function useDelayedHover(delay = HOVER_DELAY): DelayedHover {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  const onMouseEnter = useCallback(() => {
    clear();
    timer.current = setTimeout(() => setShown(true), delay);
  }, [delay]);
  const onMouseLeave = useCallback(() => {
    clear();
    setShown(false);
  }, []);
  return { shown, onMouseEnter, onMouseLeave };
}
