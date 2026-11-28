import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogHash, catalogSyncPayload } from './cosmetics';
import { DEFAULT_PACK_ECONOMY, PACK_LAUNCH_GRANT, levelPacksBetween, welcomePackCount } from './packEconomy';
import { parseProgressionProfile, parseProgressionResult, xpAtLevelStart, type ProgressionResult } from './rules';
import { settlementParity } from './server';

/**
 * THE PACK GRANTS, THE CHEST FREEZE AND THE ROLLOUT, EXECUTED (spec docs/superpowers/specs/2026-11-27-pack-economy-design.md,
 * sections 10, 11, 12 and 12.1). PGlite runs the progression chain in production order through the newest
 * settle_progression (2026-10-25-versus-duos-xp.sql), then 2026-11-03-secret-plushie-plate.sql and 2026-12-01-packs.sql,
 * with Aether on, and checks on real Postgres:
 *
 *   BEFORE THE FLIP: enrollment still makes the Welcome Chest and no pack; the Chest Shop still quotes;
 *   THE ROLLOUT: refuses while Aether is off or the pack economy is unreadable; writes every launch level only where it is
 *   null, pays 3,000 Aether once per existing account (guests too), grants no pack, flips the switch; a second run
 *   changes nothing; an account made after it is never paid; the API roles cannot write a launch level;
 *   AFTER THE FLIP: enrollment makes exactly the nine Welcome packs, Common first, and a retry none; a new account
 *   crossing Level 10 gets `level:5` and `level:10`; Review Focus 5 (an existing Level 12 account crossing to 16 gets
 *   `level:15` only, and a retry nothing); Level 37 at launch gets its first at 40; a missing Level pack self-heals;
 *   grants are made beside a full counter; no milestone chest; `buy_crate` answers `shop_retired` and a sealed
 *   `open_crate` `chests_frozen`, changing nothing, while an opened chest still answers `already_opened`; the result
 *   and profile JSON carry the packs and pass `settlementParity`.
 */
const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = [
  '2026-09-27-account-progression.sql', '2026-09-28-progression-crates.sql', '2026-09-28-progression-skins.sql', '2026-09-28-achievements.sql',
  '2026-09-29-crate-fixed-rarity-odds.sql', '2026-09-29-crate-uniform-within-rarity.sql', '2026-09-29-gauntlet-progress.sql', '2026-10-02-ancient-rarity.sql',
  '2026-10-03-placement-xp.sql', '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-14-versus-progression.sql', '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
];
const STARTER_CHECK = ((t: string): string => t.slice(0, t.indexOf('-- ── 2. equip_cosmetic')))(read('2026-10-13-emotes.sql'));
const LATER = ['2026-10-18-aether.sql', '2026-10-19-aether-launch-grant.sql', '2026-10-20-milestone-chests-epic.sql', '2026-10-20-announcers-not-focusable.sql',
  '2026-10-15-lobby-live.sql', '2026-10-15-lobby-live-watcher-identity.sql', '2026-10-24-versus-group.sql', '2026-10-24-versus-spectator-xp.sql',
  '2026-10-25-versus-duos.sql', '2026-10-25-versus-duos-xp.sql', '2026-11-03-secret-plushie-plate.sql'];
const PACKS = read('2026-12-01-packs.sql');

