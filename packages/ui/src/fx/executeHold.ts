/**
 * EXECUTE HOLDS: a unit GIVEN Execute by a card with an "On Execute given" effect keeps its Execute aura hidden until
 * that effect arrives (owner 2026-11-12: "applying execute is another effect much like ward, that applies
 * instantly"). The engine already granted the keyword; this only delays when the aura is DRAWN. The twin of
 * `wardHold.ts`: every hold expires on its own (capped at `EXECUTE_HOLD_MAX_MS`), so a skip, a seek or an unmount can
 * never leave an Execute invisible.
 */

/** The longest an aura may wait, whatever the effect's travel says. */
export const EXECUTE_HOLD_MAX_MS = 3000;

const held = new Map<string, number>(); // uid -> release timer
const listeners = new Set<() => void>();
const notify = (): void => { for (const fn of listeners) fn(); };

export function subscribeExecuteHolds(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function isExecuteHeld(uid: string): boolean {
  return held.has(uid);
}

/** Hide `uid`'s Execute aura for `ms` (clamped to 0..EXECUTE_HOLD_MAX_MS). A new hold on the same unit replaces the old. */
export function holdExecute(uid: string, ms: number): void {
  const wait = Math.max(0, Math.min(EXECUTE_HOLD_MAX_MS, ms));
  const prev = held.get(uid);
  if (prev !== undefined) clearTimeout(prev);
  if (wait <= 0) { if (prev !== undefined) { held.delete(uid); notify(); } return; }
  held.set(uid, setTimeout(() => { held.delete(uid); notify(); }, wait) as unknown as number);
  notify();
}
