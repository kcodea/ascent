/**
 * THE COUNTDOWN BEAT (2026-11-10, owner: "make the beats much stronger for duos").
 *
 * Two waits in a live game end on a server deadline the player could not feel:
 *  - the END COMBAT window: everyone else is back from the fight, and this player has 5 seconds before the next shop
 *    opens anyway. It was a number inside the gem's pill, re-read on a 200 ms interval by a hook the whole Shop screen
 *    calls, with no sound.
 *  - RANKED DUOS OVERTIME: past 0:00 the round waits for both teammates, up to the 30 second idle safeguard
 *    (R-RANKED-DUOS-GATE-02). Nothing on screen said the safeguard was running. The shop clock's own face still stays
 *    at 0:00, as that rule says; the count rides the End Turn gem's pill instead.
 *
 * Both are now one countdown beat: the game's own FIVE..ONE tick on each of the last five seconds (`sfx.turnTick`, the
 * shop clock's recorded ticks), and the number pulsing once per second in the pill (transform / opacity, one-shot).
 *
 * PERF: the seconds live in this tiny external store, off React. The driver is a timeout chain that looks just past
 * each whole-second edge (the shop clock's own cadence, `nextObserveMs`), and only `CountdownTail`, a leaf inside the
 * gem's pill, subscribes. The Shop screen never re-renders for a second passing.
 */
import { useSyncExternalStore } from 'react';
import { sfx } from '../sfx';
import { nextObserveMs } from './versusClockFx';

export interface CountdownTarget {
  /** Which countdown: match + round + kind. A re-drive of the same key never re-plays a second already ticked. */
  key: string;
  /** The deadline (epoch ms, the server's clock). */
  deadlineMs: number;
}

/** The seconds a countdown shows `ms` before its deadline: whole seconds left, rounded up, never below 0. */
export const countdownSeconds = (ms: number): number => Math.max(0, Math.ceil(ms / 1000));
/** The last seconds that tick aloud (FIVE..ONE, the clips the shop clock has). */
export const COUNTDOWN_TICK_FROM = 5;

let shown: number | null = null;
const listeners = new Set<() => void>();
const setShown = (v: number | null): void => {
  if (v === shown) return;
  shown = v;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
/** The seconds on screen right now, or null while no countdown runs. */
export const countdownShown = (): number | null => shown;

/** The last second each countdown ticked aloud, so a remount (a teammate-view swap, a reconnect) never repeats it. */
let ticked: { key: string; second: number } | null = null;
/** Test-only: forget the store and the tick memory. */
export function resetCountdownBeatForTests(): void { ticked = null; shown = null; }

/**
 * Run a countdown to `target.deadlineMs`. `now` is the server clock. Returns the stop function (the caller's effect
 * cleanup): it clears the number. Nothing shows once the deadline has passed.
 */
export function driveCountdown(target: CountdownTarget, now: () => number): () => void {
  let id: ReturnType<typeof setTimeout> | null = null;
  let live = true;
  sfx.warmTurnTick();
  const step = (): void => {
    if (!live) return;
    const ms = target.deadlineMs - now();
    const s = countdownSeconds(ms);
    if (s <= 0) { setShown(null); return; }
    setShown(s);
    if (s <= COUNTDOWN_TICK_FROM && (ticked?.key !== target.key || ticked.second > s)) {
      ticked = { key: target.key, second: s };
      sfx.turnTick(s);
    }
    id = setTimeout(step, nextObserveMs(ms));
  };
  step();
  return () => {
    live = false;
    if (id !== null) clearTimeout(id);
    setShown(null);
  };
}

/**
 * The count in the End Turn gem's pill: " · 4s", the number re-keyed each second so it pulses once (versus.css
 * `.vscd-num`). Renders nothing while no countdown runs. The ONLY subscriber to the seconds. The pill is a polite
 * live region: a screen reader hears the last five seconds, not all thirty of an overtime.
 */
export function CountdownTail(): JSX.Element | null {
  const s = useSyncExternalStore(subscribe, countdownShown, countdownShown);
  if (s === null) return null;
  return (
    <span className="vscd" aria-hidden={s > COUNTDOWN_TICK_FROM ? true : undefined}>
      {' · '}
      <span key={s} className={`vscd-num${s <= COUNTDOWN_TICK_FROM ? ' hot' : ''}`}>{s}s</span>
    </span>
  );
}