const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
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
/** A fresh account. `level`: its XP set to the start of that level. `enrolled`: it has settled before (no Welcome). */
async function newUser(opts: { level?: number; xp?: number; enrolled?: boolean; guest?: boolean } = {}): Promise<string> {
  userSeq++;
  const u = `00000000-0000-0000-0002-${String(userSeq).padStart(12, '0')}`;
  await db.query('insert into auth.users (id, is_anonymous) values ($1, $2)', [u, opts.guest ?? false]);
  await db.query('insert into public.profiles (user_id) values ($1)', [u]);
  const xp = opts.xp ?? (opts.level !== undefined ? xpAtLevelStart(opts.level) : 0);
  await db.query(`update public.profiles set account_xp = $2, account_level = public.progression_level_of($2),
    progression_enrolled_at = case when $3 then now() - interval '1 day' end where user_id = $1`, [u, xp, opts.enrolled ?? false]);
  return u;
}
type Settled = { status: string; result: ProgressionResult; raw: Record<string, unknown>; profile: Record<string, unknown> };
/** A Ranked game at 8th place (100 XP, no placement bonus) settled for `u`, as `runId` (a fresh one by default). */
async function settle(u: string, runId: string = `grant-run-${randomUUID()}`): Promise<Settled> {
  await db.query('insert into public.rank_results (user_id, run_id, placement, seed) values ($1, $2, 8, 1) on conflict do nothing', [u, runId]);
  const j = (await one<{ j: { status: string; result: Record<string, unknown>; profile: Record<string, unknown> } }>(
    "select public.settle_progression($1, 'ranked', $2, null, false, 1, null) as j", [u, runId])).j;
  return { status: j.status, result: parseProgressionResult(j.result)!, raw: j.result, profile: j.profile };
}
/** XP that lands on Level `l` after one 100 XP game. */
const justBelow = (l: number): number => xpAtLevelStart(l) - 50;
type PackRow = { pack_id: string; source: string; look_kind: string; look_id: string; floor_rarity: string; state: string; price_paid: number };
async function packsOf(u: string): Promise<PackRow[]> {
  return (await db.query<PackRow>('select pack_id, source, look_kind, look_id, floor_rarity, state, price_paid from public.packs where user_id = $1 order by created_at, pack_id', [u])).rows;
}
async function sources(u: string): Promise<string[]> {
  return (await packsOf(u)).map((p) => p.source);
}
async function balance(u: string): Promise<number> {
  return (await db.query<{ b: number }>('select balance as b from public.aether_wallets where user_id = $1', [u])).rows[0]?.b ?? 0;
}
async function launchRows(u: string): Promise<Array<{ delta: number }>> {
  return (await db.query<{ delta: number }>("select delta from public.aether_ledger where user_id = $1 and reason = 'grant' and source_id = 'pack_launch'", [u])).rows;
}
/** What a refusal must not change. */
async function snapshot(u: string): Promise<unknown> {
  return one(`select (select coalesce(sum(balance), 0) from public.aether_wallets where user_id = $1)::int as balance,
    (select count(*) from public.aether_ledger where user_id = $1)::int as ledger,
    (select coalesce(jsonb_agg(jsonb_build_object('id', crate_id, 's', state, 'r', reward_cosmetic_id) order by crate_id), '[]') from public.loot_crates where user_id = $1) as crates,
    (select count(*) from public.player_cosmetics where user_id = $1)::int as owned,
    (select coalesce(jsonb_agg(pack_id order by pack_id), '[]') from public.packs where user_id = $1) as packs,
    (select progression_revision from public.profiles where user_id = $1) as revision`, [u]);
}
const WELCOME = ['welcome:common:1', 'welcome:common:2', 'welcome:common:3', 'welcome:common:4', 'welcome:common:5',
  'welcome:rare:1', 'welcome:rare:2', 'welcome:epic:1', 'welcome:legendary:1'];
const switchOn = async (): Promise<boolean> => (await one<{ on: boolean }>('select packs_enabled as on from public.progression_config where id = 1')).on;

// Accounts that exist when the rollout runs (made before it, in the "before the flip" block).
let preEnrolled = '';   // enrolled before the flip: holds the Welcome Chest, opened
let sealedHolder = '';  // holds a sealed chest
let at12 = '';          // Review Focus 5
let at37 = '';
let atBaseline20 = '';  // a launch level already written (never moved)
let guest = '';

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const f of FILES) { await db.exec(read(f)); await db.exec(API_GRANTS); }
  await db.exec(STARTER_CHECK);
  for (const f of LATER) { await db.exec(read(f)); await db.exec(API_GRANTS); }
  await db.exec(PACKS);
  await db.exec(API_GRANTS);
  const c = catalogSyncPayload();
  await db.query('select public.sync_cosmetic_catalog($1::jsonb, $2)', [JSON.stringify(c), catalogHash(c)]);
  // Aether is live (the pack rollout requires it); packs stay OFF until the rollout flips them.
  await db.exec("update public.progression_config set crates_enabled = true, aether_enabled = true, epoch = now() - interval '2 days' where id = 1;");
}, 180_000);
afterAll(async () => { await db?.close(); });

describe('levelPacksBetween (the TS twin of the settlement\'s level packs)', () => {
  it('every multiple of 5 above the launch level, up to the level', () => {
    expect(levelPacksBetween(37, 41)).toEqual([40]);
    expect(levelPacksBetween(0, 10)).toEqual([5, 10]);
    expect(levelPacksBetween(35, 40)).toEqual([40]);
    expect(levelPacksBetween(35, 39)).toEqual([]);
    expect(levelPacksBetween(12, 16)).toEqual([15]);
    expect(levelPacksBetween(0, 4)).toEqual([]);
    expect(levelPacksBetween(0, 1)).toEqual([]);
    expect(levelPacksBetween(10, 10)).toEqual([]);
    expect(levelPacksBetween(0, 22, { ...DEFAULT_PACK_ECONOMY, levelPackEvery: 7 })).toEqual([7, 14, 21]);
    expect(welcomePackCount()).toBe(9);
  });
});

