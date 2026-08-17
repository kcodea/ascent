import { describe, it, expect } from 'vitest';
import { createRun, openEpicRuneforge, type RunState } from './index';

/** Guardian + Runesmith: the forge their OWN power opens is discounted on every slot (owner 2026-08-17). */

describe('hero-owned Runeforge is fully discounted', () => {
  // Driven through a draw ROUTE rather than a turn-advance: the discount keys off the HERO's power kind, not
  // on which path opened the forge, and that is the behaviour worth pinning.
  it("Runesmith's forge discounts every slot", () => {
    const s = { ...createRun(4, 'runesmith') } as RunState;
    openEpicRuneforge(s);
    expect(s.runeforgeOffer?.length, 'the forge opened').toBeGreaterThan(0);
    expect(s.runeforgeDiscounts?.length).toBe(s.runeforgeOffer!.length);
    for (const d of s.runeforgeDiscounts!) expect(d, 'every slot carries a discount').toBeGreaterThan(0);
  });

  it("Guardian's epic forge discounts every slot", () => {
    const s = { ...createRun(4, 'runeguard') } as RunState;
    openEpicRuneforge(s);
    expect(s.runeforgeOffer?.length).toBeGreaterThan(0);
    for (const d of s.runeforgeDiscounts!) expect(d, 'every slot carries a discount').toBeGreaterThan(0);
  });

  it('a forge opened for ANY OTHER hero keeps the sparse pivot discounts', () => {
    const s = { ...createRun(4, 'indy') } as RunState;
    openEpicRuneforge(s);
    const some = (s.runeforgeDiscounts ?? []).filter((d) => d !== undefined).length;
    expect(some, 'not every slot is discounted for a non-forge hero').toBeLessThan((s.runeforgeOffer ?? []).length);
  });
});
