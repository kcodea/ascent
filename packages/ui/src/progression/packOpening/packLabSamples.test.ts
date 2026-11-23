import { describe, expect, it } from 'vitest';
import { COSMETIC_CATEGORIES, parsePackOpenResult } from '@game/progression';
import { PACK_LAB_SAMPLES, PACK_LAB_LOOKS, sampleCategoryOf, withLook } from './packLabSamples';

const byId = (id: string) => PACK_LAB_SAMPLES.find((s) => s.id === id)!;

describe('Pack Lab samples', () => {
  it('has every sample the brief names', () => {
    for (const id of ['all-new', 'mixed-dupes', 'legendary-guaranteed', 'ancient-guaranteed', 'every-category-a', 'every-category-b', 'unknown-reward', 'slow', 'failed']) {
      expect(byId(id), id).toBeTruthy();
    }
    expect(byId('slow').delayMs).toBe(5000);
    expect(byId('failed').fail).toBe(true);
  });

  it('every sample result parses with parsePackOpenResult', () => {
    for (const s of PACK_LAB_SAMPLES) expect(parsePackOpenResult(s.result), s.id).not.toBeNull();
  });

  it('the every-category samples cover all ten COSMETIC_CATEGORIES', () => {
    const covered = new Set(
      PACK_LAB_SAMPLES.filter((s) => s.id.startsWith('every-category')).flatMap((s) => s.result.cards.map((c) => sampleCategoryOf(c.rewardId))),
    );
    for (const cat of COSMETIC_CATEGORIES) expect(covered.has(cat), cat).toBe(true);
  });

  it("each sample's guaranteed card is last, and there is exactly one", () => {
    for (const s of PACK_LAB_SAMPLES) {
      const cards = s.result.cards;
      expect(cards.filter((c) => c.guaranteed), s.id).toHaveLength(1);
      expect(cards[cards.length - 1]!.guaranteed, s.id).toBe(true);
    }
  });

  it('withLook swaps the look, raises the guaranteed card to its floor, and still parses', () => {
    const ancient = PACK_LAB_LOOKS.find((l) => l.id === 'rarity-ancient')!;
    const out = withLook(byId('all-new').result, ancient);
    expect(out.pack).toEqual(ancient);
    expect(out.cards[out.cards.length - 1]!.rarity).toBe('ancient');
    expect(parsePackOpenResult(out)).not.toBeNull();
  });

  it('offers rarity, category and themed looks', () => {
    for (const k of ['rarity', 'category', 'themed']) expect(PACK_LAB_LOOKS.some((l) => l.kind === k), k).toBe(true);
  });
});
