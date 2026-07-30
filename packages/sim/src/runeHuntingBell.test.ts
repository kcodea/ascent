import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type Keyword } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';

/**
 * Rune of the Hunting Bell — Avenge (3): fire your LEFT-MOST Rally without an attack.
 *
 * Shares `fireFreeRally` with Rune of Rallying (extracted 2026-07-30). That sharing is the point: the original
 * block had already been caught once missing its Rally-tally bump, and a hand-rolled second copy would drift
 * the same way. These tests pin both the effect AND the tally, which is the half that silently goes missing.
 */
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const byName = (n: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.name === n);
const sim = (p: BoardMinion[], e: BoardMinion[], mods = {}) =>
  simulate(p, e, makeRng(5), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods as never }), combatSide());

// A real Rally minion to be the bell-ringer, plus fodder whose deaths pace the Avenge.
const rallyCard = Object.values(CARD_INDEX).find((c) => c.keywords.includes('RL') && c.effects.some((e) => e.on === 'onAttack'))!;
const board = (fodder: number): BoardMinion[] => [
  { cardId: rallyCard.id, attack: 1, health: 400 },
  ...Array.from({ length: fodder }, () => ({ cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] as Keyword[] })),
];
const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
const rallyPulses = (mods: object, fodder = 6) =>
  sim(board(fodder), killer, mods).events.filter((e) => e.type === 'sc' && (e as { text?: string }).text === 'Rally').length;

describe('Rune of the Hunting Bell', () => {
  it('fires a free Rally once per 3 friendly deaths', () => {
    const base = rallyPulses({});
    const withBell = rallyPulses({ runeHuntingBell: true });
    expect(withBell, 'the bell never rang').toBeGreaterThan(base);
  });

  it('rings nothing when no minion can Rally', () => {
    const noRally: BoardMinion[] = [
      { cardId: 'sandbag', attack: 1, health: 400 },
      ...Array.from({ length: 6 }, () => ({ cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] as Keyword[] })),
    ];
    const pulses = sim(noRally, killer, { runeHuntingBell: true }).events
      .filter((e) => e.type === 'sc' && (e as { text?: string }).text === 'Rally').length;
    expect(pulses).toBe(0);
  });

  it('counts toward the Rally tally, like every other free rally', () => {
    // The half that goes missing when this logic is hand-copied: a free rally must still advance the Rally
    // quests. Compared against the same board without the rune so an attack-path rally cannot mask it.
    const withBell = sim(board(6), killer, { runeHuntingBell: true }).playerRallies ?? 0;
    const without = sim(board(6), killer, {}).playerRallies ?? 0;
    expect(withBell, 'the bell rang but never counted as a Rally').toBeGreaterThan(without);
  });
});

describe('Rune of Rallying still works after the extraction', () => {
  it('fires every rally-capable minion at Start of Combat, and counts them', () => {
    const r = sim(board(0), killer, { runeRallying: true });
    expect(r.events.filter((e) => e.type === 'sc' && (e as { text?: string }).text === 'Rally').length).toBeGreaterThan(0);
    expect(r.playerRallies ?? 0).toBeGreaterThan(0);
  });
});

describe('the rune data', () => {
  it('ships at 4 Gold, basic, unscoped', () => {
    const r = byName('Rune of the Hunting Bell')!;
    expect(r.cost).toBe(4);
    expect(!!r.epic).toBe(false);
    expect(r.sets).toBeUndefined(); // Rally exists in both sets
  });
});
