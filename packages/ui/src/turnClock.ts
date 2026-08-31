import { useSyncExternalStore } from 'react';

/**
 * The recruit-turn countdown, kept in a tiny external store INSTEAD of Recruit-local state.
 *
 * Why: `seconds` ticking once per second used to live in `useState` inside Recruit, so every tick
 * re-rendered the whole recruit tree — board + hand + shop (up to ~17 cards) — once per second. On a
 * heavy late-game board that's an ~8–17ms reconcile every second (doubled by StrictMode in dev): a
 * periodic frame-drop during play. Performance is the north star, so the clock is decoupled.
 *
 * Now only the components that actually display the time subscribe to `seconds` (the ShopTimer plaque + the
 * ChargeGlyph — both tiny), via `useTurnSeconds()`. Recruit subscribes only to the derived `timeUp` boolean
 * (`useTurnTimeUp()`), which changes once per turn — so the per-second tick never touches the cards.
 * The countdown loop in Recruit reads/writes this store directly (no React state, no re-render).
 */
let seconds = 0;
const listeners = new Set<() => void>();

export const turnClock = {
  get: (): number => seconds,
  set: (v: number): void => {
    if (v !== seconds) {
      seconds = v;
      listeners.forEach((l) => l());
    }
  },
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Live remaining seconds — re-renders the caller each tick. Use only in the small timer-display components. */
export function useTurnSeconds(): number {
  return useSyncExternalStore(turnClock.subscribe, turnClock.get, turnClock.get);
}

/** Whether the turn timer has expired — a boolean, so a subscriber re-renders only when it FLIPS (once per
 *  turn), not every tick. This is what the recruit tree gates on. */
export function useTurnTimeUp(): boolean {
  return useSyncExternalStore(
    turnClock.subscribe,
    () => seconds <= 0,
    () => seconds <= 0,
  );
}

/**
 * What the turn clock should be set to when the recruit screen (re)opens a turn — the decision behind
 * Recruit's clock-reset effect, extracted so it can be tested without a DOM.
 *
 * `null` means LEAVE THE CLOCK ALONE, and that is the case bug 9fceed6b turned on (player, 2026-08-31:
 * *"timer from saving and quitting is not correct, it is restarting the timer from the beginning of the
 * round"*). Quitting at 0:08 and pressing Continue gave a full 0:20, because the effect ran twice: the first
 * pass applied the resumed 8 and consumed the one-shot, and the second — seeing no resume left — opened the
 * turn at full time.
 *
 * That became reachable when the board stopped being mounted behind the title (2026-08-30): Continue used to
 * be a re-render of a live component and is now a genuine MOUNT, which is where an effect is invoked twice.
 *
 * So the rule is remembered per WAVE rather than per run: once a wave's clock has been restored, this refuses
 * to re-open that same turn — and the moment the wave advances it stops matching, so the next turn opens at
 * full time like any other.
 */
export function turnClockReset(
  args: { resume: number | null; resumedWave: number | null; wave: number; turnSeconds: number },
): { set: number; consumeResume: boolean } | null {
  const { resume, resumedWave, wave, turnSeconds } = args;
  if (resume != null) return { set: resume, consumeResume: true };
  if (resumedWave === wave) return null; // already restored this turn — a second pass must not clobber it
  return { set: turnSeconds, consumeResume: false };
}
