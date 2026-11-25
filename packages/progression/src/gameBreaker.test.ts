/** R-PROG-TITLE-GIFT-01 (owner 2026-11-25): "add a unique title not earnable called Game Breaker". */
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from './achievements';
import { GAME_BREAKER_TITLE_ID, cosmeticOf, eligibleCrateCosmetics, milestoneLevelOf } from './cosmetics';

describe('Game Breaker is a gift, never earned', () => {
  it('no chest, level or achievement gives it, and it is Secret', () => {
    const def = cosmeticOf(GAME_BREAKER_TITLE_ID)!;
    expect(def).toMatchObject({ category: 'title', name: 'Game Breaker', rarity: 'secret', look: 'lemon', active: true, acquisition: { type: 'event', id: 'gift' } });
    expect(eligibleCrateCosmetics([]).some((c) => c.id === def.id)).toBe(false);
    expect(milestoneLevelOf(def)).toBeNull();
    expect(ACHIEVEMENTS.some((a) => JSON.stringify(a.rewards).includes(def.id))).toBe(false);
  });
});
