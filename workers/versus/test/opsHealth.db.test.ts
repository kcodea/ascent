/**
 * THE DAILY HEALTH CHECK, Supabase side (R-OPS-HEALTH-01), executed: PGlite runs the pool chain + the pool delta, then
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
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('the hub wrappers are key-gated', () => {
  it('no key or a wrong key is refused; the hub key answers its note', async () => {
    expect(await fails('select public.ops_health_probe(null) as v')).toMatch(/not_authorized/);
    expect(await fails('select public.ops_health_probe($1) as v', ['wrong'])).toMatch(/not_authorized/);
    expect(await fails('select public.ops_pool_digest($1) as v', ['wrong'])).toMatch(/not_authorized/);
    expect(await fails(`select public.ops_health_record($1, 'cron', '[{"check":"x","status":"ok","detail":{}}]'::jsonb) as v`, ['wrong'])).toMatch(/not_authorized/);
    const p = await asAnon<{ key_note: string; writer_keys: string[] }>('select public.ops_health_probe($1) as v', [SECRET]);
    expect(p.key_note).toBe('ascent-hub');
    expect(p.writer_keys).toEqual(['ascent-hub']);
  });
  it('client roles cannot reach ops directly', async () => {
    expect(await fails('select count(*)::int as v from ops.health_checks')).toMatch(/permission denied/);
    expect(await fails('select ops.health_probe(now()) as v')).toMatch(/permission denied/);
  });
});

describe('the write probe', () => {
  it('counts rows inside the window, reports a missing table as null, and no session before its SQL', async () => {
    await db.exec(`
      insert into public.run_history (created_at) values (now() - interval '1 hour'), (now() - interval '2 hours'), (now() - interval '3 days');
      insert into public.lobby_fights (created_at) values (now() - interval '1 hour');
      insert into public.versus_matches (backend, content_revision, created_at, updated_at) values
        ('cloudflare', 'rev9', now() - interval '2 hours', now() - interval '1 hour'),
        ('supabase', 'old', now() - interval '1 hour', now() - interval '1 hour');
      insert into public.saved_runs (user_id, updated_at) values (gen_random_uuid(), now() - interval '1 hour');
      insert into public.player_presence (user_id, status) values (gen_random_uuid(), 'in_game'), (gen_random_uuid(), 'online');
    `);
    const p = await one<{ counts: Record<string, number | null>; latest: Record<string, string | null>; latest_cf_revision: string; session: unknown }>(
      `select ops.health_probe(now() - interval '24 hours') as v`);
    expect(p.counts).toMatchObject({ run_history: 2, lobby_fights: 1, versus_cf: 1, duos_history: 0, saved_runs: 1, in_game: 1, run_telemetry: null });
    expect(p.counts.boards).toBeGreaterThan(0);
    expect(p.latest.run_history).toBeTruthy();
    expect(p.latest.run_telemetry).toBeNull();
    expect(p.latest_cf_revision).toBe('rev9');
    expect(p.session).toBeNull();
  });
  it('reads the session flush ledger once it exists', async () => {
    await db.exec(`
      create table if not exists ops.events (id bigserial primary key, at timestamptz not null default now(), source text not null, kind text not null, key text, detail jsonb);
      create table public.session_cf_writes (user_id uuid not null, write_key text not null, game_id text not null, tbl text not null,
        status text not null, at timestamptz not null default now(), primary key (user_id, write_key));
      insert into public.session_cf_writes values (gen_random_uuid(), 'k1', 'g1', 'run_history', 'applied', now()),
        (gen_random_uuid(), 'k2', 'g1', 'boards', 'applied', now() - interval '3 days');
      insert into ops.events (source, kind, key) values ('session', 'write_rejected', 'k3'), ('client', 'write_failure', 'k4');
    `);
    const p = await one<{ session: unknown }>(`select ops.health_probe(now() - interval '24 hours') as v`);
    expect(p.session).toEqual({ applied: 1, rejected: 1 });
  });
});

describe('the pool digest is the mirror\'s, byte for byte', () => {
  it('whole pool: every eligible run in id order', async () => {
    const ids = (await db.query<{ id: string }>('select r.id::text as id from public.pool_runs r where r.eligible order by r.id')).rows.map((r) => r.id);
    expect(ids.length).toBeGreaterThan(10);
    const sql = await asAnon<PoolDigest>('select public.ops_pool_digest($1, null) as v', [SECRET]);
    const mirror = await mirrorDigest(ids);
    expect(sql.count).toBe(ids.length);
    expect(sql.rows).toEqual(mirror.rows);
    expect(sql.digest).toBe(mirror.digest);
  });
  it('a seeded draw: the same runs in the same order as pool_runs_sample_keys', async () => {
    const params = { p_limit: 10, p_seed: 'health:2026-10-31' };
    const keys = (await db.query<{ id: string }>(`select run_id::text as id from public.pool_runs_sample_keys(10, null, null, null, 'health:2026-10-31')`)).rows.map((r) => r.id);
    const sql = await one<PoolDigest>('select ops.pool_digest($1::jsonb) as v', [JSON.stringify(params)]);
    expect(sql.rows.map((r) => String(r.run_id))).toEqual(keys);
    expect(sql.digest).toBe((await mirrorDigest(keys)).digest);
    expect(await one<PoolDigest>('select ops.pool_digest($1::jsonb) as v', [JSON.stringify(params)])).toEqual(sql); // deterministic
    expect(await fails('select public.ops_pool_digest($1, $2::jsonb) as v', [SECRET, '{"p_limit": 5}'])).toMatch(/bad_params/);
  });
  it('a changed board moves the digest and that run\'s rev only', async () => {
    const before = await one<PoolDigest>('select ops.pool_digest(null) as v');
    await db.exec(`update public.boards set snapshot = jsonb_set(snapshot, '{power}', '99') where author = 'P3' and wave = 1`);
    const after = await one<PoolDigest>('select ops.pool_digest(null) as v');
    expect(after.digest).not.toBe(before.digest);
    const moved = after.rows.filter((r, i) => r.rev !== before.rows[i]!.rev || r.h !== before.rows[i]!.h);
    expect(moved).toHaveLength(1);
  });
});

describe('the record and the lead\'s status', () => {
  it('a recorded run shows in ops.health_status and ops.health_latest', async () => {
    expect(await one<{ cron_overdue: boolean }>('select to_jsonb(s) as v from ops.health_status s')).toMatchObject({ cron_overdue: true, cron_failing: 0 });
    const rows = [
      { check: 'hub', status: 'ok', detail: { code: 'abc' } },
      { check: 'writes.lobby', status: 'fail', detail: { missing: ['run_history'] } },
      { check: 'pool.whole', status: 'n/a', detail: { reason: 'no mirror' } },
      { check: 'bogus', status: 'weird', detail: 'not an object' },
    ];
    const r = await asAnon<{ rows: number }>('select public.ops_health_record($1, $2, $3::jsonb) as v', [SECRET, 'cron', JSON.stringify(rows)]);
    expect(r.rows).toBe(4);
    const status = await one<Record<string, unknown>>('select to_jsonb(s) as v from ops.health_status s');
    expect(status).toMatchObject({ cron_overdue: false, cron_failing: 2, failing_checks: 'bogus, writes.lobby' });
    const latest = (await db.query<{ check_name: string; status: string; ok: boolean; detail: unknown }>(
      `select check_name, status, ok, detail from ops.health_latest where source = 'cron' order by check_name`)).rows;
    expect(latest.find((x) => x.check_name === 'pool.whole')).toMatchObject({ status: 'n/a', ok: true });
    expect(latest.find((x) => x.check_name === 'bogus')).toMatchObject({ status: 'fail', ok: false, detail: { truncated: true } });
  });
  it('the next run replaces the latest; bad input is refused', async () => {
    await one('select ops.health_record($1, $2::jsonb) as v', ['cron', JSON.stringify([{ check: 'hub', status: 'ok', detail: {} }])]);
    expect(await one<Record<string, unknown>>('select to_jsonb(s) as v from ops.health_status s')).toMatchObject({ cron_failing: 0, failing_checks: null });
    expect(await fails('select public.ops_health_record($1, $2, $3::jsonb) as v', [SECRET, 'cron', '[]'])).toMatch(/bad_rows/);
    expect(await fails('select public.ops_health_record($1, $2, $3::jsonb) as v', [SECRET, 'elsewhere', '[{"check":"x","status":"ok"}]'])).toMatch(/bad_source/);
  });
});
