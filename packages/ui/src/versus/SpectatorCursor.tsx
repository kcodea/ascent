/**
 * VERSUS SPECTATING — the watched player's LIVE HAND (owner 2026-10-14). While the player holds a card, the card rides
 * under the closed fist, the replay viewer's drag look (`.replay-dragghost`), and the card is lifted out of its zone the
 * way the replay lifts it.
 *
 * SMOOTH PLAYBACK (owner 2026-10-20, R-SPECTATE-SMOOTH-01): the player's messages carry their own clock and a 60 Hz path
 * (`spectateTap.ts`); `cursorPlayback.ts` maps that clock onto ours and this layer draws the hand at the playback moment
 * (interpolated, carried a few frames on its velocity if the data runs dry), so it glides at an even pace whatever the
 * network did. Everything else the message says (the card in hand, the rows' drop gap, the aim, the hover, a drop) is
 * applied when playback reaches it (`advanceCursorFeed`), so the board moves as the drawn hand gets there.
 *
 * THE DROP: a committed drop leaves the card where it was let go, its gap still open, until the action lands
 * (`spectate.ts land` takes it and the rows settle once, the player's own drop FLIP); a refused or cancelled drop
 * springs back to its slot (the player's snap-back), then the slot shows it again.
 *
 * Samples land on THIS screen (anchored to the same element, else the same spot of the 16:9 game box; `cursorSpace.ts`,
 * R-SPECTATE-CURSOR-01). While the player aims, the line runs from their start point to their pointer, its end snapped
 * to the minion their aim is on (R-SPECTATE-AIM-01); the viewer's own mouse never moves it. While they hold a card, the
 * rows open the same drop gap theirs do (R-SPECTATE-DRAGGAP-01).
 *
 * Cost: one rAF loop only while the hand is live (it stops ~1 s after the last message), two transform writes per frame
 * (the hand and the card), no layout reads per frame, no React render per frame (React renders only when the card in
 * hand, the aim or the visibility changes). The sprite is the game's own gauntlet; pointer events never land on it.
 */
import { useEffect, useRef, useState } from 'react';
import { CARD_INDEX } from '@game/content';
import { Card } from '../Card';
import { dragStore } from '../dragStore';
import { NO_DRAG_DECISION } from '../dragDecision';
import { getDragFeel } from '../dragFeel';
import { ghostCardView } from '../replay/replayPlayer';
import { toStage } from '../stage';
import { useGame } from '../store';
import { getAimFxConfig } from '../aimFxConfig';
import { dragTrailStep, newDragTrail } from '../dragTrail';
import { pixiFx } from '../pixiFx';
import { pointAt } from './cursorPlayback';
import { advanceCursorFeed, cursorFeed, cursorPlayback, endSpring, onCursorFeed, type CursorDrag } from './spectate';

const OPEN_SRC = `${import.meta.env.BASE_URL}cursors/gauntlet_open.svg`;
const FIST_SRC = `${import.meta.env.BASE_URL}cursors/hand_closed.svg`;
/** The older wire's draw delay (kept for its tests and for an older player's arrival-stamped samples). */
export const CURSOR_BUFFER_MS = 100;
/** Stop the loop (and fade) this long after the newest message. */
const STALE_MS = 1200;
/** A jump this far (screen px) is a teleport (the hand came back from hidden), never smoothed across. */
const TELEPORT_PX = 400;

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

/** The card the overlay shows: in hand, parked after a committed drop, or springing back. */
function shownCard(): { drag: CursorDrag; mode: 'held' | 'parked' | 'spring' } | null {
  if (cursorFeed.spring) return { drag: cursorFeed.spring, mode: 'spring' };
  if (cursorFeed.landing) return { drag: cursorFeed.landing.drag, mode: 'parked' };
  if (cursorFeed.drag && !cursorFeed.hidden && !cursorFeed.aim) return { drag: cursorFeed.drag, mode: 'held' };
  return null;
}

