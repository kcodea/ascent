import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from './index';
import { giftCastCount, rubyCastCount } from './recruit';

/** Comet / Nimbus — "Your next spell casts N additional times" reaches EVERY spell, Clues and Rubies included
 *  (owner 2026-09-18: "this effect says spell, which means ALL spells should count"). */
describe('the "next spell" extra-cast charge reaches Clues and Rubies', () => {
  const mk = (cardId: string, extra = 2): RunState => ({
    ...createRun(3), phase: 'recruit', embers: 20, nextSpellExtraCasts: extra,
    board: [{ uid: 't', cardId: 'knit', tribe: 'neutral', attack: 3, health: 3, keywords: [], golden: false }],
    hand: [{ uid: 'h', cardId, tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
  } as RunState);
  const cast = (s: RunState): RunState => reduce(s, { type: 'play', uid: 'h', targetUid: 't' } as never);

  it('a Clue under Comet (2 extra) lands three times and spends the charge', () => {
    const s = mk('clue');
    expect(giftCastCount(s, CARD_INDEX['clue']!, true), 'the badge count').toBe(3);
    const after = cast(s);
    const t = after.board.find((c) => c.uid === 't')!;
    expect([t.attack, t.health]).toEqual([9, 9]); // 3 + 1 + 2 + 3: each Clue landing improves the next (the Clue's own rule)
    expect(after.nextSpellExtraCasts, 'spent').toBeUndefined();
  });

  it('a Ruby under Comet (2 extra) lands three times and spends the charge', () => {
    const s = mk('ruby');
    expect(rubyCastCount(s), 'the badge count').toBe(3);
    const after = cast(s);
    const t = after.board.find((c) => c.uid === 't')!;
    expect([t.attack, t.health]).toEqual([6, 6]);
    expect(after.nextSpellExtraCasts, 'spent').toBeUndefined();
  });

  it('without a charge both resolve once, and a plain (non-multicast) Gift never multiplies', () => {
    expect(rubyCastCount(mk('ruby', 0))).toBe(1);
    expect(giftCastCount(mk('clue', 0), CARD_INDEX['clue']!, true)).toBe(1);
    const gift = Object.values(CARD_INDEX).find((c) => c.gift && !c.giftMulticast)!;
    expect(giftCastCount(mk(gift.id, 2), gift, !!gift.target), 'a plain Gift resolves once by design').toBe(1);
  });
});
