import { afterEach, describe, expect, it } from 'vitest';
import { OPPONENT_POOL, createLobbyRun, lobbyPoolTelemetryOf, playableHeroes, registerOpponents, type BoardSnapshot } from '@game/sim';
import { activeSet, type SetId } from '@game/content';
import { createPoolLoader, CACHE_PER_WAVE, type LoadOptions, type PoolLoaderDeps } from './poolLoader';
import { memoryPoolCache } from './poolCache';
import { createPoolGate, poolNeededFor } from './poolGate';

/**
 * THE OPPONENT POOL LOADER (fix 2026-09-28). A rated lobby (seed 309102059) sat seven generated seats because
 * the startup pool fetch raced all 17 waves against ONE 4 s timer (one slow wave discarded everything), never
 * retried, and nothing waited for it before the lobby was built. These pin the replacement.
 */

const SET: SetId = activeSet().id;
const board = (author: string, heroId: string, seed: number, wave: number, setId: SetId = SET): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 10,
  minions: [{ cardId: 'pack', attack: 3, health: 3, keywords: [], golden: false }],
  seed, origin: 'self', author, setId,
} as unknown as BoardSnapshot);

/** Seven distinct 6-wave player runs on distinct playable heroes — enough to fill a whole lobby. */
const heroes = playableHeroes().map((h) => h.id).slice(1, 8);
const poolByWave = (waves: number): Map<number, BoardSnapshot[]> => {
  const m = new Map<number, BoardSnapshot[]>();
  for (let w = 1; w <= waves; w++) m.set(w, heroes.map((h, i) => board(`Player${i}`, h, 5000 + i, w)));
  return m;
};

const FAST: LoadOptions = { perRequestMs: 40, attemptsPerWave: 2, retryBaseMs: 0 };
const never = <T,>(): Promise<T> => new Promise<T>(() => {});

function deps(over: Partial<PoolLoaderDeps> & { fetchWave: PoolLoaderDeps['fetchWave'] }): PoolLoaderDeps & { registered: BoardSnapshot[]; scheduled: number[] } {
  const registered: BoardSnapshot[] = [];
  const scheduled: number[] = [];
  return {
    waves: 6,
    register: (s) => { registered.push(...s); },
    cache: memoryPoolCache(),
    setId: () => SET,
    patchPrefix: '0.1.0+',
    now: () => 1_000_000,
    sleep: async () => {},
    schedule: (_fn, ms) => { scheduled.push(ms); return () => {}; },
    registered,
    scheduled,
    ...over,
  };
}

afterEach(() => { OPPONENT_POOL.length = 0; });

describe('partial results: one slow or failed wave never discards the others', () => {
  it('a wave that hangs past its own timeout costs only itself', async () => {
    const pool = poolByWave(6);
    const d = deps({ fetchWave: (w) => (w === 3 ? never() : Promise.resolve(pool.get(w)!)) });
    const s = await createPoolLoader(d).load(FAST);
    expect(s.status).toBe('ready');
    expect(s.wavesFresh).toBe(5);
    expect(new Set(d.registered.map((b) => b.wave))).toEqual(new Set([1, 2, 4, 5, 6]));
    expect(d.registered.every((b) => b.remote === true)).toBe(true);
    // …and the missing wave is queued for a background retry.
    expect(d.scheduled.length).toBe(1);
  });

  it('a wave that errors is retried, and a retry that succeeds registers it', async () => {
    const pool = poolByWave(6);
    let calls = 0;
    const d = deps({ fetchWave: (w) => (w === 2 && calls++ === 0 ? Promise.reject(new Error('503')) : Promise.resolve(pool.get(w)!)) });
    const s = await createPoolLoader(d).load(FAST);
    expect(s.wavesFresh).toBe(6);
    expect(d.registered.filter((b) => b.wave === 2).length).toBe(7);
    expect(d.scheduled).toEqual([]); // nothing left to retry
  });
});

describe('retry after an empty or failed fetch', () => {
  it('a total failure reports failed, and the next load fetches the missing waves again', async () => {
    const pool = poolByWave(6);
    let online = false;
    const d = deps({ fetchWave: (w) => (online ? Promise.resolve(pool.get(w)!) : Promise.reject(new Error('offline'))) });
    const loader = createPoolLoader(d);
    expect((await loader.load(FAST)).status).toBe('failed');
    expect(d.registered).toEqual([]);
    expect(d.scheduled.length).toBe(1); // background retry queued
    online = true;
    const s = await loader.load(FAST);
    expect(s.status).toBe('ready');
    expect(s.wavesFresh).toBe(6);
  });

  it('coming back online retries the missing waves at once', async () => {
    const pool = poolByWave(6);
    let online = false;
    const d = deps({ fetchWave: (w) => (online ? Promise.resolve(pool.get(w)!) : Promise.reject(new Error('offline'))) });
    const loader = createPoolLoader(d);
    await loader.load(FAST);
    online = true;
    loader.onOnline();
    await new Promise((r) => setTimeout(r, 20));
    expect(loader.state().status).toBe('ready');
  });

  it('ensure() retries a failed pool rather than returning the stale failure', async () => {
    const pool = poolByWave(6);
    let online = false;
    const d = deps({ fetchWave: (w) => (online ? Promise.resolve(pool.get(w)!) : Promise.reject(new Error('offline'))) });
    const loader = createPoolLoader(d);
    await loader.load(FAST);
    online = true;
    expect((await loader.ensure()).status).toBe('ready');
  });

  it('a reachable server with no boards yet is ready (those generated seats are genuine)', async () => {
    const d = deps({ fetchWave: () => Promise.resolve([]) });
    expect((await createPoolLoader(d).load(FAST)).status).toBe('ready');
  });
});

