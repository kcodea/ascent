/**
 * STAT MILESTONES — fixed value tiers for the Attack/Health badges.
 *
 * Pure and React-free (unit-testable headlessly, like `channels/rallyFired.ts`). This is the SINGLE source of
 * truth for the thresholds: the badge frame is `tierOf(currentValue)` and the celebration fires on
 * `crossedUp(prev, next)`. No per-unit state lives anywhere — the frame is derived every render and the FX
 * needs only the previous value the badge already tracks (`prevStats` in `Card.tsx`).
 *
 * Tiers are OWNER-SET (docs/superpowers/specs/2026-09-14-stat-milestone-frames-design.md). Per-stat by
 * construction so Health can run higher than Attack later with a one-line edit; identical today.
 */
export type StatKind = 'attack' | 'health';

export const MILESTONE_TIERS: Record<StatKind, number[]> = {
  attack: [0, 50, 150, 500, 2000],
  health: [0, 50, 150, 500, 2000],
};

/** How many thresholds `value` has reached: 0 (below the first) up to the number of thresholds. Pure. */
export function tierOf(stat: StatKind, value: number): number {
  const tiers = MILESTONE_TIERS[stat];
  let t = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (value >= tiers[i]) t = i + 1;
    else break;
  }
  return t;
}

/** The highest tier newly reached going prev→next, or null when the tier did not increase. A jump that vaults
 *  several tiers reports the top one, so a single big buff fires ONE celebration (at the tier reached). */
export function crossedUp(stat: StatKind, prev: number, next: number): number | null {
  const before = tierOf(stat, prev);
  const after = tierOf(stat, next);
  return after > before ? after : null;
}
