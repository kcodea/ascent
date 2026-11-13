/**
 * FLURRY HOLDS: a unit GIVEN Flurry by something with a Flurry beam keeps its Flurry swirl hidden until that beam
 * arrives (owner 2026-11-13: "saved flurry-beam"). The engine already granted the keyword; this only delays when the
 * swirl is DRAWN. The twin of `riseHold.ts`: every hold expires on its own (capped at `FLURRY_HOLD_MAX_MS`), so a
 * skip, a seek or an unmount can never leave a Flurry invisible.
 */

/** The longest a swirl may wait, whatever the effect's travel says. */
export const FLURRY_HOLD_MAX_MS = 3000;

const held = new Map<string, number>(); // uid -> release timer
const listeners = new Set<() => void>();
const notify = (): void => { for (const fn of listeners) fn(); };

export function subscribeFlurryHolds(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function isFlurryHeld(uid: string): boolean {
  return held.has(uid);
}

/** Hide `uid`'s Flurry swirl for `ms` (clamped to 0..FLURRY_HOLD_MAX_MS). A new hold on the same unit replaces the old. */
export function holdFlurry(uid: string, ms: number): void {
  const wait = Math.max(0, Math.min(FLURRY_HOLD_MAX_MS, ms));
  const prev = held.get(uid);
  if (prev !== undefined) clearTimeout(prev);
  if (wait <= 0) { if (prev !== undefined) { held.delete(uid); notify(); } return; }
  held.set(uid, setTimeout(() => { held.delete(uid); notify(); }, wait) as unknown as number);
  notify();
}
