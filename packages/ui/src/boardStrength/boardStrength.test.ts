import { describe, expect, it } from 'vitest';
import { loadStrengthReference, scoreBoard, strengthBandForDivision, type BoardSnapshot, type StrengthReference } from '@game/sim';
import { createStrengthScorer, STRENGTH_SLICE_FIGHTS, type IdleDeadlineLike } from './strengthScorer';
import { lobbyBandFor } from './index';
import { fetchPoolRuns, type PoolApi, type SampleArgs, type SampleRow } from '../opponentPool/poolFetch';
import { createPoolLoader, type PoolLoaderDeps, type PoolRun } from '../opponentPool/poolLoader';
import { memoryPoolCache } from '../opponentPool/poolCache';
import { histogramOf } from '../remoteBoards';

/**
 * BOARD STRENGTH, the client half (R-LOBBY-09, owner 2026-09-30): the background scorer never does more than a
 * bounded slice of work per idle callback and agrees with the one-shot score; the pool fetch sends the rank band,
 * widens it when it cannot fill a table, and keeps working against a server that does not take a band yet; the
 * loader stamps each run's strength on its boards.
 */

const refP = loadStrengthReference();
const boardOf = (ref: StrengthReference, w: number, i: number): BoardSnapshot => ({ ...ref.waves[String(w)]![i]!, wave: w, setId: ref.setId } as BoardSnapshot);

/** A hand-cranked idle scheduler: `tick(deadline)` runs the one pending slice. */
function manualSlices(): { request: (fn: (d?: IdleDeadlineLike) => void) => () => void; tick(d?: IdleDeadlineLike): boolean; pending(): boolean } {
  let next: ((d?: IdleDeadlineLike) => void) | null = null;
  return {
    request: (fn) => { next = fn; return () => { next = null; }; },
    tick(d) { const f = next; next = null; if (!f) return false; f(d); return true; },
    pending: () => next !== null,
  };
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('the background scorer', () => {
  it('runs a bounded slice of fights per idle callback, and scores exactly what the one-shot scorer does', async () => {
    const ref = await refP;
    const slices = manualSlices();
    const scorer = createStrengthScorer({ loadReference: () => refP, requestSlice: slices.request, setTimer: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); } });
    const a = boardOf(ref, 5, 3); const b = boardOf(ref, 6, 20);
    scorer.enqueue(42, a);
    scorer.enqueue(42, b);
    scorer.enqueue(42, a); // the same wave again: ignored
    scorer.enqueue(42, { ...a, wave: 9, minions: [] }); // an empty board: nothing to score, never queued
    expect(scorer.pending(42)).toBe(2);
    slices.tick(); // loads the reference
    await flush();
    // No idle time at all (a timed-out callback): exactly one step per slice.
    const noIdle: IdleDeadlineLike = { didTimeout: true, timeRemaining: () => 0 };
    let before = scorer.fightsRun();
    slices.tick(noIdle);
    expect(scorer.fightsRun() - before).toBe(STRENGTH_SLICE_FIGHTS);
    let slicesRun = 1;
    while (scorer.pending(42) > 0) {
      before = scorer.fightsRun();
      expect(slices.tick(noIdle)).toBe(true);
      expect(scorer.fightsRun() - before).toBeLessThanOrEqual(STRENGTH_SLICE_FIGHTS);
      slicesRun++;
    }
    expect(slicesRun).toBe(Math.ceil((ref.waves['5']!.length * 2) / STRENGTH_SLICE_FIGHTS) + Math.ceil((ref.waves['6']!.length * 2) / STRENGTH_SLICE_FIGHTS));
    expect(scorer.scores(42).get(5)).toEqual(scoreBoard(a, ref));
    expect(scorer.scores(42).get(6)).toEqual(scoreBoard(b, ref));
    expect(slices.pending()).toBe(false); // nothing left: no more callbacks requested
  });

  it('uses the idle time it is given, and stops when it runs low', async () => {
    const ref = await refP;
    const slices = manualSlices();
    const scorer = createStrengthScorer({ loadReference: () => refP, requestSlice: slices.request, setTimer: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); } });
    scorer.enqueue(1, boardOf(ref, 3, 1));
    slices.tick(); await flush();
    let budget = 3; // three steps' worth of idle time, then it runs low
    slices.tick({ didTimeout: false, timeRemaining: () => (budget-- > 0 ? 10 : 0) });
    expect(scorer.fightsRun()).toBe(STRENGTH_SLICE_FIGHTS * 4);
  });

  it('settles at once when done, and never waits past its cap', async () => {
    const ref = await refP;
    const slices = manualSlices();
    const scorer = createStrengthScorer({ loadReference: () => refP, requestSlice: slices.request, setTimer: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); } });
    expect((await scorer.settled(7, 10_000)).size).toBe(0); // nothing queued: immediately
    scorer.enqueue(7, boardOf(ref, 4, 2));
    const t0 = Date.now();
    const got = await scorer.settled(7, 30); // nobody runs the slices: the cap answers
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(got.size).toBe(0);
    // Now let it work: settled resolves when the last board lands.
    const p = scorer.settled(7, 60_000);
    slices.tick(); await flush();
    while (slices.tick({ didTimeout: false, timeRemaining: () => 50 })) { /* drain */ }
    expect((await p).get(4)).toEqual(scoreBoard(boardOf(ref, 4, 2), ref));
    scorer.forget(7);
    expect(scorer.scores(7).size).toBe(0);
  });

  it('gives up cleanly when the reference cannot load (nothing scored, nobody left waiting)', async () => {
    const slices = manualSlices();
    const scorer = createStrengthScorer({ loadReference: () => Promise.reject(new Error('offline')), requestSlice: slices.request, setTimer: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); } });
    scorer.enqueue(3, { wave: 2, minions: [{ cardId: 'pack', attack: 1, health: 1 }] } as unknown as BoardSnapshot);
    expect(scorer.pending(3)).toBe(1);
    const p = scorer.settled(3, 60_000);
    slices.tick(); await flush();
    slices.tick();
    expect((await p).size).toBe(0);
  });
});

