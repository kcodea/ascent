import { describe, it, expect } from 'vitest';
import { EPIC_RUNES, QUEST_DEFS, RUNES } from '@game/content';
import type { RunState } from '@game/sim';
import { questRewardText } from './questText';
import { questTally, runeTally, runeCombatTally } from './runeTally';

/**
 * EVERY RECURRING THRESHOLD SHOWS ITS PROGRESS.
 *
 * A rune or quest that pays out "every N Gold / 3 Shouts / 6 kills" is invisible without a counter: the card
 * states the rule, nothing on screen says how close you are, and the payout reads as random. Rune of Slaying
 * was the reported case (owner 2026-08-04) — it banks kills ACROSS combats, so its payout arrives rounds after
 * the kills that earned it.
 *
 * These tests re-derive the question rather than pinning today's answer: they walk all 130 runes and 103
 * quests, decide from the TEXT whether a threshold is promised, and demand a tally for each. A new card gets
 * caught here instead of shipping silent.
 *
 * Two traps this file is shaped around, both of which bit during the audit:
 *
 *  1. **Quest defs have no `rewardText` field.** The reward text is GENERATED from the reward object by
 *     `questRewardText`. A sweep that read `q.rewardText` found nothing and reported a clean bill of health —
 *     the instrument lying, not an all-clear. So this reads the generated text, the same string the player sees.
 *  2. **Generated text isn't markdown-bolded.** Matching `**N**` works on rune text and silently misses every
 *     quest. The pattern below matches a bare number too.
 */

/** A recurring payout gated on a COUNT — "every 5 Gold", "when you kill 6 enemies", "after you trigger 3 Shouts". */
const THRESHOLD = /(?:Every|every|When you|Whenever you|After you|After every|improving every|improve by[^.]*every)[^.]{0,45}?\*{0,2}\d+/;

/**
 * Text that LOOKS like a threshold but isn't a meter, with the reason. Each is a magnitude or a per-event
 * effect that fires every time — there is no "progress toward" anything to show.
 */
const NOT_A_METER: Record<string, string> = {
  rune_motherlode: 'the 2 is how many minions a Ruby copies onto, not a count-up',
  rune_finality: 'the 7 is how many Imps arrive; the trigger is "your last minion dies"',
  rune_ashen_payroll: 'combat-local — the Imps-summoned count ticks during the replay, not across turns',
  rune_blood_and_coin: 'combat-local — covered by runeCombatTally (the badge ticks during the replay)',
  rune_remains: 'combat-local — covered by runeCombatTally',
  q_umbral_energy: 'a multiplier ("+2/+2 for every Shop spell cast"), not a threshold',
  q_blueprint_cache: 'a multiplier ("for every Attachment they have"), not a threshold',
  q_the_old_hunt: 'fires on every Beast attack — no threshold to be part-way toward',
  q_feeding_line: 'fires on every Beast Slaughter',
  q_motherlode: 'the 2 is how many Kobolds a Ruby copies onto',
  rune_scales: 'fires on EVERY Shop spell; the digits are the +2/+2 grant',
  rune_profit_sharing: 'fires on EVERY Gold gain; the digits are the +3/+3 grant',
  rune_sellers_market: 'fires on EVERY sell; the digits are the +4/+3 grant, not a count-up',
  rune_vault: 'a one-shot latch (reach Tier 5) — the shop-tier gem IS the meter',
  rune_wheel: 'the refresh accrual already prints live on every shop offer via shopBuffOnRefresh',
  rune_flagship: 'fires on EVERY Shop spell; the digits are the +2/+2 grant',
  rune_brew: 'fires on EVERY Gold spend; the digits are the +4/+3 grant',
  rune_golden_splinter: 'a one-shot latch (reach 15 Gold) — the Gold counter IS the meter',
  rune_enchantment: 'fires on EVERY Shop spell; the digits are the +1/+1 grant and its combat +2/+2',
};

