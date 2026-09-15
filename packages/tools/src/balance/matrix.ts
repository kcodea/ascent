/**
 * BALANCE BOT — the HERO MATRIX runner (owner ask 2026-09-15: "sim it 30 times for every hero where it picks
 * different lines and runes and cards and comes back with general balance results … catch the outliers").
 *
 *   npm run balance:matrix -- --manifest <base.json> --runs-per-hero 30 --out <jobId>
 *                             [--heroes a,b,c] [--exploration-rotate] [--exploration-k 4] [--workers 4]
 *
 * From a BASE manifest (set, mode, policy, budget, corpus / opponent pool, fight rules) the planner writes a
 * SCHEDULE: every playable hero of the set (production eligibility — `playableHeroes()` minus the heroes whose
 * tribe gate no tribe of the set can meet) × N runs. Each run is one lobby whose seat 0 is PINNED to the hero
 * (`manifest.pinnedHero`; the other seats rotate from the roster minus it) on a seed from a PAIRED schedule — the
 * SAME seed set for every hero, so heroes are compared on identical seeds (seat 0's run seed, shop draws and
 * fight RNG are functions of the lobby seed) — with `exploration` rotating `(seed − start) mod K` when asked, so
 * a strategist pilot plays different lines across a hero's runs.
 *
 * ONE job holds every lobby (file key `<hero>-<seed>`, see `store.ts`); it resumes like `balance:run` — a lobby
 * whose file exists, checksums and carries this job's identity is skipped. Progress + ETA print as it goes.
 * `--workers N` shards the schedule across N child processes (each resumes the same job dir; writes are atomic).
 *
 * The runner is chosen by the base manifest's `mode`: `selfPlayLobby` (today) or `pinnedLobby` (the pilot in
 * seat 0 against recorded player runs — built on `feat/balance-pinned`; loaded dynamically so this file builds
 * on a branch without it and reports "not on this branch" instead of failing to import).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HEROES, playableHeroes, runPinnedLobby, runSelfPlayLobby, SETS, type BalanceRecorder, type ExperimentIdentity, type ExperimentManifest, type LobbyRecord, type SeatPilot } from './deps';
import { completedKeys, lobbyFileKey, loadJob, writeLobby, OUT_ROOT } from './store';

export interface MatrixOptions {
  runsPerHero: number;
  /** Restrict to these hero ids (must be playable). Default: every playable hero of the set. */
  heroes?: readonly string[];
  /** Rotate `exploration` = (seed − start) mod K across a hero's seeds. Default off (every lobby exploration 0). */
  explorationRotate?: boolean;
  /** K for the rotation. Default 4. */
  explorationK?: number;
}

export interface MatrixEntry {
  heroId: string;
  seed: number;
  exploration: number;
  /** The lobby file key (`store.lobbyFileKey`) — `<hero>-<seed>`. */
  key: string;
  /** The canonical lobby id the record is relabelled to: `<mode>:<set>:<policy>:<hero>:<seed>`. */
  lobbyId: string;
  manifest: ExperimentManifest;
}

export interface MatrixPlan {
  /** The base manifest WITH its `matrix` field — the job's manifest.json and the identity's input. */
  base: ExperimentManifest;
  heroes: string[];
  /** The paired seed schedule, shared by every hero. */
  seeds: number[];
  entries: MatrixEntry[];
}

export const DEFAULT_EXPLORATION_K = 4;

/** Production eligibility for the matrix: playable (not wip / practiceOnly) and, for a tribe-gated hero, at least
 *  one gated tribe exists in the set (a per-seed tribe roll is checked by the runner and reported as a failure). */
export function matrixHeroes(setId: ExperimentManifest['setId'], restrict?: readonly string[]): string[] {
  const setTribes = new Set<string>((SETS[setId]?.tribes ?? []) as readonly string[]);
  const eligible = playableHeroes().filter((h) => !h.tribes || h.tribes.some((t) => setTribes.has(t))).map((h) => h.id);
  if (!restrict?.length) return eligible;
  const out: string[] = [];
  for (const id of restrict) {
    if (!HEROES.some((h) => h.id === id)) throw new Error(`balance:matrix — unknown hero '${id}'`);
    if (!eligible.includes(id)) throw new Error(`balance:matrix — hero '${id}' is not playable in ${setId} (wip / practiceOnly / tribe gate)`);
    out.push(id);
  }
  return out;
}

