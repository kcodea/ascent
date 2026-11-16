import { describe, expect, it } from 'vitest';
import { STORAGE_DELETE_MAX, deleteInChunks } from '../src/core/poolMirrorCore';

/**
 * A Durable Object deletes at most 128 keys per call. The rolling pool (R-POOL-ROLLING-01) drops about 300 runs from
 * the mirror in ONE sync the first time it applies, so the drop must go in chunks or the sync fails forever.
 */
describe('the pool mirror drops any number of runs', () => {
  it('never asks storage to delete more than 128 keys at once, and deletes every key once', async () => {
    const seen: string[] = [];
    const del = async (keys: string[]): Promise<void> => {
      if (keys.length > 128) throw new Error('Maximum number of keys is 128');
      seen.push(...keys);
    };
    const keys = Array.from({ length: 301 }, (_, i) => `run:${i}`);
    await deleteInChunks(del, keys);
    expect(seen).toEqual(keys);
    expect(STORAGE_DELETE_MAX).toBe(128);
  });

  it('does nothing for no keys', async () => {
    let calls = 0;
    await deleteInChunks(async () => { calls += 1; }, []);
    expect(calls).toBe(0);
  });
});
