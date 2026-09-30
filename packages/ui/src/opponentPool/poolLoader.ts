/**
 * OPPONENT POOL LOADER.
 *
 * 2026-09-28 (owner: "build the fix so this does not re-occur"): a rated lobby sat seven generated seats because
 * one slow request discarded the whole pool, nothing retried, and nothing waited for the pool before a lobby was
 * built. That fix brought per-request timeouts and retries, a last-good IndexedDB cache, a background retry with
 * backoff (and on regaining connectivity), and `ensure()`, which the lobby launch awaits (`poolGate.ts`).
 *
 * 2026-09-29, WHOLE RUNS (R-LOBBY-08; owner: "make sure this is firmly fixed and will be scalable and a non issue
 * moving forward"): the pool used to arrive as the newest N boards PER WAVE and was glued back into runs. Early
 * waves hold more boards than late ones, so an older run kept its late waves and lost its early ones, and a seat
 * served a wave-10 board on round 5. The unit is now the RUN: `fetchRuns` returns whole runs (the server picks
 * them, uniformly at random over every eligible run, and returns each with all of its boards), every run is
 * checked for completeness here, registration is all-or-nothing per run (`registerOpponentRuns`), and the cache
 * stores whole runs keyed by run key under a version, so no path can hand the lobby a cut-down run.
 *
 * Pure orchestration over injected deps (fetch, register, cache, clock), so the tests drive it without a network,
 * a browser or real time. Everything here is async and off the render path; nothing blocks the menu.
 */
import type { BoardSnapshot, RunRegistration } from '@game/sim';
import type { SetId } from '@game/content';

export type PoolStatus = 'idle' | 'loading' | 'ready' | 'failed';
/** Where the runs currently registered came from: the server-side sample (`rpc`), the pre-migration fallback
 *  that assembles whole runs client-side (`fallback`), or the last-good cache. Recorded in lobby telemetry. */
export type PoolSource = 'none' | 'rpc' | 'fallback' | 'cache';

export interface PoolLoadState {
  status: PoolStatus;
  source: PoolSource;
  /** Whole runs handed to registration this session (network + cache). A refresh re-counts runs the pool already
   *  holds (registration dedupes), so this is a receipt count, not the pool size. */
  runs: number;
  /** Boards those runs carried. */
  boards: number;
  /** Runs refused because they arrived incomplete or held a board this build cannot serve. Should stay 0. */
  runsDropped: number;
}

/** One run as the network (or the cache) delivers it: the run's key, its owner, how many distinct waves the
 *  server counted for it (when known), and ALL of its boards. */
export interface PoolRun {
  key: string;
  ownerId?: string | null;
  /** Distinct waves the server recorded for this run. When present, a run that arrives with fewer is refused. */
  waves?: number;
  snaps: BoardSnapshot[];
}

export interface PoolFetch {
  runs: PoolRun[];
  path: 'rpc' | 'fallback';
}

/** Bump when the cached shape changes: a record of another version is ignored (so a pre-2026-09-29 per-wave
 *  cache, which could hold cut-down runs, is never read again). */
export const POOL_CACHE_VERSION = 2;

/** The persisted last-good pool for ONE set: whole runs keyed by run key. */
export interface CachedPool {
  version: typeof POOL_CACHE_VERSION;
  setId: SetId;
  /** The build-version prefix the runs were fetched for. A cache from another version is ignored. */
  patchPrefix: string;
  savedAt: number;
  runs: Record<string, PoolRun>;
}

export interface PoolCacheStore {
  load(setId: SetId): Promise<unknown>;
  save(pool: CachedPool): Promise<void>;
}

export interface PoolLoaderDeps {
  /** A sample of whole runs. Must reject (or honour `signal`) on failure; resolving means the server answered. */
  fetchRuns(signal: AbortSignal): Promise<PoolFetch>;
  /** All-or-nothing registration per run into the opponent pool (`registerOpponentRuns`, idempotent). */
  registerRuns(runs: BoardSnapshot[][]): RunRegistration;
  cache: PoolCacheStore;
  /** The set whose runs are worth caching (the live set). */
  setId(): SetId;
  patchPrefix: string;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Timer seam for the background retry (setTimeout in the app). Returns a cancel function. */
  schedule(fn: () => void, ms: number): () => void;
}

