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

  // PvE win condition (current iteration): surviving this wave ends the run in victory. A bounded
  // climb (vs the old "endless"). Will likely become a per-mode dial once PvE/PvP modes land.
  maxWave: 20,

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
 * shop pool. A finite pool makes copies a contested resource: the shop draws from it (a card
 * with 0 copies left stops being offered) and selling / rerolling returns copies. Tier 7 is a
 * forward placeholder; no tier-7 cards exist yet (CONFIG.maxTier is 6).
 */
export const POOL_QUANTITIES: Record<number, number> = {
  1: 10,
  2: 9,
  3: 8,
  4: 7,
  5: 6,
  6: 6,
  7: 6,
};
