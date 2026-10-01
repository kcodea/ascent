import { afterEach, describe, expect, it } from 'vitest';
import { OPPONENT_POOL, createLobbyRun, lobbyPoolTelemetryOf, playableHeroes, registerOpponentRuns, type BoardSnapshot, type RunRegistration } from '@game/sim';
import { activeSet, type SetId } from '@game/content';
import { CACHE_MAX_RUNS, POOL_CACHE_VERSION, createPoolLoader, isWholeRun, type LoadOptions, type PoolFetch, type PoolLoaderDeps, type PoolRun } from './poolLoader';
import { memoryPoolCache } from './poolCache';
import { createPoolGate, poolNeededFor } from './poolGate';

/**
 * THE OPPONENT POOL LOADER. 2026-09-28: a rated lobby (seed 309102059) sat seven generated seats because the startup
 * fetch raced everything against ONE 4 s timer, never retried, and nothing waited for it before the lobby was built.
 * 2026-09-29 (R-LOBBY-08): the unit is the WHOLE RUN. These pin both: retry/cache/gate behaviour, and that no path
 * (network, cache) can register a cut-down run.
 */

const SET: SetId = activeSet().id;
const OTHER_SET: SetId = SET === 'set1' ? 'set2' : 'set1';
const board = (author: string, heroId: string, seed: number, wave: number, setId: SetId = SET, cardId = 'pack'): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 10,
  minions: [{ cardId, attack: 3, health: 3, keywords: [], golden: false }],
  seed, origin: 'self', author, setId,
} as unknown as BoardSnapshot);

/** Seven distinct 6-wave player runs on distinct playable heroes — enough to fill a whole lobby. */
const heroes = playableHeroes().map((h) => h.id).slice(1, 8);
const runOf = (author: string, heroId: string, seed: number, waves: number, setId: SetId = SET, ownerId?: string): PoolRun => ({
  key: `${author}|${heroId}|${seed}`, waves, ...(ownerId ? { ownerId } : {}),
  snaps: Array.from({ length: waves }, (_, i) => board(author, heroId, seed, i + 1, setId)),
});
const sevenRuns = (): PoolRun[] => heroes.map((h, i) => runOf(`Player${i}`, h, 5000 + i, 6, SET, `owner-${i}`));
const rpc = (runs: PoolRun[]): PoolFetch => ({ runs, path: 'rpc' });

const FAST: LoadOptions = { perRequestMs: 40, attempts: 2, retryBaseMs: 0 };
const never = <T,>(): Promise<T> => new Promise<T>(() => {});