export interface LoadOptions {
  /** Budget for one attempt (the whole sample: one RPC, or the fallback's handful of requests). */
  perRequestMs: number;
  attempts: number;
  /** Base delay between attempts; doubles per attempt. */
  retryBaseMs: number;
}

/** Startup: generous enough for a slow link (the sample is ~2 MB of JSON before compression), short enough that
 *  the background path takes over quickly. */
export const STARTUP_LOAD: LoadOptions = { perRequestMs: 12000, attempts: 2, retryBaseMs: 500 };
/** The lobby gate's own retry: a player is waiting on it, so it is allowed longer. */
export const GATE_LOAD: LoadOptions = { perRequestMs: 15000, attempts: 2, retryBaseMs: 750 };
/** Background retry delays after a load that failed. Stops after the last one (the `online` event and every
 *  lobby launch still retry). */
export const BACKGROUND_RETRY_MS = [5000, 15000, 45000, 120000, 300000];
/** A cache older than this is not used: a week-old pool is still real runs, a month-old one is a different meta. */
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** The cache is rewritten at most this often (a ~2 MB structured clone is cheap, but not free). */
export const CACHE_WRITE_INTERVAL_MS = 30 * 60 * 1000;
/** Cap on cached runs (matches the sample size, with room for a refresh's new runs). */
export const CACHE_MAX_RUNS = 300;

const withTimeout = <T>(p: Promise<T>, ms: number, ctl: AbortController): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { ctl.abort(); reject(new Error('timeout')); }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e); });
  });

const runKeyOfSnap = (s: BoardSnapshot): string => `${s.author ?? 'anon'}|${s.heroId}|${s.seed}`;

/**
 * Is this run complete, as delivered? Every board belongs to the run (same key), has minions, and when the
 * server said how many distinct waves the run has, all of them arrived. A run that fails is refused whole:
 * it never reaches registration, so a seat can never be built from a fragment.
 */
export function isWholeRun(run: PoolRun): boolean {
  if (!run.snaps.length) return false;
  for (const s of run.snaps) {
    if (!s || !Array.isArray(s.minions) || s.minions.length === 0 || typeof s.wave !== 'number') return false;
    if (runKeyOfSnap(s) !== run.key) return false;
  }
  if (typeof run.waves === 'number' && new Set(run.snaps.map((s) => s.wave)).size !== run.waves) return false;
  return true;
}

/** Read a cache record, or null when it is not a usable v2 whole-run pool for this set, build and age. */
export function usableCache(raw: unknown, setId: SetId, patchPrefix: string, now: number): CachedPool | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<CachedPool>;
  if (c.version !== POOL_CACHE_VERSION || c.setId !== setId || c.patchPrefix !== patchPrefix) return null;
  if (typeof c.savedAt !== 'number' || now - c.savedAt > CACHE_MAX_AGE_MS) return null;
  if (!c.runs || typeof c.runs !== 'object') return null;
  return c as CachedPool;
}

export interface PoolLoader {
  state(): PoolLoadState;
  subscribe(fn: (s: PoolLoadState) => void): () => void;
  /** Fetch a sample unless one already arrived this session (always with `refresh`). Joins an in-flight load. */
  load(opts?: LoadOptions & { refresh?: boolean }): Promise<PoolLoadState>;
  /** Resolve once the pool is usable: immediately when ready, else after the in-flight load or a fresh one
   *  with the gate's longer budget. Never rejects. */
  ensure(): Promise<PoolLoadState>;
  /** Kick an immediate retry when nothing fresh has arrived yet (wired to the browser `online` event). */
  onOnline(): void;
  dispose(): void;
}