describe('the last good pool is cached and used when the fetch fails', () => {
  it('writes the live set only, capped per wave', async () => {
    const pool = poolByWave(6);
    pool.set(1, [...pool.get(1)!, board('Other', 'x', 1, 1, 'set1' === SET ? 'set2' : 'set1')]);
    pool.set(2, Array.from({ length: CACHE_PER_WAVE + 30 }, (_, i) => board(`Many${i}`, heroes[0]!, 7000 + i, 2)));
    const cache = memoryPoolCache();
    const d = deps({ fetchWave: (w) => Promise.resolve(pool.get(w)!), cache });
    await createPoolLoader(d).load(FAST);
    await new Promise((r) => setTimeout(r, 0));
    expect(cache.saved.length).toBe(1);
    const saved = cache.saved[0]!;
    expect(saved.setId).toBe(SET);
    expect(saved.waves[1]!.every((b) => (b.setId ?? 'set1') === SET)).toBe(true);
    expect(saved.waves[2]!.length).toBe(CACHE_PER_WAVE);
  });

  it('fills failed waves from the cache (stale-but-real beats all-bot)', async () => {
    const pool = poolByWave(6);
    const cache = memoryPoolCache({ setId: SET, patchPrefix: '0.1.0+', savedAt: 999_000, waves: Object.fromEntries(pool) });
    const d = deps({ fetchWave: () => Promise.reject(new Error('offline')), cache });
    const s = await createPoolLoader(d).load(FAST);
    expect(s.status).toBe('ready');
    expect(s.source).toBe('cache');
    expect(d.registered.length).toBe(6 * 7);
  });

  it('ignores a cache from another build version or older than a week', async () => {
    const pool = Object.fromEntries(poolByWave(6));
    for (const bad of [
      { setId: SET, patchPrefix: '0.0.9+', savedAt: 999_000, waves: pool },
      { setId: SET, patchPrefix: '0.1.0+', savedAt: 1_000_000 - 8 * 24 * 3600 * 1000, waves: pool },
    ]) {
      const d = deps({ fetchWave: () => Promise.reject(new Error('offline')), cache: memoryPoolCache(bad) });
      expect((await createPoolLoader(d).load(FAST)).status).toBe('failed');
    }
  });
});

describe('the rated lobby start waits for the pool and uses it', () => {
  it('needs the pool for a lobby and for Practice vs players, not for bots', () => {
    expect(poolNeededFor('lobby')).toBe(true);
    expect(poolNeededFor('practice', { opponents: 'players' })).toBe(true);
    expect(poolNeededFor('practice', { opponents: 'bots' })).toBe(false);
    expect(poolNeededFor('tutorial')).toBe(false);
  });

  it('a lobby launched while the pool is still loading waits, then seats real runs', async () => {
    const pool = poolByWave(6);
    let release!: () => void;
    const gateOpen = new Promise<void>((r) => { release = r; });
    const d = deps({ fetchWave: async (w) => { await gateOpen; return pool.get(w)!; }, register: registerOpponents });
    const loader = createPoolLoader(d);
    void loader.load({ perRequestMs: 5000, attemptsPerWave: 1, retryBaseMs: 0 }); // the startup load, in flight
    const gate = createPoolGate(() => loader);
    const phases: string[] = [];
    gate.subscribe((p) => phases.push(p));
    const outcome = gate.run();
    expect(gate.phase()).toBe('waiting'); // "Finding opponents..."
    release();
    expect(await outcome).toBe('go');
    const run = createLobbyRun(309102059, playableHeroes()[0]!.id, {}, 'lobby');
    const t = lobbyPoolTelemetryOf(run.lobby!);
    expect(t.seats.recorded).toBe(7);
    expect(t.allGenerated).toBe(false);
    expect(phases).toEqual(['waiting', 'idle']);
  });

  it('an already-loaded pool opens the lobby with no wait at all', async () => {
    const pool = poolByWave(6);
    const loader = createPoolLoader(deps({ fetchWave: (w) => Promise.resolve(pool.get(w)!) }));
    await loader.load(FAST);
    const gate = createPoolGate(() => loader);
    const p = gate.run();
    expect(gate.phase()).toBe('idle');
    expect(await p).toBe('go');
  });

  it('no backend (offline build, tests) passes straight through', async () => {
    expect(await createPoolGate(() => null).run()).toBe('go');
  });

  it('a genuine failure stops on an explicit choice: Retry, Play anyway, or Back to menu', async () => {
    let online = false;
    const pool = poolByWave(6);
    const loader = createPoolLoader(deps({ fetchWave: (w) => (online ? Promise.resolve(pool.get(w)!) : Promise.reject(new Error('offline'))) }));
    await loader.load(FAST);
    const gate = createPoolGate(() => loader);

    const a = gate.run();
    await new Promise((r) => setTimeout(r, 60));
    expect(gate.phase()).toBe('failed');
    gate.cancel();
    expect(await a).toBe('cancel');

    const b = gate.run();
    await new Promise((r) => setTimeout(r, 60));
    expect(gate.phase()).toBe('failed');
    gate.playAnyway();
    expect(await b).toBe('go');

    const c = gate.run();
    await new Promise((r) => setTimeout(r, 60));
    online = true;
    gate.retry();
    expect(await c).toBe('go');
  });
});
