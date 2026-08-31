import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * RUBY ROACH (set 3) — "Whenever you play a Choose One card, cast a Ruby on your minions."
 *
 * The owner's report (2026-08-31) is an ORDERING bug, and it is the whole point of this lane:
 *
 *   *"Ruby Roach should trigger after the Choose One card is fully played, so that it also receives the Ruby
 *    from Ruby Roach."*
 *
 * It first fired at the top of the `play` action, before the body reached the board — so the card that earned
 * the Ruby was the one card that never got one. It now fires at the two RESOLUTION sites (the minion branch,
 * and `resolveChooseOneSpell`), which also keeps a play that merely OPENS the picker from paying: a prompt
 * commits nothing, and must not trigger the Roach.
 */
const hand = (uid: string, cardId: string): BoardCard => ({
  uid, cardId, tribe: CARD_INDEX[cardId]!.tribe,
  attack: CARD_INDEX[cardId]!.attack, health: CARD_INDEX[cardId]!.health,
  keywords: [], golden: false,
});
const onBoard = (uid: string, cardId: string): BoardCard => ({ ...hand(uid, cardId) });

/** Runic Beetle — a targeted Choose One MINION; `alley` is a plain body to hold a board slot. */
const base = (over: Partial<RunState> = {}): RunState => ({
  ...createRun(5), setId: 'set3', board: [onBoard('roach', 'k3_rubyroach')], ...over,
} as RunState);

const statsOf = (s: RunState, uid: string) => {
  const c = s.board.find((b) => b.uid === uid);
  return c ? { attack: c.attack, health: c.health } : undefined;
};

describe('Ruby Roach', () => {
  it('the Choose One MINION that triggered it receives the Ruby too', () => {
    // The bug, stated as a test. The Beetle lands, its branch resolves, and only THEN does the Roach pay —
    // so the Beetle is on the board to be paid.
    const s0 = base({ hand: [hand('c', 'beetle')] });
    const beetleDef = CARD_INDEX['beetle']!;
    const s1 = reduce(s0, { type: 'play', uid: 'c' });
    expect(s1.chooseOne?.cardId, 'the prompt opened').toBe('beetle');
    const s2 = reduce(s1, { type: 'chooseOne', index: 0 });
    const landed = statsOf(s2, 'c');
    expect(landed, 'the Beetle is on the board').toBeTruthy();
    // A Ruby is 1/1 plus the run's Ruby strength; the Beetle's own branch may add more. The claim under test
    // is only that it is strictly bigger than the body its own branch would have produced alone.
    const withoutRoach = reduce(
      { ...base({ board: [], hand: [hand('c', 'beetle')] }) }, { type: 'play', uid: 'c' },
    );
    const solo = statsOf(reduce(withoutRoach, { type: 'chooseOne', index: 0 }), 'c');
    expect(solo, 'the no-Roach control also played').toBeTruthy();
    expect(landed!.attack + landed!.health, 'the Roach paid the card that triggered it')
      .toBeGreaterThan(solo!.attack + solo!.health);
    expect(beetleDef.chooseOne?.length, 'fixture sanity: Runic Beetle is a Choose One').toBeGreaterThan(0);
  });

  it('merely OPENING the picker pays nothing — a prompt commits nothing', () => {
    const s0 = base({ hand: [hand('c', 'beetle')] });
    const before = statsOf(s0, 'roach')!;
    const s1 = reduce(s0, { type: 'play', uid: 'c' });
    expect(statsOf(s1, 'roach'), 'no Ruby while the prompt is open').toEqual(before);
  });

  it('a Choose One SPELL pays the board once its branch has been cast', () => {
    const s0 = base({ board: [onBoard('roach', 'k3_rubyroach'), onBoard('a', 'alley')], hand: [hand('c', 'crestclimb')] });
    const before = statsOf(s0, 'a')!;
    const s1 = reduce(s0, { type: 'play', uid: 'c' });
    const s2 = reduce(s1, { type: 'chooseOne', index: 0 });
    const s3 = s2.pendingTarget ? reduce(s2, { type: 'battlecryTarget', targetUid: 'a' }) : s2;
    expect(s3.hand, 'the spell resolved out of hand').toHaveLength(0);
    const after = statsOf(s3, 'a')!;
    expect(after.attack + after.health, 'the board took its Ruby').toBeGreaterThan(before.attack + before.health);
  });

  it('a plain (non-Choose One) play pays nothing', () => {
    const s0 = base({ hand: [hand('c', 'alley')] });
    const before = statsOf(s0, 'roach')!;
    const s1 = reduce(s0, { type: 'play', uid: 'c' });
    expect(statsOf(s1, 'roach'), 'only Choose One plays trigger it').toEqual(before);
  });
});
