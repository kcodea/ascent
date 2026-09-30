import { afterEach, describe, expect, it } from 'vitest';
import { makeRng } from '@game/core';
import { OPPONENT_POOL, createRunLobby, driverFor, playableHeroes, registerOpponentRuns, resetLobbyDrivers, type BoardSnapshot } from '@game/sim';
import { activeSet, type SetId } from '@game/content';
import { POOL_SAMPLE_RUNS, fetchPoolRuns, isMissingFunction, sampleUniform, type LightRow, type PoolApi, type SampleRow } from './poolFetch';
import { isWholeRun } from './poolLoader';

/**
 * THE POOL ARRIVES AS WHOLE RUNS (R-LOBBY-08, 2026-09-29). The live bug, rebuilt: 146 runs, every one with a wave-5
 * board but only 112 reaching wave 10, the OLDEST run uploaded first. The old per-wave pull (newest 120 boards of
 * each wave) cut that run down to its waves 10+, and a lobby seat served its wave-10 board on round 5. Both new
 * paths (the RPC, and the fallback used until the SQL is run) deliver every run whole, and a lobby built on them
 * serves every recorded seat its OWN board for the round.
 */

const SET: SetId = activeSet().id;
const HEROES = playableHeroes().map((h) => h.id);

interface Row { id: number; author: string; hero_id: string; seed: number; wave: number; user_id: string | null; created: number; snapshot: BoardSnapshot }

/** The live shape. Row ids (and upload order) run oldest first. */
function livePool(): Row[] {
  const rows: Row[] = [];
  let id = 0;
  const upload = (author: string, hero: string, seed: number, last: number, user: string): void => {
    for (let w = 1; w <= last; w++) {
      rows.push({
        id: ++id, author, hero_id: hero, seed, wave: w, user_id: user, created: id,
        snapshot: {
          v: 1, wave: w, heroId: hero, resolve: 30, tier: Math.min(6, 1 + Math.floor(w / 3)), triples: 0, tribes: [], threat: 'glass',
          power: w * 10, seed, origin: 'self', author, setId: SET,
          minions: [{ cardId: 'pack', attack: w, health: w, keywords: [], golden: false }],
        } as unknown as BoardSnapshot,
      });
    }
  };
  upload('Orangez', 'soren', 1129878061, 17, 'u-orangez');
  for (let i = 0; i < 145; i++) upload(`P${i % 12}`, HEROES[i % HEROES.length]!, 10_000 + i, i < 111 ? 10 + (i % 7) : 5 + (i % 5), `u-${i % 12}`);
  return rows;
}

/** A fake PostgREST over those rows. `rpc: false` answers the sample like a DB that has not run the SQL yet. */
function fakeApi(rows: Row[], opts: { rpc: boolean }): PoolApi & { calls: string[] } {
  const calls: string[] = [];
  const keyOf = (r: Row): string => `${r.author}|${r.hero_id}|${r.seed}`;
  return {
    calls,
    async sample(args) {
      calls.push('sample');
      if (!opts.rpc) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.pool_runs_sample' } };
      const byRun = new Map<string, Row[]>();
      for (const r of rows) (byRun.get(keyOf(r)) ?? byRun.set(keyOf(r), []).get(keyOf(r))!).push(r);
      const picked = sampleUniform([...byRun.values()].filter((rs) => rs[0]!.user_id !== args.p_exclude_user), args.p_limit, makeRng(7).next);
      return {
        data: picked.map((rs): SampleRow => ({ run_key: keyOf(rs[0]!), author: rs[0]!.author, user_id: rs[0]!.user_id, wave_count: rs.length, boards: rs.map((r) => r.snapshot) })),
        error: null,
      };
    },
    async lightPage(_p, from, to) {
      calls.push('light');
      return { data: rows.slice(from, to + 1).map((r): LightRow => ({ author: r.author, hero_id: r.hero_id, seed: r.seed, wave: r.wave, user_id: r.user_id, set_id: SET })), error: null };
    },
    async boardsForSeeds(_p, seeds) {
      calls.push('seeds');
      const want = new Set(seeds);
      return { data: rows.filter((r) => want.has(r.seed)).map((r) => ({ snapshot: r.snapshot, user_id: r.user_id })), error: null };
    },
  };
}

/** The OLD pull, for the before/after: the newest 120 boards of each wave, glued back into runs. */
function oldPerWavePull(rows: Row[]): Map<string, number[]> {
  const runs = new Map<string, number[]>();
  for (let w = 1; w <= 17; w++) {
    const newest = rows.filter((r) => r.wave === w).sort((a, b) => b.created - a.created).slice(0, 120);
    for (const r of newest) { const k = `${r.author}|${r.hero_id}|${r.seed}`; (runs.get(k) ?? runs.set(k, []).get(k)!).push(w); }
  }
  return runs;
}

const opts = { setId: SET, patchPrefix: '0.1.0+', random: makeRng(1).next };
const signal = new AbortController().signal;

