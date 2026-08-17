/**
 * TUTORIAL — the action bus.
 *
 * The store's `dispatch` is the single chokepoint for every player decision (buy, play, sell, roll, freeze,
 * upgrade, hero power) and the combat-flow transitions (faceOmen → resolveCombat). The tutorial controller needs
 * a clean stream of "the player just did X" to advance its steps, and diffing run state for that is fragile.
 *
 * So `dispatch` calls `notifyTutorialActions(action, prev, next)` after each commit. When no observer is
 * subscribed — i.e. every normal, non-tutorial run — this is a single empty-set check and allocates nothing, so
 * it can sit on the hot path safely. Only the tutorial controller subscribes, and only while a course is active.
 *
 * `prev` is the run state BEFORE the action, which is what lets an observer resolve a buy/play/sell `uid` back to
 * its `cardId` (the card is gone from `next`). It carries `RunState` by reference — observers must treat it as
 * read-only.
 */
import type { Action, RunState } from '@game/sim';

export type TutorialActionObserver = (action: Action, prev: RunState, next: RunState) => void;

const observers = new Set<TutorialActionObserver>();

/** Subscribe to the dispatched-action stream. Returns an unsubscribe. */
export function subscribeTutorialActions(fn: TutorialActionObserver): () => void {
  observers.add(fn);
  return () => observers.delete(fn);
}

/** Called by the store after every committed dispatch. A no-op (one set check) when nothing is subscribed. */
export function notifyTutorialActions(action: Action, prev: RunState, next: RunState): void {
  if (observers.size === 0) return;
  for (const fn of observers) {
    try {
      fn(action, prev, next);
    } catch {
      // An observer must never break the game loop — a throwing tutorial observer is dropped for this tick.
    }
  }
}
