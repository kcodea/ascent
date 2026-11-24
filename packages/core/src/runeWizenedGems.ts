/**
 * WIZENED GEMS (Set 2 + 3 Basic rune, owner design 2026-11-23, R-WIZENED-1123-01): "When you cast 3 Shop spells, improve
 * your Rubies by +1/+1 and get a Ruby." One running count per side, shared by the Shop (`wizenedGemsOnCast`, sim) and the
 * fight (`wizenedGemsCombat`, simulate.ts), so the two phases can never disagree about when it pays.
 */
export const WIZENED_GEMS = { per: 3, attack: 1, health: 1 } as const;

/** Advance the count by `casts`: where it stands now (0-2), and how many times it paid. */
export function advanceWizenedGems(tick: number | undefined, casts: number): { tick: number; trips: number } {
  const total = Math.max(0, tick ?? 0) + Math.max(0, casts);
  return { tick: total % WIZENED_GEMS.per, trips: Math.floor(total / WIZENED_GEMS.per) };
}
