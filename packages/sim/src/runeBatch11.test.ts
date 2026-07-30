import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';

/** Rune batch 11 — the Food Chain and Attacking Gems. */
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const byName = (n: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.name === n);
const sim = (p: BoardMinion[], e: BoardMinion[], mods = {}, rubyBonus?: { attack: number; health: number }) =>
  simulate(p, e, makeRng(5), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods as never, rubyBonus }), combatSide());
const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];

describe('Rune of the Food Chain', () => {
  const demon = Object.values(CARD_INDEX).find((c) => c.tribe === 'demon' && !c.spell && !c.token)!;
  const summoner = Object.values(CARD_INDEX).find((c) => c.effects.some((e) => e.on === 'onDeath' && e.do === 'deathrattleSummon'))!;
  // A fat Demon to donate stats, and a dying body whose Echo produces the first summon.
  const board: BoardMinion[] = [
    { cardId: demon.id, attack: 20, health: 30 },
    { cardId: summoner.id, attack: 0, health: 1 },
  ];
  const firstSummon = (mods: object) => {
    const ev = sim(board, killer, mods).events.find((e) => e.type === 'summon' && e.side === 'player');
    return ev && 'minion' in ev ? ev.minion : undefined;
  };

  it("the first summon inherits the left-most Demon's stats", () => {
    const base = firstSummon({});
    const fed = firstSummon({ runeFoodChain: true });
    expect(base, 'the test board never summoned anything').toBeDefined();
    expect(fed!.attack, 'the summon did not inherit Attack').toBe(base!.attack + 20);
    expect(fed!.health).toBe(base!.health + 30);
  });

  it('only the FIRST summon is fed', () => {
    // Two dying summoners: the second body must come in at its base stats.
    const two: BoardMinion[] = [
      { cardId: demon.id, attack: 20, health: 30 },
      { cardId: summoner.id, attack: 0, health: 1 },
      { cardId: summoner.id, attack: 0, health: 1 },
    ];
    const summons = sim(two, killer, { runeFoodChain: true }).events
      .filter((e): e is Extract<CombatEvent, { type: 'summon' }> => e.type === 'summon' && e.side === 'player');
    expect(summons.length, 'need at least two summons for this test to mean anything').toBeGreaterThanOrEqual(2);
    expect(summons[0]!.minion.attack).toBeGreaterThan(summons[1]!.minion.attack);
  });

  it('does nothing with no Demon on board', () => {
    const noDemon: BoardMinion[] = [{ cardId: summoner.id, attack: 0, health: 1 }];
    const withRune = sim(noDemon, killer, { runeFoodChain: true }).events.find((e) => e.type === 'summon' && e.side === 'player');
    const without = sim(noDemon, killer, {}).events.find((e) => e.type === 'summon' && e.side === 'player');
    const atk = (e: CombatEvent | undefined) => (e && 'minion' in e ? e.minion.attack : -1);
    expect(atk(withRune)).toBe(atk(without));
  });
});

describe('Rune of Attacking Gems', () => {
  const board: BoardMinion[] = [
    { cardId: 'sandbag', attack: 3, health: 300 },
    { cardId: 'sandbag', attack: 1, health: 300 },
  ];
  const gemBuffs = (mods: object, rb?: { attack: number; health: number }) =>
    sim(board, killer, mods, rb).events
      .filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === 'Rune of Attacking Gems');

  it('plays a Ruby on the whole board on every friendly attack', () => {
    expect(gemBuffs({}).length, 'baseline should never fire').toBe(0);
    const buffs = gemBuffs({ runeAttackingGems: 1 });
    expect(buffs.length, 'the rune never fired').toBeGreaterThan(0);
    // Both bodies are buffed each time, so distinct targets > 1.
    expect(new Set(buffs.map((b) => b.target)).size).toBeGreaterThan(1);
  });

  it("scales with the run's Ruby strength", () => {
    // A flat 1/1 would ignore rubyBonus entirely — the same trap Gemstorm had.
    const plain = gemBuffs({ runeAttackingGems: 1 })[0]!;
    const strong = gemBuffs({ runeAttackingGems: 1 }, { attack: 4, health: 4 })[0]!;
    expect(plain.attack).toBe(1);
    expect(strong.attack).toBe(5);
  });
});

describe('the two runes ship as specced', () => {
  it('exist at the sheet costs, both epic', () => {
    for (const [name, cost] of [['Rune of the Food Chain', 5], ['Rune of Attacking Gems', 4]] as [string, number][]) {
      const r = byName(name);
      expect(r, `${name} is missing`).toBeDefined();
      expect(r!.cost).toBe(cost);
      expect(!!r!.epic).toBe(true);
    }
  });

  it('only Attacking Gems is set-2 scoped — Rubies are a set-2 mechanic', () => {
    expect(byName('Rune of Attacking Gems')!.sets).toEqual(['set2']);
    expect(byName('Rune of the Food Chain')!.sets).toBeUndefined();
  });
});
