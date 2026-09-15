/**
 * BALANCE BOT — the RECORDED PLAYER CORPUS (roadmap "Shipped asynchronous lobby": a pinned, compatible recording
 * population; owner 2026-09-15: "we need it to run against real player snapshots to actually learn and improve").
 *
 * `balance:corpus -- --set set2 --out set2-players-v1 [--patch 0.1.0+]` pulls EVERY real board of one set from the
 * shared pool — the same Supabase `boards` table the client reads in `fetchAndRegisterPool`, replicated here over
 * plain REST with `Range` paging so nothing is truncated (the client caps per wave; a corpus must not) — keeps the
 * boards a lobby seat can be built from (non-synthetic, at least one minion, the set the manifest names, optionally
 * one patch prefix), and writes `out/corpus/<name>.json` with an ORDER-INDEPENDENT digest. A `pinnedLobby` manifest
 * names `{ name, digest }`; `balance:run` refuses a digest mismatch, so a job never runs on a population other
 * than the one it says it ran on, and re-fetching later (more uploads) yields a NEW digest, never a silent drift.
 *
 * The corpus is what `createRunLobby` seats from (through `playerRunsFrom`: boards grouped back into runs by
 * author | hero | seed, ≥ 4 waves) AND what the pilot's `fightScore` samples. Never committed (`out/` is gitignored).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUT_ROOT } from './store';
import { digest } from '@game/sim/balance/identity';
import type { BoardSnapshot } from '@game/sim';
import { registerOpponents, OPPONENT_POOL, playerRunsFrom } from '@game/sim';
import type { SetId } from '@game/content';

export interface CorpusFile {
  schemaVersion: 1;
  name: string;
  setId: SetId;
  /** ISO timestamp of the fetch (provenance only — never part of the digest). */
  fetchedAt: string;
  /** Order-independent digest over the boards (see `corpusDigest`). */
  digest: string;
  /** Boards per `patch` stamp (`'(none)'` for boards without one). */
  patches: Record<string, number>;
  boards: BoardSnapshot[];
  /** Distinct runs `playerRunsFrom` reassembles from `boards` (author | hero | seed, ≥ 4 waves). */
  runs: number;
  /** Distinct authors across those runs. */
  authors: number;
  /** The patch prefix the fetch was filtered to, if any. */
  patchPrefix?: string;
}

export function corpusPath(name: string, root = OUT_ROOT): string {
  return join(root, 'corpus', `${name}.json`);
}

/** One board's identity for the digest: provenance + wave + the bodies. Two uploads of one board collapse. */
export const boardKey = (b: BoardSnapshot): string =>
  `${b.author ?? 'anon'}|${b.heroId}|${b.seed}|${b.wave}|${b.tier}|${b.minions.map((m) => `${m.cardId}:${m.attack}/${m.health}${m.golden ? 'g' : ''}`).join(',')}`;

/** Order-independent: the sorted board keys, so the same population fetched in any row order digests the same. */
export const corpusDigest = (boards: readonly BoardSnapshot[]): string => digest(boards.map(boardKey).sort().join('\n'));

/** The lobby's own eligibility, applied at the door (`playerRunsFrom` applies it again — this just keeps the file honest). */
export function eligibleBoard(b: unknown, setId: SetId, patchPrefix?: string): b is BoardSnapshot {
  if (!b || typeof b !== 'object') return false;
  const s = b as Partial<BoardSnapshot>;
  if (!Array.isArray(s.minions) || s.minions.length === 0) return false;
  if ((s.origin ?? 'house') === 'synthetic') return false;
  if ((s.setId ?? 'set1') !== setId) return false;
  if (typeof s.wave !== 'number' || typeof s.heroId !== 'string' || typeof s.seed !== 'number') return false;
  if (patchPrefix && !(s.patch ?? '').startsWith(patchPrefix)) return false;
  return true;
}

export interface FetchOptions {
  url: string;
  key: string;
  setId: SetId;
  patchPrefix?: string;
  /** Rows per page (Supabase's default max is 1000). */
  pageSize?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

interface BoardRow { wave: number; patch: string | null; snapshot: unknown; created_at?: string }

/**
 * Every row of the set from the `boards` table, paged with `Range` headers until a short page. Server-side filter
 * on the set (`snapshot->>setId`), client-side on everything else, so the eligibility rule lives in ONE function.
 */
export async function fetchCorpusBoards(opts: FetchOptions): Promise<{ boards: BoardSnapshot[]; rows: number }> {
  const f = opts.fetchImpl ?? fetch;
  const page = opts.pageSize ?? 1000;
  const base = opts.url.replace(/\/+$/, '');
  const boards: BoardSnapshot[] = [];
  let rows = 0;
  for (let from = 0; ; from += page) {
    const q = `${base}/rest/v1/boards?select=wave,patch,snapshot,created_at&snapshot->>setId=eq.${encodeURIComponent(opts.setId)}&order=created_at.asc`;
    const res = await f(q, { headers: { apikey: opts.key, Authorization: `Bearer ${opts.key}`, Range: `${from}-${from + page - 1}`, Prefer: 'count=exact' } });
    if (!res.ok && res.status !== 206) throw new Error(`balance:corpus — ${res.status} ${res.statusText} fetching rows ${from}…`);
    const batch = (await res.json()) as BoardRow[];
    rows += batch.length;
    for (const r of batch) {
      const s = r.snapshot;
      if (!eligibleBoard(s, opts.setId, opts.patchPrefix)) continue;
      // The row's own `patch` column is the authoritative stamp; the snapshot's copy is the fallback.
      boards.push({ ...s, ...(r.patch && !s.patch ? { patch: r.patch } : {}) });
    }
    if (batch.length < page) break;
  }
  return { boards, rows };
}

/** Assemble the file: de-duplicated by `boardKey`, sorted by key (so the JSON is stable too), summarised. */
export function buildCorpus(name: string, setId: SetId, boards: readonly BoardSnapshot[], opts: { fetchedAt?: string; patchPrefix?: string } = {}): CorpusFile {
  const byKey = new Map<string, BoardSnapshot>();
  for (const b of boards) if (!byKey.has(boardKey(b))) byKey.set(boardKey(b), b);
  const unique = [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, b]) => b);
  const patches: Record<string, number> = {};
  for (const b of unique) patches[b.patch ?? '(none)'] = (patches[b.patch ?? '(none)'] ?? 0) + 1;
  const runs = playerRunsFrom(unique, undefined, setId);
  return {
    schemaVersion: 1, name, setId, fetchedAt: opts.fetchedAt ?? new Date().toISOString(), digest: corpusDigest(unique),
    patches: Object.fromEntries(Object.entries(patches).sort(([a], [b]) => a.localeCompare(b))),
    boards: unique, runs: runs.length, authors: new Set(runs.map((r) => r.author)).size,
    ...(opts.patchPrefix ? { patchPrefix: opts.patchPrefix } : {}),
  };
}

