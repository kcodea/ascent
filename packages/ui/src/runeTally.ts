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
  // Rune of the Summit counts SHOPS OPENED, and fires every THIRD one (audit fix 2026-08-06: the badge
  // counted x/2 against a fires-every-3rd implementation, so it read 1/2 on the turn it actually fired).
  if (runeId === 'rune_summit' && run.runeSummitTick != null) {
    return `${run.runeSummitTick % 3}/3`;
  }
  // Rune of the Collector: distinct minion TYPES bought this turn, toward the 3 that fire the Discover.
  if (runeId === 'rune_collector' && run.runeCollector) {
    return `${Math.min((run.typesBoughtThisTurn ?? []).length, 3)}/3`;
  }
  // Rune of Slaying banks KILLS ACROSS COMBATS (`runeSlayingKills`) and pays every 6 — the owner's report
  // 2026-08-04. A cross-combat meter with nothing on screen is the worst case of all: the payout arrives
  // rounds after the kills that earned it, so without this it reads as pure randomness.
  if (runeId === 'rune_slaying' && run.questFlags?.runeSlaying) {
    return `${Math.min(run.runeSlayingKills ?? 0, SLAYING_PER)}/${SLAYING_PER}`;
  }
  // Rune of Bulk Order keeps its own Gold meter on `runeScale` rather than joining `runeThresholds`.
  // RUNE OF BUCKY (owner ask 2026-08-07): the Ales cast THIS turn — i.e. what you are currently banking for
  // NEXT combat, since Bucky pays off last turn's brewing. A plain count, not `x/N`: there is no threshold,
  // every Ale is worth another +5/+5.
  if (runeId === 'rune_bucky') {
    const ales = run.alesCastThisTurn ?? 0;
    return ales > 0 ? `${ales} Ale${ales === 1 ? '' : 's'}` : null;
  }
  // RUNE OF THE CHEF (owner ask 2026-08-07): show the buff the Rally is actually going to hand out, not a
  // countdown — the rune's whole question is "how big is it this fight?". That figure is each Chef's BANKED
  // `chefGrantedLast`, summed across the board (two Chefs each pay their own Dwarf, so the total is what the
  // rune pays this combat). Nothing banked → no pill, which correctly reads as "this fight pays nothing".
  if (runeId === 'rune_chef' && run.questFlags?.runeChef) {
    const banked = run.board.reduce((n, c) => n + (c.cardId === 'dw_chef' ? (c.chefGranted ?? 0) : 0), 0);
    return banked > 0 ? `+${banked}/+${banked}` : null;
  }
  // Rune of the Crown: spells cast toward the one-time step. Latches at per/per once earned — the bonus is
  // permanent from then on, so a cyclic counter would lie about it turning off.
  if (runeId === 'rune_crown' && run.runeCrown) {
    return `${Math.min(run.spellsCast, run.runeCrown.per)}/${run.runeCrown.per}`;
  }
  // Rune of the Foundry: minions sold toward the next Dragon.
  if (runeId === 'rune_foundry' && run.runeFoundry) {
    return `${Math.min(run.runeFoundry.sold, run.runeFoundry.per)}/${run.runeFoundry.per}`;
  }
  if (runeId === 'rune_scale' && run.runeScale?.per) {
    return `${Math.min(run.runeScale.tick ?? 0, run.runeScale.per)}/${run.runeScale.per}g`;
  }
  return null;
}

/** Rune of Slaying's threshold. Mirrors the `>= 6` in `settleCombat` — kept beside the readout so the two are
 *  edited together; the reducer owns the behaviour and this only reports it. */
const SLAYING_PER = 6;

/**
 * COMBAT-LOCAL rune meters (audit 2026-08-06): the ten rune-granted Avenge effects — plus Blood and Coin
 * (every 4 friendly deaths) and the Remains (every 5 summons) — metered silently. A minion's Avenge hangs
 * its counter on the unit; a rune has no body, so its counter hangs on the BADGE, fed by the replay's live
 * `CombatQuestDelta` (friendly deaths / combat summons this fight). Each mirrors its registration in
 * `simulate.ts` — the sim owns the behaviour, this only reports it.
 *
 * Deliberately absent: Rune of Counterpoint (Avenge 1 — fires on every death, a 1/1 meter is noise),
 * the Brood / Living Echoes (space-triggered, no player-facing count), Finality (a one-shot latch).
 */
const RUNE_DEATHS_PER: Record<string, number> = {
  rune_broodpit: 4, rune_spearline: 4, rune_appraisal: 3, rune_last_call: 4, rune_cinder_ledger: 3, // Last Call: Avenge (4) — owner 2026-08-11
  rune_hunting_bell: 3, rune_gemstorm: 2, rune_procession: 4, rune_soul_taxes: 4,
  rune_blood_and_coin: 5, rune_engraving: 3, // Blood and Coin: Avenge (5) — owner 2026-08-11; Engraving: Avenge (3)
  rune_carrion_coin: 4, // Carrion Coin: Avenge (4) — a random Shop spell per proc
};
const RUNE_SUMMONS_PER: Record<string, number> = { rune_remains: 5 };

/** The live `x/N` combat tally for a rune, or null. `deaths` / `summons` come from the replay's per-beat
 *  quest delta, so the badge ticks in lockstep with the unit Avenge counters. Cyclic 1..N, like theirs. */
export function runeCombatTally(runeId: string, deaths: number, summons: number): string | null {
  const cyc = (v: number, per: number): string => `${v <= 0 ? 0 : ((v - 1) % per) + 1}/${per}`;
  const dp = RUNE_DEATHS_PER[runeId];
  if (dp) return cyc(deaths, dp);
  const sp = RUNE_SUMMONS_PER[runeId];
  if (sp) return cyc(summons, sp);
  return null;
}

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
