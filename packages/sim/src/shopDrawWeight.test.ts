import { describe, it, expect } from 'vitest';
import { makeRng } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, type RunState } from './index';
import { drawOfferId, rollShop } from './shop';

/**
 * THE SHOP DRAW IS WEIGHTED BY COPIES LEFT (owner ruling 2026-09-10): "the number of copies should directly impact
 * how likely a card is to be found." Before this the draw was uniform BY CARD IDENTITY while any copy remained —
 * a last copy was exactly as likely as a full stack until it hit zero (a cliff, not a gradual shift).
 */
describe('the shop draw weights each card by the copies left in the shared pool', () => {
  const defs = [CARD_INDEX['alley']!, CARD_INDEX['stray']!, CARD_INDEX['sandbag']!];

  it('one copy left is one ticket; fifteen left is fifteen; zero is never drawn', () => {
    const stock = { alley: 15, stray: 1, sandbag: 0 };
    const counts: Record<string, number> = { alley: 0, stray: 0, sandbag: 0 };
    const rng = makeRng(11);
    const N = 6000;
    for (let i = 0; i < N; i++) counts[drawOfferId(rng, defs, null, stock)!]! += 1;
    expect(counts.sandbag, 'no copies → never offered').toBe(0);
    const strayShare = counts.stray! / N;
    expect(strayShare, 'a single copy among sixteen tickets').toBeGreaterThan(1 / 16 - 0.02);
    expect(strayShare).toBeLessThan(1 / 16 + 0.02);
  });

  it('is deterministic for a seed, and a Practice tribe surge doubles that tribe\'s tickets', () => {
    const stock = { alley: 4, stray: 4, sandbag: 4 };
    const a = drawOfferId(makeRng(5), defs, null, stock);
    const b = drawOfferId(makeRng(5), defs, null, stock);
    expect(a).toBe(b);
    // Under a Beast surge every Beast holds twice its copies in tickets; the expectation is computed from the
    // real tribes so the assertion cannot drift with a retribe.
    const counts: Record<string, number> = { alley: 0, stray: 0, sandbag: 0 };
    const rng = makeRng(3);
    const N = 6000;
    for (let i = 0; i < N; i++) counts[drawOfferId(rng, defs, 'beast', stock)!]! += 1;
    const w = (id: string): number => 4 * (CARD_INDEX[id]!.tribe === 'beast' ? 2 : 1);
    const total = defs.reduce((n, d) => n + w(d.id), 0);
    expect(defs.some((d) => d.tribe === 'beast') && defs.some((d) => d.tribe !== 'beast'), 'the fixture needs both a Beast and a non-Beast').toBe(true);
    for (const d of defs) {
      const share = counts[d.id]! / N;
      expect(share, d.id).toBeGreaterThan(w(d.id) / total - 0.03);
      expect(share, d.id).toBeLessThan(w(d.id) / total + 0.03);
    }
  });

  it('end to end: a card down to its last copy appears far less often than a full stack across seeds', () => {
    // Two tier-1 cards the run can actually stock (its own tribes + neutral): drain one to a single copy, leave
    // the other full. Every seed below rolls the SAME tribe set, so both stay eligible.
    const base = createRun(1);
    const buyable = poolFor(base.setId ?? 'set3').buyable.filter((c) => c.tier === 1 && (c.tribe === 'neutral' || base.tribes.includes(c.tribe)) && (base.pool[c.id] ?? 0) > 1);
    expect(buyable.length, 'the test needs two stocked tier-1 cards').toBeGreaterThanOrEqual(2);
    const [full, last] = [buyable[0]!, buyable[1]!];
    let seenFull = 0, seenLast = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const s: RunState = { ...createRun(seed), tribes: base.tribes, pool: { ...base.pool, [last.id]: 1 }, shop: [], spell: null } as RunState;
      rollShop(s);
      if (s.shop.some((o) => o.cardId === full.id)) seenFull += 1;
      if (s.shop.some((o) => o.cardId === last.id)) seenLast += 1;
    }
    expect(seenFull, 'the full stack shows up').toBeGreaterThan(0);
    expect(seenLast, 'the last copy is far rarer than a full stack').toBeLessThan(seenFull / 4);
  });
});
