import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * R-TARGET-GREVLIN-01 (owner bug fix 2026-10-22): "grevlin & co shouldnt be him consuming 100% of the time, it
 * should be a random friendly demon. (himself included)". Every 3rd sale, ONE random friendly Demon (Grevlin in
 * the pool, All-types count) eats the right-most Shop minion and takes the gains + the consume record.
 */
const body = (cardId: string, uid: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};

/** Grevlin + `others` + three Sandbags to sell; a two-minion Shop. Sells all three and returns the state. */
function sellThree(seed: number, others: BoardCard[], golden = false): RunState {
  let s = {
    ...createRun(seed), phase: 'recruit', embers: 40,
    board: [body('dm_grevlin', 'grv', { golden }), ...others, body('sandbag', 'f1'), body('sandbag', 'f2'), body('sandbag', 'f3')],
    hand: [], shop: [{ uid: 's0', cardId: 'sandbag' }, { uid: 's1', cardId: 'stray' }],
  } as RunState;
  for (const uid of ['f1', 'f2', 'f3']) s = reduce(s, { type: 'sell', uid });
  return s;
}
const eaters = (s: RunState) => (s.shopEaten ?? []).map((e) => e.eaterUid);

describe('Grevlin & Co.: a random friendly Demon consumes (owner 2026-10-22)', () => {
  it('over many seeds, another Demon eats sometimes and Grevlin eats sometimes', () => {
    const counts: Record<string, number> = {};
    for (let seed = 1; seed <= 60; seed++) {
      const s = sellThree(seed, [body('dm_hungerling', 'dh')]);
      const e = eaters(s);
      expect(e, 'exactly one bite').toHaveLength(1);
      expect(s.shop.map((o) => o.uid), 'the right-most offer was eaten').toEqual(['s0']);
      counts[e[0]!] = (counts[e[0]!] ?? 0) + 1;
    }
    expect(counts.dh ?? 0, 'the other Demon gets picked').toBeGreaterThan(10);
    expect(counts.grv ?? 0, 'Grevlin is in the pool too').toBeGreaterThan(10);
    expect(Object.keys(counts).sort(), 'only Demons eat (Sandbags never)').toEqual(['dh', 'grv']);
  });

  it('the gains land on the chosen eater, not on Grevlin', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = sellThree(seed, [body('dm_hungerling', 'dh')]);
      if (eaters(s)[0] !== 'dh') continue;
      const dh = s.board.find((c) => c.uid === 'dh')!;
      const grv = s.board.find((c) => c.uid === 'grv')!;
      expect(dh.attack, 'Demon Horse grew').toBeGreaterThan(CARD_INDEX.dm_hungerling!.attack);
      expect(grv.attack, 'Grevlin did not').toBe(CARD_INDEX.dm_grevlin!.attack);
      return;
    }
    throw new Error('no seed picked the other Demon');
  });

  it('All-types bodies count as Demons', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) seen.add(eaters(sellThree(seed, [body('sandbag', 'at', { allTribes: true })]))[0]!);
    expect(seen.has('at'), 'an All-types body can be the eater').toBe(true);
  });

  it('with no other Demon, Grevlin eats, and no RNG draw is spent', () => {
    for (let seed = 1; seed <= 10; seed++) {
      let s = {
        ...createRun(seed), phase: 'recruit', embers: 40,
        board: [body('dm_grevlin', 'grv'), body('sandbag', 'f1'), body('sandbag', 'f2'), body('sandbag', 'f3')],
        hand: [], shop: [{ uid: 's0', cardId: 'sandbag' }, { uid: 's1', cardId: 'stray' }],
      } as RunState;
      for (const uid of ['f1', 'f2']) s = reduce(s, { type: 'sell', uid });
      const cursor = s.rngCursor;
      s = reduce(s, { type: 'sell', uid: 'f3' });
      expect(eaters(s)).toEqual(['grv']);
      expect(s.rngCursor, 'a pool of one draws nothing').toBe(cursor);
    }
  });

  it('is deterministic: the same seed picks the same eater', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const a = sellThree(seed, [body('dm_hungerling', 'dh'), body('dm_hungerling', 'dh2')]);
      const b = sellThree(seed, [body('dm_hungerling', 'dh'), body('dm_hungerling', 'dh2')]);
      expect(eaters(a)).toEqual(eaters(b));
      expect(a.rngCursor).toBe(b.rngCursor);
    }
  });

  it('Gilded: two bites, each its own random pick', () => {
    let mixed = false;
    for (let seed = 1; seed <= 60; seed++) {
      const s = sellThree(seed, [body('dm_hungerling', 'dh')], true);
      const e = eaters(s);
      expect(e, 'two bites').toHaveLength(2);
      expect(s.shop, 'both offers eaten').toHaveLength(0);
      if (e[0] !== e[1]) mixed = true;
    }
    expect(mixed, 'the two bites can go to different Demons').toBe(true);
  });
});
