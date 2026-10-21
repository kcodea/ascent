import { describe, it, expect } from 'vitest';
import { combatTierCeiling, STANDARD_TIER_CEILING } from '@game/core';
import { CARD_INDEX, SETS, type SetId } from '@game/content';
import { createRun, reduce, randomTierCeiling, type RunState } from './index';
import { albusTimeTier } from './ancients';
import type { BoardCard } from './state';

/**
 * R-RANDOM-TIER7-01 (owner 2026-10-21):
 *  - "yes": Rune of the Foundry's random Dragon (sell 5) caps at your Shop tier, like every other "get a random X".
 *  - "cant be getting t7s in combat either": a random minion pick NEVER gives a Tier 7 minion, in either phase,
 *    unless that player's Shop actually stands at Tier 7. Tier-7 ACCESS alone (Open Road / Summit Passage's
 *    `tier7Access`, the Summit rift) with a Tier 6 Shop no longer opens Tier 7 to a random picker.
 * Effects whose text names Tier 7 (Rune of the Deep, Beyond the Summit, Pete, Strange Revision) are authored and
 * stay as they were.
 */
const body = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: 3, health: 3, keywords: [], golden: false, ...extra } as BoardCard);
const tierOf = (id: string): number => CARD_INDEX[id]?.tier ?? 0;

function run(seed: number, setId: SetId, extra: Partial<RunState> = {}): RunState {
  const r = createRun(seed, undefined, 'ascent', undefined, setId, SETS[setId].tribes);
  return { ...r, phase: 'recruit', wave: 9, tier: 6, embers: 40, shop: [], board: [], hand: [], ...extra } as RunState;
}
const newIds = (before: RunState, after: RunState): string[] => {
  const had = new Set([...before.board, ...before.hand].map((c) => c.uid));
  return [...after.board, ...after.hand].filter((c) => !had.has(c.uid)).map((c) => c.cardId);
};

describe('the random ceiling is the Shop tier, not Tier-7 access', () => {
  it('Tier-7 access with a Tier 6 Shop: ceiling 6 (Shop and combat agree)', () => {
    expect(randomTierCeiling(run(1, 'set2', { tier7Access: true }))).toBe(STANDARD_TIER_CEILING);
    expect(randomTierCeiling(run(1, 'set2', { rift: 'summit' }))).toBe(STANDARD_TIER_CEILING);
    expect(combatTierCeiling(6)).toBe(STANDARD_TIER_CEILING);
  });

  it('a Tier 7 Shop: ceiling 7 (Shop and combat agree)', () => {
    expect(randomTierCeiling(run(1, 'set2', { tier7Access: true, tier: 7 }))).toBe(7);
    expect(combatTierCeiling(7)).toBe(7);
  });

  it('below Tier 6 the ceiling is still the standard 6 (the per-effect Shop-tier caps do the rest)', () => {
    expect(randomTierCeiling(run(1, 'set2', { tier: 3 }))).toBe(STANDARD_TIER_CEILING);
    expect(combatTierCeiling(3)).toBe(STANDARD_TIER_CEILING);
  });
});

describe('Rune of the Foundry caps its Dragon at your Shop tier', () => {
  const sellFive = (s: RunState): RunState => {
    for (let i = 0; i < 5; i++) s = reduce({ ...s, board: [body(`x${i}`, 'stray')] }, { type: 'sell', uid: `x${i}` }) as RunState;
    return s;
  };

  it('at Shop tier 3, every Dragon it hands over is Tier 3 or lower, across 120 seeds', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 120; seed++) {
      const s = reduce(run(seed, 'set2', { tier: 3, runeforgeOffer: ['rune_foundry'] }), { type: 'buyRune', index: 0 }) as RunState;
      for (const id of newIds(s, sellFive(s))) seen.add(id);
    }
    expect(seen.size, 'the Foundry paid Dragons').toBeGreaterThan(0);
    expect([...seen].filter((id) => tierOf(id) > 3), 'above the Shop tier').toEqual([]);
  });

  it('with Tier-7 access at Shop tier 6 it still never hands over a Tier 7', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const s = reduce(run(seed, 'set2', { tier7Access: true, runeforgeOffer: ['rune_foundry'] }), { type: 'buyRune', index: 0 }) as RunState;
      expect(newIds(s, sellFive(s)).filter((id) => tierOf(id) >= 7), `seed ${seed}`).toEqual([]);
    }
  });
});

describe('the tier-above Discovers stop at 6 unless the Shop is at Tier 7', () => {
  it('Clockwork Assistant at Shop tier 6 with Tier-7 access Discovers Tier 6, not Tier 7', () => {
    const s = run(4, 'set2', { tier7Access: true, hand: [body('c', 'n2_clockwork')], board: [] });
    const after = reduce(s, { type: 'play', uid: 'c', toIndex: 0 }) as RunState;
    const offered = after.discover ?? [];
    expect(offered.length, 'the Discover opened').toBeGreaterThan(0);
    expect(offered.map(tierOf).every((t) => t === 6), `offered ${offered.join(', ')}`).toBe(true);
  });

  it("Albus's Start of Turn Discover tier tops out at 6 with access, 7 from a Tier 7 Shop", () => {
    expect(albusTimeTier(run(1, 'set2', { tier7Access: true }))).toBe(6);
    expect(albusTimeTier(run(1, 'set2', { tier7Access: true, tier: 7 }))).toBe(7);
    expect(albusTimeTier(run(1, 'set2', { tier: 4 }))).toBe(5);
  });
});
