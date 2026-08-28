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
  /** The RAISED hand cap while the Runeforge is open, so a rune's rewards can all land on a full hand
   *  (owner ruling 2026-08-04). See `handCap` in state.ts. */
  handMaxRuneTurn: 20,

  // Tiers — cost to reach a target tier (handoff A.2). Decreases by 1 each wave
  // the player doesn't upgrade, down to the floor.
  maxTier: 6,
  upgradeCost: { 2: 5, 3: 7, 4: 8, 5: 11, 6: 10, 7: 12 } as Record<number, number>,
  upgradeDiscountPerWave: 1,
  upgradeCostFloor: 0,

  // Enemy curve (handoff A.5): board count grows +1 per N waves; stats scale
  // by (1 + wave * statScalePerWave). This is the difficulty dial.
  curve: {
    extraCountPerWaves: 6,
    statScalePerWave: 0.16,
  },

  // Quests: the master on/off for the UNIVERSAL quest turns (waves 5 & 11 — the ones every hero gets). `false`
  // → those become ordinary shop turns (no quest phase / panel / objectives / rewards). Quest-native heroes
  // (Fi's Errand, Coran's Pathfinder) keep their own quest access regardless — see `questOfferPlan`.
  //
  // ⚠️ SUPERSEDED by `QUESTS_ARCHIVED` (below), which sits ABOVE this and every hero-native path. This flag is
  // kept because `pinSet1Era()` and the set-1-era test files still set it, and a replayed set-1 run reads it —
  // but flipping it back to `true` no longer produces a quest offer while the archive switch is on.
  questsEnabled: false, // OFF for set 2 (owner 2026-07-31) — superseded by QUESTS_ARCHIVED 2026-08-28

  // Runeforge: the master on/off for the Runeforge as a UNIVERSAL system. `true` → EVERY hero visits the basic
  // Runeforge on turn 6 and the Epic Runeforge on turn 9 (free — no hero-power charge). `false` → only the
  // runeforge-native heroes access it (Runesmith basic on turn 5, Runeguard epic on turn 8), which is always
  // true independent of this flag. Separate from the `runic` rift (which independently grants the turn-6 basic
  // forge to all heroes); if both are on, turn 6 still opens exactly one basic forge. Default off.
  runeforgeEnabled: true, // ON for set 2 (owner 2026-07-31): basic forge turn 6, epic turn 9, every hero
};

/**
 * ── ARCHIVED SYSTEMS (owner ruling 2026-08-28) ─────────────────────────────────────────────────────────
 *
 * The owner's words: *"we have more or less retired quests for now. we can archive that system fully, it can
 * be more or less turned off and away from our code for now as we are centering on runes for the foreseeable
 * future."* And, in the same triage sitting, on henchmen: *"henchmen are not in the game and are extremely
 * WIP / being removed for now."*
 *
 * These are ARCHIVE switches, not feature toggles. The distinction matters and is the whole design:
 *
 *  · **Nothing is deleted.** `QUEST_DEFS` / `QUEST_INDEX`, the objective machinery, `applyQuestReward`, the
 *    quest UI and `HENCHMEN` all stay exactly where they were, fully resolvable by id. A saved run or a
 *    replay that carries a quest still loads, still ticks, still pays out — the archived-content contract
 *    (`ARCHIVED_CARDS` / `ARCHIVED_RUNES`): resolvable by id, member of no pool.
 *  · **The PRODUCERS go dark, at ONE chokepoint each.** `questOfferPlan` (quests.ts) and `henchmanOffer`
 *    (state.ts) are the only two functions in the codebase that can mint an offer, and each returns `null`
 *    unconditionally while its switch is on. That is what makes "inert" provable rather than incidental:
 *    with no offer there is no `questOffer`, so the quest overlay never opens, `buyQuest` has nothing to
 *    buy, `activeQuests` stays empty and objectives never advance — in ANY mode, on ANY seed.
 *  · **`devGrant` is deliberately NOT gated.** The reward engine must stay callable: Doc Bot's economy
 *    sweep grants every quest through it to check reward magnitudes, and every RUNE in the game pays out
 *    through `applyQuestReward`. Archiving the quest *content class* must not take the rune engine's
 *    coverage down with it.
 *
 * Flipping either back to `false` restores the system wholesale — that is the point of archiving rather
 * than demolishing.
 */