describe('before the flip: chests as today', () => {
  it('enrollment makes the Welcome Chest and no pack; the result carries 0 packs', async () => {
    preEnrolled = await newUser();
    const s = await settle(preEnrolled);
    expect(s.status).toBe('ok');
    expect(s.result.cratesAwarded).toBe(1);
    expect(s.result.packsAwarded).toBe(0);
    expect(s.result.packIds).toEqual([]);
    expect(s.raw.packsAwarded).toBe(0);
    expect(await packsOf(preEnrolled)).toEqual([]);
    expect(settlementParity(s.result)).toBe(true);
    // open it now, so after the flip it is an OPENED chest
    const open = (await one<{ j: { status: string } }>('select public.open_crate($1, $2::uuid) as j', [preEnrolled, s.result.crateIds[0]])).j;
    expect(open.status).toBe('opened');
  });

  it('the Chest Shop still quotes', async () => {
    const u = await newUser();
    expect((await one<{ q: unknown }>("select public.aether_quote($1, 'standard', null, false) as q", [u])).q).not.toBeNull();
  });

  it('the profile JSON carries an empty hand and a zero meter', async () => {
    const p = parseProgressionProfile((await one<{ j: unknown }>('select public.progression_profile_json($1) as j', [preEnrolled])).j)!;
    expect(p.packs).toEqual([]);
    expect(p.packMeter).toEqual({ progress: 0, ready: 0 });
  });

  it('the accounts that will exist at the rollout', async () => {
    sealedHolder = await newUser({ level: 3, enrolled: true });
    await db.query('insert into public.loot_crates (user_id, earned_level) values ($1, 2)', [sealedHolder]);
    at12 = await newUser({ level: 12, enrolled: true });
    at37 = await newUser({ level: 37, enrolled: true });
    atBaseline20 = await newUser({ level: 30, enrolled: true });
    await db.query('update public.profiles set pack_level_baseline = 20 where user_id = $1', [atBaseline20]);
    guest = await newUser({ guest: true });
  });
});

