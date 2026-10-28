import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogHash, catalogSyncPayload } from './cosmetics';

/**
 * SUPABASE CLEANUP P1.2 (2026-10-28): `progression_config.catalog_state_hash`, EXECUTED. PGlite runs the progression
 * migrations in production order, then 2026-11-07-catalog-state-hash.sql, and checks that the hash is filled at once,
 * moves on every change to the kill-switch columns (the code sync AND the owner's manual `admin_off` flip, items and
 * categories), comes back to the same value when the state does, ignores changes to columns the client does not read,
 * and that the file re-runs cleanly. The client skips its catalog read while this hash equals the cached one.
 */

const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = [
  '2026-09-28-progression-crates.sql', '2026-09-28-progression-skins.sql', '2026-09-28-achievements.sql', '2026-09-28-progression-hero-attack.sql',
  '2026-09-29-crate-fixed-rarity-odds.sql', '2026-09-29-crate-uniform-within-rarity.sql', '2026-10-02-ancient-rarity.sql', '2026-09-29-hero-titles.sql',
  '2026-10-03-placement-xp.sql',
].map(read);
FILES.push(((t: string): string => t.slice(0, t.indexOf('-- ── 2. equip_cosmetic')))(read('2026-10-13-emotes.sql')));
const MVP = read('2026-09-27-account-progression.sql');
const SECRET = read('2026-11-03-secret-plushie-plate.sql');
const HASH = read('2026-11-07-catalog-state-hash.sql');

const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.profiles (user_id uuid primary key references auth.users(id), rating int not null default 0,
    rank_highest_division int not null default 0, updated_at timestamptz not null default now());
  alter table public.profiles enable row level security;
  create policy "read profiles" on public.profiles for select using (true);
  create policy "update own profile" on public.profiles for update to authenticated using (auth.uid() = user_id);
  create table public.rank_results (user_id uuid, run_id text, placement int, seed bigint, created_at timestamptz default now(),
    promoted boolean not null default false, division_before int not null default 0, was_demotion_game boolean not null default false,
    demoted boolean not null default false, lobby_strength int, primary key (user_id, run_id));
  create table public.run_history (user_id uuid, mode text, entry jsonb, wins int, created_at timestamptz default now());
  create table public.practice_games (id bigserial primary key, user_id uuid, hero_id text, placement int, config jsonb, record jsonb, created_at timestamptz default now());
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
`;
const API_GRANTS = `grant select, insert, update, delete on all tables in schema public to anon, authenticated;`;
let db: PGlite;
const hash = async (): Promise<string | null> =>
  (await db.query<{ h: string | null }>('select catalog_state_hash as h from public.progression_config where id = 1')).rows[0]!.h;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MVP);
  await db.exec(API_GRANTS);
  for (const f of FILES) { await db.exec(f); await db.exec(API_GRANTS); }
  await db.exec(SECRET);
  await db.exec(API_GRANTS);
  const c = catalogSyncPayload();
  await db.query('select public.sync_cosmetic_catalog($1::jsonb, $2)', [JSON.stringify(c), catalogHash(c)]);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('catalog_state_hash', () => {
  it('is filled by the migration itself and equals the md5 of the kill-switch columns', async () => {
    await db.exec(HASH);
    const h = await hash();
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    const expected = (await db.query<{ m: string }>(`select md5(
      coalesce((select string_agg(cosmetic_id || ':' || active::text || ':' || admin_off::text, ',' order by cosmetic_id) from public.cosmetic_catalog), '')
      || '|' || coalesce((select string_agg(category || ':' || enabled::text || ':' || admin_off::text, ',' order by category) from public.cosmetic_categories), '')) as m`)).rows[0]!.m;
    expect(h).toBe(expected);
  });

  it('moves on an owner admin_off flip (item and category) and comes back when the flip is undone', async () => {
    const before = await hash();
    const id = (await db.query<{ cosmetic_id: string }>('select cosmetic_id from public.cosmetic_catalog order by 1 limit 1')).rows[0]!.cosmetic_id;
    await db.query('update public.cosmetic_catalog set admin_off = true where cosmetic_id = $1', [id]);
    const off = await hash();
    expect(off).not.toBe(before);
    await db.query('update public.cosmetic_catalog set admin_off = false where cosmetic_id = $1', [id]);
    expect(await hash()).toBe(before);
    const cat = (await db.query<{ category: string }>('select category from public.cosmetic_categories order by 1 limit 1')).rows[0]!.category;
    await db.query('update public.cosmetic_categories set admin_off = true where category = $1', [cat]);
    expect(await hash()).not.toBe(before);
    await db.query('update public.cosmetic_categories set admin_off = false where category = $1', [cat]);
    expect(await hash()).toBe(before);
  });

  it('moves when the code sync retires an item, and ignores columns the client does not read', async () => {
    const before = await hash();
    await db.exec(`update public.cosmetic_catalog set rarity = rarity`);
    expect(await hash()).toBe(before);
    const c = catalogSyncPayload();
    const retired = { ...c, items: c.items.map((x, i) => (i === 0 ? { ...x, active: false } : x)) };
    await db.query('select public.sync_cosmetic_catalog($1::jsonb, $2)', [JSON.stringify(retired), catalogHash(retired)]);
    expect(await hash()).not.toBe(before);
    await db.query('select public.sync_cosmetic_catalog($1::jsonb, $2)', [JSON.stringify(c), catalogHash(c)]);
    expect(await hash()).toBe(before);
  });

  it('re-runs cleanly and keeps the same hash', async () => {
    const before = await hash();
    await db.exec(HASH);
    expect(await hash()).toBe(before);
  });
});
