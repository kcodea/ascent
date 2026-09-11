import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * R-TARGET-02 (owner 2026-09-10) — the targeting vocabulary:
 *   "other" / "another" → only THIS body is excluded; a same-named copy is a legal target (uid).
 *   "different"         → no copy of the same-named card is eligible (card identity).
 *   A Discover triggered by playing a card never offers that card, with no printed qualifier.
 * One pin per shape, driven through the real reducer / simulator, so the two exclusion dialects cannot drift
 * without the text moving with them.
 */
const body = (uid: string, cardId: string, attack = 2, health = 2): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack, health, keywords: [...d.keywords], golden: false } as BoardCard;
};

describe('"other" — a same-named copy is a legal target (uid exclusion)', () => {
  it('Hank Pepe ("give 3 other Dwarves") buffs a SECOND Hank Pepe, never himself', () => {
    // Two Hank Pepes + one filler; playing a Dwarf fires both. With only two other Dwarves each, every recipient
    // is buffed — so the other Hank Pepe must be one of them, and the firing one never is.
    const s: RunState = {
      ...createRun(7), phase: 'recruit', setId: 'set3', shop: [],
      board: [body('hp1', 'dw3_hankpepe'), body('hp2', 'dw3_hankpepe'), body('f', 'dw_brunni')],
      hand: [body('p', 'dw_brunni')],
    } as RunState;
    const out = reduce(s, { type: 'play', uid: 'p', toIndex: 3 });
    const hp1 = out.board.find((c) => c.uid === 'hp1')!, hp2 = out.board.find((c) => c.uid === 'hp2')!;
    // Each Hank Pepe fired once; each received exactly the OTHER one's +1/+1 (uid exclusion, not card identity).
    expect([hp1.attack, hp1.health], 'hp1 got hp2\'s buff — a same-named copy is a legal target').toEqual([3, 3]);
    expect([hp2.attack, hp2.health], 'hp2 got hp1\'s buff').toEqual([3, 3]);
  });
});

describe('"different" — no copy of the same-named card (card-identity exclusion)', () => {
  it('Lieutenant Thane ("2 different friendly minions") never feeds a second Thane, across seeds', () => {
    const mine: BoardMinion[] = [
      { cardId: 'dw_thane', attack: 9, health: 50 }, { cardId: 'dw_thane', attack: 9, health: 50 },
      { cardId: 'sandbag', attack: 0, health: 50 }, { cardId: 'sandbag', attack: 0, health: 50 }, { cardId: 'sandbag', attack: 0, health: 50 },
    ];
    for (let seed = 1; seed <= 12; seed++) {
      const r = simulate(mine, [{ cardId: 'sandbag', attack: 1, health: 4000 }], makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
      const thanes = new Set(r.initial.player.filter((m) => m.cardId === 'dw_thane').map((m) => m.uid));
      const gifts = r.events.filter((e) => e.type === 'buff' && thanes.has((e as { target: string }).target));
      expect(gifts, `seed ${seed}: a Thane received Attack from the other Thane`).toEqual([]);
    }
    expect(CARD_INDEX['dw_thane']!.text).toContain('different');
  });

  it('Menagerie Mammoth ("3 random different Beasts") never summons a Mammoth, across seeds', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = simulate(
        [{ cardId: 'b2_mammoth', attack: 6, health: 1 }],
        [{ cardId: 'sandbag', attack: 60, health: 40000 }], makeRng(seed), CARD_INDEX,
        combatSide({ tier: 6, tribes: ['beast'] }), combatSide({ tier: 1 }));
      const summoned = r.events.filter((e) => e.type === 'summon' && (e as { side?: string }).side === 'player').map((e) => (e as { minion: { cardId: string } }).minion.cardId);
      expect(summoned.length, `seed ${seed}: at least the Mammoth's three (a summoned Beast may cascade its own Echo)`).toBeGreaterThanOrEqual(3);
      expect(summoned.includes('b2_mammoth'), `seed ${seed}: never a Mammoth`).toBe(false);
    }
    expect(CARD_INDEX['b2_mammoth']!.text).toContain('different');
  });
});

describe('Discover-on-play never offers the card itself — no qualifier printed (ruling 2026-09-10)', () => {
  it('Sea Urchin\'s Discover never lists a Sea Urchin, and its text carries neither "other" nor "different"', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const s: RunState = {
        ...createRun(seed), phase: 'recruit', setId: 'set1', tier: 6, shop: [], board: [],
        pool: { seaurchin: 5, raptor: 5, gryphon: 5, alley: 5, pack: 5 },
        hand: [body('u', 'seaurchin', 4, 4)],
      } as RunState;
      const out = reduce(s, { type: 'play', uid: 'u', toIndex: 0 });
      expect(out.discover, `seed ${seed}: the Discover opened`).toBeTruthy();
      expect(out.discover!.includes('seaurchin'), `seed ${seed}: offered itself`).toBe(false);
    }
    expect(/\b(other|another|different)\b/i.test(CARD_INDEX['seaurchin']!.text)).toBe(false);
  });
});