describe('pack_rollout (spec 12, 12.1)', () => {
  it('refuses while Aether is off, changing nothing', async () => {
    await db.exec('update public.progression_config set aether_enabled = false where id = 1;');
    const before = await snapshot(at12);
    expect(await raises('select public.pack_rollout()')).toMatch(/aether_disabled/);
    expect(await snapshot(at12)).toEqual(before);
    expect(await switchOn()).toBe(false);
    await db.exec('update public.progression_config set aether_enabled = true where id = 1;');
  });

  it('refuses while the grant numbers are unreadable, changing nothing', async () => {
    const good = JSON.stringify(DEFAULT_PACK_ECONOMY);
    for (const eco of [{ ...DEFAULT_PACK_ECONOMY, levelPackEvery: 0 }, { ...DEFAULT_PACK_ECONOMY, levelPackRarity: 'mythic' },
      { ...DEFAULT_PACK_ECONOMY, welcomePacks: { ...DEFAULT_PACK_ECONOMY.welcomePacks, rare: 'two' } }]) {
      await db.query('update public.pack_config set economy = $1::jsonb where id = 1', [JSON.stringify(eco)]);
      expect(await raises('select public.pack_rollout()')).toMatch(/pack_config_missing/);
    }
    await db.query('update public.pack_config set economy = $1::jsonb where id = 1', [good]);
    expect((await one<{ n: number }>('select count(*)::int as n from public.profiles where pack_level_baseline is not null')).n).toBe(1);
    expect(await switchOn()).toBe(false);
  });

  it('writes every launch level where null, pays 3,000 once per account (guests too), grants no pack, then flips the switch', async () => {
    const everyone = (await db.query<{ user_id: string }>('select user_id from public.profiles order by user_id')).rows.map((r) => r.user_id);
    const balances = new Map<string, number>();
    const revisions = new Map<string, number>();
    for (const u of everyone) {
      balances.set(u, await balance(u));
      revisions.set(u, (await one<{ r: number }>('select progression_revision as r from public.profiles where user_id = $1', [u])).r);
    }
    const out = (await one<{ j: { status: string; baselines: number; granted: number } }>('select public.pack_rollout() as j')).j;
    expect(out).toEqual({ status: 'rolled_out', baselines: everyone.length - 1, granted: everyone.length });
    for (const u of everyone) {
      expect(await launchRows(u), u).toEqual([{ delta: PACK_LAUNCH_GRANT }]);
      expect(await balance(u), u).toBe(balances.get(u)! + 3000);
      expect((await one<{ r: number }>('select progression_revision as r from public.profiles where user_id = $1', [u])).r).toBe(revisions.get(u)! + 1);
    }
    expect(PACK_LAUNCH_GRANT).toBe(3000);
    const base = async (u: string): Promise<number | null> => (await one<{ b: number | null }>('select pack_level_baseline as b from public.profiles where user_id = $1', [u])).b;
    expect(await base(at12)).toBe(12);
    expect(await base(at37)).toBe(37);
    expect(await base(atBaseline20)).toBe(20);   // already written: never moved
    expect(await base(guest)).toBe(1);
    expect((await one<{ n: number }>('select count(*)::int as n from public.packs')).n).toBe(0);
    expect(await switchOn()).toBe(true);
  });

  it('a second run changes nothing', async () => {
    const before = await Promise.all([at12, at37, guest, atBaseline20].map(snapshot));
    const baselines = (await db.query('select user_id, pack_level_baseline from public.profiles order by user_id')).rows;
    expect((await one<{ j: unknown }>('select public.pack_rollout() as j')).j).toEqual({ status: 'already_rolled_out', baselines: 0, granted: 0 });
    expect(await Promise.all([at12, at37, guest, atBaseline20].map(snapshot))).toEqual(before);
    expect((await db.query('select user_id, pack_level_baseline from public.profiles order by user_id')).rows).toEqual(baselines);
  });

  it('an account made after the rollout is never paid (not by a trigger, not by a re-run), and its launch level stays null', async () => {
    const late = await newUser();
    expect(await launchRows(late)).toEqual([]);
    await db.query('select public.pack_rollout()');
    expect(await launchRows(late)).toEqual([]);
    expect((await one<{ b: number | null }>('select pack_level_baseline as b from public.profiles where user_id = $1', [late])).b).toBeNull();
  });

  it('the API roles can never write a launch level', async () => {
    const u = await newUser({ level: 30, enrolled: true });
    await db.exec(`drop policy if exists "test write own profile" on public.profiles;
      create policy "test write own profile" on public.profiles for all to authenticated using (true) with check (true);`);
    try {
      await db.exec('set role authenticated');
      expect(await raises('update public.profiles set pack_level_baseline = 0 where user_id = $1', [u])).toMatch(/progression_columns_are_server_owned/);
      const v = randomUUID();
      await db.exec('reset role');
      await db.query('insert into auth.users (id) values ($1)', [v]);
      await db.exec('set role authenticated');
      expect(await raises('insert into public.profiles (user_id, pack_level_baseline) values ($1, 0)', [v])).toMatch(/progression_columns_are_server_owned/);
      expect(await raises('update public.profiles set rating = rating where user_id = $1', [u])).toBe('no error');
    } finally {
      await db.exec('reset role');
      await db.exec('drop policy if exists "test write own profile" on public.profiles;');
    }
  });

  it('the service role alone may run it; the gift itself is internal', async () => {
    const can = async (role: string, fn: string): Promise<boolean> =>
      (await one<{ ok: boolean }>('select has_function_privilege($1, $2, \'execute\') as ok', [role, fn])).ok;
    for (const role of ['anon', 'authenticated']) expect(await can(role, 'public.pack_rollout()'), role).toBe(false);
    expect(await can('service_role', 'public.pack_rollout()')).toBe(true);
    for (const role of ['anon', 'authenticated', 'service_role']) expect(await can(role, 'public.pack_launch_grant(uuid)'), role).toBe(false);
    // the SQL copy of the amount is PACK_LAUNCH_GRANT
    const body = PACKS.slice(PACKS.indexOf('create or replace function public.pack_launch_grant('));
    expect(/c_grant constant int := (\d+);/.exec(body)![1]).toBe(String(PACK_LAUNCH_GRANT));
  });
});