/** A run with every meter armed, so `questTally` has something to report for each quest under test. */
const armedRun = (): RunState => ({
  denMarker: { attack: 2, health: 2, step: 2, per: 3, count: 1 },
  foodForGold: { per: 7, attack: 1, health: 1 },
  foodForGoldTick: 4,
  shopBuffPerShouts: { per: 3, attack: 1, health: 1, tick: 2 },
  runeCrown: { per: 6, attack: 4, health: 4 }, // Rune of the Crown — spells cast toward its one-time step
  runeFoundry: { per: 5, sold: 2 },            // Rune of the Foundry — minions sold toward the next Dragon
  shopBuffOnRefresh: { attack: 5, health: 5, step: 1, per: 2, grown: 0, tick: 1 },
  questGoldTribeBuff: { tribe: 'dwarf', per: 5, attack: 3, health: 3, tick: 3 },
  questScalingAuras: [{ tribe: 'beast', per: 5, event: 'summon', stepAttack: 4, stepHealth: 4, progress: 2 }],
  runeSlayingKills: 4,
  questFlags: { runeSlaying: true },
  runeScale: { count: 3, attack: 3, health: 3, per: 5, tick: 2 },
  // Spellslinging and Summit keep their own meters outside `runeThresholds`; unarmed, they correctly report
  // nothing, so the sweep needs them armed or it reads their silence as a missing counter.
  spellDripPer: 5,
  spellDripTick: 3,
  runeSummitTick: 1,
  runeCollector: true,
  typesBoughtThisTurn: [],
  runeThresholds: [],
} as unknown as RunState);

describe('runes with a threshold show a tally', () => {
  const all = [...RUNES, ...EPIC_RUNES];

  it('the sweep actually sees the runes (guards against an empty instrument)', () => {
    expect(all.length).toBeGreaterThan(100);
    expect(all.filter((r) => THRESHOLD.test(r.text)).length).toBeGreaterThan(10);
  });

  it('no threshold rune is left without a counter', () => {
    const run = armedRun();
    const missing: string[] = [];
    for (const r of all) {
      if (!THRESHOLD.test(r.text) || NOT_A_METER[r.id]) continue;
      // A `runeThreshold` reward is metered generically off `runeThresholds`; the rest need a branch.
      if (r.reward.kind === 'runeThreshold') continue;
      if (!runeTally(run, r.id)) missing.push(`${r.id} — "${r.text.slice(0, 60)}"`);
    }
    expect(missing, 'add a branch to runeTally (or an entry to NOT_A_METER with the reason)').toEqual([]);
  });

  it('Rune of Slaying specifically — the reported case', () => {
    expect(runeTally(armedRun(), 'rune_slaying')).toBe('4/6');
  });

  it('Rune of Bulk Order counts Gold', () => {
    expect(runeTally(armedRun(), 'rune_scale')).toBe('2/5g');
  });

  it('a passive rune shows nothing rather than a meaningless 0/0', () => {
    expect(runeTally(armedRun(), 'rune_fury')).toBeNull();
  });
});

describe('completed quests whose REWARD is a threshold show a tally', () => {
  const rewardTextOf = (q: (typeof QUEST_DEFS)[number]) =>
    questRewardText(q.reward, { completed: true, shoutCharges: 0, repeatTurns: 0 });

  it('the sweep reads GENERATED reward text, not a field that does not exist', () => {
    // The bug this guards: `q.rewardText` is undefined on every quest, so a sweep reading it reports zero
    // findings and looks like a pass.
    expect(QUEST_DEFS.length).toBeGreaterThan(50);
    expect(rewardTextOf(QUEST_DEFS[0]!).length, 'reward text must be non-empty for the sweep to mean anything')
      .toBeGreaterThan(0);
    expect(QUEST_DEFS.filter((q) => THRESHOLD.test(rewardTextOf(q))).length).toBeGreaterThan(3);
  });

  it('no threshold quest is left without a counter', () => {
    const run = armedRun();
    const missing: string[] = [];
    for (const q of QUEST_DEFS) {
      if (!THRESHOLD.test(rewardTextOf(q)) || NOT_A_METER[q.id]) continue;
      if (!questTally(run, q.id)) missing.push(`${q.id} — "${rewardTextOf(q).slice(0, 60)}"`);
    }
    expect(missing, 'add a case to questTally (or an entry to NOT_A_METER with the reason)').toEqual([]);
  });

  it('each metered quest reports its own progress', () => {
    const run = armedRun();
    expect(questTally(run, 'q_food_for_gold')).toBe('4/7g');
    expect(questTally(run, 'q_banes_presence')).toBe('2/3');
    expect(questTally(run, 'q_golden_ledger')).toBe('3/5g');
    expect(questTally(run, 'q_den_marker')).toBe('1/3');
    expect(questTally(run, 'q_endless_inventory')).toBe('1/2');
    expect(questTally(run, 'q_pack_mentality')).toBe('2/5');
  });

  it('an unarmed meter shows nothing — a quest you have not completed has no tally', () => {
    const bare = { } as RunState;
    for (const id of ['q_food_for_gold', 'q_banes_presence', 'q_golden_ledger', 'q_den_marker',
      'q_endless_inventory', 'q_pack_mentality']) {
      expect(questTally(bare, id), `${id} invented a tally from an empty run`).toBeNull();
    }
  });

  it('a plain grant quest has no tally', () => {
    expect(questTally(armedRun(), 'q_forest_grove')).toBeNull();
  });
});

