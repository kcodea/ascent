import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNE_INDEX, RUNES } from '@game/content';

/**
 * Rune batch 8 — the two Shop carry-backs. Both key off friendly summons counted at the single placement
 * chokepoint, so a token, a Rise and a resummon each count exactly once.
 */
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const byName = (n: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.name === n);
const sim = (p: BoardMinion[], e: BoardMinion[], mods = {}) =>
  simulate(p, e, makeRng(5), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods as never }), combatSide());

/** A board whose Echo summons bodies, so the fight produces a known-ish number of friendly summons. */
const summoner = Object.values(CARD_INDEX).find((c) => c.effects.some((e) => e.on === 'onDeath' && e.do === 'deathrattleSummon'))!;
const board: BoardMinion[] = Array.from({ length: 4 }, () => ({ cardId: summoner.id, attack: 1, health: 1 }));
const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
const summonsIn = (r: ReturnType<typeof sim>) => r.events.filter((e) => e.type === 'summon' && e.side === 'player').length;

describe("Rune of the Remains — every 5 summons buffs the Shop", () => {
  it("pays per 5 summons, derived from the summons the fight produced", () => {
    const r = sim(board, killer, { runeRemains: 3 });
    const n = summonsIn(r);
    expect(n, 'the test board never summoned anything').toBeGreaterThan(0);
    expect(r.playerTavernBuyGain?.attack ?? 0, `${n} summons should pay ${Math.floor(n / 5) * 3}`)
      .toBe(Math.floor(n / 5) * 3);
  });

  it("pays nothing without the rune", () => {
    expect(sim(board, killer, {}).playerTavernBuyGain).toBeUndefined();
  });
});

describe("Rune of Reinvestment — one combined buff at settle", () => {
  it("scales with the number of friendly summons", () => {
    const r = sim(board, killer, { runeReinvestment: 1 });
    const n = summonsIn(r);
    expect(r.playerTavernBuyGain?.attack ?? 0, 'the Shop buff did not scale with summons').toBe(n);
  });

  it("stacks with the Remains rather than one replacing the other", () => {
    // Both write the same carry-back channel; a naive implementation could overwrite instead of add.
    const both = sim(board, killer, { runeReinvestment: 1, runeRemains: 3 });
    const n = summonsIn(both);
    expect(both.playerTavernBuyGain?.attack ?? 0).toBe(n + Math.floor(n / 5) * 3);
  });
});

describe("the two runes ship as specced", () => {
  // The Remains was ARCHIVED 2026-08-07 (owner) — out of both forge stocks, so it is deliberately absent from
  // the offerable lists `byName` searches. Its machinery is unchanged and still under test above, because a
  // saved run that already owns it keeps paying out; only the offer is gone.
  it("exist at the sheet costs, both basic", () => {
    for (const [name, cost] of [['Rune of Reinvestment', 5]] as [string, number][]) {
      const r = byName(name);
      expect(r, `${name} is missing`).toBeDefined();
      expect(r!.cost, `${name} cost`).toBe(cost);
      expect(!!r!.epic, `${name} should be basic`).toBe(false);
    }
    expect(byName('Rune of the Remains'), 'the Remains is archived — never offerable').toBeUndefined();
    expect(RUNE_INDEX['rune_remains'], 'but still resolvable for saved runs').toBeDefined();
  });

  it("Reinvestment is not set-scoped — summoning and the Shop exist in both sets", () => {
    expect(byName('Rune of Reinvestment')!.sets).toBeUndefined();
  });
});
