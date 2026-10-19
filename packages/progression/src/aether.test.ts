import { describe, expect, it } from 'vitest';
import {
  CRATE_TIERS, DEFAULT_AETHER_ECONOMY, ZERO_AETHER, aetherForSettlement, milestoneLevelsThrough, parseAetherEconomy,
} from './aether';

describe('aetherForSettlement', () => {
  it('ranked pays base + placement', () => {
    expect(aetherForSettlement({ mode: 'ranked', placement: 1 })).toEqual({ base: 50, placement: 140, total: 190 });
    expect(aetherForSettlement({ mode: 'ranked', placement: 2 }).total).toBe(130);
    expect(aetherForSettlement({ mode: 'ranked', placement: 8 })).toEqual({ base: 50, placement: 0, total: 50 });
    expect(aetherForSettlement({ mode: 'ranked', placement: null })).toEqual(ZERO_AETHER);
  });

  it('versus pays complete + win', () => {
    expect(aetherForSettlement({ mode: 'versus', placement: 1 })).toEqual({ base: 25, placement: 45, total: 70 });
    expect(aetherForSettlement({ mode: 'versus', placement: 2 })).toEqual({ base: 25, placement: 0, total: 25 });
    expect(aetherForSettlement({ mode: 'versus', placement: null })).toEqual({ base: 25, placement: 0, total: 25 });
  });

  it('practice and tutorial pay nothing', () => {
    for (const mode of ['practice', 'tutorial'] as const) {
      for (const placement of [null, 1, 2, 4, 8]) {
        expect(aetherForSettlement({ mode, placement })).toEqual(ZERO_AETHER);
      }
    }
  });

  it('a non-terminal game pays nothing', () => {
    expect(aetherForSettlement({ mode: 'ranked', placement: 1, terminal: false })).toEqual(ZERO_AETHER);
  });
});

describe('default economy', () => {
  it('matches the spec', () => {
    expect(CRATE_TIERS).toEqual(['standard', 'rare', 'epic', 'legendary', 'ancient']);
    expect(DEFAULT_AETHER_ECONOMY.cratePrice).toEqual({ standard: 100, rare: 200, epic: 400, legendary: 600, ancient: 900 });
    expect(DEFAULT_AETHER_ECONOMY.focusFeePercent).toEqual([100, 60, 40, 25, 15, 10, 5]);
    expect(DEFAULT_AETHER_ECONOMY.rankedPlacementBonus).toEqual([140, 80, 45, 35, 25, 15, 10, 0]);
    expect(DEFAULT_AETHER_ECONOMY.gauntletFirstClear).toBe(200);
    expect(DEFAULT_AETHER_ECONOMY.milestoneEvery).toBe(10);
  });
});

describe('parseAetherEconomy', () => {
  const clone = () => JSON.parse(JSON.stringify(DEFAULT_AETHER_ECONOMY));

  it('round-trips the default', () => {
    expect(parseAetherEconomy(clone())).toEqual(DEFAULT_AETHER_ECONOMY);
  });

  it('rejects junk', () => {
    const negative = clone(); negative.cratePrice.rare = -1;
    expect(parseAetherEconomy(negative)).toBeNull();

    const missingTier = clone(); delete missingTier.cratePrice.ancient;
    expect(parseAetherEconomy(missingTier)).toBeNull();

    const shortBonus = clone(); shortBonus.rankedPlacementBonus = shortBonus.rankedPlacementBonus.slice(0, 7);
    expect(parseAetherEconomy(shortBonus)).toBeNull();

    const fractional = clone(); fractional.versusWin = 45.5;
    expect(parseAetherEconomy(fractional)).toBeNull();

    expect(parseAetherEconomy(null)).toBeNull();
    expect(parseAetherEconomy('nope')).toBeNull();
  });
});

describe('milestoneLevelsThrough', () => {
  it('milestones every 10', () => {
    expect(milestoneLevelsThrough(9)).toEqual([]);
    expect(milestoneLevelsThrough(34)).toEqual([10, 20, 30]);
    expect(milestoneLevelsThrough(40)).toEqual([10, 20, 30, 40]);
  });
});