afterEach(() => { OPPONENT_POOL.length = 0; });

describe('before: the per-wave pull cut the oldest run', () => {
  it('146 wave-5 boards, 112 wave-10 boards: the old run arrives without its early waves', () => {
    const rows = livePool();
    expect(rows.filter((r) => r.wave === 5).length).toBe(146);
    expect(rows.filter((r) => r.wave === 10).length).toBe(112);
    const old = oldPerWavePull(rows).get('Orangez|soren|1129878061')!;
    expect(old.length).toBeLessThan(17);
    expect(old[0]).toBeGreaterThan(5); // it starts at wave 9: round 5 would have served a wave-9 board
  });
});

describe('after: both fetch paths deliver whole runs', () => {
  for (const rpc of [true, false]) {
    it(`${rpc ? 'the RPC' : 'the fallback (SQL not run yet)'} returns every run with every wave`, async () => {
      const rows = livePool();
      const api = fakeApi(rows, { rpc });
      const session = { rpcMissing: false };
      const got = await fetchPoolRuns(api, opts, signal, session);
      expect(got.path).toBe(rpc ? 'rpc' : 'fallback');
      expect(got.runs.length).toBe(Math.min(POOL_SAMPLE_RUNS, 146));
      for (const run of got.runs) {
        expect(isWholeRun(run), run.key).toBe(true);
        const truth = rows.filter((r) => `${r.author}|${r.hero_id}|${r.seed}` === run.key).map((r) => r.wave);
        expect(run.snaps.map((s) => s.wave), run.key).toEqual(truth);
      }
      expect(got.runs.some((r) => r.key === 'Orangez|soren|1129878061' && r.snaps.length === 17)).toBe(true);
      // The fallback is remembered: the next fetch in the session does not ask for the RPC again.
      expect(session.rpcMissing).toBe(!rpc);
      if (!rpc) {
        api.calls.length = 0;
        await fetchPoolRuns(api, opts, signal, session);
        expect(api.calls.includes('sample')).toBe(false);
      }
    });
  }

  it('a lobby built on the new pool serves every recorded seat its OWN board for the round', async () => {
    const got = await fetchPoolRuns(fakeApi(livePool(), { rpc: false }), opts, signal, { rpcMissing: false });
    registerOpponentRuns(got.runs.map((r) => r.snaps));
    let seated = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const lobby = createRunLobby(seed, HEROES[HEROES.length - 1]!);
      resetLobbyDrivers(lobby.seats);
      for (const seat of lobby.seats.filter((s) => s.kind === 'snapshot')) {
        seated++;
        const d = driverFor(seat)!;
        const last = (d as unknown as { lastRecordedWave: number }).lastRecordedWave;
        for (let round = 1; round <= 20; round++) {
          const b = d.prepare(round) ?? d.finalBoard?.() ?? null;
          const wave = b?.snapshot?.wave;
          // Its own round while the recording lasts; past its end only, the final board (stale final board rule).
          expect(wave, `${seat.runKey} round ${round}`).toBe(Math.min(round, last));
        }
      }
      resetLobbyDrivers(lobby.seats);
    }
    expect(seated).toBeGreaterThan(100);
  });

  it('the player\'s own runs are requested like anyone else\'s (owner 2026-09-30)', async () => {
    const api = fakeApi(livePool(), { rpc: true });
    const calls: unknown[] = [];
    const sample = api.sample.bind(api);
    api.sample = async (args, sig) => { calls.push(args.p_exclude_user); return sample(args, sig); };
    await fetchPoolRuns(api, opts, signal, { rpcMissing: false });
    expect(calls).toEqual([null]); // nobody excluded
    const fb = await fetchPoolRuns(fakeApi(livePool(), { rpc: false }), opts, signal, { rpcMissing: false });
    expect(fb.runs.some((r) => r.ownerId === 'u-3')).toBe(true); // the fallback keeps every player's runs too
  });

  it('a real server error is an error, not a silent switch to the fallback', async () => {
    const api = fakeApi(livePool(), { rpc: true });
    api.sample = async () => ({ data: null, error: { code: '57014', message: 'statement timeout' } });
    await expect(fetchPoolRuns(api, opts, signal, { rpcMissing: false })).rejects.toThrow(/timeout/);
    expect(isMissingFunction({ code: 'PGRST202', message: '' })).toBe(true);
    expect(isMissingFunction({ code: '57014', message: 'statement timeout' })).toBe(false);
  });
});

describe('the client-side sample is uniform', () => {
  it('every item is picked equally often', () => {
    const items = Array.from({ length: 40 }, (_, i) => i);
    const freq = new Array<number>(40).fill(0);
    const rng = makeRng(99);
    for (let d = 0; d < 4000; d++) for (const x of sampleUniform(items, 10, rng.next)) freq[x]!++;
    for (const n of freq) { expect(n).toBeGreaterThan(800); expect(n).toBeLessThan(1200); } // expected 1000
  });
});
