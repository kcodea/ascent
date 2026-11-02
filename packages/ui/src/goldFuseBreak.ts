/**
 * THE GOLD FUSE BREAK (owner ask 2026-11-01, R-TIMER-FUSE-02): "add an animation for when the gold fuse breaks and the
 * timer starts". The moment the turn's fuse Gold is met, the Gold bar on the shop timer plaque fills, snaps in two at
 * its middle (a gold ring and a few sparks from the `gold-fuse-break` def at the break point, the halves kick apart and
 * fade), then the clock digits punch in. About 800 ms in all, every frame on transform / opacity (goldFuseBreak.css),
 * nothing loops, and the only layout read is ONE rect at the break, for the spark.
 *
 * WHEN IT PLAYS. Only on a crossing SEEN while the plaque is mounted: the Gold spent this turn rising from under the
 * threshold to it, at the same threshold. The baseline is taken at mount, so a turn restored with its clock already
 * running (Save & Quit, a cloud resume, Continue) never replays it, and neither does a Practice timer change that
 * relights an already-paid fuse (the threshold appears, the spend does not cross it). It is keyed on the run's Gold, not
 * the clock value, because the clock store can carry a stale parked value into a fresh mount for one render.
 *
 * Presentation only: the clock starts at the same instant whether or not this plays (Recruit's start effect).
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { canPlayDefs, playDef } from './fx/playDef';
import './goldFuseBreak.css';

/** How long the bar stays on screen while it snaps (the digits are hidden this long; the clock is already running). */
export const FUSE_BREAK_SNAP_MS = 360;
/** How long the digits' punch-in runs after the snap. Matches `gfbpunch` in goldFuseBreak.css. */
export const FUSE_BREAK_PUNCH_MS = 440;

export type FuseBreakPhase = 'idle' | 'snap' | 'punch';

/** One observation of the fuse: its threshold (0 = no fuse this turn) and the Gold spent toward it. */
export interface FuseObservation {
  readonly goal: number;
  readonly spent: number;
}

/** Whether the fuse broke between two observations: the same real threshold, the spend rising from under it to it.
 *  A threshold that appears or changes (Practice's timer choice, a fresh mount) never counts as a break. */
export function fuseBroke(prev: FuseObservation, next: FuseObservation): boolean {
  return next.goal > 0 && prev.goal === next.goal && prev.spent < next.goal && next.spent >= next.goal;
}

/** DEV only: `window.dispatchEvent(new Event(FUSE_BREAK_REPLAY_EVENT))` replays the break on the live plaque. */
export const FUSE_BREAK_REPLAY_EVENT = 'ascent:fusebreak';

/**
 * The break's phase for the shop timer plaque. `goal` is this turn's fuse threshold (0 = none), `spent` the Gold spent
 * this turn, `barRef` the fuse bar (still mounted during `snap`, which is when the spark reads its rect).
 */
export function useGoldFuseBreak(goal: number, spent: number, barRef: RefObject<HTMLElement | null>): FuseBreakPhase {
  const [phase, setPhase] = useState<FuseBreakPhase>('idle');
  // The baseline is the MOUNT's own reading, so a restore that mounts already past the threshold never plays it.
  const prevRef = useRef<FuseObservation>({ goal, spent });
  // Layout effect: the break is decided before the paint that would otherwise show the digits for one frame.
  useLayoutEffect(() => {
    const prev = prevRef.current;
    const next = { goal, spent };
    prevRef.current = next;
    if (fuseBroke(prev, next)) setPhase('snap');
  }, [goal, spent]);
  // DEV: a replay hook for checking the moment by eye (no tuner owns the shop clock).
  useEffect(() => {
    if (!import.meta.env.DEV || goal <= 0) return;
    const replay = (): void => setPhase('snap');
    window.addEventListener(FUSE_BREAK_REPLAY_EVENT, replay);
    return () => window.removeEventListener(FUSE_BREAK_REPLAY_EVENT, replay);
  }, [goal]);
  useEffect(() => {
    if (phase === 'idle') return;
    if (phase === 'snap') {
      const el = barRef.current;
      if (el && canPlayDefs()) {
        const r = el.getBoundingClientRect(); // one read, at the break (screen space; Pixi is not on the stage scale)
        const p = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        playDef('gold-fuse-break', { source: p, target: p, cursor: p });
      }
      const t = window.setTimeout(() => setPhase('punch'), FUSE_BREAK_SNAP_MS);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setPhase('idle'), FUSE_BREAK_PUNCH_MS);
    return () => window.clearTimeout(t);
  }, [phase, barRef]);
  return phase;
}
