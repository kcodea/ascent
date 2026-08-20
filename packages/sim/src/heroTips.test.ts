import { describe, it, expect } from 'vitest';
import { HEROES } from './heroes';
import { HERO_TIPS, heroTip } from './heroTips';

/**
 * HERO-SELECT tips (owner copy 2026-08-20). The pill is optional by design — a hero with no entry renders no
 * resting face rather than an empty pill — so the job of these tests is to keep the GAP VISIBLE rather than to
 * force 100% coverage.
 */

/** Heroes the owner's 2026-08-20 copy pass did not cover. Listed explicitly so the shortfall is a decision on
 *  the record, not an oversight — and so adding a hero without a tip fails the test below and gets noticed. */
const KNOWN_UNCOVERED = ['djinn', 'chaos', 'chronoshero', 'aster'];

describe('hero tips', () => {
  it('covers every hero except the four known-uncovered ones', () => {
    const missing = HEROES.map((h) => h.id).filter((id) => !HERO_TIPS[id]);
    expect(missing.sort(), 'a hero gained/lost a tip — update KNOWN_UNCOVERED deliberately')
      .toEqual([...KNOWN_UNCOVERED].sort());
  });

  it('every tip id resolves to a real hero — no orphaned entries after a rename', () => {
    const ids = new Set(HEROES.map((h) => h.id));
    expect(Object.keys(HERO_TIPS).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('difficulty is one of the three steps, and every tip is real prose', () => {
    for (const [id, t] of Object.entries(HERO_TIPS)) {
      expect(['Easy', 'Medium', 'Hard'], `${id} difficulty`).toContain(t.difficulty);
      expect(t.tip.length, `${id} tip is too short to be useful`).toBeGreaterThan(20);
      // Player-facing prose renders as plain text — markdown would show as literal asterisks on the card.
      expect(t.tip, `${id} tip contains markdown`).not.toMatch(/\*\*/);
    }
  });

  it('heroTip() is safe for an unknown or missing id', () => {
    expect(heroTip('aster')).toBeUndefined();
    expect(heroTip('no-such-hero')).toBeUndefined();
    expect(heroTip(undefined)).toBeUndefined();
    expect(heroTip('warden')?.difficulty).toBe('Easy');
  });
});
