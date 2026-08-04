import type { RunState } from '@game/sim';

/**
 * LIVE RUNE TALLIES (owner ask 2026-08-03: "make sure our runes/quests all have tally trackers like the
 * avenge tracker — this should always show x/10g so I know how far off I am from triggering its effect").
 *
 * A rune whose effect fires on a METER (spend 10 Gold, cast 3 spells, buy 5 cards…) is otherwise invisible:
 * the card states the threshold but nothing on screen says how close you are, so the payout reads as random.
 * This turns each of those into the same `4/10g` progress the Avenge counters already show on units.
 *
 * COMPLETED QUESTS need the same thing (owner ask 2026-08-04, "parse all quest/runes to make sure they have
 * counters where they should"). A PENDING quest already shows its objective progress on the badge, but a quest
 * whose REWARD is itself an ongoing meter — Food for Gold's "every 7 Gold", Bane's Presence's "every 3 Shouts"
 * — went silent the moment it completed, which is exactly when the meter starts mattering. See `questTally`.
 *
 * The audit that produced this list is in `tallyCoverage.test.ts`: it walks every rune and quest and asserts
 * that anything whose text promises a recurring threshold has a tally, so the next one can't ship without.
 */

/** The unit suffix each meter counts in, so `4/10g` reads as Gold and `2/3` as casts. */
const METER_SUFFIX: Record<string, string> = {
  gold: 'g',
  spellCast: '',
  spellCastNonAle: '',
  castRuby: '',
  cardsBought: '',
  shout: '',
};

/**
 * The live `x/N` tally for a rune, or null when it has no meter to show (most runes are passive or
 * one-shot). Pure — safe to call per render.
 */
export function runeTally(run: RunState, runeId: string): string | null {
  // Threshold runes (Gemspam, Spending, Action, …) — `sourceId` is stamped when the meter is armed.
  const t = run.runeThresholds?.find((x) => x.sourceId === runeId);
  if (t && t.per > 0) {
    // `oncePerTurn` runes that already paid out this turn read as full rather than as a fresh 0 — the meter
    // is banked, it just can't fire again until next turn.
    if (t.oncePerTurn && t.usedThisTurn) return `${t.per}/${t.per}${METER_SUFFIX[t.meter] ?? ''}`;
    return `${Math.min(t.tick, t.per)}/${t.per}${METER_SUFFIX[t.meter] ?? ''}`;
  }
  // Rune of Spellslinging keeps its own Gold meter rather than joining `runeThresholds`.
  if (runeId === 'rune_spellslinging' && run.spellDripPer) {
    return `${Math.min(run.spellDripTick ?? 0, run.spellDripPer)}/${run.spellDripPer}g`;
  }
  // Rune of the Summit counts SHOPS OPENED, and fires every second one.
  if (runeId === 'rune_summit' && run.runeSummitTick != null) {
    return `${run.runeSummitTick % 2}/2`;
  }
  // Rune of Slaying banks KILLS ACROSS COMBATS (`runeSlayingKills`) and pays every 6 — the owner's report
  // 2026-08-04. A cross-combat meter with nothing on screen is the worst case of all: the payout arrives
  // rounds after the kills that earned it, so without this it reads as pure randomness.
  if (runeId === 'rune_slaying' && run.questFlags?.runeSlaying) {
    return `${Math.min(run.runeSlayingKills ?? 0, SLAYING_PER)}/${SLAYING_PER}`;
  }
  // Rune of Bulk Order keeps its own Gold meter on `runeScale` rather than joining `runeThresholds`.
  if (runeId === 'rune_scale' && run.runeScale?.per) {
    return `${Math.min(run.runeScale.tick ?? 0, run.runeScale.per)}/${run.runeScale.per}g`;
  }
  return null;
}

/** Rune of Slaying's threshold. Mirrors the `>= 6` in `settleCombat` — kept beside the readout so the two are
 *  edited together; the reducer owns the behaviour and this only reports it. */
const SLAYING_PER = 6;

/**
 * The live `x/N` tally for a COMPLETED quest whose reward is a recurring meter, or null when it has none.
 *
 * Only completed quests: a pending quest shows its OBJECTIVE progress instead (`questProgressText` on the
 * badge), and showing both would be two different numbers in the same slot.
 */
export function questTally(run: RunState, questId: string): string | null {
  switch (questId) {
    // Den Marker — every `per` Beasts played, the grant climbs.
    case 'q_den_marker':
      return run.denMarker?.per
        ? `${Math.min(run.denMarker.count ?? 0, run.denMarker.per)}/${run.denMarker.per}`
        : null;
    // Food for Gold — every `per` Gold spent adds a Fodder.
    case 'q_food_for_gold':
      return run.foodForGold?.per
        ? `${Math.min(run.foodForGoldTick ?? 0, run.foodForGold.per)}/${run.foodForGold.per}g`
        : null;
    // Bane's Presence — every `per` Shouts triggered, the Shop grows.
    case 'q_banes_presence':
      return run.shopBuffPerShouts?.per
        ? `${Math.min(run.shopBuffPerShouts.tick, run.shopBuffPerShouts.per)}/${run.shopBuffPerShouts.per}`
        : null;
    // Endless Inventory — the refresh buff improves every `per` refreshes.
    case 'q_endless_inventory':
      return run.shopBuffOnRefresh?.per
        ? `${Math.min(run.shopBuffOnRefresh.tick, run.shopBuffOnRefresh.per)}/${run.shopBuffOnRefresh.per}`
        : null;
    // Golden Ledger — every `per` Gold spent buffs the tribe.
    case 'q_golden_ledger':
      return run.questGoldTribeBuff?.per
        ? `${Math.min(run.questGoldTribeBuff.tick, run.questGoldTribeBuff.per)}/${run.questGoldTribeBuff.per}g`
        : null;
    // Pack Mentality — the aura improves every `per` of its trigger event. Its meter lives in a LIST (a run can
    // hold several scaling auras), so it is matched on the tribe the quest granted rather than by index.
    case 'q_pack_mentality': {
      const aura = run.questScalingAuras?.find((a) => a.tribe === 'beast');
      return aura?.per ? `${Math.min(aura.progress, aura.per)}/${aura.per}` : null;
    }
    default:
      return null;
  }
}