describe('the rank band', () => {
  it('follows the medal: Bronze 0-30, Silver 10-40, Gold 15-65, Platinum 15-100, Diamond 25-100, Ascendant 35-100', () => {
    const at = (divisionIndex: number) => lobbyBandFor({ rank: { position: { divisionIndex, points: 0 } } } as never);
    expect(at(0)).toEqual({ min: 0, max: 30 });
    expect(at(2)).toEqual({ min: 0, max: 30 });
    expect(at(3)).toEqual({ min: 10, max: 40 });
    expect(at(8)).toEqual({ min: 15, max: 65 });
    expect(at(9)).toEqual({ min: 15, max: 100 });
    expect(at(11)).toEqual({ min: 15, max: 100 });
    expect(at(12)).toEqual({ min: 25, max: 100 });
    expect(at(14)).toEqual({ min: 25, max: 100 });
    expect(at(15)).toEqual({ min: 35, max: 100 });
    expect(at(17)).toEqual({ min: 35, max: 100 });
    expect(lobbyBandFor(null)).toBeNull();
    expect(at(5)).toEqual(strengthBandForDivision(5));
  });
});

describe('the pool fetch with a band', () => {
  /** A fake sample over runs of known strength: honours the band like the SQL (unscored = inside). */
  function api(runs: Array<{ key: string; strength: number | null; user: string }>, opts: { bands: boolean }): PoolApi & { calls: SampleArgs[] } {
    const calls: SampleArgs[] = [];
    return {
      calls,
      async sample(args) {
        calls.push(args);
        if (!opts.bands && (args.p_strength_min !== undefined || args.p_strength_max !== undefined)) {
          return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.pool_runs_sample(p_exclude_user, p_limit, ...)' } };
        }
        const inBand = runs.filter((r) => r.strength === null || ((args.p_strength_min ?? 0) <= r.strength && r.strength <= (args.p_strength_max ?? 100)));
        return {
          data: inBand.map((r): SampleRow => ({
            run_key: r.key, author: r.key.split('|')[0]!, user_id: r.user, wave_count: 1, strength: r.strength === null ? null : String(r.strength),
            boards: [{ v: 1, wave: 1, heroId: r.key.split('|')[1]!, author: r.key.split('|')[0]!, seed: Number(r.key.split('|')[2]), minions: [{ cardId: 'pack', attack: 1, health: 1 }] } as unknown as BoardSnapshot],
          })),
          error: null,
        };
      },
      lightPage: async () => ({ data: [], error: null }),
      boardsForSeeds: async () => ({ data: [], error: null }),
    };
  }
  const opts = (band: { min: number; max: number } | null) => ({ setId: 'set2' as const, patchPrefix: '0.1.0+', random: Math.random, band });
  const runs = Array.from({ length: 20 }, (_, i) => ({ key: `P${i}|h${i}|${i}`, strength: (i + 1) * 5, user: `u${i}` }));

  it('asks for the band, and stops there when it can seat a table', async () => {
    const a = api(runs, { bands: true });
    const got = await fetchPoolRuns(a, opts({ min: 0, max: 50 }), new AbortController().signal, { rpcMissing: false });
    expect(a.calls.map((c) => [c.p_strength_min, c.p_strength_max])).toEqual([[0, 50]]);
    expect(got.runs.length).toBe(10);
    expect(got.widenings).toBe(0);
    expect(got.runs.every((r) => r.strength! <= 50)).toBe(true);
  });

  it('widens step by step until the runs can fill a table, merging what each step found', async () => {
    const a = api(runs, { bands: true });
    const got = await fetchPoolRuns(a, opts({ min: 0, max: 20 }), new AbortController().signal, { rpcMissing: false });
    expect(a.calls.map((c) => c.p_strength_max)).toEqual([20, 30, 40]); // 4, 6, then 8 runs: 7 seats need the third
    expect(got.widenings).toBe(2);
    expect(got.runs.length).toBe(8);
  });

  it('before the SQL, drops the band for the session and still uses the RPC (never the fallback)', async () => {
    const a = api(runs, { bands: false });
    const session = { rpcMissing: false };
    const got = await fetchPoolRuns(a, opts({ min: 0, max: 30 }), new AbortController().signal, session);
    expect(got.path).toBe('rpc');
    expect(got.runs.length).toBe(20);
    expect(got.widenings).toBeUndefined();
    expect(session).toEqual({ rpcMissing: false, bandsMissing: true });
    await fetchPoolRuns(a, opts({ min: 0, max: 30 }), new AbortController().signal, session);
    expect(a.calls.slice(2).every((c) => c.p_strength_min === undefined)).toBe(true); // not asked again
  });

  it('treats unscored runs as inside the band', async () => {
    const a = api(runs.map((r) => ({ ...r, strength: null })), { bands: true });
    const got = await fetchPoolRuns(a, opts({ min: 0, max: 30 }), new AbortController().signal, { rpcMissing: false });
    expect(got.runs.length).toBe(20);
    expect(got.runs.every((r) => r.strength === undefined)).toBe(true);
  });
});

