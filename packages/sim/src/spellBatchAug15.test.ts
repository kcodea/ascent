import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from './index';

/** Owner spell batch 2026-08-15 — the shop-side tranche (Blessing / Beefy / Gamble). */

// DISTINCT cardIds on purpose: three copies of one card would complete a TRIPLE and be consumed mid-test.
const minion = (uid: string, cardId = 'stray'): never =>
  ({ uid, cardId, tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }) as never;

describe('Blessing — +5/+6 to a minion', () => {
  it('is a T4 2-Gold targeted spell granting 5/6', () => {
    const def = CARD_INDEX['sp_blessing']!;
    expect([def.tier, def.cost, def.spell, def.target]).toEqual([4, 2, true, 'any']);
    expect(def.effects[0]!.params).toMatchObject({ attack: 5, health: 6 });
  });

  it('lands the grant on the chosen minion', () => {
    const s: RunState = {
      ...createRun(5), phase: 'recruit', embers: 10, board: [minion('m1')],
      hand: [{ uid: 'sp', cardId: 'sp_blessing', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    } as RunState;
    const after = reduce(s, { type: 'play', uid: 'sp', targetUid: 'm1' } as never);
    const m = after.board.find((c) => c.uid === 'm1')!;
    expect([m.attack - 2, m.health - 2], 'at least the printed +5/+6 (spell power may add)').toEqual([5, 6]);
  });
});

describe('Beefy — the target AND its neighbours', () => {
  it('buffs three bodies when cast on the middle of a row', () => {
    const s: RunState = {
      ...createRun(6), phase: 'recruit', embers: 10,
      board: [minion('l', 'stray'), minion('mid', 'alley'), minion('r', 'sandbag')],
      hand: [{ uid: 'sp', cardId: 'sp_beefy', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    } as RunState;
    const after = reduce(s, { type: 'play', uid: 'sp', targetUid: 'mid' } as never);
    for (const uid of ['l', 'mid', 'r']) {
      const c = after.board.find((x) => x.uid === uid)!;
      expect(c.attack - 2, `${uid} got the grant`).toBe(8);
      expect(c.health - 2).toBe(8);
    }
  });

  it('an EDGE target only reaches two bodies', () => {
    const s: RunState = {
      ...createRun(6), phase: 'recruit', embers: 10,
      board: [minion('l', 'stray'), minion('mid', 'alley'), minion('r', 'sandbag')],
      hand: [{ uid: 'sp', cardId: 'sp_beefy', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    } as RunState;
    const after = reduce(s, { type: 'play', uid: 'sp', targetUid: 'l' } as never);
    expect(after.board.find((x) => x.uid === 'l')!.attack - 2).toBe(8);
    expect(after.board.find((x) => x.uid === 'mid')!.attack - 2).toBe(8);
    expect(after.board.find((x) => x.uid === 'r')!.attack - 2, 'the far end is untouched').toBe(0);
  });
});

describe('Gamble — roll a die, get a card of that Tier', () => {
  it('is a T5 2-Gold untargeted spell', () => {
    const def = CARD_INDEX['sp_gamble']!;
    expect([def.tier, def.cost, def.spell]).toEqual([5, 2, true]);
    expect(def.target, 'untargeted').toBeUndefined();
  });

  it('conjures exactly one card, and its Tier is the die face (1-6)', () => {
    const s: RunState = {
      ...createRun(6), phase: 'recruit', embers: 10, board: [], hand: [
        { uid: 'sp', cardId: 'sp_gamble', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false },
      ],
    } as RunState;
    const after = reduce(s, { type: 'play', uid: 'sp' } as never);
    const got = after.hand.filter((c) => c.cardId !== 'sp_gamble');
    expect(got.length, 'one card pulled').toBe(1);
    const tier = CARD_INDEX[got[0]!.cardId]!.tier;
    expect(tier, 'the pull is a real die face').toBeGreaterThanOrEqual(1);
    expect(tier).toBeLessThanOrEqual(6);
  });

  it('is deterministic for a given rng cursor (seeded, replayable)', () => {
    const mk = (): RunState => ({
      ...createRun(6), phase: 'recruit', embers: 10, rngCursor: 12345, board: [], hand: [
        { uid: 'sp', cardId: 'sp_gamble', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false },
      ],
    } as RunState);
    const a = reduce(mk(), { type: 'play', uid: 'sp' } as never);
    const b = reduce(mk(), { type: 'play', uid: 'sp' } as never);
    expect(a.hand.map((c) => c.cardId)).toEqual(b.hand.map((c) => c.cardId));
  });
});