describe('rune AVENGE / combat-local meters have a combat tally (audit 2026-08-06)', () => {
  // The original THRESHOLD regex cannot see "**Avenge (3):**", which is how ten rune meters shipped with no
  // counter at all. This sweep closes the class: every rune whose text carries an Avenge cadence (or a
  // per-combat death/summon threshold) must either report through runeCombatTally or carry a documented
  // exemption below.
  const COMBAT_EXEMPT: Record<string, string> = {
    rune_counterpoint: 'Avenge (1) — fires on every death; a 1/1 meter is noise',
    rune_first_claws: 'Start of Combat, not a meter',
    rune_forthcoming: 'Start of Combat, not a meter',
  };
  it('every Avenge rune reports a live x/N during combat', () => {
    const avenge = [...RUNES, ...EPIC_RUNES].filter((r) => /Avenge \(\d+\)/.test(r.text));
    expect(avenge.length, 'the sweep must actually see the Avenge runes').toBeGreaterThanOrEqual(9);
    const missing = avenge
      .filter((r) => !COMBAT_EXEMPT[r.id])
      .filter((r) => runeCombatTally(r.id, 1, 1) === null)
      .map((r) => r.id);
    expect(missing, 'add the rune to RUNE_DEATHS_PER (or COMBAT_EXEMPT with the reason)').toEqual([]);
  });
  it('the tally mirrors the printed Avenge number', () => {
    for (const r of [...RUNES, ...EPIC_RUNES]) {
      const m = /Avenge \((\d+)\)/.exec(r.text);
      if (!m || COMBAT_EXEMPT[r.id]) continue;
      const per = Number(m[1]);
      expect(runeCombatTally(r.id, per, 0), `${r.id} full meter`).toBe(`${per}/${per}`);
    }
  });
});

describe('per-turn ACCUMULATOR runes show a live count (audit 2026-08-12)', () => {
  // The THRESHOLD regex above needs a NUMBER in the text, so "for every card you played this turn" — a meter
  // with no printed threshold — sailed past it, and Rune of the Lapidary shipped with no counter at all (the
  // owner's report). This sweep closes that class: every rune whose text banks "for every / for each / per …
  // this turn" must report a live count through runeTally, or carry a documented exemption.
  const ACCUMULATOR = /(?:for (?:every|each)|per)[^.]{0,45}this turn/i;
  const ACC_EXEMPT: Record<string, string> = {};
  it('every per-turn accumulator rune reports a live count', () => {
    // A run mid-turn with every accumulator armed and non-zero, so a wired tally must return non-null.
    const run = {
      runeLapidary: true,
      questRecurringEndOfTurn: ['runeAction', 'runeSpending'],
      playedThisTurn: ['a', 'b'],
      goldSpentThisTurn: 3,
    } as unknown as RunState;
    const acc = [...RUNES, ...EPIC_RUNES].filter((r) => ACCUMULATOR.test(r.text));
    expect(acc.length, 'the sweep must actually see the accumulator runes').toBeGreaterThanOrEqual(3);
    const missing = acc
      .filter((r) => !ACC_EXEMPT[r.id])
      .filter((r) => runeTally(run, r.id) === null)
      .map((r) => r.id);
    expect(missing, 'add the rune to runeTally (or ACC_EXEMPT with the reason)').toEqual([]);
  });
  it('the counts read the right meters', () => {
    const run = {
      runeLapidary: true,
      questRecurringEndOfTurn: ['runeAction', 'runeSpending'],
      playedThisTurn: ['a', 'b', 'c'],
      goldSpentThisTurn: 7,
    } as unknown as RunState;
    expect(runeTally(run, 'rune_lapidary')).toBe('3 cards');
    expect(runeTally(run, 'rune_action')).toBe('3 cards');
    expect(runeTally(run, 'rune_spending')).toBe('7g');
    // Un-armed → no badge (the rune isn't held).
    expect(runeTally({ playedThisTurn: ['a'] } as unknown as RunState, 'rune_lapidary')).toBeNull();
  });
});