describe('after the flip: the settlement grants packs (spec 10)', () => {
  it('enrollment makes exactly the nine Welcome packs, Common first, no chest; a retry and a later game make none', async () => {
    const u = await newUser();
    const runId = `welcome-${randomUUID()}`;
    const s = await settle(u, runId);
    expect(s.status).toBe('ok');
    expect(await sources(u)).toEqual(WELCOME);
    const rows = await packsOf(u);
    expect(rows.every((p) => p.look_kind === 'rarity' && p.look_id === `rarity-${p.floor_rarity}` && p.state === 'sealed' && p.price_paid === 0)).toBe(true);
    expect(rows.map((p) => p.floor_rarity)).toEqual(['common', 'common', 'common', 'common', 'common', 'rare', 'rare', 'epic', 'legendary']);
    expect(s.result.packsAwarded).toBe(9);
    expect(s.result.packIds).toEqual(rows.map((p) => p.pack_id));
    expect(s.result.cratesAwarded).toBe(0);
    expect(s.result.crateIds).toEqual([]);
    expect((await one<{ n: number }>('select count(*)::int as n from public.loot_crates where user_id = $1', [u])).n).toBe(0);
    expect(settlementParity(s.result)).toBe(true);
    // the profile shows them in counter order (the same order)
    const profile = parseProgressionProfile(s.profile)!;
    expect(profile.packs!.map((p) => p.packId)).toEqual(rows.map((p) => p.pack_id));
    expect(profile.packs!.map((p) => p.look.name)).toEqual(['Common Pack', 'Common Pack', 'Common Pack', 'Common Pack', 'Common Pack', 'Rare Pack', 'Rare Pack', 'Epic Pack', 'Legendary Pack']);
    expect(profile.packMeter).toEqual({ progress: 0, ready: 0 });

    const again = await settle(u, runId);
    expect(again.status).toBe('deduped');
    expect(again.result.packIds).toEqual(s.result.packIds);
    const later = await settle(u);
    expect(later.result.packsAwarded).toBe(0);
    expect(await sources(u)).toEqual(WELCOME);
  });

  it('a new account crossing Level 10 in its first game gets the Welcome packs, then level:5 and level:10', async () => {
    const u = await newUser({ xp: justBelow(10) });
    const s = await settle(u);
    expect(s.result.after.level).toBe(10);
    expect(await sources(u)).toEqual([...WELCOME, 'level:5', 'level:10']);
    const level = (await packsOf(u)).slice(9);
    expect(level.map((p) => [p.look_id, p.floor_rarity])).toEqual([['rarity-legendary', 'legendary'], ['rarity-legendary', 'legendary']]);
    expect(s.result.packsAwarded).toBe(11);
    expect(settlementParity(s.result)).toBe(true);
  });

  it('Review Focus 5: an existing Level 12 account crossing to 16 gets level:15 only, and a retry nothing', async () => {
    await db.query('update public.profiles set account_xp = $2, account_level = public.progression_level_of($2) where user_id = $1', [at12, justBelow(16)]);
    const runId = `focus5-${randomUUID()}`;
    const s = await settle(at12, runId);
    expect(s.result.before.level).toBe(15);
    expect(s.result.after.level).toBe(16);
    expect(await sources(at12)).toEqual(['level:15']);
    expect(s.result.packsAwarded).toBe(1);
    expect(settlementParity(s.result)).toBe(true);
    expect((await settle(at12, runId)).status).toBe('deduped');
    expect((await settle(at12)).result.packsAwarded).toBe(0);
    expect(await sources(at12)).toEqual(['level:15']);
  });

  it('Level 37 at launch: nothing until its first pack at 40', async () => {
    await db.query('update public.profiles set account_xp = $2, account_level = public.progression_level_of($2) where user_id = $1', [at37, justBelow(39)]);
    expect((await settle(at37)).result.packsAwarded).toBe(0);
    await db.query('update public.profiles set account_xp = $2, account_level = public.progression_level_of($2) where user_id = $1', [at37, justBelow(41)]);
    await settle(at37);
    expect(await sources(at37)).toEqual(['level:40']);
  });

  it('a launch level already written before the rollout is the line (Level 20: first pack at 25)', async () => {
    await settle(atBaseline20);
    expect(await sources(atBaseline20)).toEqual(['level:25', 'level:30']);
  });

  it('a missing Level pack self-heals above the launch level', async () => {
    const u = await newUser({ xp: justBelow(10) });
    await settle(u);
    await db.query("delete from public.packs where user_id = $1 and source = 'level:5'", [u]);
    const s = await settle(u);
    expect(s.result.packsAwarded).toBe(1);
    expect((await sources(u)).filter((x) => x.startsWith('level:')).sort()).toEqual(['level:10', 'level:5']);
  });

  it('grants are made beside a full counter (5 types x 8 each)', async () => {
    const u = await newUser();
    let n = 0;
    for (const id of ['category-title', 'category-emote', 'category-board', 'category-music', 'category-card_plate']) {
      for (let i = 0; i < 8; i++) {
        await db.query("insert into public.packs (user_id, look_kind, look_id, floor_rarity, source) values ($1, 'category', $2, 'common', $3)", [u, id, `test:${++n}`]);
      }
    }
    expect((await one<{ room: boolean }>("select public.progression_counter_has_room($1, 'rarity', 'rarity-common') as room", [u])).room).toBe(false);
    await db.query('update public.profiles set account_xp = $2, account_level = public.progression_level_of($2) where user_id = $1', [u, justBelow(5)]);
    const s = await settle(u);
    expect(s.result.packsAwarded).toBe(10);
    expect((await sources(u)).slice(40)).toEqual([...WELCOME, 'level:5']);
  });

  it('no milestone chest with packs on (an existing account crossing Level 20)', async () => {
    const u = await newUser({ xp: justBelow(20), enrolled: true });
    const s = await settle(u);
    expect(s.result.after.level).toBe(20);
    expect(s.result.cratesAwarded).toBe(0);
    expect((await one<{ n: number }>('select count(*)::int as n from public.loot_crates where user_id = $1', [u])).n).toBe(0);
    expect(await sources(u)).toEqual(['level:5', 'level:10', 'level:15', 'level:20']);   // made after the launch: line 0
  });

  it('an unreadable pack economy grants no pack this settlement and never blocks the game', async () => {
    await db.query('update public.pack_config set economy = $1::jsonb where id = 1', [JSON.stringify({ ...DEFAULT_PACK_ECONOMY, levelPackEvery: 'five' })]);
    try {
      const u = await newUser({ xp: justBelow(5) });
      const s = await settle(u);
      expect(s.status).toBe('ok');
      expect(s.result.packsAwarded).toBe(0);
      expect(s.result.cratesAwarded).toBe(0);
      expect(parseProgressionProfile(s.profile)).not.toBeNull();
    } finally {
      await db.query('update public.pack_config set economy = $1::jsonb where id = 1', [JSON.stringify(DEFAULT_PACK_ECONOMY)]);
    }
  });
});

