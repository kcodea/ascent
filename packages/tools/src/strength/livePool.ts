/**
 * The live opponent pool, read-only, for the board-strength tools (2026-09-30).
 *
 * Only anon REST GETs: `pool_runs` (one row per run) and `boards` (by seed). Nothing is ever written to the
 * backend. The result is cached at `packages/tools/.cache/strength-pool.json` (gitignored) so the reference,
 * backfill and measure steps all read the same snapshot of the pool.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BoardSnapshot } from '@game/sim';

export const POOL_CACHE = 'packages/tools/.cache/strength-pool.json';

export interface LiveBoard {
  /** `boards.id`, the row the backfill UPDATE targets. */
  rowId: string;
  wave: number;
  snapshot: BoardSnapshot;
}
export interface LiveRun {
  key: string;
  author: string;
  userId: string | null;
  setId: string;
  patchPrefix: string;
  eligible: boolean;
  boards: LiveBoard[];
}
export interface LivePool { fetchedAt: string; runs: LiveRun[] }

function env(): { url: string; key: string } {
  const e = Object.fromEntries(
    readFileSync('apps/web/.env', 'utf8').split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
  if (!e.VITE_SUPABASE_URL || !e.VITE_SUPABASE_ANON_KEY) throw new Error('no backend configured in apps/web/.env');
  return { url: e.VITE_SUPABASE_URL, key: e.VITE_SUPABASE_ANON_KEY };
}

async function get<T>(path: string): Promise<T> {
  const { url, key } = env();
  const res = await fetch(`${url}/rest/v1/${path}`, { method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`GET ${path.slice(0, 80)}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

interface PoolRunRow { author: string; hero_id: string; seed: number; user_id: string | null; set_id: string; patch_prefix: string; eligible: boolean }
interface BoardRow { id: string; author: string | null; hero_id: string; seed: number; wave: number; origin: string | null; snapshot: BoardSnapshot }

/** Fetch every pool run and all of its servable boards (GET only). */
export async function fetchLivePool(): Promise<LivePool> {
  const runRows = await get<PoolRunRow[]>('pool_runs?select=author,hero_id,seed,user_id,set_id,patch_prefix,eligible&order=id.asc&limit=5000');
  const runs = new Map<string, LiveRun>();
  for (const r of runRows) {
    const key = `${r.author}|${r.hero_id}|${r.seed}`;
    runs.set(key, { key, author: r.author, userId: r.user_id, setId: r.set_id, patchPrefix: r.patch_prefix, eligible: r.eligible, boards: [] });
  }
  const seeds = [...new Set(runRows.map((r) => r.seed))];
  for (let i = 0; i < seeds.length; i += 40) {
    const chunk = seeds.slice(i, i + 40);
    const rows = await get<BoardRow[]>(`boards?select=id,author,hero_id,seed,wave,origin,snapshot&seed=in.(${chunk.join(',')})&order=id.asc&limit=1000`);
    for (const b of rows) {
      if (!b.snapshot || !Array.isArray(b.snapshot.minions) || b.snapshot.minions.length === 0) continue;
      if ((b.origin ?? 'self') === 'synthetic') continue;
      const run = runs.get(`${b.author ?? 'anon'}|${b.hero_id}|${b.seed}`);
      if (!run) continue;
      run.boards.push({ rowId: b.id, wave: b.wave, snapshot: b.snapshot });
    }
  }
  for (const r of runs.values()) r.boards.sort((a, b) => a.wave - b.wave || a.rowId.localeCompare(b.rowId));
  return { fetchedAt: new Date().toISOString(), runs: [...runs.values()] };
}

export async function loadLivePool(refresh = false): Promise<LivePool> {
  if (!refresh && existsSync(POOL_CACHE)) return JSON.parse(readFileSync(POOL_CACHE, 'utf8')) as LivePool;
  const pool = await fetchLivePool();
  mkdirSync(dirname(POOL_CACHE), { recursive: true });
  writeFileSync(POOL_CACHE, JSON.stringify(pool));
  return pool;
}