export const QUESTS_ARCHIVED = true;

/** See `QUESTS_ARCHIVED`. Gates `henchmanOffer` (state.ts) — the single producer of a henchman offer, and
 *  therefore of the StatusBar's henchman chip, which renders only when that offer is non-null. */
export const HENCHMEN_ARCHIVED = true;

/** Keshi's Crown: the tavern-tier bank threshold that grants a Triple Reward — a single-number retune from
 *  here alone. Read by `keshiCrownBuy` (reducer.ts) and the UI's StatusBar (both the compact and expanded
 *  power readouts); nowhere else should hardcode this as a literal 25. */
export const KESHI_CROWN_THRESHOLD = 25;

/**
 * Croupier Ayse (Lucky Seat): the chance EACH Shop card rolls to come up Enchanted.
 *
 * Owner change 2026-08-22 — was "a 50% chance the shop seats exactly ONE", then briefly 0.15. A per-card rate
 * cannot be a flat swap for a per-SHOP one: it scales with shop size, so it necessarily tilts the curve. 0.20
 * is chosen to hold the EARLY game roughly level rather than to match the midpoint —
 *
 *   cards:      3 (T1)   4      5      6 (T6)
 *   P(>=1):     48.8%   59.0%  67.2%   73.8%     (old system: a flat 50% at every size)
 *   P(>=2):     10.4%   18.1%  26.3%   34.5%     (impossible under the old system)
 *
 * — so a Tier-1 shop still sees one about half the time, and the growth from there is the upside. The tail is
 * the point: her power now has a lucky fill worth reacting to instead of reading identically every time it
 * hits. At 0.15 the opening shop sat at 38.6%, a real nerf to the early game (owner call: bump it).
 *
 * A single-number retune from here alone — nothing should hardcode this as a literal.
 */
export const CIA_ENCHANT_CHANCE = 0.20;

/** Ayse's ACE, tier-up half: Gold knocked off the next Shop upgrade. Banked in `aceTierDiscount`. */
export const ACE_TIER_DISCOUNT = 4;

/**
 * Ayse's ACE, tier-up half: the highest Shop tier that half is OFFERED at (owner rule 2026-08-22 — "the
 * tiering up one can only be offered at tier 5 and below").
 *
 * Above it the Ace always pays its Discover half rather than flipping: at Tier 6 a discount buys at most one
 * more step, and at the ceiling it buys nothing at all, so a coin flip up there would pay out dead half the
 * time — the one outcome a prize should never have.
 */
export const ACE_DISCOUNT_MAX_TIER = 5;

/**
 * Power Shifter (T5 spell): how many hero powers it offers — THREE (owner 2026-08-22), against the two the
 * hero-native Discovers show. A one-shot spell you paid Gold for, which overwrites the power you already
 * hold, earns a wider choice than a per-turn disguise does.
 */
export const SHIFTER_OPTIONS = 3;

/**
 * Indy's Masterwork recharge: Gold that must be SPENT after a use before the charge returns.
 *
 * Exported because the reducer arms the recharge and the StatusBar prints the meter, and those two drifted —
 * the value was rebalanced 40 → 75 on 2026-08-07 in the reducer only, so the pill read "0/40g" while the
 * charge actually needed 75 (owner report 2026-08-20). One constant, both readers.
 */
export const INDY_GILD_RECHARGE_GOLD = 75;