export function createPoolLoader(deps: PoolLoaderDeps): PoolLoader {
  let fresh = false; // a network sample arrived this session
  let source: PoolSource = 'none';
  let runs = 0;
  let boards = 0;
  let runsDropped = 0;
  let status: PoolStatus = 'idle';
  let inFlight: Promise<PoolLoadState> | null = null;
  let cachePromise: Promise<CachedPool | null> | null = null;
  let lastCacheWrite = -Infinity;
  const freshRuns = new Map<string, PoolRun>(); // this session's network runs, for the cache write
  let retryIndex = 0;
  let cancelRetry: (() => void) | null = null;
  const listeners = new Set<(s: PoolLoadState) => void>();

  const snapshot = (): PoolLoadState => ({ status, source, runs, boards, runsDropped });
  const emit = (): void => { const s = snapshot(); for (const fn of listeners) fn(s); };

  /** Validate, stamp and register whole runs. Returns the runs that were accepted. */
  const register = (delivered: readonly PoolRun[]): PoolRun[] => {
    const whole: PoolRun[] = [];
    for (const r of delivered) {
      if (isWholeRun(r)) whole.push(r);
      else runsDropped++;
    }
    if (!whole.length) return whole;
    const stamped = whole.map((r) => r.snaps.map((s) => ({
      ...s,
      remote: true as const, // live-shared-pool mark, as before
      ...(r.ownerId ? { ownerId: r.ownerId } : {}),
    })));
    const res = deps.registerRuns(stamped);
    runs += res.runs;
    boards += res.boards;
    runsDropped += res.dropped;
    return whole;
  };

  const loadCache = (): Promise<CachedPool | null> => {
    cachePromise ??= deps.cache.load(deps.setId()).then(
      (raw) => usableCache(raw, deps.setId(), deps.patchPrefix, deps.now()),
      () => null,
    );
    return cachePromise;
  };

  const fetchOnce = async (opts: LoadOptions): Promise<boolean> => {
    for (let attempt = 0; attempt < opts.attempts; attempt++) {
      if (attempt > 0) await deps.sleep(opts.retryBaseMs * 2 ** (attempt - 1));
      const ctl = new AbortController();
      try {
        const got = await withTimeout(deps.fetchRuns(ctl.signal), opts.perRequestMs, ctl);
        const accepted = register(got.runs);
        for (const r of accepted) freshRuns.set(r.key, r);
        fresh = true;
        source = got.path;
        emit();
        return true;
      } catch { /* timed out / failed: next attempt */ }
    }
    return false;
  };

  const writeCache = (): void => {
    if (freshRuns.size === 0 || deps.now() - lastCacheWrite < CACHE_WRITE_INTERVAL_MS) return;
    lastCacheWrite = deps.now();
    const setId = deps.setId();
    const out: Record<string, PoolRun> = {};
    // ONLY the live set's runs, whole, newest arrivals kept when over the cap.
    const live = [...freshRuns.values()].filter((r) => (r.snaps[0]?.setId ?? 'set1') === setId);
    for (const r of live.slice(-CACHE_MAX_RUNS)) out[r.key] = r;
    void deps.cache.save({ version: POOL_CACHE_VERSION, setId, patchPrefix: deps.patchPrefix, savedAt: deps.now(), runs: out })
      .catch(() => { /* best-effort */ });
  };

  const scheduleBackground = (): void => {
    if (cancelRetry || fresh || retryIndex >= BACKGROUND_RETRY_MS.length) return;
    const ms = BACKGROUND_RETRY_MS[retryIndex++]!;
    cancelRetry = deps.schedule(() => { cancelRetry = null; void load(STARTUP_LOAD); }, ms);
  };

  const run = async (opts: LoadOptions, refresh: boolean): Promise<PoolLoadState> => {
    if (fresh && !refresh) return snapshot();
    if (status !== 'ready') status = 'loading';
    emit();
    const ok = await fetchOnce(opts);
    // The network could not supply a sample: fall back to the last good pool of WHOLE runs (stale-but-real
    // beats generated), once per session.
    if (!ok && source === 'none') {
      const cached = await loadCache();
      if (cached) {
        const accepted = register(Object.values(cached.runs));
        if (accepted.length) source = 'cache';
      }
    }
    // Usable once the server answered (even with no runs: those generated seats are genuine) or the cache
    // covered it.
    status = fresh || source === 'cache' ? 'ready' : 'failed';
    if (!fresh) scheduleBackground();
    else retryIndex = 0;
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
      if (fresh) return;
      cancelRetry?.(); cancelRetry = null; retryIndex = 0;
      void load(STARTUP_LOAD);
    },
    dispose() { cancelRetry?.(); cancelRetry = null; listeners.clear(); },
  };
}
