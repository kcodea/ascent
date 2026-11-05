/**
 * WARD HOLDS: a unit whose Ward was GIVEN by a card with an "On Ward given" effect keeps its Ward dome hidden until
 * that effect arrives (owner ask 2026-11-04: Lastlight's effect "travels to the target and THEN the ward effect
 * deploys"). The engine already granted the Ward; this only delays when the dome is DRAWN. Every hold expires on its
 * own (capped at `WARD_HOLD_MAX_MS`), so a skip, a seek or an unmount can never leave a Ward invisible.
 */

/** The longest a dome may wait, whatever the effect's travel says. */
export const WARD_HOLD_MAX_MS = 3000;

const held = new Map<string, number>(); // uid -> release timer
const listeners = new Set<() => void>();
const notify = (): void => { for (const fn of listeners) fn(); };

export function subscribeWardHolds(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function isWardHeld(uid: string): boolean {
  return held.has(uid);
}

/** Hide `uid`'s Ward dome for `ms` (clamped to 0..WARD_HOLD_MAX_MS). A new hold on the same unit replaces the old. */
export function holdWard(uid: string, ms: number): void {
  const wait = Math.max(0, Math.min(WARD_HOLD_MAX_MS, ms));
  const prev = held.get(uid);
  if (prev !== undefined) clearTimeout(prev);
  if (wait <= 0) { if (prev !== undefined) { held.delete(uid); notify(); } return; }
  held.set(uid, setTimeout(() => { held.delete(uid); notify(); }, wait) as unknown as number);
  notify();
}

/** Release every hold now (combat ended / skipped). */
export function clearWardHolds(): void {
  if (held.size === 0) return;
  for (const t of held.values()) clearTimeout(t);
  held.clear();
  notify();
}
