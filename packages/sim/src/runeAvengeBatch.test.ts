import { describe, it, expect } from 'vitest';
import { ALE_IDS, combatSide, makeRng, simulate, type BoardMinion, type Keyword } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';

/**
 * Rune batch 5 — the Avenge runes. All three register through the existing `runeAvenge` helper, which owns the
 * modulo, the per-side mask and the Rune of Fury re-fire. Each test drives a REAL combat with enough friendly
 * deaths to cross the threshold, and compares against the same board without the rune.
 */
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const byName = (n: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.name === n);
const sim = (p: BoardMinion[], e: BoardMinion[], mods = {}) =>
  simulate(p, e, makeRng(5), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods as never }), combatSide());
/** A board that loses N cheap bodies, with one survivor to keep the fight going. */
const fodder = (n: number): BoardMinion[] => [
  { cardId: 'sandbag', attack: 2, health: 200 },
  ...Array.from({ length: n }, () => ({ cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] as Keyword[] })),
];
const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];

describe('Rune of Last Call — Avenge (4): 2 Ales to hand (owner rework 2026-08-11)', () => {
  it('grants 2 Ales per 4 friendly deaths', () => {
    // Derived from the deaths the fight ACTUALLY produced rather than the board size — the back-line body is
    // not guaranteed to survive, and an assumed death count silently tests the wrong threshold. Each Avenge(4)
    // proc now pays TWO random Ales (was one at Avenge 3).
    let sawAProc = false;
    for (const n of [4, 7, 9]) {
      const r = sim(fodder(n), killer, { runeLastCall: true });
      const deaths = r.events.filter((e) => e.type === 'death' && e.side === 'player').length;
      const granted = (r.playerHandGrants ?? []).filter((g) => ALE_IDS.includes(g)).length;
      const procs = Math.floor(deaths / 4);
      if (procs > 0) sawAProc = true;
      expect(granted, `${deaths} friendly deaths should pay ${procs * 2} Ales`).toBe(procs * 2);
    }
    expect(sawAProc, 'no fixture crossed the Avenge(4) threshold — vacuous').toBe(true);
  });

  it('grants nothing without the rune', () => {
    const g = (sim(fodder(6), killer, {}).playerHandGrants ?? []).filter((x) => ALE_IDS.includes(x));
    expect(g.length).toBe(0);
  });
});

describe('Rune of the Cinder Ledger — Avenge (3): improve your Imps', () => {
  it('carries the Imp buff back to the run', () => {
    // `playerImpBuffGain` is the carry-back channel; a combat-only buff would vanish at settle and the rune
    // would read as "improve your Imps" while improving nothing that lasts.
    const withRune = sim(fodder(3), killer, { runeCinderLedger: 6 });
    const without = sim(fodder(3), killer, {});
    expect(without.playerImpBuffGain).toBeUndefined();
    expect(withRune.playerImpBuffGain, 'no Imp buff was carried back').toEqual({ attack: 6, health: 6 });
  });

  it('scales with the number of thresholds crossed', () => {
    expect(sim(fodder(6), killer, { runeCinderLedger: 6 }).playerImpBuffGain).toEqual({ attack: 12, health: 12 });
  });
});

describe('Rune of the Procession — Avenge (4): double your right-most', () => {
  it('doubles a LIVING right-most body', () => {
    // Doubling a corpse would read as the rune doing nothing. The survivor sits left of the fodder, so the
    // right-most living body at trigger time is a real target.
    const board: BoardMinion[] = [
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] as Keyword[] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] as Keyword[] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] as Keyword[] },
      { cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] as Keyword[] },
      { cardId: 'sandbag', attack: 5, health: 300 },
    ];
    const buffs = (mods: object) => sim(board, killer, mods).events
      .filter((e) => e.type === 'buff' && e.source === 'Rune of the Procession').length;
    expect(buffs({}), 'baseline should never fire the rune').toBe(0);
    expect(buffs({ runeProcession: true }), 'the rune never doubled anything').toBeGreaterThan(0);
  });
});

describe('the three runes ship as specced', () => {
  it("exist at the sheet's costs and tiers", () => {
    const want: [string, number, boolean][] = [
      ['Rune of Last Call', 2, false], ['Rune of the Cinder Ledger', 3, true], ['Rune of the Procession', 3, true],
    ];
    for (const [name, cost, epic] of want) {
      const r = byName(name);
      expect(r, `${name} is missing`).toBeDefined();
      expect(r!.cost, `${name} cost`).toBe(cost);
      expect(!!r!.epic, `${name} epic`).toBe(epic);
    }
  });

  it('only Last Call is set-2 scoped — the other two use set-1 mechanics too', () => {
    expect(byName('Rune of Last Call')!.sets).toEqual(['set2']); // Ales
    expect(byName('Rune of the Cinder Ledger')!.sets).toBeUndefined(); // Imps exist in both sets
    expect(byName('Rune of the Procession')!.sets).toBeUndefined();
  });
});
