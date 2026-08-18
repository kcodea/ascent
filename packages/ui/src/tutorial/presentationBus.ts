/**
 * TUTORIAL — the combat-presentation bus.
 *
 * The tutorial needs to know when a combat effect is SHOWN (a Rally landed, a summon appeared, a death played),
 * so a Predict/Confirm step can advance at the right beat. `useCombatReplay` classifies each beat's events as it
 * presents them; it calls `notifyTutorialPresented(kind, ev)` from that existing per-beat loop.
 *
 * This is READ-ONLY: it never changes timing, order, or FX — it only reports what the replay already decided to
 * show, after the fact. When nothing is subscribed (every non-tutorial fight) it's a single set-size check and
 * allocates nothing, so it's safe on the combat hot path. Only the tutorial controller subscribes, and only
 * while a course is live. Mirrors the Beat Lab's own read-only observation of the same loop.
 */
import type { TutorialPresentedKind } from '@game/sim';

export interface TutorialPresentedEvent {
  kind: TutorialPresentedKind;
  srcUid?: string;
  srcCard?: string;
}

export type TutorialPresentationObserver = (ev: TutorialPresentedEvent) => void;

const observers = new Set<TutorialPresentationObserver>();

/** Subscribe to the combat-presentation stream. Returns an unsubscribe. */
export function subscribeTutorialPresented(fn: TutorialPresentationObserver): () => void {
  observers.add(fn);
  return () => observers.delete(fn);
}

/** Called by the combat replay as each beat is presented. No-op (one set check) when nothing is subscribed. */
export function notifyTutorialPresented(ev: TutorialPresentedEvent): void {
  if (observers.size === 0) return;
  for (const fn of observers) {
    try {
      fn(ev);
    } catch {
      // A tutorial observer must never break the combat loop.
    }
  }
}