export function SpectatorCursor(): JSX.Element | null {
  const moverRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState<{ uid: string; cardId: string; source: string; mode: 'held' | 'parked' | 'spring' } | null>(null);
  const [fist, setFist] = useState(false);
  const [visible, setVisible] = useState(false);
  // While the player aims, their own screen hides the held card and the pointer (the aim line IS the pointer).
  const [aimOn, setAimOn] = useState(false);
  const inCombat = useGame((s) => s.run.phase === 'combat');
  const flying = useGame((s) => s.replayDragGhost !== null);

  useEffect(() => {
    let raf = 0;
    // True while `frame` runs: a state it applies notifies `sync`, which must not start a second loop.
    let inFrame = false;
    // The held card's wind trail, as the player's own drag drew it (dragTrail.ts). Screen px for the FX layer.
    const trail = newDragTrail();
    let aiming = false;
    // The drawn hand (screen px), eased a touch toward the playback point so a seam between two mappings (an anchor
    // and the game box on a different aspect) never reads as a jump.
    let drawn: { x: number; y: number } | null = null;
    let lastFrame = 0;
    const frame = (): void => {
      raf = 0;
      inFrame = true;
      const now = performance.now();
      try { advanceCursorFeed(now); } finally { inFrame = false; }
      const target = pointAt(cursorFeed.pts, cursorPlayback(now));
      const dt = lastFrame ? Math.min(50, now - lastFrame) : 16;
      lastFrame = now;
      if (target) {
        if (!drawn || Math.hypot(target.x - drawn.x, target.y - drawn.y) > TELEPORT_PX) drawn = { ...target };
        else { const k = 1 - Math.exp(-dt / 10); drawn = { x: drawn.x + (target.x - drawn.x) * k, y: drawn.y + (target.y - drawn.y) * k }; }
      }
      const p = drawn;
      // Screen px in, stage px out (the movers live inside the scaled stage).
      const tf = p ? `translate3d(${Math.round(toStage(p.x))}px, ${Math.round(toStage(p.y))}px, 0)` : null;
      if (tf && moverRef.current) moverRef.current.style.transform = tf;
      // The card rides the hand while held; parked where it was let go; springing back runs its own animation.
      const card = shownCard();
      if (tf && cardRef.current && card?.mode === 'held') cardRef.current.style.transform = tf;
      const aim = cursorFeed.hidden ? null : cursorFeed.aim;
      const held = card?.mode === 'held' ? CARD_INDEX[card.drag.cardId] : undefined;
      if (p && held) dragTrailStep(trail, p.x, p.y, held.keywords);
      else trail.last = null;
      // The player's AIM LINE (a spell cast, the hero power, Equipment, a Battlecry), drawn by the same `setAimLine`
      // from where it starts to the watched pointer; it goes when the player's does.
      if (p && aim) {
        aiming = true;
        pixiFx.setAimLine({ x: aim.x, y: aim.y }, aim.end ?? { x: p.x, y: p.y }, aim.on, getAimFxConfig(), aim.def);
      } else if (aiming) { aiming = false; pixiFx.clearAimLine(); }
      const live = now - cursorFeed.lastAt < STALE_MS && !cursorFeed.hidden;
      if (live || cursorFeed.pending.length || cursorFeed.landing) raf = requestAnimationFrame(frame);
      else { setVisible(false); drawn = null; lastFrame = 0; if (aiming) { aiming = false; pixiFx.clearAimLine(); } }
    };
    const sync = (): void => {
      const show = !cursorFeed.hidden && cursorFeed.pts.length > 0;
      setVisible(show);
      const card = shownCard();
      setShown((cur) => (card ? (cur && cur.uid === card.drag.uid && cur.mode === card.mode ? cur : { uid: card.drag.uid, cardId: card.drag.cardId, source: card.drag.source, mode: card.mode }) : null));
      setFist(show && !!cursorFeed.drag);
      // A card just picked up starts on the hand (the frame loop moves it from the next frame on).
      if (card?.mode === 'held' && cardRef.current && moverRef.current?.style.transform) cardRef.current.style.transform = moverRef.current.style.transform;
      setAimOn(show && !!cursorFeed.aim);
      if (!raf && !inFrame && (show || cursorFeed.pending.length || cursorFeed.landing)) raf = requestAnimationFrame(frame);
      // The held card's drop gap moved (a new decision object only when it did): the rows slide, as the player's do.
      const d = cursorFeed.drag;
      const cur = dragStore.get();
      if (d && cur.drag?.ghost && cur.drag.uid === d.uid && (cur.decision !== d.decision || cur.overZone !== d.overZone)) dragStore.set({ overZone: d.overZone, decision: d.decision });
    };
    const off = onCursorFeed(sync);
    sync();
    return () => { off(); if (raf) cancelAnimationFrame(raf); if (aiming) pixiFx.clearAimLine(); };
  }, []);

  // The card in the player's hand is lifted out of its zone while they hold it (the replay's hold, without a decision)
  // and stays lifted while it is parked or springing back; the hold ends when the overlay lets the card go (or when the
  // action lands: `spectate.ts land` releases it in the same render as the new board).
  const holdUid = shown && !flying ? shown.uid : null;
  useEffect(() => {
    const d = cursorFeed.drag?.uid === holdUid ? cursorFeed.drag : cursorFeed.landing?.drag.uid === holdUid ? cursorFeed.landing.drag : cursorFeed.spring?.uid === holdUid ? cursorFeed.spring : null;
    if (!holdUid || !d) return undefined;
    const run = useGame.getState().run;
    const view = ghostCardView(run as never, d.cardId);
    if (!view) return undefined;
    dragStore.set({
      drag: { uid: d.uid, source: d.source as never, view, active: true, ghost: true, ox: 0, oy: 0, grabOx: 0, grabOy: 0, w: 0, h: 0, startX: 0, startY: 0, x: 0, y: 0 },
      overZone: d.overZone, decision: d.decision, castingSpell: false, snapping: false, magSlide: false,
    });
    return () => { if (dragStore.get().drag?.uid === d.uid && dragStore.get().drag?.ghost) dragStore.endDrag(); };
  }, [holdUid, flying]);

  // THE SPRING-BACK: the card flies from where it was let go to its own slot (the player's snap-back, `snapMs`), the
  // rows reopen the slot under it, then the slot shows the card again. One rect read when it starts.
  const springUid = shown?.mode === 'spring' ? shown.uid : null;
  useEffect(() => {
    if (!springUid) return undefined;
    const el = cardRef.current;
    const wrap = el?.querySelector<HTMLElement>('.ghostcardwrap');
    const slot = document.querySelector<HTMLElement>(`[data-zone] .card[data-uid="${springUid}"]`);
    // The slot is reserved again (no collapsed gap) while the card flies home.
    if (dragStore.get().drag?.uid === springUid) dragStore.set({ overZone: null, decision: { ...NO_DRAG_DECISION }, snapping: true });
    const ms = getDragFeel().snapMs;
    let done = false;
    const finish = (): void => { if (!done) { done = true; endSpring(); } };
    if (!el || !wrap || !slot || typeof el.animate !== 'function') { const t = window.setTimeout(finish, 0); return () => window.clearTimeout(t); }
    const r = slot.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    // The wrap is centred on the mover (translate -50% / -58%): aim the mover so the card's centre meets the slot's.
    const from = el.style.transform || 'translate3d(0px, 0px, 0)';
    const tx = toStage(r.left + r.width / 2 - (w.left + w.width / 2));
    const ty = toStage(r.top + r.height / 2 - (w.top + w.height / 2));
    const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(from);
    const x0 = m ? Number(m[1]) : 0;
    const y0 = m ? Number(m[2]) : 0;
    const to = `translate3d(${x0 + tx}px, ${y0 + ty}px, 0)`;
    const anim = el.animate([{ transform: from }, { transform: to }], { duration: ms, easing: 'cubic-bezier(0.2, 0.85, 0.35, 1)', fill: 'forwards' });
    anim.onfinish = finish;
    const t = window.setTimeout(finish, ms + 120);
    return () => { window.clearTimeout(t); anim.cancel(); };
  }, [springUid]);

  if (inCombat || flying) return null; // in a fight there is nothing to point at; a flight's fist IS the hand
  const card = shown && !(aimOn && shown.mode === 'held') ? shown : null;
  const view = card ? ghostCardView(useGame.getState().run as never, card.cardId) : undefined;
  return (
    <div className="replay-dragghost vsspec-cursor" aria-hidden="true" style={{ opacity: visible || card ? 1 : 0 }}>
      <div className="ghostmover vsspec-cardmover" ref={cardRef}>
        {view && <div className={`ghostcardwrap${card?.source === 'hand' ? ' fromhand' : ''}`}><div className="dragshrink"><Card card={view} suppressPop /></div></div>}
      </div>
      <div className="ghostmover" ref={moverRef} style={{ opacity: visible && !aimOn ? 1 : 0 }}>
        <img decoding="sync" className={fist ? 'ghostfist' : 'vsspec-cursor-open'} src={fist ? FIST_SRC : OPEN_SRC} alt="" draggable={false} />
      </div>
    </div>
  );
}
