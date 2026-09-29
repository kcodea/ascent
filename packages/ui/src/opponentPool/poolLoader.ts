/**
 * OPPONENT POOL LOADER (fix 2026-09-28, owner: "build the fix so this does not re-occur").
 *
 * A rated lobby (seed 309102059, 2026-09-29) sat seven generated seats while the live pool held 34-120 real
 * boards per wave. The old startup fetch fired one request per wave and raced ALL of them against a single
 * 4 s timer, so one slow wave threw the whole pool away; nothing retried until a run ended; and nothing waited
 * for the pool before a lobby was built. This module replaces that with:
 *
 *  - a PER-REQUEST timeout and a PER-WAVE retry, so a slow wave costs only itself. Each wave registers the
 *    moment it lands, so partial results are kept;
 *  - a last-good CACHE (IndexedDB in the app, see `poolCache.ts`) that fills any wave the network could not
 *    supply, because a stale real board beats a generated one;
 *  - a background retry with backoff (and on regaining connectivity) for anything still missing;
 *  - `ensure()`, which the lobby launch awaits (see `poolGate.ts`) so a rated table is never built on an empty
 *    pool by accident.
 *
 * Pure orchestration over injected deps (fetch, register, cache, clock), so the tests drive it without a
 * network, a browser or real time. Everything here is async and off the render path; nothing blocks the menu.
 */
import type { BoardSnapshot } from '@game/sim';
import type { SetId } from '@game/content';

export type PoolStatus = 'idle' | 'loading' | 'ready' | 'failed';
/** Where the boards currently registered came from. `mixed` = network for some waves, cache for others. */
export type PoolSource = 'none' | 'network' | 'cache' | 'mixed';

export interface PoolLoadState {
  status: PoolStatus;
  source: PoolSource;
  /** Waves whose fresh network pull succeeded this session. */
  wavesFresh: number;
  /** Waves covered by the cache because their pull failed. */
  wavesFromCache: number;
  wavesTotal: number;
  /** Boards handed to registration this session (network + cache). A refresh re-counts boards the pool
   *  already holds (registration dedupes them), so this is a receipt count, not the pool size. */
  boards: number;
}

/** The persisted last-good pool for ONE set. Bounded by the per-wave cap at write time. */
export interface CachedPool {
  setId: SetId;
  /** The build-version prefix the boards were fetched for. A cache from another version is ignored. */
  patchPrefix: string;
  savedAt: number;
  /** wave (1-based) -> boards */
  waves: Record<number, BoardSnapshot[]>;
}

export interface PoolCacheStore {
  load(setId: SetId): Promise<CachedPool | null>;
  save(pool: CachedPool): Promise<void>;
}

export interface PoolLoaderDeps {
  /** How many waves to pull (one request each). */
  waves: number;
  /** One wave's rows. Must reject (or honour `signal`) on failure; resolving means the server answered. */
  fetchWave(wave: number, signal: AbortSignal): Promise<BoardSnapshot[]>;
  /** Idempotent registration into the opponent pool (`registerOpponents` dedupes). */
  register(snaps: BoardSnapshot[]): void;
  cache: PoolCacheStore;
  /** The set whose boards are worth caching (the live set). */
  setId(): SetId;
  patchPrefix: string;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Timer seam for the background retry (setTimeout in the app). Returns a cancel function. */
  schedule(fn: () => void, ms: number): () => void;
}

export interface LoadOptions {
  perRequestMs: number;
  attemptsPerWave: number;
  /** Base delay between attempts of one wave; doubles per attempt. */
  retryBaseMs: number;
}

/** Startup: generous enough for a slow link, short enough that the background path takes over quickly. */
export const STARTUP_LOAD: LoadOptions = { perRequestMs: 6000, attemptsPerWave: 2, retryBaseMs: 500 };
/** The lobby gate's own retry: a player is waiting on it, so it is allowed longer. */
export const GATE_LOAD: LoadOptions = { perRequestMs: 8000, attemptsPerWave: 2, retryBaseMs: 750 };
/** Background retry delays after a load that left waves missing. Stops after the last one (the `online`
 *  event and every lobby launch still retry). */
export const BACKGROUND_RETRY_MS = [5000, 15000, 45000, 120000, 300000];
/** A cache older than this is not used: a week-old pool is still real boards, a month-old one is a different
 *  meta. */
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** The cache is rewritten at most this often (a ~1 MB structured clone is cheap, but not free). */
export const CACHE_WRITE_INTERVAL_MS = 30 * 60 * 1000;
/** Per-wave cap on cached boards (matches the fetch's per-wave limit). */
export const CACHE_PER_WAVE = 120;

const withTimeout = <T>(p: Promise<T>, ms: number, ctl: AbortController): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { ctl.abort(); reject(new Error('timeout')); }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e); });
  });

export interface PoolLoader {
  state(): PoolLoadState;
  subscribe(fn: (s: PoolLoadState) => void): () => void;
  /** Pull every wave not yet fresh this session (all of them with `refresh`). Joins an in-flight load. */
  load(opts?: LoadOptions & { refresh?: boolean }): Promise<PoolLoadState>;
  /** Resolve once the pool is usable: immediately when ready, else after the in-flight load or a fresh one
   *  with the gate's longer budget. Never rejects. */
  ensure(): Promise<PoolLoadState>;
  /** Kick an immediate retry of missing waves (wired to the browser `online` event). */
  onOnline(): void;
  dispose(): void;
}

