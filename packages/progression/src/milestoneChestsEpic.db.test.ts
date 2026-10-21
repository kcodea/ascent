import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MILESTONE_CRATE_TIER } from './aether';
import { CRATE_TIER_FLOOR, atOrAbove } from './crateShop';
import { COSMETIC_INDEX, catalogHash, catalogSyncPayload } from './cosmetics';
import { levelOfXp, xpAtLevelStart } from './rules';

/**
 * MILESTONE CHESTS ARE EPIC AND NEVER FOCUSED, EXECUTED (owner 2026-10-20: "i want the chest quality to reduce down to
 * Epic for the milestone chests (every 10 levels) and you cannot focus those ones specifically"; on the chests already
 * granted: "Keep them Legendary"; R-PROG-AETHER-04). PGlite runs the progression migrations in production order, then
 * 2026-10-18-aether.sql, 2026-10-19-aether-launch-grant.sql and 2026-10-20-milestone-chests-epic.sql, and checks on real
 * Postgres: the rollout and a settlement create milestone crates at floor Epic; a milestone crate already held at
 * Legendary is kept as it is (and the settlement's self-heal adds only the missing ones, at Epic); a focus at open is
 * refused for every crate, before anything is charged, leaving it sealed; an unfocused open is free and rolls at or
 * above the crate's own floor; and the table takes a milestone crate only at Epic or Legendary.
 */
