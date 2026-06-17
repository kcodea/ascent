/**
 * All run-loop tuning constants in one object (handoff A.2 economy + C.7 curve).
 * These are the dials the balance runner (M2) turns; the A.6 counter matrix is
 * the balance *truth* they're tuned toward.
 */
export const CONFIG = {
  // Economy (Embers = gold)
  startEmbers: 3,
  embersPerWave: 1,
  embersCap: 10,

  // Resolve (HP)
  startResolve: 30,

  // Shop
  minionCost: 3,
  sellValue: 1,
  refreshCost: 1,
  boardMax: 7,
  handMax: 10,

  // Tiers — cost to reach a target tier (handoff A.2). Decreases by 1 each wave
  // the player doesn't upgrade, down to the floor.
  maxTier: 6,
  upgradeCost: { 2: 5, 3: 7, 4: 8, 5: 11, 6: 10 } as Record<number, number>,
  upgradeDiscountPerWave: 1,
  upgradeCostFloor: 0,

  // Enemy curve (handoff A.5): board count grows +1 per N waves; stats scale
  // by (1 + wave * statScalePerWave). This is the difficulty dial.
  curve: {
    extraCountPerWaves: 6,
    statScalePerWave: 0.16,
  },
};

/**
 * Minion-pool quantities per tier — how many copies of each tier's cards sit in the shared
 * shop pool. A finite pool is what makes triples a contested resource (buying/selling draws
 * from + returns copies). **Placeholder — not yet wired into shop rolls** (see roadmap: the
 * shop currently samples cards without a finite pool). Tier 7 is a forward placeholder; no
 * tier-7 cards exist yet (CONFIG.maxTier is 6).
 */
export const POOL_QUANTITIES: Record<number, number> = {
  1: 16,
  2: 15,
  3: 13,
  4: 11,
  5: 9,
  6: 7,
  7: 5,
};