describe('after the flip: the Chest Shop is retired and sealed chests are frozen (spec 11)', () => {
  it('buy_crate answers shop_retired and changes nothing; aether_quote answers null', async () => {
    const before = await snapshot(at37);
    expect(await raises("select public.buy_crate($1, 'standard', null, 100, $2)", [at37, randomUUID()])).toMatch(/shop_retired/);
    expect(await snapshot(at37)).toEqual(before);
    expect((await one<{ q: unknown }>("select public.aether_quote($1, 'standard', null, false) as q", [at37])).q).toBeNull();
  });

  it('a sealed open_crate answers chests_frozen, leaving the chest sealed and everything unchanged', async () => {
    const crate = (await one<{ crate_id: string }>("select crate_id from public.loot_crates where user_id = $1 and state = 'sealed'", [sealedHolder])).crate_id;
    const before = await snapshot(sealedHolder);
    expect(await raises('select public.open_crate($1, $2::uuid)', [sealedHolder, crate])).toMatch(/chests_frozen/);
    expect(await snapshot(sealedHolder)).toEqual(before);
    expect((await one<{ state: string }>('select state from public.loot_crates where crate_id = $1', [crate])).state).toBe('sealed');
  });

  it('an opened chest still answers already_opened with its committed reward', async () => {
    const row = await one<{ crate_id: string; reward_cosmetic_id: string }>("select crate_id, reward_cosmetic_id from public.loot_crates where user_id = $1 and state = 'opened'", [preEnrolled]);
    const out = (await one<{ j: { status: string; rewardId: string } }>('select public.open_crate($1, $2::uuid) as j', [preEnrolled, row.crate_id])).j;
    expect(out.status).toBe('already_opened');
    expect(out.rewardId).toBe(row.reward_cosmetic_id);
  });
});

describe('the migration', () => {
  it('is safe to run again after the rollout', async () => {
    await db.exec(PACKS);
    expect(await switchOn()).toBe(true);
    expect((await one<{ j: { status: string } }>('select public.pack_rollout() as j')).j.status).toBe('already_rolled_out');
    const u = await newUser();
    await settle(u);
    expect(await sources(u)).toEqual(WELCOME);
  });
});
