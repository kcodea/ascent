import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * Owner rule 2026-08-01: Triple Rewards must not themselves triple. Three banked reward tokens silently
 * combined into ONE golden Triple Reward — eating two Discovers. `noTriple` excludes the token from the
 * triple COUNT entirely (the same treatment as Mage-Pup), so banked rewards just sit in hand until played.
 */
describe('Triple Reward cannot triple', () => {
  const reward = (uid: string): BoardCard =>
    ({ uid, cardId: 'discoverspell', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

  it('three banked rewards stay three separate cards', () => {
    let s: RunState = { ...createRun(1), phase: 'recruit', board: [], hand: [reward('r1'), reward('r2'), reward('r3')] };
    // Any action that runs checkTriples — buying is the natural one; an empty shop makes it a no-op buy,
    // so drive the check directly through a play of an unrelated card instead.
    s = { ...s, hand: [...s.hand, { uid: 'x', cardId: 'drummer', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'x' });
    const rewards = s.hand.filter((c) => c.cardId === 'discoverspell');
    expect(rewards.length, 'the three rewards were combined').toBe(3);
    expect(rewards.every((c) => !c.golden)).toBe(true);
  });

  it('the def carries noTriple, so every checkTriples site is covered', () => {
    expect(CARD_INDEX['discoverspell']!.noTriple).toBe(true);
  });
});

describe('Triple Reward is NOT a Shop spell (owner rule 2026-08-01)', () => {
  const reward = (uid: string): BoardCard =>
    ({ uid, cardId: 'discoverspell', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

  it('playing it records no spell cast — no copy effect or End-of-Turn recast can ever see it', () => {
    let s: RunState = { ...createRun(1), phase: 'recruit', board: [], hand: [reward('r')] };
    s = reduce(s, { type: 'play', uid: 'r' });
    expect(s.discover, 'its Discover must still open').toBeTruthy();
    expect(s.spellsCast, 'it must not count as a spell cast').toBe(0);
    expect(s.spellsThisTurn).toBe(0);
    expect(s.firstSpellThisTurnId, "it must not become Recurrence's remembered first spell").toBeUndefined();
    expect(s.lastSpellCastId, 'it must not become the copyable last spell (Steward/Recaller)').toBeUndefined();
    expect(s.playedThisTurn, 'it still counts as a CARD played').toContain('discoverspell');
  });

  it('spell multipliers never touch it — a Nimbus charge is neither used nor consumed', () => {
    let s: RunState = { ...createRun(1), phase: 'recruit', board: [], hand: [reward('r')], nextSpellExtraCasts: 1 };
    s = reduce(s, { type: 'play', uid: 'r' });
    expect(s.discover, 'exactly one Discover opens').toBeTruthy();
    expect(s.discoverQueue ?? [], 'no doubled Discover behind it').toEqual([]);
    expect(s.nextSpellExtraCasts, 'the Nimbus charge must survive for a REAL spell').toBe(1);
  });
});
