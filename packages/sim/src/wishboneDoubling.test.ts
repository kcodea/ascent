import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { wishboneReps } from './reducer';

/**
 * RUNE OF THE WISHBONE — "your Hero Power triggers twice".
 *
 * The rune is gated by `DOUBLEABLE_POWERS`, and the gate is the whole safety property: a hero offered this
 * rune must actually get something for it. The failure mode is silent — a power whose branch never reads
 * `reps` (or a PASSIVE, which never reaches the activation switch at all) looks fine, is offered the rune,
 * and does exactly nothing. So these tests check the DOUBLING, not just the flag.
 */
const run = (heroId: string, over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1, heroId), phase: 'recruit', embers: 20, ...over } as RunState);
const armed = (heroId: string, over: Partial<RunState> = {}): RunState =>
  run(heroId, { ...over, runeWishbone: true });

describe('wishboneReps', () => {
  it('is 1 unarmed and 2 with the rune — the one answer both phases read', () => {
    expect(wishboneReps(run('nadja'))).toBe(1);
    expect(wishboneReps(armed('nadja'))).toBe(2);
  });
});

describe('the doubling actually happens (not just the gate)', () => {
  it('Nadja banks +2 max Gold instead of +1', () => {
    const plain = reduce(run('nadja'), { type: 'heroPower' } as never);
    const doubled = reduce(armed('nadja'), { type: 'heroPower' } as never);
    expect(doubled.maxGoldBonus ?? 0).toBe((plain.maxGoldBonus ?? 0) * 2);
  });

  it('Keshi banks a purchase’s tier TWICE (a passive — it never reaches the activation switch)', () => {
    // Keshi's crown tally is a buy hook, so if `reps` were the only mechanism this would silently do nothing.
    const buy = (s: RunState) => {
      const shop = [{ uid: 'o1', cardId: 'stray' }];
      return reduce({ ...s, shop, embers: 20 } as RunState, { type: 'buy', uid: 'o1' } as never);
    };
    const tier = CARD_INDEX['stray']!.tier;
    expect(buy(run('keshi')).keshiTierPoints).toBe(tier);
    expect(buy(armed('keshi')).keshiTierPoints).toBe(tier * 2);
  });

  it('Quillen’s overflow carries to the NEXT bucket rather than being discarded', () => {
    // Two doubled archives = 4 counts. Three pay out; the 4th must remain banked (owner ruling).
    const s = armed('quillen', {
      board: [
        { uid: 'a', cardId: 'd2_embermouth', tribe: 'dragon', attack: 2, health: 2, keywords: [], golden: false },
        { uid: 'b', cardId: 'd2_embermouth', tribe: 'dragon', attack: 2, health: 2, keywords: [], golden: false },
      ] as BoardCard[],
    });
    const one = reduce(s, { type: 'heroPower', uid: 'a' } as never);
    expect(one.archivedTribes?.length, 'one doubled archive banks 2').toBe(2);
    const two = reduce({ ...one, heroReady: true } as RunState, { type: 'heroPower', uid: 'b' } as never);
    expect(two.archivedTribes?.length, '4 banked minus the 3 spent = 1 carried over').toBe(1);
  });
});

describe('the gate refuses a hero it cannot help', () => {
  it('Flash is excluded — arming a MARK twice is the same mark', () => {
    // The honest exclusion: there is no reading of "triggers twice" for a mark that isn't a design change.
    // Asserted so a later widening of the gate has to make a deliberate decision about it.
    const s = armed('flash');
    const before = s.flashPick;
    const after = reduce(s, { type: 'heroPower', flashPick: 'first' } as never);
    expect(after.flashPick, 'the mark is set, once').toBe('first');
    expect(before).toBeUndefined();
  });
});