/**
 * ── Rifts ──────────────────────────────────────────────────────────────────────────────────────────────
 * A limited-time "rift" is a **global rule bent for fun for a while, then switched back off** — think
 * seasonal / weekend modifiers. This is the extensible spine for them: add a new entry to `RIFTS`, give
 * it an `enabled` switch + display copy, and teach the relevant system to honour its id. At most one rift
 * is active at a time (the first `enabled` entry, in declaration order).
 *
 * Turning one on/off is a one-line `enabled: true|false` flip — no other wiring. The active rift is
 * **snapshotted onto each run at creation** (`RunState.rift`), so a saved or replayed run keeps the rules
 * it was played under even after we flip the global switch off (same "pin what actually happened" philosophy
 * as pinned opponents). Runtime code should read `RunState.rift` / `run.rift`, never the live registry.
 */
export type RiftId = 'freedom' | 'runic' | 'summit';

export interface RiftDef {
  id: RiftId;
  /** Display name — shown on hero select as "Rift: <name>". */
  name: string;
  /** One-line rules blurb for banners / tooltips. */
  blurb: string;
  /** The on/off switch. `false` retires the rift for NEW runs (in-flight runs keep their pinned copy). */
  enabled: boolean;
  /** Optional human note on the intended window (e.g. "through 2026-07-20"). Informational only — the
   *  functional switch is `enabled`; we flip it (or ship a build) when the window ends. */
  runsThrough?: string;
}

export const RIFTS: Record<RiftId, RiftDef> = {
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
    blurb: 'Every hero visits the basic Runeforge on turn 6.',
    enabled: false, // retired 2026-07-16 (owner) — in-flight runs keep their pinned copy
    runsThrough: 'a limited-time celebration patch',
  },
  summit: {
    id: 'summit',
    name: 'Summit',
    blurb: 'All heroes gain +10 Armor, and the shop unlocks Tier 7.',
    enabled: false, // parked 2026-07-20 (owner) — Tier 7 now arrives via Brackus / Teleport Summit / Rune of the Summit
    runsThrough: 'a limited-time celebration patch',
  },
};

/** Extra Armor a rift grants every hero at run creation (Summit: +10). Applied to BOTH `armor` and
 *  `maxArmor` in `createRun`, and pinned with the run like every other rift effect. */
export const RIFT_BONUS_ARMOR: Partial<Record<RiftId, number>> = { summit: 10 };

/**
 * The highest shop tier a run can reach. `CONFIG.maxTier` (6) is the standard ceiling; the **Summit**
 * rift raises it to 7. Every tier ceiling — the tavern-up gate, Discover clamps, the triple's "one tier
 * up" peek — must go through this rather than reading `CONFIG.maxTier` directly, or Tier 7 becomes
 * either unreachable or reachable outside Summit. Takes the RUN's pinned rift, never the live registry,
 * so a replayed Summit run keeps its ceiling after the switch flips off.
 */
export function maxTierFor(rift: RiftId | null | undefined): number {
  return rift === 'summit' ? 7 : CONFIG.maxTier;
}

/**
 * Does this run have ACCESS to Tier 7 at all? (owner ruling 2026-07-28)
 *
 * Two ways in, and only two: the **Summit** rift raises the ceiling for the whole run, or a hero reaches it
 * through a **quest or hero power** that sets `tier7Access`. No such hero exists yet — the flag is the seam
 * the owner asked for ("it would be a different hero power or something"), so adding one later is a one-line
 * change rather than a hunt through every tier-7 site.
 *
 * Beyond the Summit is gated on this: without access it Discovers up to Tier 6, and its card text drops the
 * "(up to Tier 7)" promise rather than advertising something the run cannot deliver.
 */
export function hasTier7Access(state: { rift?: RiftId | null; tier7Access?: boolean }): boolean {
  return maxTierFor(state.rift) >= 7 || state.tier7Access === true;
}

/** The rift a NEW run should adopt — the first enabled entry, or `null` if none. Deterministic (depends
 *  only on the registry's `enabled` flags), so it's safe to call from `createRun`. */
export function activeRift(): RiftDef | null {
  for (const a of Object.values(RIFTS)) if (a.enabled) return a;
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
