import { describe, expect, it } from 'vitest';
import { makeRng } from '@game/core';
import { playableHeroes, type BoardSnapshot } from '@game/sim';
import { activeSet, type SetId } from '@game/content';
import { POOL_SAMPLE_RUNS, fetchPoolRuns, sampleUniform, type PoolApi, type SampleArgs, type SampleRow } from './poolFetch';
import { POOL_RUN_CACHE_VERSION, cachedSample, memoryRunCache, type DeltaRpc, type DeltaStats, type KeyRow, type RunBoardsRow } from './poolRunCache';

/**
 * THE POOL, CACHED BY RUN (Supabase cleanup P1.5, owner ruling 2026-10-28: "yes, cache them"; owner bar: snapshots
 * served on exactly the right turn with exact recorded state, never reaching forward).
 *
 * Two worlds over the SAME server and the SAME sequence of server draws: TODAY calls `pool_runs_sample`; CACHED answers
 * the same call from `pool_runs_sample_keys` + the device cache + `pool_runs_boards`. Across sessions, between-runs
 * refreshes, bands, runs that gain / change boards between calls, and a cache that trims, every answer is
 * BYTE-IDENTICAL (JSON) to today's, and so is `fetchPoolRuns`' result, which is what registration and seat selection
 * consume. The bytes each world downloads are measured on the same fake responses.
 */
const SET: SetId = activeSet().id;
const HEROES = playableHeroes().map((h) => h.id);

interface Run { id: number; key: string; author: string; user: string | null; strength: number | null; early: number | null; late: number | null; boards: BoardSnapshot[]; ver: number }

/** A live-sized pool: `n` runs of 6-17 waves, 7 minions a board (~24 KB a run, like prod). */
function makePool(n: number): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < n; i++) {
    const hero = HEROES[i % HEROES.length]!;
    const author = `P${i % 40}`;
    const seed = 50_000 + i;
    const waves = 6 + (i % 12);
    const boards = Array.from({ length: waves }, (_, w) => board(author, hero, seed, w + 1, w === 0 && i % 9 === 0));
    runs.push({ id: i + 1, key: `${author}|${hero}|${seed}`, author, user: `u-${i % 40}`, strength: i % 5 === 0 ? null : (i * 37) % 100, early: (i * 13) % 100, late: (i * 71) % 100, boards, ver: 1 });
  }
  return runs;
}
function board(author: string, hero: string, seed: number, wave: number, empty = false): BoardSnapshot {
  return {
    v: 1, wave, heroId: hero, resolve: 30, tier: Math.min(6, 1 + Math.floor(wave / 3)), triples: 0, tribes: ['beast', 'mech'], threat: 'glass',
    power: wave * 10, seed, origin: 'self', author, setId: SET,
    minions: empty ? [] : Array.from({ length: 7 }, (_, m) => ({
      cardId: ['pack', 'blackbelt', 'alleycat', 'stray'][m % 4], attack: wave + m, health: wave * 2 + m, keywords: m % 2 ? ['taunt'] : [], golden: m === 0,
      text: `Live text for minion ${m} on wave ${wave}. `.repeat(3), buffs: [{ source: 'shop', attack: 1, health: 1 }],
    })),
  } as unknown as BoardSnapshot;
}

/** The fake server. `draw` is the server's random sample; both worlds' servers replay the same draw sequence. */
function server(runs: Run[], drawSeed: number) {
  const rng = makeRng(drawSeed);
  const bytes = { sample: 0, keys: 0, boards: 0 };
  const inBand = (r: Run, a: SampleArgs): boolean => {
    if (typeof a.p_strength_cap === 'number' && r.strength !== null && r.strength > a.p_strength_cap) return false;
    if (r.strength === null) return true;
    return (a.p_strength_min === undefined || r.strength >= a.p_strength_min) && (a.p_strength_max === undefined || r.strength <= a.p_strength_max);
  };
  const draw = (a: SampleArgs): Run[] => sampleUniform(runs.filter((r) => inBand(r, a)), a.p_limit, rng.next);
  const rev = (r: Run): string => `${r.id}:${r.ver}:${r.boards.length}`;
  const send = <T>(k: keyof typeof bytes, data: T): { data: T; error: null } => {
    const json = JSON.stringify(data);
    bytes[k] += json.length;
    return { data: JSON.parse(json) as T, error: null }; // what the client actually gets: freshly parsed JSON
  };
  return {
    bytes, runs,
    sample: async (a: SampleArgs) => send('sample', draw(a).map((r): SampleRow => ({
      run_key: r.key, author: r.author, user_id: r.user, wave_count: new Set(r.boards.map((b) => b.wave)).size,
      strength: r.strength, strength_early: r.early, strength_late: r.late, boards: r.boards,
    }))),
    keys: async (a: SampleArgs) => send('keys', draw(a).map((r): KeyRow => ({
      run_id: r.id, run_key: r.key, author: r.author, user_id: r.user, wave_count: new Set(r.boards.map((b) => b.wave)).size,
      strength: r.strength, strength_early: r.early, strength_late: r.late, rev: rev(r),
    }))),
    boards: async (ids: number[]) => send('boards', runs.filter((r) => ids.includes(r.id)).map((r): RunBoardsRow => ({ run_id: r.id, run_key: r.key, rev: rev(r), boards: r.boards }))),
  };
}
type Server = ReturnType<typeof server>;

