/**
 * BALANCE BOT B5 — the job store. One directory per job under `packages/tools/src/balance/out/<jobId>/` (gitignored):
 *
 *   manifest.json            the ExperimentManifest
 *   identity.json            the ExperimentIdentity
 *   lobbies/<seed>.json      one LobbyRecord per seed, in an envelope with a checksum — written ATOMICALLY
 *   summary.json             optional: the last rendered Aggregate (regenerable)
 *
 * Resumable: `completedSeeds(jobId, manifest, identity)` returns the seeds whose lobby file exists, parses, whose
 * checksum matches its record, and whose record carries the SAME identity + manifest digest. A stale file (a
 * different engine, a different manifest) is not "done" — the roadmap's rule: resumption requires matching
 * identities and completed shard checksums, not merely an existing filename.
 *
 * MATRIX jobs (`balance:matrix`): the job's manifest is the BASE manifest (carrying `matrix`), and every lobby's
 * record carries a DERIVED manifest — the base with `pinnedHero` / `exploration` / `seeds` / `name` set for that
 * lobby. Lobby files are then keyed `<pinnedHero>-<seed>.json` (`lobbyFileKey`) and a record is accepted when its
 * manifest, stripped of the per-lobby fields, equals the base stripped the same way (`manifestMatches`).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExperimentIdentity, ExperimentManifest, LobbyRecord } from './deps';
import { fnv1a } from './stats';

export const OUT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'out');

export interface LobbyEnvelope {
  schemaVersion: 1;
  /** FNV-1a over `JSON.stringify(record)` — the "checksum line". */
  checksum: string;
  record: LobbyRecord;
}

export interface Job {
  jobId: string;
  dir: string;
  manifest: ExperimentManifest;
  identity: ExperimentIdentity;
  lobbies: LobbyRecord[];
  /** Seeds whose file exists but failed the checksum / identity / manifest check (never silently reused).
   *  `key` is the file key (`lobbyFileKey`) — the same as the seed for a plain job, `<hero>-<seed>` for a matrix. */
  rejected: { seed: number; key: string; reason: string }[];
}

/** The lobby file key: the seed for a plain job; `<pinnedHero>-<seed>` for a matrix lobby (its manifest pins a hero). */
export const lobbyFileKey = (record: { seed: number; manifest: { pinnedHero?: string } }): string =>
  record.manifest.pinnedHero ? `${record.manifest.pinnedHero}-${record.seed}` : String(record.seed);
const KEY_FILE = /^([A-Za-z0-9_.-]+)\.json$/;
const seedOfKey = (key: string): number => Number(/(-?\d+)$/.exec(key)?.[1] ?? NaN);

/** The per-lobby fields a matrix lobby's derived manifest may differ from the base in. */
const DERIVED_FIELDS = ['name', 'pinnedHero', 'exploration', 'seeds', 'matrix'] as const;
function stripDerived(m: ExperimentManifest): string {
  const o: Record<string, unknown> = { ...m };
  for (const f of DERIVED_FIELDS) delete o[f];
  return JSON.stringify(o);
}
/** Does a record's manifest belong to this job? Identical for a plain job; for a matrix job (base carries `matrix`)
 *  a derived manifest — pinned, same everything else, no `matrix` of its own — is the expected shape. */
export function manifestMatches(base: ExperimentManifest, recordManifest: ExperimentManifest): boolean {
  if (JSON.stringify(base) === JSON.stringify(recordManifest)) return true;
  if (!base.matrix || recordManifest.matrix || !recordManifest.pinnedHero) return false;
  return stripDerived(base) === stripDerived(recordManifest);
}

const SAFE_ID = /^[A-Za-z0-9._-]+$/;
export function jobDir(jobId: string, root = OUT_ROOT): string {
  if (!SAFE_ID.test(jobId)) throw new Error(`store: job id "${jobId}" must match ${SAFE_ID}`);
  return join(root, jobId);
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
}

export const recordChecksum = (record: LobbyRecord): string => fnv1a(JSON.stringify(record));

/** Create (or re-open) a job directory. Re-opening with a different manifest/identity is an error, not a merge. */
export function createJob(jobId: string, manifest: ExperimentManifest, identity: ExperimentIdentity, root = OUT_ROOT): string {
  const dir = jobDir(jobId, root);
  mkdirSync(join(dir, 'lobbies'), { recursive: true });
  const mPath = join(dir, 'manifest.json'); const iPath = join(dir, 'identity.json');
  if (existsSync(mPath)) {
    const prior = readJson<ExperimentManifest>(mPath);
    if (JSON.stringify(prior) !== JSON.stringify(manifest)) throw new Error(`store: job "${jobId}" already exists with a different manifest — use a new job id`);
  } else writeAtomic(mPath, JSON.stringify(manifest, null, 2));
  if (existsSync(iPath)) {
    const prior = readJson<ExperimentIdentity>(iPath);
    if (JSON.stringify(prior) !== JSON.stringify(identity)) throw new Error(`store: job "${jobId}" already exists with a different identity (${prior.engineRevision}/${prior.contentDigest} vs ${identity.engineRevision}/${identity.contentDigest}) — a changed rules identity invalidates the job; use a new job id`);
  } else writeAtomic(iPath, JSON.stringify(identity, null, 2));
  return dir;
}

