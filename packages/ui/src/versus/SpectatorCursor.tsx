/**
 * VERSUS SPECTATING — the watched player's LIVE HAND (owner 2026-10-14). The player's cursor arrives at about 15 Hz
 * (`spectateTap.ts`); this layer draws it ~100 ms behind real time, interpolated between samples, so it glides rather
 * than steps. While the player holds a card, the card rides under the closed fist, the replay viewer's drag look
 * (`.replay-dragghost`), and the card is lifted out of its zone the way the replay lifts it.
 *
 * Cost: one rAF loop only while samples are flowing (it stops ~1 s after the last), ONE transform write per frame on
 * ONE element, no layout reads (the stage size is cached and refreshed on resize), no React render per frame. The
 * sprite is the game's own gauntlet; pointer events never land on it.
 */
import { useEffect, useRef, useState } from 'react';
import { Card } from '../Card';
import { dragStore } from '../dragStore';
import { NO_DRAG_DECISION } from '../dragDecision';
import { ghostCardView } from '../replay/replayPlayer';
import { stageViewport } from '../stage';
import { useGame } from '../store';
import { cursorFeed, onCursorFeed } from './spectate';

const OPEN_SRC = `${import.meta.env.BASE_URL}cursors/gauntlet_open.svg`;
const FIST_SRC = `${import.meta.env.BASE_URL}cursors/hand_closed.svg`;
/** Draw this far behind the newest sample, so there is always a segment to interpolate along. */
export const CURSOR_BUFFER_MS = 100;
/** Stop the loop (and fade) this long after the newest sample. */
const STALE_MS = 1200;

/** The point at time `t` along the samples (linear between neighbours; held at either end). Pure, tested. */
export function cursorAt(pts: readonly { t: number; x: number; y: number }[], t: number): { x: number; y: number } | null {
  if (pts.length === 0) return null;
  if (t <= pts[0]!.t) return { x: pts[0]!.x, y: pts[0]!.y };
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i]!;
    if (t <= b.t) {
      const a = pts[i - 1]!;
      const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  const last = pts[pts.length - 1]!;
  return { x: last.x, y: last.y };
}

export function SpectatorCursor(): JSX.Element | null {
  const moverRef = useRef<HTMLDivElement | null>(null);
  const [dragUid, setDragUid] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const inCombat = useGame((s) => s.run.phase === 'combat');
  const flying = useGame((s) => s.replayDragGhost !== null);

  useEffect(() => {
    let { w, h } = stageViewport();
    const onResize = (): void => { ({ w, h } = stageViewport()); };
    window.addEventListener('resize', onResize);
    let raf = 0;
    const frame = (): void => {
      raf = 0;
      const el = moverRef.current;
      const now = performance.now();
      const last = cursorFeed.pts[cursorFeed.pts.length - 1];
      const p = cursorAt(cursorFeed.pts, now - CURSOR_BUFFER_MS);
      if (el && p) el.style.transform = `translate3d(${Math.round(p.x * w)}px, ${Math.round(p.y * h)}px, 0)`;
      if (last && now - last.t < STALE_MS && !cursorFeed.hidden) raf = requestAnimationFrame(frame);
      else setVisible(false);
    };
    const off = onCursorFeed(() => {
      const show = !cursorFeed.hidden && cursorFeed.pts.length > 0;
      setVisible(show);
      setDragUid(show ? cursorFeed.drag?.uid ?? null : null);
      if (show && !raf) raf = requestAnimationFrame(frame);
    });
    return () => { off(); if (raf) cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, []);

  // The card in the player's hand is lifted out of its zone while they hold it (the replay's hold, without a decision).
  useEffect(() => {
    const d = cursorFeed.drag;
    if (!dragUid || !d || flying) return undefined;
    const run = useGame.getState().run;
    const view = ghostCardView(run as never, d.cardId);
    if (!view) return undefined;
    dragStore.set({
      drag: { uid: d.uid, source: d.source as never, view, active: true, ghost: true, ox: 0, oy: 0, grabOx: 0, grabOy: 0, w: 0, h: 0, startX: 0, startY: 0, x: 0, y: 0 },
      overZone: null, decision: { ...NO_DRAG_DECISION, collapsedLift: true }, castingSpell: false, snapping: false, magSlide: false,
    });
    return () => { if (dragStore.get().drag?.uid === d.uid && dragStore.get().drag?.ghost) dragStore.endDrag(); };
  }, [dragUid, flying]);

  if (inCombat || flying) return null; // in a fight there is nothing to point at; a flight's fist IS the hand
  const d = dragUid ? cursorFeed.drag : null;
  const view = d ? ghostCardView(useGame.getState().run as never, d.cardId) : undefined;
  return (
    <div className="replay-dragghost vsspec-cursor" aria-hidden="true" style={{ opacity: visible ? 1 : 0 }}>
      <div className="ghostmover" ref={moverRef}>
        {view && <div className="ghostcardwrap"><Card card={view} suppressPop /></div>}
        <img decoding="sync" className={d ? 'ghostfist' : 'vsspec-cursor-open'} src={d ? FIST_SRC : OPEN_SRC} alt="" draggable={false} />
      </div>
    </div>
  );
}
