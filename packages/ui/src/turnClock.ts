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