const today = (s: Server): PoolApi => ({ sample: (a) => s.sample(a), lightPage: async () => ({ data: [], error: null }), boardsForSeeds: async () => ({ data: [], error: null }) });
function cached(s: Server, store = memoryRunCache(), stats?: DeltaStats, rpc?: Partial<DeltaRpc>): PoolApi {
  let t = 0;
  const sample = cachedSample({ keys: (a) => s.keys(a), boards: (ids) => s.boards(ids), sample: (a) => s.sample(a), ...rpc }, store, {}, () => ++t, stats);
  return { sample, lightPage: async () => ({ data: [], error: null }), boardsForSeeds: async () => ({ data: [], error: null }) };
}
const signal = new AbortController().signal;
const ARGS: SampleArgs = { p_limit: POOL_SAMPLE_RUNS, p_set: SET, p_patch_prefix: '0.1.0+', p_exclude_user: null };
const BANDED: SampleArgs = { ...ARGS, p_strength_min: 20, p_strength_max: 70, p_early_weight: 0.3, p_strength_cap: 60 };

/** Mutate a run the same way in both worlds: a new board (the run went further) or a changed one. */
function grow(runs: Run[], id: number): void { const r = runs.find((x) => x.id === id)!; r.boards = [...r.boards, board(r.author, r.boards[0]!.heroId, r.boards[0]!.seed!, r.boards.length + 1)]; r.ver++; }
function touch(runs: Run[], id: number): void { const r = runs.find((x) => x.id === id)!; r.boards = r.boards.map((b, i) => (i === 1 ? { ...b, power: b.power + 1 } : b)); r.ver++; }

