import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { createRun, reduce, type RunState } from './index';
import { applyEndOfTurn } from './recruit';

/** Owner balance pass 2026-08-15: Drunken Oaf +3/+3 per Ale, Kringle +1/+2 per card, Vaultkeeper counts the
 *  SPELL umbrella (Shop Spells + Rubies) rather than Shop Spells alone. */

describe('Drunken Oaf — +3/+3 per Ale (was +2/+2)', () => {
  it('the printed grant and the effect params both read 3', () => {
    const def = CARD_INDEX['dw_oaf'] ?? Object.values(CARD_INDEX).find((c) => c.name === 'Drunken Oaf')!;
    const eff = def.effects.find((e) => e.do === 'scBuffRandomTribePerAle')!;
    expect(eff.params).toMatchObject({ attack: 3, health: 3 });
    expect(def.text).toContain('+3/+3');
    expect(def.goldenText).toContain('+6/+6'); // golden doubles
  });

  it('a Dwarf gains 3 per Ale cast this turn', () => {
    const oaf = Object.values(CARD_INDEX).find((c) => c.name === 'Drunken Oaf')!;
    const p: BoardMinion[] = [
      { cardId: oaf.id, attack: 4, health: 40 },
      { cardId: 'dw_brunni', attack: 2, health: 40 },
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 60 }];
    const r = simulate(p, e, makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['dwarf'], alesLastTurn: 2 }), combatSide({ tier: 1 }));
    // The base grant plus one REPEAT per Ale (`reps = 1 + ales`), each now worth +3/+3.
    const grants = r.events.filter((ev) => ev.type === 'buff' && ev.attack === 3 && ev.health === 3);
    expect(grants.length, 'base + one repeat per Ale, all at +3/+3').toBe(3);
  });
});

describe('Kringle — +1/+2 per card played (was +1/+1)', () => {
  it('the printed grant and params read 1/2', () => {
    const def = Object.values(CARD_INDEX).find((c) => c.name === 'Kringle')!;
    const eff = def.effects.find((e) => e.do === 'endOfTurnBuffEndsTribePerCard')!;
    expect(eff.params).toMatchObject({ attack: 1, health: 2 });
    expect(def.text).toContain('+1/+2');
    expect(def.goldenText).toContain('+2/+4');
  });

  it('the left-most Dwarf gains 1/2 once, then once more per card played this turn (the REPEAT form, owner 2026-09-22)', () => {
    const kringle = Object.values(CARD_INDEX).find((c) => c.name === 'Kringle')!;
    const s: RunState = {
      ...createRun(5), phase: 'recruit', playedThisTurn: ['a', 'b'], // 2 cards played → base + 2 repeats = 3 ticks
      board: [
        { uid: 'd1', cardId: 'dw_brunni', tribe: 'dwarf', attack: 2, health: 2, keywords: [], golden: false },
        { uid: 'k', cardId: kringle.id, tribe: 'dwarf', attack: 3, health: 7, keywords: [], golden: false },
      ],
    } as RunState;
    const before = { a: s.board[0]!.attack, h: s.board[0]!.health };
    applyEndOfTurn(s);
    const left = s.board.find((c) => c.uid === 'd1')!;
    expect(left.attack - before.a, '+1 Attack × (1 base + 2 repeats)').toBe(3);
    expect(left.health - before.h, '+2 Health × (1 base + 2 repeats)').toBe(6);
  });
});

// RETIRED 2026-10-10: Vaultkeeper no longer scales with spells (owner balance batch replaced the effect with "When this
// gains Attack, give adjacent Dragons +3/+4"); the new card is pinned in dragonBatch1010.test.ts.
