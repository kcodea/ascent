import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AETHER_LAUNCH_GRANT, DEFAULT_AETHER_ECONOMY, aetherForSettlement } from './aether';
import { catalogHash, catalogSyncPayload } from './cosmetics';

/**
 * THE AETHER LAUNCH GRANT, EXECUTED (owner 2026-10-19: "lets give everyone 1,000 Aether as part of the announcement
 * of this change"; R-PROG-AETHER-05). PGlite runs the progression migrations in production order, then
 * 2026-10-18-aether.sql, then 2026-10-19-aether-launch-grant.sql, and checks on real Postgres: the rollout pays every
 * existing profile the grant exactly once (one ledger row, the revision moved) and a re-run pays nobody; a profile
 * created after the launch is paid by the trigger, including one a first Ranked settlement creates; with the switch
 * off the trigger pays nothing; running the file AFTER the launch pays the profiles that exist; the SQL amount is the
 * TS `AETHER_LAUNCH_GRANT`; and no API role can call the grant.
 */
const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = ['2026-09-27-account-progression.sql', '2026-09-28-progression-crates.sql', '2026-09-28-progression-skins.sql', '2026-09-28-achievements.sql', '2026-09-29-crate-fixed-rarity-odds.sql', '2026-09-29-crate-uniform-within-rarity.sql', '2026-09-29-gauntlet-progress.sql', '2026-10-02-ancient-rarity.sql', '2026-10-03-placement-xp.sql', '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql', '2026-10-14-versus-progression.sql'];
const STARTER_CHECK = ((t: string): string => t.slice(0, t.indexOf('-- ── 2. equip_cosmetic')))(read('2026-10-13-emotes.sql'));
const AETHER = read('2026-10-18-aether.sql');
const GRANT = read('2026-10-19-aether-launch-grant.sql');

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
/** A fresh auth account, with a profile unless `withProfile` is false. */
async function newUser(withProfile = true): Promise<string> {
  userSeq++;
  const u = `00000000-0000-0000-0000-${String(userSeq).padStart(12, '0')}`;
  await db.query('insert into auth.users (id) values ($1)', [u]);
  if (withProfile) await db.query('insert into public.profiles (user_id) values ($1)', [u]);
  return u;
}
async function balance(u: string): Promise<number> {
  return (await db.query<{ balance: number }>('select balance from public.aether_wallets where user_id = $1', [u])).rows[0]?.balance ?? 0;
}
async function grants(u: string): Promise<Array<{ delta: number; source_id: string }>> {
  return (await db.query<{ delta: number; source_id: string }>("select delta, source_id from public.aether_ledger where user_id = $1 and reason = 'grant' order by id", [u])).rows;
}
async function revision(u: string): Promise<number> {
  return (await one<{ r: number }>('select progression_revision::int as r from public.profiles where user_id = $1', [u])).r;
}
const setSwitch = (on: boolean): Promise<unknown> => db.exec(`update public.progression_config set aether_enabled = ${on} where id = 1;`);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const f of FILES) { await db.exec(read(f)); await db.exec(API_GRANTS); }
  await db.exec(STARTER_CHECK);
  await db.exec(AETHER);
  await db.exec(API_GRANTS);
  await db.exec(GRANT);
  const c = catalogSyncPayload();
  await db.query('select public.sync_cosmetic_catalog($1::jsonb, $2)', [JSON.stringify(c), catalogHash(c)]);
  await db.exec("update public.progression_config set crates_enabled = true, epoch = now() - interval '2 days' where id = 1;");
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('the Aether launch grant (R-PROG-AETHER-05)', () => {
  it('the SQL amount is the TS AETHER_LAUNCH_GRANT (1,000)', () => {
    expect(AETHER_LAUNCH_GRANT).toBe(1000);
    expect(/c_grant constant int := (\d+);/.exec(GRANT)![1]).toBe(String(AETHER_LAUNCH_GRANT));
  });

  it('before the launch nothing is paid; the rollout pays every profile once and moves its revision; a re-run pays nobody', async () => {
    const a = await newUser();
    const b = await newUser();
    expect(await balance(a)).toBe(0);
    const rev0 = await revision(a);
    const first = (await one<{ j: { granted: number; accounts: number; crates: number } }>('select public.aether_rollout() as j')).j;
    expect(first.granted).toBeGreaterThanOrEqual(2);
    for (const u of [a, b]) {
      expect(await balance(u)).toBe(AETHER_LAUNCH_GRANT);
      expect(await grants(u)).toEqual([{ delta: AETHER_LAUNCH_GRANT, source_id: 'aether_launch' }]);
    }
    expect(await revision(a)).toBe(rev0 + 1);
    expect((await one<{ on: boolean }>('select aether_enabled as on from public.progression_config where id = 1')).on).toBe(true);
    const second = (await one<{ j: unknown }>('select public.aether_rollout() as j')).j;
    expect(second).toEqual({ accounts: 0, crates: 0, granted: 0 });
    expect(await balance(a)).toBe(AETHER_LAUNCH_GRANT);
    expect(await revision(a)).toBe(rev0 + 1);
  });

  it('after the launch, a new profile is paid at once, and only once', async () => {
    const u = await newUser();
    expect(await balance(u)).toBe(AETHER_LAUNCH_GRANT);
    await db.query('insert into public.profiles (user_id) values ($1) on conflict (user_id) do nothing', [u]);
    expect(await grants(u)).toHaveLength(1);
    // the rollout run again does not pay it a second time either
    await db.query('select public.aether_rollout()');
    expect(await balance(u)).toBe(AETHER_LAUNCH_GRANT);
  });

  it('a first Ranked game (the settlement creates the profile) gets the grant plus the game\'s pay', async () => {
    const u = await newUser(false);
    await db.query("insert into public.rank_results (user_id, run_id, placement, seed) values ($1, 'grant-run-1', 1, 1)", [u]);
    await db.query("select public.settle_progression($1, 'ranked', 'grant-run-1', null, false, 1, null)", [u]);
    expect(await balance(u)).toBe(AETHER_LAUNCH_GRANT + aetherForSettlement({ mode: 'ranked', placement: 1 }, DEFAULT_AETHER_ECONOMY).total);
    expect(await grants(u)).toHaveLength(1);
  });

  it('with the switch off a new profile is not paid (the rollout pays it later)', async () => {
    await setSwitch(false);
    try {
      const u = await newUser();
      expect(await balance(u)).toBe(0);
      await db.query('select public.aether_rollout()');
      expect(await balance(u)).toBe(AETHER_LAUNCH_GRANT);
    } finally { await setSwitch(true); }
  });

  it('running the file AFTER the launch pays the profiles that exist, and a second run pays nothing more', async () => {
    await setSwitch(false);
    const u = await newUser(); // made while off: the trigger skipped it
    await setSwitch(true);
    expect(await balance(u)).toBe(0);
    const rev0 = await revision(u);
    await db.exec(GRANT);
    expect(await balance(u)).toBe(AETHER_LAUNCH_GRANT);
    expect(await revision(u)).toBe(rev0 + 1);
    await db.exec(GRANT);
    expect(await grants(u)).toHaveLength(1);
    expect(await revision(u)).toBe(rev0 + 1);
  });

  it('no API role can call the grant or the trigger function', async () => {
    for (const sig of ['public.aether_launch_grant(uuid)', 'public.profiles_aether_launch_grant()']) {
      const acl = await one<{ anon: boolean; auth: boolean; svc: boolean }>(
        `select has_function_privilege('anon', '${sig}', 'execute') as anon, has_function_privilege('authenticated', '${sig}', 'execute') as auth, has_function_privilege('service_role', '${sig}', 'execute') as svc`);
      expect(acl, sig).toEqual({ anon: false, auth: false, svc: false });
    }
    const roll = await one<{ auth: boolean; svc: boolean }>(
      "select has_function_privilege('authenticated', 'public.aether_rollout()', 'execute') as auth, has_function_privilege('service_role', 'public.aether_rollout()', 'execute') as svc");
    expect(roll).toEqual({ auth: false, svc: true });
  });
});
