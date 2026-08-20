import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { BoardMinion } from '@game/core';
import { storedCardView, isUnknownStoredCard, UNKNOWN_CARD_NAME } from './storedBoardView';

/**
 * Owner report 2026-08-20: Career boards rendered as `d2_transcendence` / tribe NEUTRAL / placeholder art.
 *
 * Career + Leaderboard history is fetched from the SERVER, so a row can be written by one build and read by
 * another — two devs on divergent content branches share one database, and a packaged build lags the branch
 * that played the run. These tests reproduce that split directly: a minion whose `cardId` this build does NOT
 * have must still render as itself.
 */

const minion = (over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId: 'pack', attack: 5, health: 4, keywords: [], ...over }) as BoardMinion;

describe('a card THIS build has', () => {
  it('prefers the live def, so renames and re-tribes are picked up', () => {
    const def = CARD_INDEX['d2_transcendence']!;
    // Stale identity baked at capture — the live def must win, or an old row would freeze a renamed card.
    const v = storedCardView(minion({ cardId: 'd2_transcendence', name: 'Transcendence', tribe: 'neutral' }));
    expect(v.name).toBe(def.name);
    expect(v.tribe).toBe(def.tribe);
    expect(isUnknownStoredCard(minion({ cardId: 'd2_transcendence' }))).toBe(false);
  });
});

describe('a card this build does NOT have (the reported bug)', () => {
  // An id from a divergent content branch. `n2_ninefold` is real on `content/rune-batch-2026-08-20` and
  // absent from main — exactly the class of row that produced the report.
  const foreign = () => minion({
    cardId: 'n2_ninefold', name: 'Ninefold Chorus', tribe: 'dragon',
    text: 'Some baked rule text.', attack: 57, health: 40, golden: true,
  });

  it('is not in this build — the premise of the test', () => {
    expect(CARD_INDEX['n2_ninefold'], 'main gained this id; pick another divergent id').toBeUndefined();
  });

  it('renders its baked NAME, never the raw card id', () => {
    const v = storedCardView(foreign());
    expect(v.name).toBe('Ninefold Chorus');
    expect(v.name, 'an internal id leaked into the UI').not.toBe('n2_ninefold');
  });

  it('renders its baked TRIBE, not a NEUTRAL fallback', () => {
    expect(storedCardView(foreign()).tribe).toBe('dragon');
  });

  it('keeps the stats and the baked rule text it was captured with', () => {
    const v = storedCardView(foreign());
    expect([v.attack, v.health]).toEqual([57, 40]);
    expect(v.text).toBe('Some baked rule text.');
    expect(v.golden).toBe(true);
  });

  it('reports its stats as unbuffed rather than claiming growth it cannot substantiate', () => {
    // With no def there is no printed base to compare against, so base := stored.
    const v = storedCardView(foreign());
    expect([v.baseAttack, v.baseHealth]).toEqual([57, 40]);
  });
});

describe('a row written BEFORE the identity bake shipped', () => {
  const legacy = () => minion({ cardId: 'n2_ninefold', text: 'Baked text only.' });

  it('is labelled Unknown rather than showing its id', () => {
    expect(storedCardView(legacy()).name).toBe(UNKNOWN_CARD_NAME);
    expect(isUnknownStoredCard(legacy())).toBe(true);
  });

  it('still shows whatever it did manage to bake', () => {
    expect(storedCardView(legacy()).text).toBe('Baked text only.');
  });

  it('a known card is never labelled Unknown, even with nothing baked', () => {
    expect(storedCardView(minion({ cardId: 'pack' })).name).toBe(CARD_INDEX['pack']!.name);
    expect(isUnknownStoredCard(minion({ cardId: 'pack' }))).toBe(false);
  });
});