export function createPoolLoader(deps: PoolLoaderDeps): PoolLoader {
  const fresh = new Set<number>(); // waves pulled from the network this session
  const fromCache = new Set<number>(); // waves filled from the cache (until a fresh pull replaces them)
  const freshRows = new Map<number, BoardSnapshot[]>(); // this session's fresh rows, for the cache write
  let boards = 0;
  let status: PoolStatus = 'idle';
  let inFlight: Promise<PoolLoadState> | null = null;
  let cachePromise: Promise<CachedPool | null> | null = null;
  let lastCacheWrite = -Infinity;
  let retryIndex = 0;
  let cancelRetry: (() => void) | null = null;
  const listeners = new Set<(s: PoolLoadState) => void>();

  const snapshot = (): PoolLoadState => ({
    status,
    source: fresh.size > 0 && fromCache.size > 0 ? 'mixed' : fresh.size > 0 ? 'network' : fromCache.size > 0 ? 'cache' : 'none',
    wavesFresh: fresh.size,
    wavesFromCache: fromCache.size,
    wavesTotal: deps.waves,
    boards,
  });
  const emit = (): void => { const s = snapshot(); for (const fn of listeners) fn(s); };

  const register = (snaps: BoardSnapshot[]): void => {
    if (snaps.length === 0) return;
    deps.register(snaps);
    boards += snaps.length;
  };

  const loadCache = (): Promise<CachedPool | null> => {
    cachePromise ??= deps.cache.load(deps.setId()).then((c) => {
      if (!c) return null;
      if (c.setId !== deps.setId() || c.patchPrefix !== deps.patchPrefix) return null;
      if (deps.now() - c.savedAt > CACHE_MAX_AGE_MS) return null;
      return c;
    }, () => null);
    return cachePromise;
  };

  const fetchOne = async (wave: number, opts: LoadOptions): Promise<boolean> => {
    for (let attempt = 0; attempt < opts.attemptsPerWave; attempt++) {
      if (attempt > 0) await deps.sleep(opts.retryBaseMs * 2 ** (attempt - 1));
      const ctl = new AbortController();
      try {
        const rows = await withTimeout(deps.fetchWave(wave, ctl.signal), opts.perRequestMs, ctl);
        const snaps = rows
          .filter((s): s is BoardSnapshot => !!s && Array.isArray(s.minions) && s.minions.length > 0)
          .map((s) => ({ ...s, remote: true as const })); // live-shared-pool mark, as before
        register(snaps);
        fresh.add(wave);
        fromCache.delete(wave);
        freshRows.set(wave, snaps);
        emit();
        return true;
      } catch { /* timed out / failed: next attempt */ }
    }
    return false;
  };

  const writeCache = (): void => {
    if (freshRows.size === 0 || deps.now() - lastCacheWrite < CACHE_WRITE_INTERVAL_MS) return;
    lastCacheWrite = deps.now();
    const setId = deps.setId();
    void loadCache().then((prev) => {
      const waves: Record<number, BoardSnapshot[]> = { ...(prev?.waves ?? {}) };
      for (const [w, rows] of freshRows) {
        // ONLY the live set's boards, capped per wave: the cache is a floor for the set players are on now.
        waves[w] = rows.filter((s) => (s.setId ?? 'set1') === setId).slice(0, CACHE_PER_WAVE);
      }
      return deps.cache.save({ setId, patchPrefix: deps.patchPrefix, savedAt: deps.now(), waves });
    }).catch(() => { /* best-effort */ });
  };

  const scheduleBackground = (): void => {
    if (cancelRetry || fresh.size >= deps.waves || retryIndex >= BACKGROUND_RETRY_MS.length) return;
    const ms = BACKGROUND_RETRY_MS[retryIndex++]!;
    cancelRetry = deps.schedule(() => { cancelRetry = null; void load(STARTUP_LOAD); }, ms);
  };

  const run = async (opts: LoadOptions, refresh: boolean): Promise<PoolLoadState> => {
    if (status !== 'ready') status = 'loading';
    emit();
    const waves = Array.from({ length: deps.waves }, (_, i) => i + 1).filter((w) => refresh || !fresh.has(w));
    const ok = await Promise.all(waves.map((w) => fetchOne(w, opts)));
    const missing = waves.filter((_, i) => !ok[i]);
    // Fill every wave the network could not supply from the last good pool.
    if (missing.length > 0) {
      const cached = await loadCache();
      for (const w of missing) {
        if (fresh.has(w) || fromCache.has(w)) continue;
        const rows = cached?.waves[w];
        if (!rows?.length) continue;
        register(rows.map((s) => ({ ...s, remote: true as const })));
        fromCache.add(w);
      }
    }
    // Usable once ANY wave came back (the server answered) or the cache covered something. A reachable server
    // that simply has no boards yet is ready too: those generated seats are genuine, not a load failure.
    status = fresh.size > 0 || fromCache.size > 0 ? 'ready' : 'failed';
    if (fresh.size < deps.waves) scheduleBackground();
    else { retryIndex = 0; }
    writeCache();
    emit();
    return snapshot();
  };

  const load = (opts: LoadOptions & { refresh?: boolean } = STARTUP_LOAD): Promise<PoolLoadState> => {
    if (inFlight) return inFlight;
    inFlight = run(opts, !!opts.refresh).finally(() => { inFlight = null; });
    return inFlight;
  };

  return {
    state: snapshot,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    load,
    async ensure() {
      if (status === 'ready') return snapshot();
      if (inFlight) {
        const s = await inFlight;
        if (s.status === 'ready') return s;
      }
      return load(GATE_LOAD);
    },
    onOnline() {
      if (fresh.size >= deps.waves) return;
      cancelRetry?.(); cancelRetry = null; retryIndex = 0;
      void load(STARTUP_LOAD);
    },
    dispose() { cancelRetry?.(); cancelRetry = null; listeners.clear(); },
  };
}
