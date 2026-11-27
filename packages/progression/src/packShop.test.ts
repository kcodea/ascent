import { describe, expect, it } from 'vitest';
import { aetherShort, canAfford, ownedEveryNotice, ownsEveryCosmetic, type PackOffer } from './packShop';

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
