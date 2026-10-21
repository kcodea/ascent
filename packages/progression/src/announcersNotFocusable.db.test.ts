import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CRATE_TIERS, type CrateTier } from './aether';
import { CRATE_TIER_FLOOR, availableFocusCategories, eligibleForCrate, quoteCrate } from './crateShop';
import { COSMETICS, catalogHash, catalogSyncPayload } from './cosmetics';

/**
 * ANNOUNCERS CAN'T BE A CHEST FOCUS, EXECUTED (owner 2026-10-20: "lets remove announcers from being able to be focused";
 * "yes, announcers can drop from the unfocused chests"; asked about ticking every focusable category: "Free, may give an
 * Announcer"; R-PROG-AETHER-06). PGlite runs the progression migrations in production order, then 2026-10-18-aether.sql,
 * 2026-10-19-aether-launch-grant.sql, 2026-10-20-milestone-chests-epic.sql and 2026-10-20-announcers-not-focusable.sql,
 * and checks on real Postgres: a focus naming `announcer` is refused as `bad_focus`; ticking every focusable category is
 * no focus (null, free) with the Announcers still in the pool; and `aether_quote` equals the TS `quoteCrate` for a spread
 * of focus sets at every tier.
 */
const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = ['2026-09-27-account-progression.sql', '2026-09-28-progression-crates.sql', '2026-09-28-progression-skins.sql', '2026-09-28-achievements.sql', '2026-09-29-crate-fixed-rarity-odds.sql', '2026-09-29-crate-uniform-within-rarity.sql', '2026-09-29-gauntlet-progress.sql', '2026-10-02-ancient-rarity.sql', '2026-10-03-placement-xp.sql', '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql', '2026-10-14-versus-progression.sql'];
const STARTER_CHECK = ((t: string): string => t.slice(0, t.indexOf('-- ── 2. equip_cosmetic')))(read('2026-10-13-emotes.sql'));
const AETHER = read('2026-10-18-aether.sql');
const GRANT = read('2026-10-19-aether-launch-grant.sql');
const MILESTONE = read('2026-10-20-milestone-chests-epic.sql');
const ANNOUNCERS = read('2026-10-20-announcers-not-focusable.sql');

const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.profiles (user_id uuid primary key references auth.users(id), rating int not null default 0,
    rank_highest_division int not null default 0, updated_at timestamptz not null default now());
  alter table public.profiles enable row level security;
  create table public.rank_results (user_id uuid, run_id text, placement int, seed bigint, created_at timestamptz default now(),
    promoted boolean not null default false, division_before int not null default 0, was_demotion_game boolean not null default false,
    demoted boolean not null default false, lobby_strength int, primary key (user_id, run_id));
  create table public.run_history (user_id uuid, mode text, entry jsonb, wins int, created_at timestamptz default now());
  create table public.practice_games (id bigserial primary key, user_id uuid, hero_id text, placement int, config jsonb, record jsonb, created_at timestamptz default now());
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;
const API_GRANTS = `grant select, insert, update, delete on all tables in schema public to anon, authenticated;`;

let db: PGlite;
let userSeq = 0;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0]!;
}
async function raises(sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); } catch (e) { return String((e as Error).message); }
  return 'no error';
}
/** A fresh account (auth row + profile) that already owns `ids`. */
async function newUser(ids: readonly string[] = []): Promise<string> {
  userSeq++;
  const u = `00000000-0000-0000-0000-${String(userSeq).padStart(12, '0')}`;
  await db.query('insert into auth.users (id) values ($1)', [u]);
  await db.query('insert into public.profiles (user_id) values ($1)', [u]);
  for (const id of ids) await db.query("insert into public.player_cosmetics (user_id, cosmetic_id, source) values ($1, $2, 'test') on conflict do nothing", [u, id]);
  return u;
}
const sqlQuote = async (u: string, tier: CrateTier, focus: string[] | null): Promise<unknown> =>
  (await one<{ q: unknown }>('select public.aether_quote($1, $2, $3::text[], false) as q', [u, tier, focus])).q;
const asJson = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const f of FILES) { await db.exec(read(f)); await db.exec(API_GRANTS); }
  await db.exec(STARTER_CHECK);
  await db.exec(AETHER);
  await db.exec(API_GRANTS);
  await db.exec(GRANT);
  await db.exec(MILESTONE);
  await db.exec(ANNOUNCERS);
  const c = catalogSyncPayload();
  await db.query('select public.sync_cosmetic_catalog($1::jsonb, $2)', [JSON.stringify(c), catalogHash(c)]);
  await db.exec('update public.progression_config set crates_enabled = true, aether_enabled = true where id = 1;');
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('Announcers are never a chest focus (R-PROG-AETHER-06, 2026-10-20)', () => {
  it('a focus naming announcer is refused, alone or with other categories, at every tier', async () => {
    const u = await newUser();
    for (const tier of CRATE_TIERS) {
      expect(await raises("select public.aether_quote($1, $2, array['announcer'], false)", [u, tier]), tier).toMatch(/bad_focus/);
      expect(await raises("select public.aether_quote($1, $2, array['announcer', 'hero_skin'], false)", [u, tier]), tier).toMatch(/bad_focus/);
    }
  });

  it('ticking every focusable category is no focus and free, and the pool still holds the Announcers', async () => {
    const u = await newUser();
    for (const tier of CRATE_TIERS) {
      const floor = CRATE_TIER_FLOOR[tier];
      const all = availableFocusCategories([], floor);
      expect(all).not.toContain('announcer');
      const sql = (await sqlQuote(u, tier, all)) as { focus: unknown; fee: number; remaining: number };
      expect(sql, tier).toMatchObject({ focus: null, fee: 0 });
      expect(sql.remaining, tier).toBe(eligibleForCrate([], floor, null).length);
    }
    // Announcers are Legendary (and above) drops: a Legendary chest's unfocused pool has them.
    expect(eligibleForCrate([], 'legendary', null).some((c) => c.category === 'announcer')).toBe(true);
  });

  it('aether_quote equals quoteCrate for a spread of focus sets at every tier (owning nothing and owning the Announcers)', async () => {
    const announcers = COSMETICS.filter((c) => c.category === 'announcer' && c.acquisition.type === 'crate').map((c) => c.id);
    for (const owned of [[], announcers]) {
      const u = await newUser(owned);
      for (const tier of CRATE_TIERS) {
        const avail = availableFocusCategories(owned, CRATE_TIER_FLOOR[tier]);
        const sets: Array<string[] | null> = [null, avail.slice(0, 1), avail.slice(0, 2), [...avail].reverse(), avail.slice(1), avail.slice(0, 1).concat(avail.slice(0, 1))];
        for (const focus of sets) {
          const ts = quoteCrate({ tier, focus, owned });
          if (ts === null) continue;
          expect(await sqlQuote(u, tier, focus), `${tier} ${JSON.stringify(focus)} owned=${owned.length}`).toEqual(asJson(ts));
        }
      }
    }
  });
});
