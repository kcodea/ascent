import { describe, expect, it } from 'vitest';
import { aetherShort, canAfford, type PackOffer } from './packShop';

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
