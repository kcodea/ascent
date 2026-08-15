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

describe('Frantic Frank — Clearance', () => {
  it('refreshes the Shop and makes its minions cost 2 Gold this turn', () => {
    let s: RunState = { ...createRun(3, 'frank'), embers: 10, maxEmbers: 20, heroReady: true, tier: 3 };
    s = reduce(s, { type: 'heroPower' });
    expect(s.frankClearanceTurn, 'clearance armed for this turn').toBe(s.wave);
    const offer = s.shop.find((o) => { const d = CARD_INDEX[o.cardId]; return d && !d.spell && !d.ruby && !(o.cost != null); });
    expect(offer, 'a normal Shop minion to buy').toBeTruthy();
    const before = s.embers;
    const after = reduce(s, { type: 'buy', uid: offer!.uid });
    expect(before - after.embers, 'that minion cost 2 Gold under Clearance').toBe(2);
  });
});

describe('Foreman Flint — Company Rate', () => {
  it('Dwarf minions cost 2 Gold; others cost the normal price', () => {
    const s: RunState = {
      ...createRun(5, 'flint'), embers: 20, maxEmbers: 20, tier: 3, hand: [],
      shop: [{ uid: 'd0', cardId: 'dw_brunni' }, { uid: 'n0', cardId: 'stray' }],
    };
    const dwarf = reduce(s, { type: 'buy', uid: 'd0' });
    expect(s.embers - dwarf.embers, 'a Dwarf costs 2').toBe(2);
    const other = reduce(s, { type: 'buy', uid: 'n0' });
    expect(s.embers - other.embers, 'a non-Dwarf is not discounted').toBeGreaterThan(2);
  });
});

describe('Pete — Contrabanana', () => {
  it('every 3rd refresh appends a minion from the tier above', () => {
    let s: RunState = { ...createRun(4, 'pete'), embers: 50, maxEmbers: 50, heroReady: true, tier: 3, freeRolls: 99 };
    for (let i = 0; i < 3; i++) s = reduce(s, { type: 'roll' });
    const higher = s.shop.filter((o) => CARD_INDEX[o.cardId]?.tier === 4);
    expect(higher.length, 'the 3rd refresh smuggled in a Tier-4 offer').toBeGreaterThan(0);
    expect(s.refreshCount).toBe(3);
  });
});
