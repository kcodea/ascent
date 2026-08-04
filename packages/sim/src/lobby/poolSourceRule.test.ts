import { describe, it, expect } from 'vitest';
import { OPPONENT_POOL_DATA } from '../opponentPool.data';
import { playerRunsFrom } from './snapshotSeats';

/**
 * OPPONENT SOURCES (owner call 2026-08-03: "I ONLY want it to be bots or online opponents").
 *
 * The store no longer registers this browser's `loadStoredBoards()` into the opponent pool, so the only
 * player-run source is the shared Supabase pool. What stays registered is the committed
 * `OPPONENT_POOL_DATA` — and the pin below is that it can NEVER supply a lobby seat, because every board in
 * it is `origin: 'synthetic'` and `playerRunsFrom` excludes synthetic outright. If a future `npm run pool`
 * bake ever emitted a non-synthetic board, this fails loudly rather than silently seating a house board as a
 * player.
 */
describe('the committed pool can never seat a player run', () => {
  it('every committed board is synthetic', () => {
    expect(OPPONENT_POOL_DATA.length).toBeGreaterThan(0);
    const nonSynthetic = OPPONENT_POOL_DATA.filter((b) => (b.origin ?? 'house') !== 'synthetic');
    expect(nonSynthetic.map((b) => b.author ?? b.heroId)).toEqual([]);
  });

  it('so grouping it into player runs yields nothing, for either set', () => {
    expect(playerRunsFrom(OPPONENT_POOL_DATA, undefined, 'set1')).toEqual([]);
    expect(playerRunsFrom(OPPONENT_POOL_DATA, undefined, 'set2')).toEqual([]);
    expect(playerRunsFrom(OPPONENT_POOL_DATA)).toEqual([]);
  });
});