describe('the cached pool answers exactly what pool_runs_sample answers', () => {
  it('5 sessions x (start + 3 refreshes), bands, growing and changing runs: every answer byte-identical; bytes measured', async () => {
    const A = server(makePool(411), 99);
    const B = server(makePool(411), 99);
    const store = memoryRunCache(); // one device: the cache outlives each session
    const stats: DeltaStats = { calls: 0, runs: 0, hits: 0, fetched: 0, fallbacks: 0 };
    for (let session = 0; session < 5; session++) {
      const a = today(A);
      const b = cached(B, store, stats); // a new session: new module state, same IndexedDB
      for (let call = 0; call < 4; call++) {
        const args = call % 2 ? BANDED : ARGS;
        const ra = await a.sample(args, signal);
        const rb = await b.sample(args, signal);
        expect(rb.error).toBeNull();
        expect(JSON.stringify(rb.data)).toBe(JSON.stringify(ra.data));
        // Between calls the pool moves the same way on both servers: a run finishes more rounds, another is re-uploaded.
        for (const s of [A, B]) { grow(s.runs, 1 + ((session * 7 + call * 3) % 411)); touch(s.runs, 1 + ((session * 11 + call * 5) % 411)); }
      }
    }
    const before = A.bytes.sample;
    const after = B.bytes.keys + B.bytes.boards;
    console.info(`[P1.5 bytes] 20 pool fetches over a 411-run pool: pool_runs_sample ${before} B -> keys ${B.bytes.keys} B + boards ${B.bytes.boards} B = ${after} B (${(100 * (1 - after / before)).toFixed(1)}% less); ${stats.hits}/${stats.runs} runs from the cache, ${stats.fetched} downloaded`);
    expect(after).toBeLessThan(before / 3);
    expect(stats.fallbacks).toBe(0);
  });

  it('fetchPoolRuns (what registration and seat selection consume) is identical, band widening included', async () => {
    const A = server(makePool(120), 5);
    const B = server(makePool(120), 5);
    const band = { min: 40, max: 50, earlyWeight: 0.3, overallCap: 60 } as never;
    for (let i = 0; i < 3; i++) {
      const fa = await fetchPoolRuns(today(A), { setId: SET, patchPrefix: '0.1.0+', random: Math.random, band }, signal, { rpcMissing: false });
      const fb = await fetchPoolRuns(cached(B), { setId: SET, patchPrefix: '0.1.0+', random: Math.random, band }, signal, { rpcMissing: false });
      expect(JSON.stringify(fb)).toBe(JSON.stringify(fa));
      expect(fa.runs.length).toBeGreaterThan(0);
    }
  });

  it('a run whose rev moved is downloaded again (never served stale); an unchanged one never is', async () => {
    const S = server(makePool(30), 1);
    const store = memoryRunCache();
    const stats: DeltaStats = { calls: 0, runs: 0, hits: 0, fetched: 0, fallbacks: 0 };
    const api = cached(S, store, stats);
    await api.sample(ARGS, signal);
    expect(stats.fetched).toBe(30);
    touch(S.runs, 7);
    grow(S.runs, 8);
    const r = await api.sample(ARGS, signal);
    expect(stats.fetched).toBe(32); // exactly the two that moved
    const got = r.data!.find((x) => x.run_key === S.runs[6]!.key)!;
    expect(JSON.stringify(got.boards)).toBe(JSON.stringify(S.runs[6]!.boards));
    expect(r.data!.find((x) => x.run_key === S.runs[7]!.key)!.boards).toHaveLength(S.runs[7]!.boards.length);
  });

  it('every call hands out fresh objects: a caller mutating its boards never reaches the cache', async () => {
    const S = server(makePool(5), 1);
    const api = cached(S);
    const first = await api.sample(ARGS, signal);
    (first.data![0]!.boards![0] as { power: number }).power = -1;
    const second = await api.sample(ARGS, signal);
    const run = S.runs.find((x) => x.key === second.data![0]!.run_key)!;
    expect(JSON.stringify(second.data!.find((x) => x.run_key === run.key)!.boards)).toBe(JSON.stringify(run.boards));
  });

  it('the cache trims least recently used runs and still answers exactly', async () => {
    const S = server(makePool(80), 3);
    const T = server(makePool(80), 3);
    const store = memoryRunCache(40);
    const api = cached(S, store);
    for (let i = 0; i < 4; i++) {
      const rb = await api.sample({ ...ARGS, p_limit: 30 }, signal);
      const ra = await today(T).sample({ ...ARGS, p_limit: 30 }, signal);
      expect(JSON.stringify(rb.data)).toBe(JSON.stringify(ra.data));
      await Promise.resolve();
      expect(store.map.size).toBeLessThanOrEqual(40);
    }
  });

  it('a cached record of another version, or a broken one, is a miss', async () => {
    const S = server(makePool(3), 1);
    const store = memoryRunCache();
    const k = S.runs[0]!;
    store.map.set(k.key, { v: POOL_RUN_CACHE_VERSION + 1, key: k.key, rev: `${k.id}:${k.ver}:${k.boards.length}`, text: '[]', usedAt: 0 });
    store.map.set(S.runs[1]!.key, { v: POOL_RUN_CACHE_VERSION, key: S.runs[1]!.key, rev: 'old', text: '[]', usedAt: 0 });
    const r = await cached(S, store).sample(ARGS, signal);
    for (const run of S.runs) expect(JSON.stringify(r.data!.find((x) => x.run_key === run.key)!.boards)).toBe(JSON.stringify(run.boards));
  });

  it('a server without the delta SQL: the session calls pool_runs_sample, exactly as before', async () => {
    const S = server(makePool(10), 2);
    const T = server(makePool(10), 2);
    const missing = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.pool_runs_sample_keys' } };
    let keysCalls = 0;
    const stats: DeltaStats = { calls: 0, runs: 0, hits: 0, fetched: 0, fallbacks: 0 };
    const api = cached(S, memoryRunCache(), stats, { keys: async () => { keysCalls++; return missing; } });
    for (let i = 0; i < 3; i++) expect(JSON.stringify((await api.sample(ARGS, signal)).data)).toBe(JSON.stringify((await T.sample(ARGS)).data));
    expect(keysCalls).toBe(1); // remembered for the session
    expect(stats.fallbacks).toBe(3);
  });

  it('a failed read returns its error (the loader retries as before); nothing half-built is served', async () => {
    const S = server(makePool(10), 2);
    const boom = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    expect((await cached(S, memoryRunCache(), undefined, { keys: async () => boom }).sample(ARGS, signal)).error).toEqual(boom.error);
    expect((await cached(S, memoryRunCache(), undefined, { boards: async () => boom }).sample(ARGS, signal))).toEqual({ data: null, error: boom.error });
  });
});