describe('the loader', () => {
  const run = (i: number, strength?: number): PoolRun => ({
    key: `P${i}|h${i}|${i}`, waves: 1, ownerId: `u${i}`, ...(strength !== undefined ? { strength } : {}),
    snaps: [{ v: 1, wave: 1, heroId: `h${i}`, author: `P${i}`, seed: i, minions: [{ cardId: 'pack', attack: 1, health: 1 }] } as unknown as BoardSnapshot],
  });
  const base = (over: Partial<PoolLoaderDeps>): PoolLoaderDeps => ({
    fetchRuns: async () => ({ runs: [], path: 'rpc' }), registerRuns: (rs) => ({ runs: rs.length, boards: rs.length, dropped: 0 }),
    cache: memoryPoolCache(), setId: () => 'set2', patchPrefix: '0.1.0+', now: () => 0, sleep: async () => {}, schedule: () => () => {}, ...over,
  });

  it("stamps each run's strength on its boards and records the band's widenings", async () => {
    const registered: BoardSnapshot[][] = [];
    const loader = createPoolLoader(base({
      fetchRuns: async () => ({ runs: [run(1, 22), run(2)], path: 'rpc', widenings: 1 }),
      registerRuns: (rs) => { registered.push(...rs); return { runs: rs.length, boards: rs.length, dropped: 0 }; },
    }));
    const s = await loader.load({ perRequestMs: 1000, attempts: 1, retryBaseMs: 0 });
    expect(s.bandWidenings).toBe(1);
    expect(registered[0]![0]!.runStrength).toBe(22);
    expect(registered[1]![0]!.runStrength).toBeUndefined();
  });

  it('fetches again for a new band (a rank change) without holding the lobby up', async () => {
    let band: { min: number; max: number } | null = { min: 0, max: 30 };
    let fetches = 0;
    const loader = createPoolLoader(base({ band: () => band, fetchRuns: async () => { fetches++; return { runs: [run(fetches)], path: 'rpc' }; } }));
    await loader.load({ perRequestMs: 1000, attempts: 1, retryBaseMs: 0 });
    await loader.load({ perRequestMs: 1000, attempts: 1, retryBaseMs: 0 });
    expect(fetches).toBe(1); // same band: the session's sample stands
    band = { min: 10, max: 40 };
    const s = await loader.ensure();
    expect(s.status).toBe('ready'); // answered at once
    await flush();
    expect(fetches).toBe(2); // and refreshed for the new band in the background
  });
});

describe('the histogram', () => {
  it('reads the RPC rows into per-wave entries, or null when empty', () => {
    expect(histogramOf([{ wave: 1, raw: '0.5', n: '3' }, { wave: '2', raw: 0.25, n: 1 }, { wave: 2, raw: 'x', n: 1 }])).toEqual({
      '1': [{ raw: 0.5, count: 3 }], '2': [{ raw: 0.25, count: 1 }],
    });
    expect(histogramOf([])).toBeNull();
  });
});