export function writeLobby(jobId: string, record: LobbyRecord, root = OUT_ROOT): string {
  const path = join(jobDir(jobId, root), 'lobbies', `${lobbyFileKey(record)}.json`);
  const env: LobbyEnvelope = { schemaVersion: 1, checksum: recordChecksum(record), record };
  writeAtomic(path, JSON.stringify(env));
  return path;
}

export function writeSummary(jobId: string, summary: unknown, root = OUT_ROOT): string {
  const path = join(jobDir(jobId, root), 'summary.json');
  writeAtomic(path, JSON.stringify(summary, null, 2));
  return path;
}

/** Read one lobby file and verify it belongs to (manifest, identity). */
export function readLobby(path: string, manifest: ExperimentManifest, identity: ExperimentIdentity): { record: LobbyRecord } | { reason: string } {
  let env: LobbyEnvelope;
  try { env = readJson<LobbyEnvelope>(path); } catch (e) { return { reason: `unreadable: ${(e as Error).message}` }; }
  if (!env || env.schemaVersion !== 1 || !env.record || typeof env.checksum !== 'string') return { reason: 'bad envelope' };
  if (recordChecksum(env.record) !== env.checksum) return { reason: 'checksum mismatch (incomplete or corrupted write)' };
  const id = env.record.identity;
  for (const f of ['engineRevision', 'dirtyDigest', 'contentDigest', 'poolDigest', 'effectDigest', 'manifestDigest'] as const) {
    if (id[f] !== identity[f]) return { reason: `identity.${f} differs (${id[f]} vs ${identity[f]})` };
  }
  if (!manifestMatches(manifest, env.record.manifest)) return { reason: 'manifest differs' };
  return { record: env.record };
}

/** Every lobby file key complete for this exact (manifest, identity) — the resume set for a matrix job. */
export function completedKeys(jobId: string, manifest: ExperimentManifest, identity: ExperimentIdentity, root = OUT_ROOT): Set<string> {
  const dir = join(jobDir(jobId, root), 'lobbies');
  const out = new Set<string>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const m = KEY_FILE.exec(f); if (!m) continue;
    const r = readLobby(join(dir, f), manifest, identity);
    if ('record' in r && lobbyFileKey(r.record) === m[1]) out.add(m[1]);
  }
  return out;
}

/** Seeds already complete for this exact (manifest, identity) — the resume set. */
export function completedSeeds(jobId: string, manifest: ExperimentManifest, identity: ExperimentIdentity, root = OUT_ROOT): Set<number> {
  const dir = join(jobDir(jobId, root), 'lobbies');
  const out = new Set<number>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const m = /^(-?\d+)\.json$/.exec(f); if (!m) continue;
    const r = readLobby(join(dir, f), manifest, identity);
    if ('record' in r && r.record.seed === Number(m[1])) out.add(r.record.seed);
  }
  return out;
}

export function listJobs(root = OUT_ROOT): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'manifest.json'))).map((d) => d.name).sort();
}

export function loadJob(jobId: string, root = OUT_ROOT): Job {
  const dir = jobDir(jobId, root);
  if (!existsSync(join(dir, 'manifest.json'))) throw new Error(`store: no job "${jobId}" under ${root} (known: ${listJobs(root).join(', ') || 'none'})`);
  const manifest = readJson<ExperimentManifest>(join(dir, 'manifest.json'));
  const identity = readJson<ExperimentIdentity>(join(dir, 'identity.json'));
  const lobbies: LobbyRecord[] = []; const rejected: Job['rejected'] = [];
  const ldir = join(dir, 'lobbies');
  if (existsSync(ldir)) {
    // Order: by seed, then by key — so a plain job reads 1, 2, 3 … and a matrix job reads every hero of seed 1 first.
    const files = readdirSync(ldir).filter((f) => KEY_FILE.test(f)).map((f) => ({ f, key: KEY_FILE.exec(f)![1] }));
    files.sort((a, b) => seedOfKey(a.key) - seedOfKey(b.key) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const { f, key } of files) {
      const r = readLobby(join(ldir, f), manifest, identity);
      if ('record' in r && lobbyFileKey(r.record) === key) lobbies.push(r.record);
      else rejected.push({ seed: seedOfKey(key), key, reason: 'record' in r ? `file key "${key}" does not match the record (${lobbyFileKey(r.record)})` : r.reason });
    }
  }
  return { jobId, dir, manifest, identity, lobbies, rejected };
}

export function deleteJob(jobId: string, root = OUT_ROOT): void {
  const dir = jobDir(jobId, root);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
