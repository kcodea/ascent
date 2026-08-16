import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, getHero, type RunState } from './index';

/** Owner hero batch 2026-08-16 — Emerald Warden (Vanguard), Underdweller (Soulkeeper), Albus (Empowerment). */

const at = (over: Partial<RunState>): RunState =>
  ({ ...createRun(7), phase: 'recruit', ...over }) as RunState;

describe('Emerald Warden — Vanguard', () => {
  it('is an 8-armor passive', () => {
    const h = getHero('emeraldwarden');
    expect([h.armor, h.power.kind, h.power.passive]).toEqual([8, 'vanguard', true]);
  });

  it('hands you a minion of the tier you JUST reached, not the one you left', () => {
    const s = at({ heroId: 'emeraldwarden', embers: 20, tier: 1, upgradeCost: 5, hand: [] });
    const after = reduce(s, { type: 'upgrade' } as never);
    expect(after.tier, 'the tavern went up').toBe(2);
    expect(after.hand.length, 'exactly one minion granted').toBe(1);
    const def = CARD_INDEX[after.hand[0]!.cardId]!;
    expect(def.tier, 'from the NEW tier').toBe(2);
    expect(def.spell ?? false, 'a minion, never a spell').toBe(false);
  });

  it('pays out on every tier-up, not just the first', () => {
    let s = at({ heroId: 'emeraldwarden', embers: 40, tier: 1, upgradeCost: 5, hand: [] });
    s = reduce(s, { type: 'upgrade' } as never);
    s = { ...s, embers: 40 } as RunState;
    s = reduce(s, { type: 'upgrade' } as never);
    expect([s.tier, s.hand.length]).toEqual([3, 2]);
    expect(CARD_INDEX[s.hand[1]!.cardId]!.tier).toBe(3);
  });

  it('grants nothing to a hero without the power (the passive is hero-gated)', () => {
    const s = at({ heroId: 'indy', embers: 20, tier: 1, upgradeCost: 5, hand: [] });
    expect(reduce(s, { type: 'upgrade' } as never).hand.length).toBe(0);
  });
});

describe('Underdweller — Soulkeeper', () => {
  const combat = (deaths: Array<{ uid: string; cardId: string }>, extra: object = {}): object => ({
    result: 'win', playerDamage: 0, playerDeathrattles: 0,
    initial: { player: deaths.map((d) => ({ ...d, name: d.cardId, tribe: 'beast', attack: 1, health: 1, keywords: [] })), enemy: [] },
    events: deaths.map((d) => ({ type: 'death', target: d.uid, side: 'player' })),
    ...extra,
  });

  it('is a 9-armor, 3-Gold untargeted power', () => {
    const h = getHero('underdweller');
    expect([h.armor, h.power.kind, h.power.cost, h.power.untargeted]).toEqual([9, 'soulkeeper', 3, true]);
  });

  it('offers a Discover built from what died last combat', () => {
    const s = at({
      heroId: 'underdweller', embers: 10, heroReady: true, hand: [],
      lastCombat: combat([{ uid: 'p1', cardId: 'stray' }, { uid: 'p2', cardId: 'alley' }]) as never,
    });
    const after = reduce(s, { type: 'heroPower' } as never);
    expect(after.discover, 'a Discover opened').toBeTruthy();
    expect(new Set(after.discover), 'exactly the dead').toEqual(new Set(['stray', 'alley']));
    expect(after.embers, '3 Gold charged').toBe(7);
  });

  it('reaches BOTH sides of the board (the owner ruling)', () => {
    const s = at({
      heroId: 'underdweller', embers: 10, heroReady: true, hand: [],
      lastCombat: {
        result: 'win', playerDamage: 0, playerDeathrattles: 0,
        initial: {
          player: [{ uid: 'p1', cardId: 'stray', name: 'x', tribe: 'beast', attack: 1, health: 1, keywords: [] }],
          enemy: [{ uid: 'e1', cardId: 'alley', name: 'y', tribe: 'beast', attack: 1, health: 1, keywords: [] }],
        },
        events: [
          { type: 'death', target: 'p1', side: 'player' },
          { type: 'death', target: 'e1', side: 'enemy' },
        ],
      } as never,
    });
    const after = reduce(s, { type: 'heroPower' } as never);
    expect(new Set(after.discover)).toEqual(new Set(['stray', 'alley']));
  });

  it('skips a Rise death — that body came back, so it did not stay dead', () => {
    const s = at({
      heroId: 'underdweller', embers: 10, heroReady: true, hand: [],
      lastCombat: combat([], {
        initial: { player: [{ uid: 'p1', cardId: 'stray', name: 'x', tribe: 'beast', attack: 1, health: 1, keywords: [] }], enemy: [] },
        events: [{ type: 'death', target: 'p1', side: 'player', rise: true }],
      }) as never,
    });
    const after = reduce(s, { type: 'heroPower' } as never);
    expect(after.discover, 'nothing to reclaim').toBeFalsy();
    expect(after.embers, 'and no Gold charged for the no-op').toBe(10);
  });

  it('is a full no-op when nothing died — the charge is not spent', () => {
    const s = at({ heroId: 'underdweller', embers: 10, heroReady: true, hand: [] });
    const after = reduce(s, { type: 'heroPower' } as never);
    expect([after.discover, after.embers, after.heroReady]).toEqual([undefined, 10, true]);
  });
});

