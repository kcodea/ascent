/**
 * SOCIAL CACHE (perf 2026-10-09): the stale-while-revalidate cache behind the Leaderboard, Hall and Recent Games and
 * the title's idle prefetch. Pins: a fresh answer is served without asking; concurrent loads share ONE request; a
 * stale answer is refreshed; an empty answer (the fetchers' failure shape) never blanks a non-empty list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSocialCache, loadSocial, peekSocial, putSocial, SOCIAL_FRESH_MS } from './socialCache';

beforeEach(() => { clearSocialCache(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('socialCache', () => {
  it('shares one request between concurrent loads, then serves the fresh answer without asking', async () => {
    const fetcher = vi.fn(async () => [1, 2, 3]);
    const [a, b] = await Promise.all([loadSocial('k', fetcher), loadSocial('k', fetcher)]);
    expect(a).toEqual([1, 2, 3]);
    expect(b).toEqual([1, 2, 3]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await loadSocial('k', fetcher)).toEqual([1, 2, 3]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refreshes a stale answer (and a forced load)', async () => {
    let n = 0;
    const fetcher = vi.fn(async () => [++n]);
    await loadSocial('k', fetcher);
    vi.advanceTimersByTime(SOCIAL_FRESH_MS + 1);
    expect(await loadSocial('k', fetcher)).toEqual([2]);
    expect(await loadSocial('k', fetcher, { force: true })).toEqual([3]);
  });

  it('never lets an empty answer replace a non-empty one', async () => {
    putSocial('k', ['row']);
    expect(await loadSocial('k', async () => [], { force: true })).toEqual(['row']);
    expect(peekSocial<string[]>('k')?.data).toEqual(['row']);
    // …but an empty answer is stored when there is nothing better.
    expect(await loadSocial('empty', async () => [])).toEqual([]);
  });
});
