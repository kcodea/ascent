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

  // Course structure (A1). A run plays a fixed course of `courseRounds` rounds. The first
  // `calibrationRounds` are calibration: they still cost Resolve + run the economy, but do NOT count
  // toward your record. The run ALWAYS completes the course unless Resolve hits 0 (the failure). Your
  // final W–L record over the scored rounds is the score — see `runRecord`. The per-wave stat scaling
  // (`curve.statScalePerWave`) is the difficulty dial.
  calibrationRounds: 2,
  courseRounds: 17, // 2 calibration + 15 scored
  // Par / line (A2): the default target number of scored wins a run is graded against. Static for now
  // (mid-tier); becomes rating-driven with the career system (new ~7 / mid ~9 / high ~11 / elite ~12+).
  defaultLine: 9,
  // Wave horizon for the balance/curve tools (`npm run curve`) — the difficulty curve is reported over
  // the whole course.
  maxWave: 17,
  // Practice mode shares the same course as Ascent (`courseRounds`) — it just can't be lost (unlimited
  // health) and runs a longer per-turn clock; see `advanceCombat` + the recruit timer.

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

  // Quests: the master on/off for the whole quest system. `false` → the quest waves (5 and 11) are ordinary
  // shop turns (no quest phase / panel / objectives / rewards). Gated at the single `questBucketFor`
  // chokepoint, so nothing downstream can activate. Default on.
  questsEnabled: true,
};

/**
 * ── Anomalies ──────────────────────────────────────────────────────────────────────────────────────────
 * A limited-time "anomaly" is a **global rule bent for fun for a while, then switched back off** — think
 * seasonal / weekend modifiers. This is the extensible spine for them: add a new entry to `ANOMALIES`, give
 * it an `enabled` switch + display copy, and teach the relevant system to honour its id. At most one anomaly
 * is active at a time (the first `enabled` entry, in declaration order).
 *
 * Turning one on/off is a one-line `enabled: true|false` flip — no other wiring. The active anomaly is
 * **snapshotted onto each run at creation** (`RunState.anomaly`), so a saved or replayed run keeps the rules
 * it was played under even after we flip the global switch off (same "pin what actually happened" philosophy
 * as pinned opponents). Runtime code should read `RunState.anomaly` / `run.anomaly`, never the live registry.
 */
export type AnomalyId = 'freedom' | 'runic';

export interface AnomalyDef {
  id: AnomalyId;
  /** Display name — shown on hero select as "Anomaly: <name>". */
  name: string;
  /** One-line rules blurb for banners / tooltips. */
  blurb: string;
  /** The on/off switch. `false` retires the anomaly for NEW runs (in-flight runs keep their pinned copy). */
  enabled: boolean;
  /** Optional human note on the intended window (e.g. "through 2026-07-20"). Informational only — the
   *  functional switch is `enabled`; we flip it (or ship a build) when the window ends. */
  runsThrough?: string;
}

export const ANOMALIES: Record<AnomalyId, AnomalyDef> = {
  freedom: {
    id: 'freedom',
    name: 'Freedom',
    blurb: 'The first minion you buy each turn is free.',
    enabled: false,
    runsThrough: 'a limited-time celebration patch',
  },
  runic: {
    id: 'runic',
    name: 'Runic Behavior',
    blurb: 'Every hero visits the basic Runeforge on turn 7.',
    enabled: true,
    runsThrough: 'a limited-time celebration patch',
  },
};

/** The anomaly a NEW run should adopt — the first enabled entry, or `null` if none. Deterministic (depends
 *  only on the registry's `enabled` flags), so it's safe to call from `createRun`. */
export function activeAnomaly(): AnomalyDef | null {
  for (const a of Object.values(ANOMALIES)) if (a.enabled) return a;
  return null;
}

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
