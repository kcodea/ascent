import { describe, expect, it } from 'vitest';
import { COSMETICS, type CosmeticDef } from './cosmetics';
import { aetherShort, canAfford, ownedEveryNotice, ownsEveryCosmetic, shelfOffers, type PackOffer } from './packShop';

const offer = (price: number, soldOut = false): PackOffer => ({
  offerId: 'o',
  look: { kind: 'rarity', id: 'rare', name: 'Rare Pack', guaranteedFloor: 'rare' },
  price,
  shelf: 's',
  contains: 1,
  soldOut,
});

describe('pack shop contract', () => {
  it('affordable at exactly the price, never when sold out, always when free', () => {
    expect(canAfford(offer(200), 200)).toBe(true);
    expect(canAfford(offer(200), 199)).toBe(false);
    expect(canAfford(offer(200, true), 999)).toBe(false);
    expect(canAfford(offer(0), 0)).toBe(true);
  });
  it('reports how much is missing', () => {
    expect(aetherShort(offer(200), 150)).toBe(50);
    expect(aetherShort(offer(200), 500)).toBe(0);
  });
});

// owner 2026-11-27: "lightly grey out the pack and overlay a notice that says 'You own every cosmetic from this pack. You may
// continue purchasing more of the "name_of_pack" at your own descretion.'" (category packs only: rarity packs may duplicate)
describe('shelfOffers sells only packs that can be opened (R-PROG-PACK-01)', () => {
  const rarityIds = (cat: readonly CosmeticDef[]): string[] => shelfOffers('w', cat).filter((o) => o.shelf === 'rarity').map((o) => o.look.id);
  it('lists every Rarity pack while each rarity has something rollable', () => {
    expect(rarityIds(COSMETICS)).toEqual(['rarity-common', 'rarity-rare', 'rarity-epic', 'rarity-legendary', 'rarity-ancient']);
  });
  it('omits a Rarity pack with nothing at or above its rarity, keeps the ones below it', () => {
    const noAncient = COSMETICS.map((c) => (c.rarity === 'ancient' ? { ...c, active: false } : c));
    expect(rarityIds(noAncient)).toEqual(['rarity-common', 'rarity-rare', 'rarity-epic', 'rarity-legendary']);
    // only Common left: the Common pack alone (its last card can be Common), never a higher one
    const commonOnly = COSMETICS.map((c) => (c.rarity !== 'common' ? { ...c, active: false } : c));
    expect(rarityIds(commonOnly)).toEqual(['rarity-common']);
    // only Ancient left: every Rarity pack still opens (its last card is Ancient, at or above every floor)
    const ancientOnly = COSMETICS.map((c) => (c.rarity !== 'ancient' ? { ...c, active: false } : c));
    expect(rarityIds(ancientOnly)).toEqual(['rarity-common', 'rarity-rare', 'rarity-epic', 'rarity-legendary', 'rarity-ancient']);
  });
});

describe('owning every cosmetic a pack can give', () => {
  const cat: PackOffer = { offerId: 'c', look: { kind: 'category', id: 'category-emote', name: 'Emote Pack', guaranteedFloor: 'rare' }, price: 200, shelf: 'category', contains: 1, newToYou: { unowned: 0, total: 40 } };
  it('is a category / style pack with nothing new left, never a rarity pack', () => {
    expect(ownsEveryCosmetic(cat)).toBe(true);
    expect(ownsEveryCosmetic({ ...cat, newToYou: { unowned: 1, total: 40 } })).toBe(false);
    expect(ownsEveryCosmetic({ ...cat, newToYou: undefined })).toBe(false);
    expect(ownsEveryCosmetic({ ...cat, look: { kind: 'rarity', id: 'rarity-rare', name: 'Rare Pack', guaranteedFloor: 'rare' } })).toBe(false);
  });
  it('names the pack in the notice', () => {
    expect(ownedEveryNotice(cat)).toBe('You own every cosmetic from this pack. You may continue purchasing more of the "Emote Pack" at your own discretion.');
  });
});

describe('the pack reward (owner 2026-11-27: every 15 packs purchased gives one free Rarity Pack, Epic since his later ruling)', () => {
  it('is an Epic pack ("change the free legendary after 15 purchases to Epic")', async () => {
    const { PACK_REWARD_RARITY } = await import('./packShop');
    expect(PACK_REWARD_RARITY).toBe('epic');
  });
  it('counts purchases, earns one per 15, carries the remainder, and stacks unclaimed rewards', async () => {
    const { PACK_REWARD_EVERY, packRewardAfter } = await import('./packShop');
    expect(PACK_REWARD_EVERY).toBe(15);
    expect(packRewardAfter({ progress: 0, ready: 0 }, 1)).toEqual({ progress: 1, ready: 0 });
    expect(packRewardAfter({ progress: 14, ready: 0 }, 1)).toEqual({ progress: 0, ready: 1 });
    expect(packRewardAfter({ progress: 13, ready: 0 }, 3)).toEqual({ progress: 1, ready: 1 });
    expect(packRewardAfter({ progress: 5, ready: 1 }, 25)).toEqual({ progress: 0, ready: 3 });
    expect(packRewardAfter({ progress: 4, ready: 0 }, 0)).toEqual({ progress: 4, ready: 0 });
  });
});
