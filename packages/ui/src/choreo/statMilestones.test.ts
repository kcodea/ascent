import { describe, expect, it } from 'vitest';
import { crossedUp, MILESTONE_TIERS, tierOf } from './statMilestones';

describe('MILESTONE_TIERS', () => {
  it('is the owner-set schedule, per stat', () => {
    expect(MILESTONE_TIERS.attack).toEqual([50, 100, 500, 1000, 5000]);
    expect(MILESTONE_TIERS.health).toEqual([50, 100, 500, 1000, 5000]);
  });
});

describe('tierOf', () => {
  it('is 0 below the first threshold', () => {
    expect(tierOf('attack', 0)).toBe(0);
    expect(tierOf('attack', 49)).toBe(0);
  });
  it('steps up exactly AT each threshold (inclusive)', () => {
    expect(tierOf('attack', 50)).toBe(1);
    expect(tierOf('attack', 99)).toBe(1);
    expect(tierOf('attack', 100)).toBe(2);
    expect(tierOf('attack', 500)).toBe(3);
    expect(tierOf('attack', 1000)).toBe(4);
    expect(tierOf('attack', 5000)).toBe(5);
  });
  it('caps at the top tier for anything above the last threshold', () => {
    expect(tierOf('attack', 999999)).toBe(5);
  });
  it('never returns a tier for a negative value', () => {
    expect(tierOf('health', -10)).toBe(0);
  });
});

describe('crossedUp', () => {
  it('returns the tier reached on a single-step up-cross', () => {
    expect(crossedUp('attack', 49, 50)).toBe(1);
    expect(crossedUp('attack', 99, 100)).toBe(2);
  });
  it('returns the HIGHEST tier when a jump vaults several at once', () => {
    expect(crossedUp('attack', 40, 1200)).toBe(4);
  });
  it('is null when the tier did not change', () => {
    expect(crossedUp('attack', 50, 60)).toBeNull();
    expect(crossedUp('attack', 10, 20)).toBeNull();
  });
  it('is null on a DOWN-cross (frame follows down, but no celebration)', () => {
    expect(crossedUp('attack', 120, 40)).toBeNull();
    expect(crossedUp('attack', 100, 99)).toBeNull();
  });
});