export const matrixLobbyId = (base: ExperimentManifest, heroId: string, seed: number): string => `${base.mode}:${base.setId}:${base.policy.id}:${heroId}:${seed}`;

/** One lobby's manifest: the base, pinned to `heroId`, one seed, its exploration index. Never carries `matrix`. */
export function deriveLobbyManifest(base: ExperimentManifest, heroId: string, seed: number, exploration: number): ExperimentManifest {
  const rest: ExperimentManifest = { ...base }; delete rest.matrix;
  const m: ExperimentManifest = { ...rest, name: `${base.name}/${heroId}/${seed}`, pinnedHero: heroId, seeds: { start: seed, count: 1 } };
  if (exploration > 0 || base.matrix?.explorationK !== undefined) m.exploration = exploration;
  return m;
}

/** Plan the schedule. Pure and deterministic: the same base + options → the same entries in the same order
 *  (SEED-major, hero-minor — an interrupted job has every hero on the first seeds rather than a few heroes on all,
 *  and `--workers` shards interleave heroes evenly). */
export function planMatrix(input: ExperimentManifest, opts: MatrixOptions): MatrixPlan {
  if (opts.runsPerHero < 1) throw new Error('balance:matrix — --runs-per-hero must be ≥ 1');
  const heroes = matrixHeroes(input.setId, opts.heroes);
  if (!heroes.length) throw new Error(`balance:matrix — no playable hero for ${input.setId}`);
  const K = opts.explorationRotate ? (opts.explorationK ?? DEFAULT_EXPLORATION_K) : undefined;
  const clean: ExperimentManifest = { ...input }; delete clean.pinnedHero; delete clean.exploration;
  const base: ExperimentManifest = { ...clean, seeds: { start: input.seeds.start, count: opts.runsPerHero }, matrix: { runsPerHero: opts.runsPerHero, heroes, ...(K !== undefined ? { explorationK: K } : {}) } };
  const seeds = Array.from({ length: opts.runsPerHero }, (_, i) => input.seeds.start + i);
  const entries: MatrixEntry[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const exploration = K === undefined ? 0 : i % K;
    for (const heroId of heroes) {
      const manifest = deriveLobbyManifest(base, heroId, seed, exploration);
      entries.push({ heroId, seed, exploration, key: lobbyFileKey({ seed, manifest }), lobbyId: matrixLobbyId(base, heroId, seed), manifest });
    }
  }
  return { base, heroes, seeds, entries };
}

/** Rewrite a record's lobby id everywhere it appears (a runner that does not fold the pinned hero into its id
 *  would otherwise collide across heroes on one seed). Idempotent. */
export function relabelLobby(record: LobbyRecord, lobbyId: string): LobbyRecord {
  if (record.lobbyId === lobbyId) return record;
  return {
    ...record, lobbyId,
    seats: record.seats.map((s) => ({ ...s, lobbyId })),
    rounds: record.rounds.map((r) => ({ ...r, lobbyId })),
    actions: record.actions.map((a) => ({ ...a, lobbyId })),
    effects: record.effects.map((e) => ({ ...e, lobbyId })),
  };
}

export type LobbyRunner = (manifest: ExperimentManifest, seed: number, pilotFor: (seatIdx: number) => SeatPilot, recorder: BalanceRecorder, identity: ExperimentIdentity) => LobbyRecord;

/** The runner for a mode. `pinnedLobby` is loaded dynamically (built on `feat/balance-pinned`); on a branch
 *  without it the error names the branch instead of a missing module. */
export async function runnerFor(mode: ExperimentManifest['mode']): Promise<LobbyRunner> { // async kept for the CLI's call shape
  if (mode === 'selfPlayLobby') return runSelfPlayLobby;
  if (mode === 'pinnedLobby') return (manifest, seed, pilotFor, recorder, identity) => runPinnedLobby(manifest, seed, pilotFor(0), recorder, identity); // one pilot: seat 0
  throw new Error(`balance:matrix — mode "${mode}" is not runnable (selfPlayLobby | pinnedLobby)`);
}

export interface RunMatrixOptions {
  jobId: string;
  identity: ExperimentIdentity;
  runner: LobbyRunner;
  pilotFor: (manifest: ExperimentManifest, entry: MatrixEntry) => SeatPilot;
  recorderFor: (lobbyId: string, seed: number, manifest: ExperimentManifest, identity: ExperimentIdentity) => BalanceRecorder;
  /** Run only entries with `index % count === index` (child workers). */
  shard?: { index: number; count: number };
  root?: string;
  log?: (line: string) => void;
}

