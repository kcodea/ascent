/**
 * REPLAY VIEWER — the recorded CURSOR (2026-09-19).
 *
 * Between drags the recorded player's hand is a free pointer: hovering offers, hesitating over the sell line,
 * drifting to End Turn. The capture layer sampled it (`cursorTrace.ts` → `ReplayV2.cursorTrail`); this layer
 * moves the game's open-gauntlet cursor along that trail on the REPLAY CLOCK (`replayClockMs`), so it lands
 * on a card the instant the recorded click did.
 *
 * One `requestAnimationFrame` loop while a session is playing: per frame it reads the clock, interpolates the
 * trail (O(1) with the hint — see `cursorAt`) and writes ONE transform on ONE element. No layout reads (the
 * viewport size is cached and refreshed on `resize`), no React re-render per frame, no paint properties
 * touched. Paused: the loop stops and the sprite holds; a seek repositions it once through the session
 * subscription. Hidden during combat frames, during a ghost flight (the ghost's closed fist IS the hand),
 * when the recording has no trail, and when the viewer's Cursor toggle is off.
 *
 * Sits UNDER the drag ghost (z 535 < 540) and under the transport chrome; never intercepts pointer events.
 */
import React, { useEffect, useRef } from 'react';
import { useGame } from '../store';
import { replayCursorAt } from './replayPlayer';

// BASE_URL-relative, NOT root-absolute — itch serves the game from a CDN sub-path where '/cursors/…' 404s.
const OPEN_SRC = `${import.meta.env.BASE_URL}cursors/gauntlet_open.svg`;

export function ReplayCursorGhost(): React.ReactElement | null {
  const active = useGame((s) => !!s.replaySession && s.replaySession.cursor !== false && s.replaySession.hasCursorTrail === true);
  const playing = useGame((s) => s.replaySession?.playing === true);
  const index = useGame((s) => s.replaySession?.index ?? -1);
  const ghostFlying = useGame((s) => s.replayDragGhost !== null);
  const inCombat = useGame((s) => s.replaySession?.phase === 'combat');
  const elRef = useRef<HTMLImageElement | null>(null);
  const hintRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const el = elRef.current;
    if (!active || !el) return;
    let vw = window.innerWidth;
    let vh = window.innerHeight;
    const onResize = (): void => { vw = window.innerWidth; vh = window.innerHeight; };
    window.addEventListener('resize', onResize);
    let raf = 0;
    const place = (): boolean => {
      const p = replayCursorAt(hintRef.current);
      if (!p) { el.style.opacity = '0'; return false; }
      hintRef.current = p.index;
      el.style.opacity = '1';
      el.style.transform = `translate3d(${Math.round(p.x * vw)}px, ${Math.round(p.y * vh)}px, 0)`;
      return true;
    };
    const tick = (): void => { place(); raf = requestAnimationFrame(tick); };
    // A seek (index change) or a pause lands the sprite once; playing keeps the loop alive.
    place();
    if (playing && !ghostFlying && !inCombat) raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [active, playing, index, ghostFlying, inCombat]);

  if (!active) return null;
  return (
    <div className="replay-cursor" aria-hidden="true">
      <img decoding="sync" className="replay-cursor-sprite" ref={elRef} src={OPEN_SRC} alt="" draggable={false} />
    </div>
  );
}
