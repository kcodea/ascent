import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeRng } from '@game/core';
import { activeSet } from '@game/content';
import { fetchPoolRuns, type PoolApi, type SampleArgs } from './poolFetch';
import { POOL_PATCH_PREFIX, poolPatchArg } from './poolPatch';

/**
 * R-POOL-ANY-VERSION-01: a lobby draws recorded runs from EVERY app version. The live bug (2026-11-04): the desktop
 * app shipped as v0.2.0 while every recorded run was v0.1.0, the pool matched the version prefix, found nothing, and
 * every ranked lobby came out all-generated (unrated, "a practice match").
 */
describe('the opponent pool is not filtered by app version', () => {
  it('the prefix is empty and reaches the server as null (= any version)', () => {
    expect(POOL_PATCH_PREFIX).toBe('');
    expect(poolPatchArg(POOL_PATCH_PREFIX)).toBeNull();
    expect(poolPatchArg('0.1.0+')).toBe('0.1.0+');
  });

  it('the sample RPC is asked for any version', async () => {
    const seen: SampleArgs[] = [];
    const api: PoolApi = {
      async sample(args) { seen.push(args); return { data: [], error: null }; },
      async lightPage() { return { data: [], error: null }; },
      async boardsForSeeds() { return { data: [], error: null }; },
    };
    await fetchPoolRuns(api, { setId: activeSet().id, patchPrefix: POOL_PATCH_PREFIX, random: makeRng(1).next }, new AbortController().signal, { rpcMissing: false });
    expect(seen.length).toBeGreaterThan(0);
    for (const a of seen) expect(a.p_patch_prefix).toBeNull();
  });

  it('no pool entry point keys on __APP_VERSION__', () => {
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
    const store = src('../store.ts');
    const remote = src('../remoteBoards.ts');
    const god = src('../godMode/godBoards.ts');
    expect(store).toMatch(/fetchAndRegisterPool\(POOL_PATCH_PREFIX\)/);
    expect(store).toMatch(/refreshOpponentPoolAndRecords\(POOL_PATCH_PREFIX\)/);
    expect(store).not.toMatch(/(fetchAndRegisterPool|refreshOpponentPoolAndRecords)\([^)]*__APP_VERSION__/);
    expect(remote).toMatch(/opponentPoolLoader\(patchPrefix = POOL_PATCH_PREFIX\)/);
    expect(god).toMatch(/patchPrefix: POOL_PATCH_PREFIX/);
  });
});
