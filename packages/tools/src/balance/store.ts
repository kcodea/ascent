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
  /** Seeds whose file exists but failed the checksum / identity / manifest check (never silently reused). */
  rejected: { seed: number; reason: string }[];
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
  const path = join(jobDir(jobId, root), 'lobbies', `${record.seed}.json`);
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
  if (JSON.stringify(env.record.manifest) !== JSON.stringify(manifest)) return { reason: 'manifest differs' };
  return { record: env.record };
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
    for (const f of readdirSync(ldir).sort((a, b) => Number(a.replace('.json', '')) - Number(b.replace('.json', '')))) {
      const m = /^(-?\d+)\.json$/.exec(f); if (!m) continue;
      const r = readLobby(join(ldir, f), manifest, identity);
      if ('record' in r) lobbies.push(r.record); else rejected.push({ seed: Number(m[1]), reason: r.reason });
    }
  }
  return { jobId, dir, manifest, identity, lobbies, rejected };
}

export function deleteJob(jobId: string, root = OUT_ROOT): void {
  const dir = jobDir(jobId, root);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
