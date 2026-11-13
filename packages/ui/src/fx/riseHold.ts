/**
 * RISE HOLDS: a unit GIVEN Rise by a card with an "On Rise given" effect keeps its Rise dome and wisps hidden until
 * that effect arrives (owner 2026-11-12: "wired in all the exact same ways as the ward beam and execute beam"). The
 * engine already granted the keyword; this only delays when the dome is DRAWN. The twin of `wardHold.ts` and
 * `executeHold.ts`: every hold expires on its own (capped at `RISE_HOLD_MAX_MS`), so a skip, a seek or an unmount can
 * never leave a Rise invisible.
 */

/** The longest a dome may wait, whatever the effect's travel says. */
export const RISE_HOLD_MAX_MS = 3000;

const held = new Map<string, number>(); // uid -> release timer
const listeners = new Set<() => void>();
const notify = (): void => { for (const fn of listeners) fn(); };

export function subscribeRiseHolds(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function isRiseHeld(uid: string): boolean {
  return held.has(uid);
}

/** Hide `uid`'s Rise dome for `ms` (clamped to 0..RISE_HOLD_MAX_MS). A new hold on the same unit replaces the old. */
export function holdRise(uid: string, ms: number): void {
  const wait = Math.max(0, Math.min(RISE_HOLD_MAX_MS, ms));
  const prev = held.get(uid);
  if (prev !== undefined) clearTimeout(prev);
  if (wait <= 0) { if (prev !== undefined) { held.delete(uid); notify(); } return; }
  held.set(uid, setTimeout(() => { held.delete(uid); notify(); }, wait) as unknown as number);
  notify();
}
