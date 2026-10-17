import { afterEach, describe, expect, it } from 'vitest';
import { OPPONENT_POOL, STRENGTH_BANDS, createLobbyRun, lobbyPoolTelemetryOf, playableHeroes, registerOpponentRuns, type BoardSnapshot, type RunRegistration, type StrengthBand } from '@game/sim';
import { activeSet, type SetId } from '@game/content';
import { BAND_MATCH_LOAD, CACHE_MAX_RUNS, POOL_CACHE_VERSION, createPoolLoader, isWholeRun, type LoadOptions, type PoolFetch, type PoolLoaderDeps, type PoolRun } from './poolLoader';
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

  it('a board from another run makes the delivery not whole; an EMPTY board is a real round and keeps it whole', () => {
    const mixed = runOf('A', heroes[0]!, 1, 5);
    mixed.snaps[2] = board('B', heroes[0]!, 1, 3);
    expect(isWholeRun(mixed)).toBe(false);
    // R-LOBBY-08 (owner 2026-10-17): "empty boards are never uploaded is a problem. this has to be fixed".
    const empty = runOf('A', heroes[0]!, 1, 5);
    empty.snaps[0] = { ...empty.snaps[0]!, minions: [] }; // Disco Dan's turn 1
    expect(isWholeRun(empty)).toBe(true);
    const allEmpty = runOf('A', heroes[0]!, 1, 5);
    allEmpty.snaps = allEmpty.snaps.map((s) => ({ ...s, minions: [] }));
    expect(isWholeRun(allEmpty)).toBe(false); // nothing on board in any round: no seat to field
    const broken = runOf('A', heroes[0]!, 1, 5);
    broken.snaps[1] = { ...broken.snaps[1]!, minions: undefined as never };
    expect(isWholeRun(broken)).toBe(false);
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

/**
 * SAMPLES FOR MORE THAN ONE RANK (R-PRACTICE-RANK-01, owner 2026-10-13: "add an option to select what rank the
 * snapshots they face are in ... exactly what is already in place with what snapshots a bronze vs silver vs gold
 * player can face"). A Practice game may ask for another rank's opponents than the player's own, so the loader fetches
 * the wanted band's sample (`matchBand`) and names the runs fetched only for other bands (`foreignRuns`), which the
 * next table of this band passes over.
 */
describe('a Practice game set to another rank', () => {
  const BRONZE = STRENGTH_BANDS.Bronze!;
  const GOLD = STRENGTH_BANDS.Gold!;
  const bandRuns = (tag: string, base: number): PoolRun[] => heroes.map((h, i) => runOf(`${tag}${i}`, h, base + i, 6, SET, `${tag}-owner-${i}`));
  /** A loader whose band the test switches, and whose every fetch answers with that band's own runs. */
  function banded(start: StrengthBand | null) {
    let band: StrengthBand | null = start;
    const asked: (StrengthBand | null)[] = [];
    const answers = new Map<StrengthBand | null, PoolRun[]>();
    const d = deps({
      band: () => band,
      fetchRuns: () => { asked.push(band); return Promise.resolve(rpc(answers.get(band) ?? [])); },
    });
    return { loader: createPoolLoader(d), d, asked, answers, want: (b: StrengthBand | null) => { band = b; } };
  }

  it('matchBand fetches the wanted band once, and is a no-op while the bands agree', async () => {
    const t = banded(GOLD);
    t.answers.set(GOLD, bandRuns('Gold', 100));
    t.answers.set(BRONZE, bandRuns('Bronze', 200));
    await t.loader.load(FAST);
    expect(t.loader.bandStale()).toBe(false);
    await t.loader.matchBand(FAST);
    expect(t.asked).toEqual([GOLD]); // nothing to do: the pool is this band's

    t.want(BRONZE); // the Practice hero picker opened with Bronze picked
    expect(t.loader.bandStale()).toBe(true);
    const s = await t.loader.matchBand(FAST);
    expect(t.asked).toEqual([GOLD, BRONZE]);
    expect(s.status).toBe('ready');
    expect(t.loader.bandStale()).toBe(false);
    await t.loader.matchBand(FAST);
    expect(t.asked).toEqual([GOLD, BRONZE]);
    // Both samples are registered: nothing is ever taken out of the pool (a saved game may be seated from either).
    expect(t.d.registered.length).toBe(14);
  });

  it('matchBand gives up after ONE attempt and leaves the pool usable', async () => {
    expect(BAND_MATCH_LOAD.attempts).toBe(1);
    let fail = false;
    let band: StrengthBand | null = GOLD;
    let calls = 0;
    const loader = createPoolLoader(deps({
      band: () => band,
      fetchRuns: () => { calls++; return fail ? Promise.reject(new Error('offline')) : Promise.resolve(rpc(sevenRuns())); },
    }));
    await loader.load(FAST);
    band = BRONZE; fail = true;
    const s = await loader.matchBand({ perRequestMs: 40, attempts: 1, retryBaseMs: 0 });
    expect(calls).toBe(2);
    expect(s.status).toBe('ready'); // the pool on hand still seats a table
    expect(loader.bandStale()).toBe(true);
    expect(loader.foreignRuns(BRONZE).size).toBe(0); // no Bronze sample arrived: nothing is passed over
  });

  it('matchBand waits for a load already in flight, then fetches the wanted band', async () => {
    let band: StrengthBand | null = GOLD;
    const asked: (StrengthBand | null)[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const loader = createPoolLoader(deps({
      band: () => band,
      fetchRuns: async () => { const mine = band; asked.push(mine); if (mine === GOLD) await held; return rpc(mine === GOLD ? bandRuns('Gold', 100) : bandRuns('Bronze', 200)); },
    }));
    void loader.load({ perRequestMs: 5000, attempts: 1, retryBaseMs: 0 }); // the startup load, for the player's own rank
    band = BRONZE;
    const p = loader.matchBand(FAST);
    release();
    await p;
    expect(asked).toEqual([GOLD, BRONZE]);
    expect(loader.bandStale()).toBe(false);
  });

  it('foreignRuns names the runs fetched ONLY for other bands, and nothing before this band has a sample', async () => {
    const t = banded(GOLD);
    const gold = bandRuns('Gold', 100);
    const bronze = bandRuns('Bronze', 200);
    t.answers.set(GOLD, gold);
    t.answers.set(BRONZE, [...bronze, gold[0]!]); // one run is in both bands' samples
    await t.loader.load(FAST);
    expect(t.loader.foreignRuns(GOLD).size).toBe(0);
    expect(t.loader.foreignRuns(BRONZE).size).toBe(0); // no Bronze sample yet: the table is seated from what is on hand

    t.want(BRONZE);
    await t.loader.matchBand(FAST);
    // A Gold table passes over the Bronze-only runs; the shared run stays a candidate for both.
    expect([...t.loader.foreignRuns(GOLD)].sort()).toEqual(bronze.map((r) => r.key).sort());
    expect([...t.loader.foreignRuns(BRONZE)].sort()).toEqual(gold.slice(1).map((r) => r.key).sort());
    // A band that was never sampled (All Ranks here) passes over nothing.
    expect(t.loader.foreignRuns(null).size).toBe(0);
  });

  it('a rated lobby after a Bronze Practice game is not seated from the Bronze sample', async () => {
    let band: StrengthBand | null = null; // an uncapped (Platinum) player
    const open = bandRuns('Open', 100);
    const bronze = bandRuns('Weak', 200);
    const loader = createPoolLoader(deps({
      band: () => band,
      fetchRuns: () => Promise.resolve(rpc(band ? bronze : open)),
      registerRuns: registerOpponentRuns,
    }));
    await loader.load(FAST);
    band = BRONZE;
    await loader.matchBand(FAST); // the Practice game's sample: 14 runs are now in the pool
    band = null;
    const hero = playableHeroes()[0]!.id;
    const weak = new Set(bronze.map((r) => r.key));
    for (let seed = 1; seed <= 12; seed++) {
      const rated = createLobbyRun(seed, hero, {}, 'lobby', undefined, undefined, { strengthBand: null, excludeRuns: loader.foreignRuns(null) });
      const keys = rated.lobby!.seats.filter((x) => x.kind === 'snapshot').map((x) => x.runKey!);
      expect(keys.length).toBeGreaterThan(0);
      for (const k of keys) expect(weak.has(k)).toBe(false);
    }
  });

  it('the gate waits for the picked rank only when asked (matchBand), and goes on if it never arrives', async () => {
    let band: StrengthBand | null = GOLD;
    let release!: () => void;
    let held = new Promise<void>((r) => { release = r; });
    let calls = 0;
    const loader = createPoolLoader(deps({
      band: () => band,
      fetchRuns: async () => { calls++; if (calls > 1) await held; return rpc(sevenRuns()); },
    }));
    await loader.load(FAST);
    const gate = createPoolGate(() => loader);
    band = BRONZE;

    // A rated launch does not wait for another band's sample: exactly as before.
    const rated = gate.run();
    expect(gate.phase()).toBe('idle');
    expect(await rated).toBe('go');
    expect(calls).toBe(1);

    // A Practice launch does: "Finding opponents..." until the picked rank's sample lands.
    const practice = gate.run({ matchBand: true });
    expect(gate.phase()).toBe('waiting');
    release();
    expect(await practice).toBe('go');
    expect(calls).toBe(2);
    expect(loader.bandStale()).toBe(false);

    // The bands agree now: no wait at all.
    const again = gate.run({ matchBand: true });
    expect(gate.phase()).toBe('idle');
    expect(await again).toBe('go');

    // Cancel works during the wait, and a fetch that fails still lets the game start on the pool on hand.
    band = GOLD;
    held = new Promise<void>((r) => { release = r; });
    const cancelled = gate.run({ matchBand: true });
    expect(gate.phase()).toBe('waiting');
    gate.cancel();
    expect(await cancelled).toBe('cancel');
    release();
  });
});
