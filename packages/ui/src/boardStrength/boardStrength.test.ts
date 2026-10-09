import { afterEach, describe, expect, it } from 'vitest';
import { OPPONENT_POOL, STRENGTH_BANDS, createLobbyRun, loadStrengthReference, playableHeroes, registerOpponentRuns, scoreBoard, strengthBandForDivision, type BoardSnapshot, type StrengthReference } from '@game/sim';
import { activeSet } from '@game/content';
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
  it('follows the medal: Bronze early-only 0-20 capped at 40, Silver 80% early 10-30 capped at 60, Gold 60% early 10-50 capped at 75, open from Platinum (R-LOBBY-13 + R-LOBBY-15)', () => {
    const at = (divisionIndex: number) => lobbyBandFor({ rank: { position: { divisionIndex, points: 0 } } } as never);
    expect(at(0)).toEqual({ min: 0, max: 20, earlyWeight: 1, overallCap: 40 });
    expect(at(2)).toEqual({ min: 0, max: 20, earlyWeight: 1, overallCap: 40 });
    expect(at(3)).toEqual({ min: 10, max: 30, earlyWeight: 0.8, overallCap: 60 });
    expect(at(8)).toEqual({ min: 10, max: 50, earlyWeight: 0.6, overallCap: 75 });
    expect(at(9)).toBeNull();
    expect(at(11)).toBeNull();
    expect(at(12)).toBeNull();
    expect(at(14)).toBeNull();
    expect(at(15)).toBeNull();
    expect(at(17)).toBeNull();
    expect(lobbyBandFor(null)).toBeNull();
    expect(at(5)).toEqual(strengthBandForDivision(5));
  });
});

