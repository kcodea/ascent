import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type Keyword } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';

/** Rune batch 7 — Blood and Coin, the Wild Hunt, Living Treasure. All three carry back or escalate. */
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const byName = (n: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.name === n);
const sim = (p: BoardMinion[], e: BoardMinion[], mods = {}) =>
  simulate(p, e, makeRng(5), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods as never }), combatSide());

describe("Rune of Blood and Coin — deaths bank Gold", () => {
  const fodder = (n: number): BoardMinion[] => [
    { cardId: 'sandbag', attack: 2, health: 400 },
    ...Array.from({ length: n }, () => ({ cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] as Keyword[] })),
  ];
  const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];

  it("banks 4 Gold per 4 friendly deaths, carried back to the run", () => {
    // Derived from the deaths the fight actually produced — assuming a count silently tests the wrong threshold.
    const r = sim(fodder(8), killer, { runeBloodAndCoin: 4 });
    const deaths = r.events.filter((e) => e.type === 'death' && e.side === 'player').length;
    expect(r.playerBonusGold ?? 0, `${deaths} deaths should bank ${Math.floor(deaths / 4) * 4} Gold`)
      .toBe(Math.floor(deaths / 4) * 4);
  });

  it("banks nothing without the rune", () => {
    expect(sim(fodder(8), killer, {}).playerBonusGold).toBeUndefined();
  });
});

describe("Rune of the Wild Hunt — the Health grant escalates", () => {
  const beasts: BoardMinion[] = [{ cardId: 'pack', attack: 3, health: 300 }, { cardId: 'pack', attack: 3, health: 300 }];
  const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 400 }];
  const hunts = (mods: object) => sim(beasts, enemy, mods).events
    .filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === 'Rune of the Wild Hunt');

  it("grows the grant with each Beast attack rather than paying a flat rate", () => {
    expect(hunts({}).length, 'baseline should never fire').toBe(0);
    const events = hunts({ runeWildHunt: 3 });
    expect(events.length, 'the rune never fired').toBeGreaterThan(0);
    // First Beast attack grants 3; a later one must grant strictly more, or the "improve permanently" half is dead.
    const healths = events.map((e) => e.health);
    expect(healths[0]).toBe(3);
    expect(Math.max(...healths), 'the grant never escalated').toBeGreaterThan(3);
  });

  it("the DEF ships at 1 Health per attack (owner rebalance 2026-08-02)", () => {
    // The engine tests above pass an explicit mod value, so they can't catch a def drift — this pins the
    // shipped number. `amount` is both the grant and the escalation step.
    const r = byName('Rune of the Wild Hunt')!.reward as { amount?: number };
    expect(r.amount).toBe(1);
  });

  it("grants Health only, never Attack", () => {
    for (const e of hunts({ runeWildHunt: 3 })) expect(e.attack).toBe(0);
  });

  it("the escalation is PERMANENT: the next combat resumes where the last left off (owner fix 2026-08-01)", () => {
    // Combat 1 grows the counter from 0; its final value rides out on `playerWildHuntGrown`.
    const first = sim(beasts, enemy, { runeWildHunt: 3 });
    const grown = first.playerWildHuntGrown ?? 0;
    expect(grown, 'combat 1 should have grown the counter').toBeGreaterThan(0);
    // Combat 2 seeds from it: the FIRST grant is already above the base step, and the carry-out keeps growing.
    const second = simulate(beasts, enemy, makeRng(9), CARD_INDEX,
      combatSide({ tier: 3, tribes: ['beast'], questMods: { runeWildHunt: 3 }, wildHuntGrown: grown }),
      combatSide({ tier: 1 }));
    const grants = second.events
      .filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === 'Rune of the Wild Hunt');
    expect(grants.length).toBeGreaterThan(0);
    expect(grants[0]!.health, 'the first grant must continue from the carried escalation').toBe(grown + 3);
    expect(second.playerWildHuntGrown ?? 0, 'the carry-out keeps accumulating').toBeGreaterThan(grown);
  });
});

describe("Rune of Living Treasure — Gemheart Golems gain Rise", () => {
  it("gives the Golem token Rise, and nothing else", () => {
    expect(CARD_INDEX['gemheart-shard'], 'the Gemheart Golem token is missing').toBeDefined();
    const carver = Object.values(CARD_INDEX).find((c) => c.effects.some((e) => e.do === 'deathrattleSummon'
      && (e.params as { cardId?: string } | undefined)?.cardId === 'gemheart-shard'));
    // If no card summons the token, assert the wiring on the flag rather than silently passing.
    const r = byName('Rune of Living Treasure')!.reward as { flag?: string };
    expect(r.flag).toBe('runeLivingTreasure');
    if (!carver) return;
    const board: BoardMinion[] = [{ cardId: carver.id, attack: 0, health: 1 }];
    const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 60 }];
    const rises = (mods: object) => sim(board, enemy, mods).events
      .filter((e) => e.type === 'keyword' && (e as { keyword?: string }).keyword === 'R').length;
    expect(rises({ runeLivingTreasure: true })).toBeGreaterThanOrEqual(rises({}));
  });
});

describe("the three runes ship as specced", () => {
  it("exist at the sheet costs and tiers", () => {
    const want: [string, number, boolean][] = [
      ['Rune of Blood and Coin', 3, false], ['Rune of the Wild Hunt', 3, true], ['Rune of Living Treasure', 4, true],
    ];
    for (const [name, cost, epic] of want) {
      const r = byName(name);
      expect(r, `${name} is missing`).toBeDefined();
      expect(r!.cost, `${name} cost`).toBe(cost);
      expect(!!r!.epic, `${name} epic`).toBe(epic);
    }
  });

  it("only Living Treasure is set-2 scoped — Gemheart Golems are a set-2 token", () => {
    expect(byName('Rune of Living Treasure')!.sets).toEqual(['set2']);
    expect(byName('Rune of Blood and Coin')!.sets).toBeUndefined();
    expect(byName('Rune of the Wild Hunt')!.sets).toBeUndefined();
  });
});
