/**
 * VERSUS — THE CLOCK'S SOUNDS AND THE 20 s GLYPH, driven by the server deadline (owner 2026-10-16: "the versus timer
 * does not play sound effects at all and the glyph animation doesnt play either, the 20s glyph"; R-VERSUS-TIMER-FX-01).
 *
 * A lobby's shop clock is a local countdown loop in Recruit, and that loop is what plays the clock's cues: the warm-up
 * on 10..6, the FIVE..ONE ticks, the explosion at 0:00 and the announcer's clock reading. It also marks the clock as
 * running, which the charge glyph (the 20 s sigil) and its build sound read. Versus skips that loop (the server owns
 * the deadline) and only ever wrote the displayed seconds, so every cue was silent and the glyph sat held.
 *
 * Here the same cues fire from the server clock instead:
 *  - `versusClockCues` (pure) decides what one observed step plays: a cue only on a real step DOWN by one or two
 *    seconds while the clock moves. A first sight of a clock (a mount, a reconnect, a seat switch), a frozen clock (the
 *    30 s disconnect pause and the 3-2-1 back: `paused_at` stays set through both), a clock pushed back up (the pause's
 *    deadline shift) or a long jump (a tab waking up) plays nothing, so nothing doubles and nothing fires in a pause.
 *  - `driveVersusClock` feeds `turnClock.follow` (seconds + running) and plays the cues. The last observation is kept
 *    at module level, so a remounted screen does not replay the second it lands on.
 */
import { observeTurnClock } from '../announcer';
import { sfx } from '../sfx';
import { turnClock } from '../turnClock';

export type VersusClockCue = { kind: 'warm' } | { kind: 'tick'; n: number } | { kind: 'explode' };

export interface VersusClockSeen {
  /** Which clock: match + phase + round. A new key is a fresh clock (first sight plays nothing). */
  key: string;
  second: number;
}

/** The lobby's thresholds, exactly as its countdown loop plays them: 10..6 warm the tick bank, 5..1 tick, 0 explodes. */
export function cueForSecond(next: number, explode: boolean): VersusClockCue | null {
  if (next === 0) return explode ? { kind: 'explode' } : null;
  if (next >= 1 && next <= 5) return { kind: 'tick', n: next };
  if (next > 5 && next <= 10) return { kind: 'warm' };
  return null;
}

/** Longest step DOWN that still counts as the clock ticking (one missed poll); anything longer is a catch-up. */
const MAX_STEP = 2;

/**
 * What one observation of the clock plays. `prev` is the last observation (any clock), `moving` false while paused.
 * Returns the cue (if any), whether the step is a real tick (the announcer hears those), and the new observation.
 */
export function versusClockCues(
  prev: VersusClockSeen | null,
  key: string,
  second: number,
  moving: boolean,
  explode: boolean,
): { cue: VersusClockCue | null; stepped: boolean; seen: VersusClockSeen } {
  const seen = { key, second };
  if (!moving || !prev || prev.key !== key) return { cue: null, stepped: false, seen };
  const drop = prev.second - second;
  if (drop < 1 || drop > MAX_STEP) return { cue: null, stepped: false, seen };
  return { cue: cueForSecond(second, explode), stepped: true, seen };
}

let lastSeen: VersusClockSeen | null = null;

/** Test-only: forget the last observation. */
export function resetVersusClockFxForTests(): void {
  lastSeen = null;
}

export function playVersusClockCue(cue: VersusClockCue): void {
  if (cue.kind === 'tick') sfx.turnTick(cue.n);
  else if (cue.kind === 'warm') sfx.warmTurnTick();
  else sfx.turnExplode();
}

/**
 * One observation of a Versus clock: sets `turnClock` (seconds + running/held) and plays what the step plays.
 *  - `key`: the clock's identity (match id + phase + round).
 *  - `remainingMs`: the server deadline less the synced server now (or, while paused, less `paused_at`).
 *  - `moving`: false while the match is paused (the clock and its cues freeze; the glyph holds and its build fades).
 *  - `explode`: the shop's 0:00 explosion (the shop locks); Hero Select's clock has no shop to lock.
 *  - `quiet`: the player on screen ended the turn early; the clock keeps running, its cues stay silent.
 *  - `announceWave`: the round, for the announcer's clock reading (the shop only, the player only), or null.
 */
export function driveVersusClock(o: {
  key: string;
  remainingMs: number;
  moving: boolean;
  explode: boolean;
  /** The player on screen ended the turn early: the clock still runs, its cues stay silent (as after a lobby End Turn). */
  quiet?: boolean;
  announceWave: number | null;
  now?: number;
}): VersusClockCue | null {
  turnClock.follow(o.remainingMs, o.now ?? performance.now(), o.moving);
  const second = turnClock.get();
  const r = versusClockCues(lastSeen, o.key, second, o.moving, o.explode);
  lastSeen = r.seen;
  if (o.quiet) return null;
  if (r.stepped && o.announceWave != null) observeTurnClock(second, o.announceWave);
  if (r.cue) playVersusClockCue(r.cue);
  return r.cue;
}

/** How long to wait before observing again: just past the next whole-second edge (so a tick lands on its second, not
 *  up to a poll late), and never more than 250 ms. */
export function nextObserveMs(remainingMs: number): number {
  if (!(remainingMs > 0)) return 250;
  const toEdge = remainingMs % 1000;
  return Math.max(10, Math.min(250, (toEdge === 0 ? 1000 : toEdge) + 5));
}