export function writeCorpus(file: CorpusFile, root = OUT_ROOT): string {
  const path = corpusPath(file.name, root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(file));
  return path;
}

export function loadCorpus(name: string, root = OUT_ROOT): CorpusFile {
  const path = corpusPath(name, root);
  if (!existsSync(path)) throw new Error(`balance: no corpus "${name}" at ${path} — fetch one with balance:corpus -- --set <set> --out ${name}`);
  const file = JSON.parse(readFileSync(path, 'utf8')) as CorpusFile;
  if (file.schemaVersion !== 1) throw new Error(`balance: corpus "${name}" has schemaVersion ${String(file.schemaVersion)}; expected 1`);
  return file;
}

/**
 * Register the corpus a manifest names for this process (idempotent). The digest is recomputed from the boards on
 * disk AND compared with the file's own stamp and the manifest's, so neither a hand-edited file nor a re-fetched
 * one can run under an old name. Returns what the engine accepted (`registerOpponents` drops boards whose cards
 * this build no longer has) and the runs the lobby can seat from it.
 */
export function registerCorpus(ref: { name: string; digest: string }, root = OUT_ROOT): { registered: number; runs: number; authors: number; file: CorpusFile } {
  const file = loadCorpus(ref.name, root);
  const actual = corpusDigest(file.boards);
  if (actual !== file.digest) throw new Error(`balance: corpus "${ref.name}" boards digest ${actual} ≠ its stamped ${file.digest} — the file was edited; re-fetch it`);
  if (file.digest !== ref.digest) throw new Error(`balance: corpus "${ref.name}" digest ${file.digest} ≠ manifest's ${ref.digest} — the population changed; re-pin the manifest to it`);
  const before = OPPONENT_POOL.length;
  registerOpponents(file.boards);
  const runs = playerRunsFrom(undefined, undefined, file.setId);
  return { registered: OPPONENT_POOL.length - before, runs: runs.length, authors: new Set(runs.map((r) => r.author)).size, file };
}

/** The printed summary: boards, runs, authors, per-wave, per-patch, and how many runs reach a lobby's length. */
export function describeCorpus(file: CorpusFile, minWavesReached = 12): string {
  const waves = new Map<number, number>();
  for (const b of file.boards) waves.set(b.wave, (waves.get(b.wave) ?? 0) + 1);
  const runs = playerRunsFrom(file.boards, undefined, file.setId);
  const long = runs.filter((r) => r.snaps[r.snaps.length - 1]!.wave >= minWavesReached).length;
  const heroes = new Map<string, number>();
  for (const r of runs) heroes.set(r.heroId, (heroes.get(r.heroId) ?? 0) + 1);
  return [
    `corpus "${file.name}" (${file.setId}): ${file.boards.length} boards, ${file.runs} runs (≥ 4 waves), ${file.authors} authors, digest ${file.digest}`,
    `  fetched ${file.fetchedAt}${file.patchPrefix ? `, patch prefix ${file.patchPrefix}` : ''}`,
    '  per wave:  ' + [...waves.entries()].sort((a, b) => a[0] - b[0]).map(([w, n]) => `${w}:${n}`).join(' '),
    '  per patch: ' + Object.entries(file.patches).map(([p, n]) => `${p}:${n}`).join(' '),
    '  per hero (runs): ' + [...heroes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([h, n]) => `${h}:${n}`).join(' '),
    `  runs reaching wave ≥ ${minWavesReached}: ${long} of ${runs.length}`,
    `  name it in a manifest as  "corpus": { "name": "${file.name}", "digest": "${file.digest}" }`,
  ].join('\n');
}

/** The Supabase URL + anon key: the environment first, then `apps/web/.env` (the client's own config). */
export function supabaseConfig(): { url: string; key: string } {
  const env = (k: string): string | undefined => process.env[k] || undefined;
  let url = env('SUPABASE_URL') ?? env('VITE_SUPABASE_URL');
  let key = env('SUPABASE_ANON_KEY') ?? env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../apps/web/.env');
    if (existsSync(envPath)) {
      for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = /^\s*(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)\s*=\s*(.*?)\s*$/.exec(line);
        if (!m) continue;
        const v = m[2]!.replace(/^["']|["']$/g, '');
        if (m[1] === 'VITE_SUPABASE_URL') url ??= v; else key ??= v;
      }
    }
  }
  if (!url || !key) throw new Error('balance:corpus — no Supabase config: set SUPABASE_URL + SUPABASE_ANON_KEY (or VITE_…) or keep them in apps/web/.env');
  return { url, key };
}
