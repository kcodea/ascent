import { useEffect } from 'react';
import { CARD_INDEX } from '@game/content';
import { TRIBES } from '@game/core';
import { inGameScreen, useGame } from '../store';
import { useSpectate } from '../versus/spectate';
import { useLiveWatch } from '../live/liveWatch';
import { applyTribeCursor, dominantTribe, useReactiveCursorEnabled } from './reactiveCursor';

/**
 * Drives the Reactive Cursor (R-CURSOR-REACTIVE-01; see reactiveCursor.ts). Renders nothing. The selector returns the
 * picked tribe as a string, so this re-renders only when the tribe changes, not on every board edit.
 */
export function ReactiveCursor(): null {
  const on = useReactiveCursorEnabled();
  const spectating = useSpectate((s) => s.active);
  const liveWatching = useLiveWatch((s) => s.game !== null);
  const tribe = useGame((s) => {
    if (!on || s.replaying || !inGameScreen(s)) return null;
    if (s.run.phase !== 'recruit' && s.run.phase !== 'combat') return null;
    return dominantTribe(s.run.board, CARD_INDEX, TRIBES);
  });
  const picked = spectating || liveWatching ? null : tribe;
  useEffect(() => {
    applyTribeCursor(picked);
  }, [picked]);
  useEffect(() => () => applyTribeCursor(null), []);
  return null;
}
