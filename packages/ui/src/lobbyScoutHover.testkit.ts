/**
 * Test helper: hover a rail seat AND stay on it long enough for its scout card to open (R-RAIL-SCOUT-DELAY-01: the card
 * waits SCOUT_OPEN_DELAY_MS of hovering). Works with real or fake timers (it leaves the timer mode as it found it).
 */
import { act } from 'react';
import { vi } from 'vitest';
import { SCOUT_OPEN_DELAY_MS } from './LobbyPanel';

export const hoverHeld = (el: Element): void => {
  const fake = vi.isFakeTimers();
  if (!fake) vi.useFakeTimers();
  try {
    act(() => { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); });
    act(() => { vi.advanceTimersByTime(SCOUT_OPEN_DELAY_MS); });
  } finally {
    if (!fake) vi.useRealTimers();
  }
};
