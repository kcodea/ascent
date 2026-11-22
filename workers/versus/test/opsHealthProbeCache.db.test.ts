/**
 * THE PRE-COMPUTED HEALTH PROBE (R-OPS-HEALTH-02, fix 2026-11-22): the anon role's 3 s statement ceiling cancelled the
 * hub's cold 06:17 probe, so pg_cron computes it at 06:10 into ops.health_probe_cache and the wrapper answers from it.
 * Setup copied from opsHealth.db.test.ts (THE DAILY HEALTH CHECK, Supabase side (R-OPS-HEALTH-01)), executed: PGlite runs the pool chain + the pool delta, then
 * `2026-11-21-ops-health-checks.sql` twice (idempotent), and proves:
 *
 *  - the hub's wrappers are key-gated (no key, a wrong key: `not_authorized`) and answer the key's note;
 *  - the probe counts end-of-game rows inside the window only, reports a missing table as null, and reads the game
 *    session's flush ledger once that SQL exists (null before: the check is n/a);
 *  - `ops.pool_digest` is BYTE-EXACT the mirror's `poolDigestOf` over what `pool_runs_boards` serves, for the whole pool
 *    and for a seeded `pool_runs_sample_keys` draw (same runs, same order), and moves when a board changes;
 *  - a recorded run is what `ops.health_status` (the lead's query) and `ops.health_latest` show; client roles cannot read it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { poolDigestOf, type PoolDigest } from '../src/health/healthProtocol';

const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const CHAIN = [
  '2026-09-29-pool-whole-runs.sql', '2026-09-30-board-strength.sql', '2026-09-30-weighted-strength.sql',
  '2026-10-03-final-board-strength.sql', '2026-10-06-weighted-strength-again.sql', '2026-10-06-early-late-strength.sql',
  '2026-10-09-strength-overall-caps.sql', '2026-10-17-pool-empty-boards.sql', '2026-11-08-pool-runs-delta.sql',
];
const HEALTH = read('2026-11-21-ops-health-checks.sql');
const CACHE = read('2026-11-28-health-probe-cache.sql');
const SECRET = 'test-hub-secret-not-real';

const STUB = `
  create role anon; create role authenticated;
  create schema auth; create schema extensions;
  create extension pgcrypto with schema extensions;
  create table auth.users (id uuid primary key);
  create table public.boards (
    id uuid primary key default gen_random_uuid(), patch text not null, wave int not null, hero_id text not null,
    power int not null, rating real, origin text, author text, tribes text[], captured_at date, seed bigint,
    snapshot jsonb not null, created_at timestamptz default now(), user_id uuid, unrated boolean not null default false);
  alter table public.boards enable row level security;
  create policy "read boards" on public.boards for select using (true);
  grant usage on schema public to anon, authenticated;
  grant select on public.boards to anon, authenticated;
  create table public.versus_cf_writer_keys (key_hash text primary key, note text, created_at timestamptz not null default now());
  insert into public.versus_cf_writer_keys (key_hash, note) values ('${createHash('sha256').update(SECRET).digest('hex')}', 'ascent-hub');
  create table public.run_history (id bigint generated always as identity primary key, user_id uuid, created_at timestamptz not null default now());
  create table public.lobby_fights (id bigint generated always as identity primary key, created_at timestamptz default now());
  create table public.versus_matches (id uuid primary key default gen_random_uuid(), backend text not null default 'supabase',
    content_revision text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  create table public.duos_match_history (match_id uuid primary key default gen_random_uuid(), completed_at timestamptz not null default now());
  create table public.saved_runs (user_id uuid primary key, updated_at timestamptz not null default now());
  create table public.player_presence (user_id uuid primary key, status text not null, updated_at timestamptz not null default now());
`;

let db: PGlite;
async function upload(author: string, hero: string, seed: number, waves: number): Promise<void> {
  for (let w = 1; w <= waves; w++) {
    const snap = { v: 1, wave: w, heroId: hero, seed, author, setId: 'set2', minions: [{ cardId: 'k_geode', attack: w, health: 3 + w, text: `Live ${seed}:${w} "quoted" é` }] };
    await db.query('insert into public.boards (patch, wave, hero_id, power, author, seed, snapshot) values ($1, $2, $3, $4, $5, $6, $7::jsonb)',
      ['0.1.0+abc', w, hero, w, author, seed, JSON.stringify(snap)]);
  }
}
async function asAnon<T>(sql: string, params: unknown[] = []): Promise<T> {
  await db.exec('set role anon');
  try { return (await db.query<{ v: T }>(sql, params)).rows[0]!.v; } finally { await db.exec('reset role'); }
}
async function fails(sql: string, params: unknown[] = []): Promise<string> {
  try { await asAnon(sql, params); } catch (e) { return (e as Error).message; }
  return 'did not fail';
}
const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.query<{ v: T }>(sql, params)).rows[0]!.v;

/** The mirror's side, from exactly what `pool_runs_boards` serves. */
async function mirrorDigest(ids: string[]): Promise<PoolDigest> {
  const rows = (await db.query<{ run_id: string; run_key: string; rev: string; boards: string }>(
    'select run_id::text, run_key, rev, boards::text as boards from public.pool_runs_boards($1::bigint[])', [ids])).rows;
  const by = new Map(rows.map((r) => [r.run_id, r]));
  return poolDigestOf(ids.map((id) => by.get(id)!).map((r) => ({ run_id: Number(r.run_id), run_key: r.run_key, rev: r.rev, boards: r.boards })));
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  for (const f of CHAIN) await db.exec(read(f));
  for (let i = 0; i < 24; i++) await upload(`P${i}`, ['warden', 'soren', 'albus'][i % 3]!, 2000 + i, 3 + (i % 5));
  await db.exec(HEALTH);
  await db.exec(HEALTH); // idempotent
  await db.exec(CACHE);
  await db.exec(CACHE); // idempotent
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('the pre-computed probe', () => {
  it('with no cache the wrapper still answers live (key-gated, no cached_at)', async () => {
    expect(await fails('select public.ops_health_probe($1) as v', ['wrong'])).toMatch(/not_authorized/);
    const p = await asAnon<{ key_note: string; cached_at?: string; counts: Record<string, number> }>('select public.ops_health_probe($1) as v', [SECRET]);
    expect(p.key_note).toBe('ascent-hub');
    expect(p.cached_at).toBeUndefined();
    expect(p.counts).toBeTruthy();
  });
  it('after the 06:10 refresh the wrapper answers the cached probe, same fields', async () => {
    await db.exec(`insert into public.run_history (created_at) values (now() - interval '1 hour')`);
    const live = await one<Record<string, unknown>>(`select ops.health_probe(now() - interval '24 hours') as v`);
    await db.exec('select ops.health_probe_refresh()');
    await db.exec(`insert into public.run_history (created_at) values (now() - interval '5 minutes')`); // after the refresh
    const p = await asAnon<Record<string, unknown> & { cached_at?: string; key_note: string }>('select public.ops_health_probe($1) as v', [SECRET]);
    expect(p.cached_at).toBeTruthy();
    expect(p.key_note).toBe('ascent-hub');
    expect(p.counts).toEqual(live.counts); // the cache, not a fresh count (the newer row is not in it)
    expect(Object.keys(p).filter((k) => k !== 'cached_at' && k !== 'key_note').sort()).toEqual(Object.keys(live).sort());
  });
  it('a window far from the cached one, or a stale cache, computes live', async () => {
    const far = await asAnon<{ cached_at?: string }>(`select public.ops_health_probe($1, now() - interval '3 days') as v`, [SECRET]);
    expect(far.cached_at).toBeUndefined();
    await db.exec(`update ops.health_probe_cache set computed_at = now() - interval '2 hours'`);
    const stale = await asAnon<{ cached_at?: string }>('select public.ops_health_probe($1) as v', [SECRET]);
    expect(stale.cached_at).toBeUndefined();
  });
  it('client roles cannot read the cache or run the refresh', async () => {
    expect(await fails('select count(*)::int as v from ops.health_probe_cache')).toMatch(/permission denied/);
    expect(await fails('select ops.health_probe_refresh() as v')).toMatch(/permission denied/);
  });
});
