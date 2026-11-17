import { describe, it, expect } from 'vitest';
import { liveRunsOf, LIVE_CACHE_ERROR, type LivePool, type LiveRun } from './livePool';

const run = (key: string, over: Partial<LiveRun> = {}): LiveRun =>
  ({ key, author: key, userId: null, setId: 'set2', patchPrefix: '', eligible: true, live: true, boards: [], ...over });

describe('liveRunsOf', () => {
  it('keeps eligible live runs of the set, in order', () => {
    const pool: LivePool = { fetchedAt: '', runs: [run('a'), run('b', { live: false }), run('c', { eligible: false }), run('d', { setId: 'set1' }), run('e')] };
    expect(liveRunsOf(pool, 'set2').map((r) => r.key)).toEqual(['a', 'e']);
  });
  it('refuses a cache fetched before the live flag existed', () => {
    const old = { fetchedAt: '', runs: [{ ...run('a'), live: undefined }] } as unknown as LivePool;
    expect(() => liveRunsOf(old, 'set2')).toThrow(LIVE_CACHE_ERROR);
  });
});
