/**
 * VERSUS SPECTATING — the watched player's LIVE HAND (owner 2026-10-14). The player's cursor arrives at about 15 Hz
 * (`spectateTap.ts`); this layer draws it ~100 ms behind real time, interpolated between samples, so it glides rather
 * than steps. While the player holds a card, the card rides under the closed fist, the replay viewer's drag look
 * (`.replay-dragghost`), and the card is lifted out of its zone the way the replay lifts it.
 *
 * Samples arrive already landed on THIS screen (screen px: anchored to the same element, else the same spot of the 16:9
 * game box; `cursorSpace.ts`, R-SPECTATE-CURSOR-01), so the hand points at the same button at any window size or
 * aspect. While the player aims, the line runs from their start point to their pointer, its end snapped to the minion
 * their aim is on (R-SPECTATE-AIM-01); the viewer's own mouse never moves it. While they hold a card, the rows open the
 * same drop gap theirs do (R-SPECTATE-DRAGGAP-01).
 *
 * Cost: one rAF loop only while samples are flowing (it stops ~1 s after the last), ONE transform write per frame on
 * ONE element, no layout reads per frame, no React render per frame. The sprite is the game's own gauntlet; pointer
 * events never land on it.
 */
import { useEffect, useRef, useState } from 'react';
import { CARD_INDEX } from '@game/content';
import { Card } from '../Card';
import { dragStore } from '../dragStore';
import { ghostCardView } from '../replay/replayPlayer';
import { toStage } from '../stage';
import { useGame } from '../store';
import { getAimFxConfig } from '../aimFxConfig';
import { dragTrailStep, newDragTrail } from '../dragTrail';
import { pixiFx } from '../pixiFx';
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
  // While the player aims, their own screen hides the held card and the pointer (the aim line IS the pointer).
  const [aimOn, setAimOn] = useState(false);
  const inCombat = useGame((s) => s.run.phase === 'combat');
  const flying = useGame((s) => s.replayDragGhost !== null);

  useEffect(() => {
    let raf = 0;
    // The held card's wind trail, as the player's own drag drew it (dragTrail.ts). Screen px for the FX layer.
    const trail = newDragTrail();
    let aiming = false;
    const frame = (): void => {
      raf = 0;
      const el = moverRef.current;
      const now = performance.now();
      const last = cursorFeed.pts[cursorFeed.pts.length - 1];
      const p = cursorAt(cursorFeed.pts, now - CURSOR_BUFFER_MS);
      // Screen px in, stage px out (the mover lives inside the scaled stage).
      if (el && p) el.style.transform = `translate3d(${Math.round(toStage(p.x))}px, ${Math.round(toStage(p.y))}px, 0)`;
      const aim = cursorFeed.hidden ? null : cursorFeed.aim;
      const held = cursorFeed.drag && !cursorFeed.hidden && !aim ? CARD_INDEX[cursorFeed.drag.cardId] : undefined;
      if (p && held) dragTrailStep(trail, p.x, p.y, held.keywords);
      else trail.last = null;
      // The player's AIM LINE (a spell cast, the hero power, Equipment, a Battlecry), drawn by the same `setAimLine`
      // from where it starts to the watched pointer; it goes when the player's does.
      if (p && aim) {
        aiming = true;
        pixiFx.setAimLine({ x: aim.x, y: aim.y }, aim.end ?? { x: p.x, y: p.y }, aim.on, getAimFxConfig(), aim.def);
      } else if (aiming) { aiming = false; pixiFx.clearAimLine(); }
      if (last && now - last.t < STALE_MS && !cursorFeed.hidden) raf = requestAnimationFrame(frame);
      else { setVisible(false); if (aiming) { aiming = false; pixiFx.clearAimLine(); } }
    };
    const off = onCursorFeed(() => {
      const show = !cursorFeed.hidden && cursorFeed.pts.length > 0;
      setVisible(show);
      setDragUid(show ? cursorFeed.drag?.uid ?? null : null);
      setAimOn(show && !!cursorFeed.aim);
      if (show && !raf) raf = requestAnimationFrame(frame);
      // The held card's drop gap moved (a new decision object only when it did): the rows slide, as the player's do.
      const d = cursorFeed.drag;
      const cur = dragStore.get();
      if (d && cur.drag?.ghost && cur.drag.uid === d.uid) dragStore.set({ overZone: d.overZone, decision: d.decision });
    });
    return () => { off(); if (raf) cancelAnimationFrame(raf); if (aiming) pixiFx.clearAimLine(); };
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
      overZone: d.overZone, decision: d.decision, castingSpell: false, snapping: false, magSlide: false,
    });
    return () => { if (dragStore.get().drag?.uid === d.uid && dragStore.get().drag?.ghost) dragStore.endDrag(); };
  }, [dragUid, flying]);

  if (inCombat || flying) return null; // in a fight there is nothing to point at; a flight's fist IS the hand
  const d = dragUid && !aimOn ? cursorFeed.drag : null;
  const view = d ? ghostCardView(useGame.getState().run as never, d.cardId) : undefined;
  return (
    <div className="replay-dragghost vsspec-cursor" aria-hidden="true" style={{ opacity: visible && !aimOn ? 1 : 0 }}>
      <div className="ghostmover" ref={moverRef}>
        {view && <div className={`ghostcardwrap${d?.source === 'hand' ? ' fromhand' : ''}`}><div className="dragshrink"><Card card={view} suppressPop /></div></div>}
        <img decoding="sync" className={d ? 'ghostfist' : 'vsspec-cursor-open'} src={d ? FIST_SRC : OPEN_SRC} alt="" draggable={false} />
      </div>
    </div>
  );
}
