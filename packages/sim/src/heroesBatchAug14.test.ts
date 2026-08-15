import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { HEROES } from './heroes';
import { createRun, reduce, type RunState } from './index';

/** Owner batch 2026-08-14: Tiff re-added; new heroes Merrin / Gambler / Xerox (the active-power tranche). */

describe('Tiff is back in the selectable pool', () => {
  it('is no longer flagged wip', () => {
    const tiff = HEROES.find((h) => h.id === 'tiff');
    expect(tiff, 'Tiff exists').toBeTruthy();
    expect(tiff!.wip, 'Tiff is offered again').toBeFalsy();
  });
});

describe('Merrin — Pocket Magic', () => {
  it('gets a random Shop spell to hand for 1 Gold', () => {
    let s: RunState = { ...createRun(3, 'merrin'), embers: 5, heroReady: true, hand: [] };
    s = reduce(s, { type: 'heroPower' });
    expect(s.hand.length, 'a card landed in hand').toBe(1);
    expect(CARD_INDEX[s.hand[0]!.cardId]?.spell, 'and it is a spell').toBe(true);
    expect(s.embers, '1 Gold spent').toBe(4);
  });
});

describe('Gambler — Dice', () => {
  it('rolls 1-6 and locks the power for that many turns', () => {
    let s: RunState = { ...createRun(3, 'gambler'), embers: 5, maxEmbers: 20, heroReady: true };
    const wave0 = s.wave;
    const before = s.embers;
    s = reduce(s, { type: 'heroPower' });
    const roll = (s.heroDiceLockUntil ?? 0) - wave0; // lockUntil = wave + roll
    expect(roll, 'a die was rolled (1-6)').toBeGreaterThanOrEqual(1);
    expect(roll).toBeLessThanOrEqual(6);
    expect(s.embers, 'gained Gold from the roll (net of the 1-Gold cost)').toBe(before - 1 + roll);

    // Still on cooldown next attempt (heroReady recharged, but the lock holds) → no charge, no roll.
    const locked = reduce({ ...s, heroReady: true, embers: 5 }, { type: 'heroPower' });
    expect(locked.embers, 'locked: nothing happens').toBe(5);
  });
});

describe('Xerox — Copy Machine', () => {
  it('copies a friendly board minion into hand (plain), once per game', () => {
    let s: RunState = {
      ...createRun(3, 'xerox'), heroReady: true, hand: [],
      board: [{ uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 9, health: 9, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'heroPower', uid: 'b1' });
    expect(s.hand.length, 'a copy landed in hand').toBe(1);
    expect(s.hand[0]!.cardId).toBe('stray');
    const def = CARD_INDEX['stray']!;
    expect([s.hand[0]!.attack, s.hand[0]!.health], 'a PLAIN copy — base stats, not the buffed 9/9').toEqual([def.attack, def.health]);
    expect(s.heroPowerSpent, 'once per game — spent').toBe(true);
  });
});