export interface RunMatrixResult { planned: number; ran: number; skipped: number; failed: number; ms: number; perLobbyMs: number | undefined }

/** Run (or resume) the schedule into the job. A lobby whose seat 0 did not get the pinned hero is FAILED (censored),
 *  never silently accepted. Every lobby is written before the next starts, so an interruption loses at most one. */
export function runMatrix(plan: MatrixPlan, opts: RunMatrixOptions): RunMatrixResult {
  const root = opts.root ?? OUT_ROOT;
  const log = opts.log ?? ((s: string) => console.log(s));
  const done = completedKeys(opts.jobId, plan.base, opts.identity, root);
  const mine = plan.entries.filter((_, i) => !opts.shard || i % opts.shard.count === opts.shard.index);
  const todo = mine.filter((e) => !done.has(e.key));
  const skipped = mine.length - todo.length;
  const tag = opts.shard ? `[w${opts.shard.index}] ` : '';
  log(`${tag}${plan.heroes.length} heroes × ${plan.seeds.length} seeds = ${plan.entries.length} lobbies planned; this ${opts.shard ? 'shard' : 'process'}: ${mine.length}, ${skipped} already complete, ${todo.length} to run`);
  const t0 = Date.now();
  let ran = 0, failed = 0;
  for (const entry of todo) {
    const t1 = Date.now();
    const recorder = opts.recorderFor(entry.lobbyId, entry.seed, entry.manifest, opts.identity);
    let record: LobbyRecord;
    try {
      record = opts.runner(entry.manifest, entry.seed, () => opts.pilotFor(entry.manifest, entry), recorder, opts.identity);
    } catch (e) {
      // A thrown runner is a FAILED lobby with a record, so coverage can count it — never a hole in the schedule.
      record = { lobbyId: entry.lobbyId, seed: entry.seed, manifest: entry.manifest, identity: opts.identity, seats: [], rounds: [], actions: [], effects: [], roundsPlayed: 0, failure: `runner threw: ${(e as Error).message}` };
    }
    record = relabelLobby(record, entry.lobbyId);
    if (!record.failure && !record.seats.some((s) => s.heroId === entry.heroId)) record = { ...record, failure: `pinned hero ${entry.heroId} was not seated (seats: ${record.seats.map((s) => s.heroId).join(', ') || 'none'})` };
    writeLobby(opts.jobId, record, root);
    ran++; if (record.failure) failed++;
    const elapsed = Date.now() - t0; const per = elapsed / ran; const eta = Math.round((per * (todo.length - ran)) / 1000);
    log(`${tag}[${ran + skipped}/${mine.length}] ${entry.heroId} seed ${entry.seed}${entry.exploration ? ` x${entry.exploration}` : ''}: ${record.failure ? 'FAILED — ' + record.failure : record.roundsPlayed + ' rounds'} (${Date.now() - t1} ms; avg ${Math.round(per)} ms/lobby; ETA ${fmtDuration(eta)})`);
  }
  const ms = Date.now() - t0;
  return { planned: plan.entries.length, ran, skipped, failed, ms, perLobbyMs: ran ? ms / ran : undefined };
}

export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : m ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
}

/** Shard the schedule across N child processes (each re-invokes this CLI with `--shard i/N` and resumes the
 *  same job dir). Resolves when every child exits; a child's non-zero exit is reported, not hidden. */
export function runWorkers(cliArgv: readonly string[], workers: number, cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url))): Promise<number[]> {
  const children = Array.from({ length: workers }, (_, i) => new Promise<number>((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', cliPath, 'matrix', ...cliArgv, '--shard', `${i}/${workers}`], { stdio: 'inherit', env: process.env });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  }));
  return Promise.all(children);
}

/** Coverage of a finished (or partial) matrix job, straight from the store — what the CLI prints at the end. */
export function matrixProgress(jobId: string, plan: MatrixPlan, root = OUT_ROOT): { complete: number; failed: number; missing: string[] } {
  const job = loadJob(jobId, root);
  const byKey = new Map(job.lobbies.map((L) => [lobbyFileKey(L), L]));
  let complete = 0, failed = 0; const missing: string[] = [];
  for (const e of plan.entries) { const L = byKey.get(e.key); if (!L) missing.push(e.key); else if (L.failure) failed++; else complete++; }
  return { complete, failed, missing };
}