function deps(over: Partial<PoolLoaderDeps> & { fetchRuns: PoolLoaderDeps['fetchRuns'] }): PoolLoaderDeps & { registered: BoardSnapshot[][]; scheduled: number[] } {
  const registered: BoardSnapshot[][] = [];
  const scheduled: number[] = [];
  return {
    registerRuns: (runs): RunRegistration => {
      registered.push(...runs);
      return { runs: runs.length, boards: runs.reduce((a, r) => a + r.length, 0), dropped: 0 };
    },
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

describe('whole runs only', () => {
  it('registers every delivered run whole, marked remote and stamped with its owner', async () => {
    const d = deps({ fetchRuns: () => Promise.resolve(rpc(sevenRuns())) });
    const s = await createPoolLoader(d).load(FAST);
    expect(s).toMatchObject({ status: 'ready', source: 'rpc', runs: 7, boards: 42, runsDropped: 0 });
    expect(d.registered.every((r) => r.length === 6)).toBe(true);
    expect(d.registered.flat().every((b) => b.remote === true)).toBe(true);
    expect(d.registered[0]!.every((b) => b.ownerId === 'owner-0')).toBe(true);
  });

  it('a run that arrives missing a wave is refused WHOLE, never registered as a fragment', async () => {
    const cut = runOf('Cut', heroes[0]!, 1, 10);
    cut.snaps = cut.snaps.filter((b) => b.wave >= 5); // the server counted 10 waves; 6 arrived
    expect(isWholeRun(cut)).toBe(false);
    const d = deps({ fetchRuns: () => Promise.resolve(rpc([cut, ...sevenRuns()])) });
    const s = await createPoolLoader(d).load(FAST);
    expect(s.runs).toBe(7);
    expect(s.runsDropped).toBe(1);
    expect(d.registered.some((r) => r[0]!.author === 'Cut')).toBe(false);
  });

  it('a board from another run, or an empty board, makes the delivery not whole', () => {
    const mixed = runOf('A', heroes[0]!, 1, 5);
    mixed.snaps[2] = board('B', heroes[0]!, 1, 3);
    expect(isWholeRun(mixed)).toBe(false);
    const empty = runOf('A', heroes[0]!, 1, 5);
    empty.snaps[1] = { ...empty.snaps[1]!, minions: [] };
    expect(isWholeRun(empty)).toBe(false);
  });

  it('with the real registration, one unservable board refuses its whole run', async () => {
    const stale = runOf('Stale', heroes[0]!, 9, 6);
    stale.snaps[3] = board('Stale', heroes[0]!, 9, 4, SET, 'no_such_card_anymore');
    const d = deps({ fetchRuns: () => Promise.resolve(rpc([stale, ...sevenRuns()])), registerRuns: registerOpponentRuns });
    const s = await createPoolLoader(d).load(FAST);
    expect(s.runs).toBe(7);
    expect(s.runsDropped).toBe(1);
    expect(OPPONENT_POOL.some((b) => b.author === 'Stale')).toBe(false);
  });
});

describe('retry after an empty or failed fetch', () => {
  it('a hung request times out, is retried, and a total failure queues a background retry', async () => {
    let online = false;
    const d = deps({ fetchRuns: () => (online ? Promise.resolve(rpc(sevenRuns())) : never()) });
    const loader = createPoolLoader(d);
    expect((await loader.load(FAST)).status).toBe('failed');
    expect(d.registered).toEqual([]);
    expect(d.scheduled.length).toBe(1);
    online = true;
    const s = await loader.load(FAST);
    expect(s.status).toBe('ready');
    expect(s.runs).toBe(7);
  });

  it('an error then a success within one load registers once', async () => {
    let calls = 0;
    const d = deps({ fetchRuns: () => (calls++ === 0 ? Promise.reject(new Error('503')) : Promise.resolve(rpc(sevenRuns()))) });
    const s = await createPoolLoader(d).load(FAST);
    expect(s.runs).toBe(7);
    expect(d.scheduled).toEqual([]);
  });

  it('coming back online retries at once', async () => {
    let online = false;
    const d = deps({ fetchRuns: () => (online ? Promise.resolve(rpc(sevenRuns())) : Promise.reject(new Error('offline'))) });
    const loader = createPoolLoader(d);
    await loader.load(FAST);
    online = true;
    loader.onOnline();
    await new Promise((r) => setTimeout(r, 20));
    expect(loader.state().status).toBe('ready');
  });

  it('ensure() retries a failed pool rather than returning the stale failure', async () => {
    let online = false;
    const d = deps({ fetchRuns: () => (online ? Promise.resolve(rpc(sevenRuns())) : Promise.reject(new Error('offline'))) });
    const loader = createPoolLoader(d);
    await loader.load(FAST);
    online = true;
    expect((await loader.ensure()).status).toBe('ready');
  });

  it('a reachable server with no runs yet is ready (those generated seats are genuine)', async () => {
    const d = deps({ fetchRuns: () => Promise.resolve(rpc([])) });
    expect((await createPoolLoader(d).load(FAST)).status).toBe('ready');
  });

  it('a second load is a no-op once a sample arrived; a refresh draws a new one', async () => {
    let calls = 0;
    const d = deps({ fetchRuns: () => { calls++; return Promise.resolve(rpc(sevenRuns())); } });
    const loader = createPoolLoader(d);
    await loader.load(FAST);
    await loader.load(FAST);
    expect(calls).toBe(1);
    await loader.load({ ...FAST, refresh: true });
    expect(calls).toBe(2);
  });
});

describe('the last good pool is cached as whole runs and used when the fetch fails', () => {
  it('writes version 2, the live set only, keyed by run key, capped', async () => {
    const many = Array.from({ length: CACHE_MAX_RUNS + 20 }, (_, i) => runOf(`Many${i}`, heroes[i % 7]!, 7000 + i, 5));
    const other = runOf('Other', 'x', 1, 5, OTHER_SET);
    const cache = memoryPoolCache();
    await createPoolLoader(deps({ fetchRuns: () => Promise.resolve(rpc([...many, other])), cache })).load(FAST);
    await new Promise((r) => setTimeout(r, 0));
    expect(cache.saved.length).toBe(1);
    const saved = cache.saved[0]!;
    expect(saved.version).toBe(POOL_CACHE_VERSION);
    expect(saved.setId).toBe(SET);
    const runs = Object.values(saved.runs);
    expect(runs.length).toBe(CACHE_MAX_RUNS);
    expect(runs.every((r) => isWholeRun(r) && r.snaps.length === 5 && (r.snaps[0]!.setId ?? 'set1') === SET)).toBe(true);
    for (const [k, r] of Object.entries(saved.runs)) expect(k).toBe(r.key);
  });

  it('fills a failed fetch from the cache (stale-but-real beats all-bot)', async () => {
    const runs = Object.fromEntries(sevenRuns().map((r) => [r.key, r]));
    const cache = memoryPoolCache({ version: POOL_CACHE_VERSION, setId: SET, patchPrefix: '0.1.0+', savedAt: 999_000, runs });
    const d = deps({ fetchRuns: () => Promise.reject(new Error('offline')), cache });
    const s = await createPoolLoader(d).load(FAST);
    expect(s.status).toBe('ready');
    expect(s.source).toBe('cache');
    expect(d.registered.length).toBe(7);
  });

  it('refuses a cut-down run even from the cache', async () => {
    const cut = runOf('Cut', heroes[0]!, 1, 10);
    cut.snaps = cut.snaps.slice(4);
    const cache = memoryPoolCache({ version: POOL_CACHE_VERSION, setId: SET, patchPrefix: '0.1.0+', savedAt: 999_000, runs: { [cut.key]: cut } });
    const s = await createPoolLoader(deps({ fetchRuns: () => Promise.reject(new Error('offline')), cache })).load(FAST);
    expect(s.status).toBe('failed');
    expect(s.runsDropped).toBe(1);
  });

  it('ignores the old per-wave cache, another build version, and one older than a week', async () => {
    const runs = Object.fromEntries(sevenRuns().map((r) => [r.key, r]));
    const waves = { 1: sevenRuns().map((r) => r.snaps[0]!) };
    for (const bad of [
      { setId: SET, patchPrefix: '0.1.0+', savedAt: 999_000, waves }, // the pre-2026-09-29 record (no version)
      { version: POOL_CACHE_VERSION, setId: SET, patchPrefix: '0.0.9+', savedAt: 999_000, runs },
      { version: POOL_CACHE_VERSION, setId: SET, patchPrefix: '0.1.0+', savedAt: 1_000_000 - 8 * 24 * 3600 * 1000, runs },
    ]) {
      const d = deps({ fetchRuns: () => Promise.reject(new Error('offline')), cache: memoryPoolCache(bad) });
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
    let release!: () => void;
    const gateOpen = new Promise<void>((r) => { release = r; });
    const d = deps({ fetchRuns: async () => { await gateOpen; return rpc(sevenRuns()); }, registerRuns: registerOpponentRuns });
    const loader = createPoolLoader(d);
    void loader.load({ perRequestMs: 5000, attempts: 1, retryBaseMs: 0 }); // the startup load, in flight
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
    const loader = createPoolLoader(deps({ fetchRuns: () => Promise.resolve(rpc(sevenRuns())) }));
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
    const loader = createPoolLoader(deps({ fetchRuns: () => (online ? Promise.resolve(rpc(sevenRuns())) : Promise.reject(new Error('offline'))) }));
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
