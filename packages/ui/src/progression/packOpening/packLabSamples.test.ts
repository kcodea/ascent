import { describe, expect, it, vi } from 'vitest';
import { COSMETIC_CATEGORIES, parsePackOpenResult } from '@game/progression';
import { DUPLICATE_AETHER, PACK_LAB_SAMPLES, PACK_LAB_LOOKS, cancelLabTimers, makeLabOpen, sampleCategoryOf, withLook } from './packLabSamples';
import { RARITY_PACK_PRICE } from '../packShop/shopLabData';

const byId = (id: string) => PACK_LAB_SAMPLES.find((s) => s.id === id)!;

// owner 2026-11-27: "lets refund 20% of the pack's rarity value. so common would be 20, and so forth" ... "its own rarity"
describe('duplicate refunds', () => {
  it('pay 20% of the rarity pack price for the card\'s OWN rarity, in every sample', () => {
    for (const [r, price] of Object.entries(RARITY_PACK_PRICE)) expect(DUPLICATE_AETHER[r as keyof typeof DUPLICATE_AETHER], r).toBe(price * 0.2);
    let dups = 0;
    for (const s of PACK_LAB_SAMPLES) for (const c of s.result.cards) if (c.duplicate) { dups++; expect(c.duplicate.aether, `${s.id} ${c.rewardId}`).toBe(DUPLICATE_AETHER[c.rarity]); }
    expect(dups).toBeGreaterThan(3);
  });
});

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

describe('makeLabOpen', () => {
  it('a cancelled slow sample leaves no timer and never settles', async () => {
    vi.useFakeTimers();
    try {
      const timers = new Set<ReturnType<typeof setTimeout>>();
      let settled = false;
      void makeLabOpen(byId('slow'), PACK_LAB_LOOKS[0]!, timers)().then(() => { settled = true; });
      expect(timers.size).toBe(1);
      cancelLabTimers(timers);
      expect(timers.size).toBe(0);
      await vi.advanceTimersByTimeAsync(6000);
      expect(settled).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('answers with the run look after the delay', async () => {
    vi.useFakeTimers();
    try {
      const timers = new Set<ReturnType<typeof setTimeout>>();
      const look = PACK_LAB_LOOKS.find((l) => l.id === 'rarity-ancient')!;
      const p = makeLabOpen(byId('slow'), look, timers)();
      await vi.advanceTimersByTimeAsync(5000);
      const out = await p;
      expect(out.status === 'ok' && out.result.pack.id).toBe('rarity-ancient');
      expect(timers.size).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
