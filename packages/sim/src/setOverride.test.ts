import { describe, it, expect } from 'vitest';
import { activeSet, poolFor } from '@game/content';
import { CONFIG, createRun, poolOf } from './index';

/**
 * `createRun`'s optional `setId` override — what lets the DEV Scene Builder play an unreleased set.
 *
 * The load-bearing property is NON-disruption: set 2 is authored and playtested while set 1 stays live for
 * real players. Two things have to hold for that:
 *   1. the default is unchanged — every real run still pins `activeSet()`, and its seeds are byte-identical
 *      to what they were before the parameter existed; and
 *   2. a run pinned to another set draws from THAT set only, never leaking set 1's pool in.
 */
const line = CONFIG.defaultLine;

describe('createRun set override', () => {
  it('defaults to the live set, and passing it explicitly changes nothing', () => {
    const implicit = createRun(12345, 'warden');
    const explicit = createRun(12345, 'warden', 'ascent', line, activeSet().id);
    expect(implicit.setId).toBe(activeSet().id);
    // Seed integrity: the same seed must still roll the same opening shop. If this ever fails, the parameter
    // has perturbed live runs — which is the one thing it must never do.
    expect(implicit.shop.map((c) => c.cardId)).toEqual(explicit.shop.map((c) => c.cardId));
    expect(implicit.shop.length).toBeGreaterThan(0);
  });

  it('pins the requested set and reads its pool through poolOf', () => {
    const run = createRun(1, 'warden', 'practice', line, 'set2');
    expect(run.setId).toBe('set2');
    expect(poolOf(run).setId).toBe('set2');
  });

  it('a run on another set draws NOTHING from set 1', () => {
    // Set 2 is empty while in development, so this is currently "an empty shop". The assertion is written
    // against the POOL rather than the count, so it keeps meaning something once set 2 has cards: whatever
    // the shop offers must be drawable from the pinned set.
    const run = createRun(7, 'warden', 'practice', line, 'set2');
    const set2Ids = new Set(poolFor('set2').all.map((c) => c.id));
    for (const offer of run.shop) expect(set2Ids.has(offer.cardId), `${offer.cardId} is not in set 2`).toBe(true);
  });

  it('an empty set degrades gracefully rather than throwing', () => {
    // The rig will sit on an empty set 2 on day one — that must read as "no cards yet", not a crash.
    expect(() => createRun(3, 'warden', 'practice', line, 'set2')).not.toThrow();
    expect(poolFor('set2').buyable.length).toBe(poolOf(createRun(3, 'warden', 'practice', line, 'set2')).buyable.length);
  });
});
