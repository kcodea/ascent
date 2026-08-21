/**
 * `gildCopiesNeeded` — the ONE number the reducer's `checkTriples` and the shop's "buying this completes a
 * Gild" indicator both read.
 *
 * They disagreed (owner report 2026-08-21): the reducer used 2 copies for Midas' Touch / Rune of Twin
 * Gilding, but the shop hardcoded "you already hold 2", i.e. a threshold of 3. So a Midas player — who Gilds
 * at 2 — saw no highlight on the duplicate in their shop that would have completed it on the spot.
 */
import { describe, expect, it } from 'vitest';
import { gildCopiesNeeded } from './heroes';

describe('gildCopiesNeeded', () => {
  it('is 3 for an ordinary run', () => {
    expect(gildCopiesNeeded({ heroId: 'warden' })).toBe(3);
  });

  it('is 2 for Midas, whose power Gilds at two copies', () => {
    expect(gildCopiesNeeded({ heroId: 'midas' })).toBe(2);
  });

  it('is 2 under Rune of Twin Gilding, whatever the hero', () => {
    expect(gildCopiesNeeded({ heroId: 'warden', runeTwinGilding: true })).toBe(2);
  });

  it('cannot stack down to 1 when both apply', () => {
    expect(gildCopiesNeeded({ heroId: 'midas', runeTwinGilding: true })).toBe(2);
  });

  it('an unknown hero id falls back to the ordinary 3 rather than throwing', () => {
    expect(gildCopiesNeeded({ heroId: 'nobody-by-that-name' })).toBe(3);
  });

  it('the shop indicator threshold is one less than the requirement', () => {
    // The shop lights an offer when you ALREADY hold `need - 1`, so buying it lands on `need`.
    expect(gildCopiesNeeded({ heroId: 'midas' }) - 1).toBe(1);   // Midas: one on board is enough
    expect(gildCopiesNeeded({ heroId: 'warden' }) - 1).toBe(2);  // everyone else: two
  });
});