const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = ['2026-09-27-account-progression.sql', '2026-09-28-progression-crates.sql', '2026-09-28-progression-skins.sql', '2026-09-28-achievements.sql', '2026-09-29-crate-fixed-rarity-odds.sql', '2026-09-29-crate-uniform-within-rarity.sql', '2026-09-29-gauntlet-progress.sql', '2026-10-02-ancient-rarity.sql', '2026-10-03-placement-xp.sql', '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql', '2026-10-14-versus-progression.sql'];
const STARTER_CHECK = ((t: string): string => t.slice(0, t.indexOf('-- ── 2. equip_cosmetic')))(read('2026-10-13-emotes.sql'));
const AETHER = read('2026-10-18-aether.sql');
const GRANT = read('2026-10-19-aether-launch-grant.sql');
const MILESTONE = read('2026-10-20-milestone-chests-epic.sql');

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
let runSeq = 0;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0]!;
}
async function raises(sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); } catch (e) { return String((e as Error).message); }
  return 'no error';
}
/** A fresh account with a profile, optionally at a level (its XP the start of that level). */
async function newUser(level?: number): Promise<string> {
  userSeq++;
  const u = `00000000-0000-0000-0000-${String(userSeq).padStart(12, '0')}`;
  await db.query('insert into auth.users (id) values ($1)', [u]);
  await db.query('insert into public.profiles (user_id) values ($1)', [u]);
  if (level !== undefined) await db.query('update public.profiles set account_xp = $2, account_level = $3 where user_id = $1', [u, xpAtLevelStart(level), level]);
  return u;
}
type CrateLine = { crate_id: string; source: string | null; floor_rarity: string; state: string };
async function milestones(u: string): Promise<CrateLine[]> {
  return (await db.query<CrateLine>(
    "select crate_id, source, floor_rarity, state from public.loot_crates where user_id = $1 and source like 'milestone:%' order by split_part(source, ':', 2)::int", [u])).rows;
}
async function balance(u: string): Promise<number> {
  return (await db.query<{ balance: number }>('select balance from public.aether_wallets where user_id = $1', [u])).rows[0]?.balance ?? 0;
}
async function settleRanked(u: string, placement: number): Promise<void> {
  runSeq++;
  const runId = `milestone-run-${runSeq}`;
  await db.query('insert into public.rank_results (user_id, run_id, placement, seed) values ($1, $2, $3, 1)', [u, runId, placement]);
  await db.query("select public.settle_progression($1, 'ranked', $2, null, false, 1, null)", [u, runId]);
}
async function legendaryMilestone(u: string, level: number): Promise<string> {
  return (await one<{ crate_id: string }>(
    "insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity) values ($1, null, $2, 'before-2026-10-20', 'legendary') returning crate_id",
    [u, `milestone:${level}`])).crate_id;
}
type OpenJson = { status: string; rewardId: string | null };
async function openCrate(u: string, crateId: string, focus: string[] | null = null, fee: number | null = null): Promise<OpenJson> {
  return (await one<{ j: OpenJson }>('select public.open_crate($1, $2::uuid, $3::text[], $4) as j', [u, crateId, focus, fee])).j;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const f of FILES) { await db.exec(read(f)); await db.exec(API_GRANTS); }
  await db.exec(STARTER_CHECK);
  await db.exec(AETHER);
  await db.exec(API_GRANTS);
  await db.exec(GRANT);
  await db.exec(MILESTONE);
  const c = catalogSyncPayload();
  await db.query('select public.sync_cosmetic_catalog($1::jsonb, $2)', [JSON.stringify(c), catalogHash(c)]);
  // Aether stays OFF until the rollout test turns it on (the rollout is what flips the switch).
  await db.exec("update public.progression_config set crates_enabled = true, epoch = now() - interval '2 days' where id = 1;");
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('milestone chests are Epic and never focused (R-PROG-AETHER-04, 2026-10-20)', () => {
  it('the TS milestone tier is Epic', () => {
    expect(MILESTONE_CRATE_TIER).toBe('epic');
    expect(CRATE_TIER_FLOOR[MILESTONE_CRATE_TIER]).toBe('epic');
  });

  it('the rollout backdates milestone crates at floor Epic (and still pays the launch grant)', async () => {
    const u = await newUser(25);
    const out = (await one<{ j: { accounts: number; crates: number; granted: number } }>('select public.aether_rollout() as j')).j;
    expect(out.crates).toBeGreaterThanOrEqual(2);
    expect((await milestones(u)).map((c) => [c.source, c.floor_rarity])).toEqual([['milestone:10', 'epic'], ['milestone:20', 'epic']]);
    expect(await balance(u)).toBe(1000);
    expect((await one<{ on: boolean }>('select aether_enabled as on from public.progression_config where id = 1')).on).toBe(true);
  });

  it('a settlement that crosses a milestone creates it at floor Epic', async () => {
    const u = await newUser();
    const xp = xpAtLevelStart(21) - 50;
    await db.query('update public.profiles set account_xp = $2, account_level = $3 where user_id = $1', [u, xp, levelOfXp(xp)]);
    await settleRanked(u, 1);
    expect((await milestones(u)).map((c) => [c.source, c.floor_rarity])).toEqual([['milestone:10', 'epic'], ['milestone:20', 'epic']]);
  });

  it('a milestone crate already held at Legendary is kept; the self-heal adds only the missing one, at Epic', async () => {
    const u = await newUser(21);
    await db.query('update public.profiles set progression_enrolled_at = now() where user_id = $1', [u]);
    const old = await legendaryMilestone(u, 10);
    await settleRanked(u, 8);
    const rows = await milestones(u);
    expect(rows.map((c) => [c.source, c.floor_rarity])).toEqual([['milestone:10', 'legendary'], ['milestone:20', 'epic']]);
    expect(rows[0]!.crate_id).toBe(old);
  });

  it('a focus at open is refused for every milestone crate (Epic or Legendary): nothing charged, the crate left sealed', async () => {
    const u = await newUser(21);
    await db.query("select public.aether_apply($1, 5000, 'grant', 'milestone-test')", [u]);
    const before = await balance(u); // the grant plus the launch grant a new profile gets once Aether is on
    const legacy = await legendaryMilestone(u, 10);
    const epic = (await one<{ crate_id: string }>(
      "insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity) values ($1, null, 'milestone:20', 'x', 'epic') returning crate_id", [u])).crate_id;
    for (const id of [legacy, epic]) {
      expect(await raises('select public.open_crate($1, $2::uuid, $3::text[], $4)', [u, id, ['card_plate'], 360])).toMatch(/focus_not_allowed/);
      expect(await raises('select public.open_crate($1, $2::uuid, $3::text[], $4)', [u, id, ['card_plate'], null])).toMatch(/focus_not_allowed/);
    }
    expect(await balance(u)).toBe(before);
    expect((await one<{ n: number }>("select count(*)::int as n from public.aether_ledger where user_id = $1 and reason = 'crate_focus'", [u])).n).toBe(0);
    expect((await milestones(u)).map((c) => c.state)).toEqual(['sealed', 'sealed']);
  });

  it('an unfocused open is free and rolls at or above the crate\'s own floor (Epic new, Legendary kept)', async () => {
    const u = await newUser(21);
    const before = await balance(u);
    const legacy = await legendaryMilestone(u, 10);
    const epic = (await one<{ crate_id: string }>(
      "insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity) values ($1, null, 'milestone:20', 'x', 'epic') returning crate_id", [u])).crate_id;
    for (const [id, floor] of [[legacy, 'legendary'], [epic, 'epic']] as const) {
      const out = await openCrate(u, id);
      expect(out.status).toBe('opened');
      expect(atOrAbove(COSMETIC_INDEX[out.rewardId!]!.rarity, floor), `${out.rewardId} >= ${floor}`).toBe(true);
    }
    expect(await balance(u)).toBe(before);
  });

  it('a focus is refused on any other crate too (a focus is bought with a crate, in the shop)', async () => {
    const u = await newUser();
    const lvl = (await one<{ crate_id: string }>('insert into public.loot_crates (user_id, earned_level) values ($1, 3) returning crate_id', [u])).crate_id;
    expect(await raises('select public.open_crate($1, $2::uuid, $3::text[], $4)', [u, lvl, ['title'], 0])).toMatch(/focus_not_allowed/);
  });

  it('the table takes a milestone crate only at Epic or Legendary', async () => {
    const u = await newUser();
    for (const floor of ['common', 'rare', 'ancient']) {
      expect(await raises("insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity) values ($1, null, 'milestone:30', 'x', $2)", [u, floor]), floor)
        .toMatch(/loot_crates_milestone_floor/);
    }
    expect(await raises("insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity) values ($1, null, 'milestone:30', 'x', 'epic')", [u])).toBe('no error');
  });

  it('the file is safe to run twice', async () => {
    await db.exec(MILESTONE);
    const u = await newUser(11);
    await db.query('update public.profiles set progression_enrolled_at = now() where user_id = $1', [u]);
    await settleRanked(u, 8);
    expect((await milestones(u)).map((c) => [c.source, c.floor_rarity])).toEqual([['milestone:10', 'epic']]);
  });
});
