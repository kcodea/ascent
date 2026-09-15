/**
 * BALANCE BOT — versioned OPPONENT PANELS (roadmap B3: "versioned opponent panels"; trust ledger next step 2).
 *
 * The pilot's `fightScore` samples the registered opponent pool for the run's set; with none registered it scores
 * against the procedural threat curve and says so. The right population is the one self-play produces, so a
 * job's per-round board snapshots (recorded by the runner on every `RoundRecord`) become a pool FILE under
 * `out/pools/<name>.json`, stamped with the job's identity and its own digest. A manifest names the pool it wants
 * (`opponentPool: { name, digest }`); `balance:run` registers it before the first lobby, and the digest rides
 * the manifest digest so two jobs on different panels never compare as equals.
 *
 * Snapshots are taken at the END of each seat's recruit turn — the board it fought with — through the same
 * `snapshotBoard` converter the shipped game serves opponents with, so the panel is exactly what a served
 * opponent looks like. `origin: 'synthetic'` marks them as bot boards (never a recording).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_ROOT, loadJob } from './store';
import { digest } from '@game/sim/balance/identity';
import type { BoardSnapshot } from '@game/sim';
import { registerOpponents, OPPONENT_POOL } from '@game/sim';

export interface PoolFile {
  schemaVersion: 1;
  name: string;
  /** Digest of the boards (order-independent: sorted by a stable key). */
  digest: string;
  builtFromJob: string;
  identity: unknown;
  setId: string;
  boards: BoardSnapshot[];
}

export function poolPath(name: string, root = OUT_ROOT): string {
  return join(root, 'pools', `${name}.json`);
}

/** Build a pool from a job: every round snapshot, de-duplicated by (hero, wave, board contents), capped per wave
 *  so early rounds (many near-identical boards) do not swamp the band a late-game evaluation samples. */
export function buildPool(jobId: string, name: string, opts: { perWaveCap?: number; root?: string } = {}): PoolFile {
  const job = loadJob(jobId, opts.root);
  const perWave = opts.perWaveCap ?? 400;
  const seen = new Set<string>();
  const byWave = new Map<number, BoardSnapshot[]>();
  for (const L of job.lobbies) {
    if (L.failure) continue; // a censored lobby's boards are not a trustworthy population
    for (const r of L.rounds) {
      const s = r.snapshot;
      if (!s || s.minions.length === 0) continue;
      const key = `${s.heroId}|${s.wave}|${s.minions.map((m) => `${m.cardId}:${m.attack}/${m.health}${m.golden ? 'g' : ''}`).join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const bucket = byWave.get(s.wave) ?? byWave.set(s.wave, []).get(s.wave)!;
      if (bucket.length >= perWave) continue;
      bucket.push({ ...s, origin: 'synthetic', seed: L.seed });
    }
  }
  const boards = [...byWave.keys()].sort((a, b) => a - b).flatMap((w) => byWave.get(w)!);
  const d = digest(JSON.stringify(boards.map((b) => `${b.heroId}|${b.wave}|${b.minions.map((m) => `${m.cardId}:${m.attack}/${m.health}${m.golden ? 'g' : ''}`).join(',')}`).sort()));
  const file: PoolFile = { schemaVersion: 1, name, digest: d, builtFromJob: jobId, identity: job.identity, setId: job.manifest.setId, boards };
  const path = poolPath(name, opts.root);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(file));
  return file;
}

export function loadPool(name: string, root = OUT_ROOT): PoolFile {
  const path = poolPath(name, root);
  if (!existsSync(path)) throw new Error(`balance: no opponent pool "${name}" at ${path} — build one with balance:pool -- --job <id> --out ${name}`);
  return JSON.parse(readFileSync(path, 'utf8')) as PoolFile;
}

/** Register a named pool for this process (idempotent). Refuses a digest mismatch so a manifest can never run on a
 *  panel other than the one it names. Returns how many boards the engine accepted (stale boards are filtered). */
export function registerPool(ref: { name: string; digest: string }, root = OUT_ROOT): number {
  const file = loadPool(ref.name, root);
  if (file.digest !== ref.digest) throw new Error(`balance: opponent pool "${ref.name}" digest ${file.digest} ≠ manifest's ${ref.digest} — the panel changed; rebuild the manifest against it`);
  const before = OPPONENT_POOL.length;
  registerOpponents(file.boards);
  return OPPONENT_POOL.length - before;
}
