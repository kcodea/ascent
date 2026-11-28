import { describe, expect, it } from 'vitest';
import { DEFAULT_PACK_ECONOMY, PACK_LAUNCH_GRANT, PACK_ROLL_VERSION, parsePackEconomy, rarityPackOdds } from './packEconomy';
import { nextShopRefresh, shopWindowId } from './packShop';

const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(DEFAULT_PACK_ECONOMY));

describe('DEFAULT_PACK_ECONOMY', () => {
  it('carries the owner values', () => {
    const e = DEFAULT_PACK_ECONOMY;
    expect(e.version).toBe(1);
    expect(e.rarityPackPrice).toEqual({ common: 100, rare: 175, epic: 300, legendary: 500, ancient: 850 });
    expect(e.themedPackPrice).toBe(200);
    expect(e.duplicateAether).toEqual({ common: 20, rare: 35, epic: 60, legendary: 100, ancient: 170 });
    expect(e.standardOdds).toEqual({ common: 35, rare: 31, epic: 22, legendary: 9, ancient: 3 });
    expect([e.rewardEvery, e.rewardRarity, e.levelPackEvery, e.levelPackRarity, e.freePackRarity]).toEqual([15, 'epic', 5, 'legendary', 'rare']);
    expect(e.welcomePacks).toEqual({ common: 5, rare: 2, epic: 1, legendary: 1, ancient: 0 });
    expect([e.counterTypes, e.stackMax, e.refreshHours, e.refreshZone]).toEqual([5, 8, 6, 'America/New_York']);
    expect([e.featuredDeals, e.dealOff, e.dealStock]).toEqual([4, { min: 20, max: 60, step: 5 }, { min: 2, max: 5 }]);
    expect(PACK_LAUNCH_GRANT).toBe(3000);
    expect(PACK_ROLL_VERSION).toBe(1);
  });
});

describe('parsePackEconomy', () => {
  it('round-trips the default through JSON', () => {
    expect(parsePackEconomy(JSON.parse(JSON.stringify(DEFAULT_PACK_ECONOMY)))).toEqual(DEFAULT_PACK_ECONOMY);
  });
  it('rejects malformed documents', () => {
    expect(parsePackEconomy(null)).toBeNull();
    expect(parsePackEconomy('x')).toBeNull();
    const noPrice = clone(); delete noPrice.themedPackPrice;
    expect(parsePackEconomy(noPrice)).toBeNull();
    const negative = clone(); (negative.duplicateAether as Record<string, number>).epic = -1;
    expect(parsePackEconomy(negative)).toBeNull();
    const odds = clone(); (odds.standardOdds as Record<string, number>).common = 36;
    expect(parsePackEconomy(odds)).toBeNull();
    expect(parsePackEconomy({ ...clone(), stackMax: 0 })).toBeNull();
    const unknownKey = clone(); (unknownKey.rarityPackPrice as Record<string, number>).secret = 5;
    expect(parsePackEconomy(unknownKey)).toBeNull();
    expect(parsePackEconomy({ ...clone(), rewardRarity: 'secret' })).toBeNull();
    expect(parsePackEconomy({ ...clone(), refreshHours: 5 })).toBeNull();
    expect(parsePackEconomy({ ...clone(), dealStock: { min: 6, max: 5 } })).toBeNull();
  });
});

describe('rarityPackOdds', () => {
  it('shows the standard odds for the cards and the floor-renormalized odds for the last card', () => {
    const o = rarityPackOdds('rare');
    expect(o.cards).toEqual({ common: 35, rare: 31, epic: 22, legendary: 9, ancient: 3 });
    expect(o.last).toEqual({ common: 0, rare: 47.7, epic: 33.8, legendary: 13.8, ancient: 4.6 });
    expect(rarityPackOdds('ancient').last.ancient).toBe(100);
  });
});

describe('the shop window', () => {
  it('names the window in Eastern wall-clock time across the spring-forward day', () => {
    expect(shopWindowId(new Date('2026-03-08T06:59:00Z'))).toBe('2026-03-08T00');
    expect(shopWindowId(new Date('2026-03-08T10:00:00Z'))).toBe('2026-03-08T06');
    expect(nextShopRefresh(new Date('2026-03-08T06:59:00Z'))).toBe(Date.parse('2026-03-08T10:00:00Z'));
  });
});
