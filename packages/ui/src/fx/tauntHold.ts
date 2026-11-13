/**
 * TAUNT HOLDS: a unit GIVEN Taunt by something with a Taunt beam keeps its ordinary frame until that beam arrives
 * (owner 2026-11-13: "now im making a taunt beam"). The engine already granted the keyword; this only delays when the
 * shield frame is DRAWN. The twin of `flurryHold.ts`: every hold expires on its own (capped at `TAUNT_HOLD_MAX_MS`),
 * so a skip, a seek or an unmount can never leave a Taunt invisible.
 */

/** The longest a shield frame may wait, whatever the effect's travel says. */
export const TAUNT_HOLD_MAX_MS = 3000;

const held = new Map<string, number>(); // uid -> release timer
const listeners = new Set<() => void>();
const notify = (): void => { for (const fn of listeners) fn(); };

export function subscribeTauntHolds(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function isTauntHeld(uid: string): boolean {
  return held.has(uid);
}

/** Hide `uid`'s Taunt shield frame for `ms` (clamped to 0..TAUNT_HOLD_MAX_MS). A new hold on the same unit replaces the old. */
export function holdTaunt(uid: string, ms: number): void {
  const wait = Math.max(0, Math.min(TAUNT_HOLD_MAX_MS, ms));
  const prev = held.get(uid);
  if (prev !== undefined) clearTimeout(prev);
  if (wait <= 0) { if (prev !== undefined) { held.delete(uid); notify(); } return; }
  held.set(uid, setTimeout(() => { held.delete(uid); notify(); }, wait) as unknown as number);
  notify();
}
