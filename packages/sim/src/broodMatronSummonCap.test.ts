import { describe, it, expect } from 'vitest';
import { combatSide, simulate, makeRng, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';

/**
 * R-BROOD-01 (owner 2026-11-22: "lets fix brood matron to be max of 3 summons per round"). One Brood Matron summons at
 * most 3 Imps per combat (gilded: 6). Only the summon is capped: every Avenge (2) still gives your Imps +1/+1 this
 * game. The count lives on the body, so a second Brood Matron has its own 3, and a body that returns through Rebirth
 * starts fresh (R-RETURN-RESET-01).
 *
 * The boards are built so the cap is the only thing that can stop the Imps: the Matron never dies (huge Health, no
 * Attack), the enemy never dies, and every Imp that dies feeds the next Avenge.
 */
const bm = (cardId: string, uid: string, attack = 0, health = 400, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...over } as BoardMinion);
const KILLER = (): BoardMinion[] => [bm('omen', 'O', 100, 10_000_000, { keywords: [] })];
const fodder = (n: number): BoardMinion[] => Array.from({ length: n }, (_, i) => bm('sandbag', `s${i}`, 0, 1));
const fight = (p: BoardMinion[], seed = 1) => simulate(p, KILLER(), makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
type Sim = ReturnType<typeof simulate>;
const uidOf = (r: Sim, sourceUid: string): string => r.initial.player.find((m) => (m as { sourceUid?: string }).sourceUid === sourceUid)?.uid ?? r.initial.player[0]!.uid;
const impsBy = (r: Sim, uid: string): number =>
  r.events.filter((e) => e.type === 'summon' && e.minion.cardId === 'impscrap' && e.source === uid).length;
const friendlyDeaths = (r: Sim): number => {
  const mine = new Set(r.initial.player.map((m) => m.uid));
  for (const e of r.events) if (e.type === 'summon' && e.side === 'player') mine.add(e.minion.uid);
  return r.events.filter((e) => e.type === 'death' && mine.has(e.target)).length;
};
const SEEDS = [1, 2, 3, 7, 11];

describe('R-BROOD-01: Brood Matron summons at most 3 Imps per combat', () => {
  it('the card declares the cap and prints it', () => {
    const c = CARD_INDEX['brood']!;
    expect(c.effects.find((e) => e.do === 'avengeBuffImps')?.params).toMatchObject({ count: 2, summon: 1, max: 3 });
    expect(c.text).toContain('(Max 3 Imps per combat.)');
    expect(c.goldenText).toContain('(Max 6 Imps per combat.)');
  });

  it('plain: exactly 3 Imps, however many friends die', () => {
    for (const seed of SEEDS) {
      const r = fight([bm('brood', 'B', 0, 5_000_000), ...fodder(6)], seed);
      const deaths = friendlyDeaths(r);
      expect(deaths, `seed ${seed}: enough deaths for more than 3 Avenges`).toBeGreaterThanOrEqual(8);
      expect(impsBy(r, uidOf(r, 'B')), `seed ${seed}`).toBe(3);
    }
  });

  it('only the summon is capped: the +1/+1 keeps paying on every Avenge', () => {
    for (const seed of SEEDS) {
      const r = fight([bm('brood', 'B', 0, 5_000_000), ...fodder(6)], seed);
      const avenges = Math.floor(friendlyDeaths(r) / 2);
      expect(avenges, `seed ${seed}`).toBeGreaterThan(3);
      expect(r.playerImpBuffGain, `seed ${seed}`).toEqual({ attack: avenges, health: avenges });
    }
  });

  it('gilded: exactly 6 Imps (2 per Avenge, 3 Avenges), and +2/+2 on every Avenge', () => {
    for (const seed of SEEDS) {
      const r = fight([bm('brood', 'B', 0, 5_000_000, { golden: true }), ...fodder(6)], seed);
      const avenges = Math.floor(friendlyDeaths(r) / 2);
      expect(avenges, `seed ${seed}`).toBeGreaterThan(3);
      expect(impsBy(r, uidOf(r, 'B')), `seed ${seed}`).toBe(6);
      expect(r.playerImpBuffGain, `seed ${seed}`).toEqual({ attack: 2 * avenges, health: 2 * avenges });
    }
  });

  it('the cap is per Brood Matron: two of them summon 3 each', () => {
    const r = fight([bm('brood', 'B1', 0, 5_000_000), bm('brood', 'B2', 0, 5_000_000), ...fodder(5)]);
    expect(impsBy(r, uidOf(r, 'B1'))).toBe(3);
    expect(impsBy(r, uidOf(r, 'B2'))).toBe(3);
  });

  it('a Brood Matron that returns through Rebirth starts a fresh 3', () => {
    // Taunt + 250 Health: the Matron shares the enemy's hits with the Taunt fodder and dies on its third, so on some
    // seeds the first life has already spent its 3 Imps and friends are still left to die after the return.
    let seen = false;
    for (let seed = 1; seed <= 40 && !seen; seed++) {
      const r = fight([bm('brood', 'B', 0, 250, { keywords: ['T', 'RB'] }), ...fodder(6)], seed);
      const uid = uidOf(r, 'B');
      const back = r.events.findIndex((e) => e.type === 'reborn' && e.target === uid);
      if (back < 0) continue;
      const before = r.events.slice(0, back).filter((e) => e.type === 'summon' && e.minion.cardId === 'impscrap' && e.source === uid).length;
      const after = r.events.slice(back).filter((e) => e.type === 'summon' && e.minion.cardId === 'impscrap' && e.source === uid).length;
      expect(before, `seed ${seed}: first life`).toBeLessThanOrEqual(3);
      expect(after, `seed ${seed}: second life`).toBeLessThanOrEqual(3);
      if (before === 3 && after > 0) seen = true;
    }
    expect(seen, 'some seed spends the first 3 and summons again after the return').toBe(true);
  });
});