describe('Albus — Empowerment', () => {
  it('is a 14-armor, 1-Gold targeted power', () => {
    const h = getHero('albus');
    expect([h.armor, h.power.kind, h.power.cost]).toEqual([14, 'empowerment', 1]);
    expect(h.power.passive ?? false, 'active, not passive').toBe(false);
  });

  it('offers a Discover from the tier ABOVE the targeted Shop minion', () => {
    const base = createRun(9) as RunState;
    const offer = base.shop.find((o) => {
      const d = CARD_INDEX[o.cardId];
      return d && !d.spell && !d.ruby;
    })!;
    const s = { ...base, phase: 'recruit', heroId: 'albus', embers: 10, heroReady: true, tier: 3 } as RunState;
    const after = reduce(s, { type: 'heroPower', uid: offer.uid } as never);
    const srcTier = CARD_INDEX[offer.cardId]!.tier;
    expect(after.discover, 'a Discover opened').toBeTruthy();
    for (const id of after.discover!) expect(CARD_INDEX[id]!.tier, 'one tier up').toBe(srcTier + 1);
    expect(after.discoverIntoShopUid, 'aimed back at the offer it will replace').toBe(offer.uid);
  });

  it('the pick REPLACES the Shop offer instead of going to hand', () => {
    const base = createRun(9) as RunState;
    const offer = base.shop.find((o) => {
      const d = CARD_INDEX[o.cardId];
      return d && !d.spell && !d.ruby;
    })!;
    const idx = base.shop.findIndex((o) => o.uid === offer.uid);
    const s = { ...base, phase: 'recruit', heroId: 'albus', embers: 10, heroReady: true, tier: 3, hand: [] } as RunState;
    const armed = reduce(s, { type: 'heroPower', uid: offer.uid } as never);
    const chosen = armed.discover![0]!;
    const after = reduce(armed, { type: 'discover', index: 0 } as never);
    expect(after.hand.length, 'nothing landed in hand').toBe(0);
    expect(after.shop[idx]!.cardId, 'the offer turned into the pick').toBe(chosen);
    expect(after.discoverIntoShopUid, 'the one-shot marker is consumed').toBeUndefined();
  });

  it('clamps at Tier 6 without Tier 7 access (the standard ceiling)', () => {
    const base = createRun(11) as RunState;
    const s = {
      ...base, phase: 'recruit', heroId: 'albus', embers: 10, heroReady: true, tier: 6,
      shop: [{ uid: 's99', cardId: 'gnash' }], // Gnasher, the Overrun — Tier 6
    } as RunState;
    const after = reduce(s, { type: 'heroPower', uid: 's99' } as never);
    expect(CARD_INDEX['gnash']!.tier, 'the target really is T6').toBe(6);
    for (const id of after.discover!) expect(CARD_INDEX[id]!.tier, 'stays at 6, never 7').toBe(6);
  });

  it('refuses a Shop SPELL — minions only', () => {
    const s = {
      ...createRun(9), phase: 'recruit', heroId: 'albus', embers: 10, heroReady: true, tier: 3,
      shop: [{ uid: 's99', cardId: 'growth' }],
    } as RunState;
    const after = reduce(s, { type: 'heroPower', uid: 's99' } as never);
    expect([after.discover, after.embers, after.heroReady]).toEqual([undefined, 10, true]);
  });
});

describe('Gambler — the rolled face is held for the turn', () => {
  it('records the roll and the wave it happened on', () => {
    const s = at({ heroId: 'gambler', embers: 10, heroReady: true, wave: 4 });
    const after = reduce(s, { type: 'heroPower' } as never);
    expect(after.heroDiceRoll, 'a real die face').toBeGreaterThanOrEqual(1);
    expect(after.heroDiceRoll).toBeLessThanOrEqual(6);
    expect(after.heroDiceRollWave, 'stamped with this turn').toBe(4);
    expect(after.heroDiceLockUntil, 'lock still rides on the same roll').toBe(4 + after.heroDiceRoll!);
  });
});