describe('the pool fetch with a band', () => {
  /** A fake sample over runs of known strength: honours the band like the SQL (unscored = inside). */
  function api(runs: Array<{ key: string; strength: number | null; user: string; early?: number | null; late?: number | null }>, opts: { bands: boolean; split?: boolean; caps?: boolean }): PoolApi & { calls: SampleArgs[] } {
    const calls: SampleArgs[] = [];
    return {
      calls,
      async sample(args) {
        calls.push(args);
        if (!opts.bands && (args.p_strength_min !== undefined || args.p_strength_max !== undefined)) {
          return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.pool_runs_sample(p_exclude_user, p_limit, ...)' } };
        }
        // A server before the early/late SQL has no p_early_weight: PostgREST finds no function for the call.
        if (!opts.split && args.p_early_weight !== undefined) {
          return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.pool_runs_sample(p_early_weight, p_exclude_user, ...)' } };
        }
        // A server before the caps SQL (R-LOBBY-15) has no p_strength_cap.
        if (!opts.caps && args.p_strength_cap !== undefined) {
          return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.pool_runs_sample(p_early_weight, p_exclude_user, p_strength_cap, ...)' } };
        }
        const w = args.p_early_weight;
        const cap = args.p_strength_cap;
        const score = (r: typeof runs[number]): number | null => (w === undefined ? r.strength
          : typeof r.early === 'number' && typeof r.late === 'number' ? w * r.early + (1 - w) * r.late : r.early ?? r.late ?? r.strength);
        const inBand = runs.filter((r) => { const s = score(r); return s === null || ((args.p_strength_min ?? 0) <= s && s <= (args.p_strength_max ?? 100)); })
          .filter((r) => cap === undefined || r.strength === null || r.strength <= cap);
        return {
          data: inBand.map((r): SampleRow => ({
            ...(opts.split ? { strength_early: r.early ?? null, strength_late: r.late ?? null } : {}),
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
  const opts = (band: { min: number; max: number; earlyWeight?: number; overallCap?: number } | null) => ({ setId: 'set2' as const, patchPrefix: '0.1.0+', random: Math.random, band });
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

  it('sends a split band as (weight, min, max) and keeps each run\'s early / late ratings (R-LOBBY-13)', async () => {
    // early 5..100, late reversed: the Bronze early-only band 0-20 holds the first four by EARLY.
    const split = runs.map((r, i) => ({ ...r, strength: 50, early: (i + 1) * 5, late: 100 - i * 5 }));
    const a = api(split, { bands: true, split: true });
    const session = { rpcMissing: false };
    const got = await fetchPoolRuns(a, opts({ min: 0, max: 20, earlyWeight: 1 }), new AbortController().signal, session);
    expect(a.calls.map((c) => [c.p_early_weight, c.p_strength_min, c.p_strength_max])).toEqual([[1, 0, 20], [1, 0, 30], [1, 0, 40]]);
    expect(got.runs.map((r) => r.early)).toEqual([5, 10, 15, 20, 25, 30, 35, 40]);
    expect(got.runs[0]).toMatchObject({ strength: 50, early: 5, late: 100 });
    expect(session).toEqual({ rpcMissing: false });
  });

  it('before the early/late SQL, drops ONLY the weight for the session: the same min/max filters the weighted strength', async () => {
    const a = api(runs, { bands: true, split: false });
    const session = { rpcMissing: false };
    const got = await fetchPoolRuns(a, opts({ min: 0, max: 20, earlyWeight: 1 }), new AbortController().signal, session);
    expect(got.path).toBe('rpc');
    // weighted try, then the plain band (strengths 5..20 = 4 runs), widened to 0-30 (6) and 0-40 (8).
    expect(a.calls.map((c) => [c.p_early_weight, c.p_strength_max])).toEqual([[1, 20], [undefined, 20], [undefined, 30], [undefined, 40]]);
    expect(got.runs.length).toBe(8);
    expect(got.widenings).toBe(2);
    expect(got.runs.every((r) => r.early === undefined && r.late === undefined)).toBe(true);
    expect(session).toEqual({ rpcMissing: false, splitBandsMissing: true });
    await fetchPoolRuns(a, opts({ min: 0, max: 20, earlyWeight: 1 }), new AbortController().signal, session);
    expect(a.calls.slice(4).every((c) => c.p_early_weight === undefined)).toBe(true); // not asked again
  });

  it('sends a capped band\'s overall cap (R-LOBBY-15): the server drops runs over it, and the cap rides every widening step', async () => {
    // EARLY 5 for everyone (deep inside Bronze's 0-20), overall strength 5..100: only the cap decides.
    const capped = runs.map((r) => ({ ...r, early: 5, late: 50 }));
    const a = api(capped, { bands: true, split: true, caps: true });
    const session = { rpcMissing: false };
    const got = await fetchPoolRuns(a, opts(STRENGTH_BANDS.Bronze), new AbortController().signal, session);
    expect(a.calls.map((c) => [c.p_early_weight, c.p_strength_min, c.p_strength_max, c.p_strength_cap])).toEqual([[1, 0, 20, 40]]);
    expect(got.runs.map((r) => r.strength)).toEqual([5, 10, 15, 20, 25, 30, 35, 40]); // exactly 40 is in
    expect(session).toEqual({ rpcMissing: false });
    // A thin capped band widens with the cap on every request, ending on the cap alone (min 0, max 100), never uncapped.
    const thin = runs.map((r, i) => ({ ...r, early: 5 + i * 5, late: 50 }));
    const b = api(thin, { bands: true, split: true, caps: true });
    await fetchPoolRuns(b, opts({ min: 0, max: 20, earlyWeight: 1, overallCap: 10 }), new AbortController().signal, { rpcMissing: false });
    expect(b.calls.length).toBe(9);
    expect(b.calls.every((c) => c.p_strength_cap === 10)).toBe(true);
    expect(b.calls.at(-1)).toMatchObject({ p_strength_min: 0, p_strength_max: 100, p_strength_cap: 10 });
  });

  it('before the caps SQL, drops ONLY the cap for the session, keeps the band, and counts only under-cap runs when deciding to widen', async () => {
    // Overall 5..100, EARLY 5 for the first ten runs (inside Bronze) and 60 for the rest. The server ignores the cap,
    // so it delivers the first ten (strength 5..50); only 8 are under 40. 8 under-cap runs from 8 players seat a table.
    const mixed = runs.map((r, i) => ({ ...r, early: i < 10 ? 5 : 60, late: 50 }));
    const a = api(mixed, { bands: true, split: true, caps: false });
    const session = { rpcMissing: false };
    const got = await fetchPoolRuns(a, opts(STRENGTH_BANDS.Bronze), new AbortController().signal, session);
    expect(got.path).toBe('rpc');
    expect(a.calls.map((c) => [c.p_early_weight, c.p_strength_max, c.p_strength_cap])).toEqual([[1, 20, 40], [1, 20, undefined]]);
    expect(session).toEqual({ rpcMissing: false, capsMissing: true });
    // The over-cap runs arrive WITH their strength, so seat selection can refuse them (the cap holds client-side).
    expect(got.runs.map((r) => r.strength)).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
    await fetchPoolRuns(a, opts(STRENGTH_BANDS.Bronze), new AbortController().signal, session);
    expect(a.calls.slice(2).every((c) => c.p_strength_cap === undefined)).toBe(true); // not asked again

    // Widening counts only runs under the cap: 10 delivered, but just 6 are at or under a cap of 30, so it widens.
    const b = api(mixed, { bands: true, split: true, caps: false });
    const got2 = await fetchPoolRuns(b, opts({ min: 0, max: 20, earlyWeight: 1, overallCap: 30 }), new AbortController().signal, { rpcMissing: false });
    expect(got2.widenings).toBeGreaterThan(0);
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

  it("stamps each run's early / late ratings on its boards (R-LOBBY-13)", async () => {
    const registered: BoardSnapshot[][] = [];
    const loader = createPoolLoader(base({
      fetchRuns: async () => ({ runs: [{ ...run(1, 40), early: 12, late: 77 }, { ...run(2, 30), early: 9 }], path: 'rpc' }),
      registerRuns: (rs) => { registered.push(...rs); return { runs: rs.length, boards: rs.length, dropped: 0 }; },
    }));
    await loader.load({ perRequestMs: 1000, attempts: 1, retryBaseMs: 0 });
    expect(registered[0]![0]).toMatchObject({ runStrength: 40, runStrengthEarly: 12, runStrengthLate: 77 });
    expect(registered[1]![0]).toMatchObject({ runStrength: 30, runStrengthEarly: 9 });
    expect(registered[1]![0]!.runStrengthLate).toBeUndefined();
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

describe('the overall cap before the caps SQL, end to end (R-LOBBY-15)', () => {
  afterEach(() => { OPPONENT_POOL.length = 0; });

  it('a server without p_strength_cap delivers over-cap runs; the loader stamps their strength and a Bronze lobby never seats one', async () => {
    const SET = activeSet().id;
    const heroes = playableHeroes().map((h) => h.id).slice(1, 15);
    // 14 eight-wave runs on distinct heroes, all inside Bronze's early band (EARLY 5); overall strength 10..140 step 10
    // clamped to 100, so 4 are at or under 40 and 10 are over it.
    const pool = heroes.map((h, i) => ({ key: `C${i}|${h}|${7700 + i}`, strength: Math.min(100, (i + 1) * 10), early: 5, late: 50, user: `c${i}`, hero: h, seed: 7700 + i }));
    const calls: SampleArgs[] = [];
    const fakeApi: PoolApi = {
      async sample(args) {
        calls.push(args);
        if (args.p_strength_cap !== undefined) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.pool_runs_sample(p_strength_cap, ...)' } };
        return {
          data: pool.map((r): SampleRow => ({
            run_key: r.key, author: r.key.split('|')[0]!, user_id: null, wave_count: 8, strength: String(r.strength), strength_early: r.early, strength_late: r.late,
            boards: Array.from({ length: 8 }, (_, w) => ({ v: 1, wave: w + 1, heroId: r.hero, resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 10, seed: r.seed, origin: 'self', author: r.key.split('|')[0]!, setId: SET, minions: [{ cardId: 'pack', attack: 3, health: 3, keywords: [], golden: false }] } as unknown as BoardSnapshot)),
          })),
          error: null,
        };
      },
      lightPage: async () => ({ data: [], error: null }),
      boardsForSeeds: async () => ({ data: [], error: null }),
    };
    const band = lobbyBandFor({ rank: { position: { divisionIndex: 0, points: 0 } } } as never);
    const session = { rpcMissing: false };
    const loader = createPoolLoader({
      fetchRuns: (signal) => fetchPoolRuns(fakeApi, { setId: SET, patchPrefix: '0.1.0+', random: Math.random, band }, signal, session),
      registerRuns: registerOpponentRuns, cache: memoryPoolCache(), setId: () => SET, patchPrefix: '0.1.0+', now: () => 0, sleep: async () => {}, schedule: () => () => {},
      band: () => band,
    });
    const s = await loader.load({ perRequestMs: 5000, attempts: 1, retryBaseMs: 0 });
    expect(s.runs).toBe(14);
    expect(session).toMatchObject({ capsMissing: true });
    expect(calls[0]!.p_strength_cap).toBe(40);
    const strengthOf = new Map(pool.map((r) => [r.key, r.strength]));
    for (let seed = 1; seed <= 8; seed++) {
      const run = createLobbyRun(1000 + seed, playableHeroes()[0]!.id, {}, 'lobby', undefined, SET, { strengthBand: band });
      const seated = run.lobby!.seats.filter((x) => x.kind === 'snapshot').map((x) => strengthOf.get(x.runKey!));
      expect(seated.length).toBe(4); // the four runs at or under 40
      for (const st of seated) expect(st!).toBeLessThanOrEqual(40);
    }
  });
});
