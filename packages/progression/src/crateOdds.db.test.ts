import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COSMETICS, COSMETIC_RARITIES, CRATE_ROLL_VERSION, catalogHash, catalogSyncPayload, eligibleCrateCosmetics, parseOpenCrateResult,
  pickCrateReward, type CatalogSyncPayload,
} from './cosmetics';

/**
 * THE FIXED-ODDS CRATE ROLL, EXECUTED (owner 2026-09-29: "go to C", then "make it 50/30/15/5 though"). PGlite runs
 * every progression migration in order (MVP, crates, skins, achievements, hero attack, fixed odds), syncs the code
 * catalog, and checks that the SQL pick (`progression_crate_pick`) chooses EXACTLY what the TS `pickCrateReward`
 * chooses, draw by draw, across fresh, partial and nearly-empty collections (so the rarity bands, the nearest-rarity
 * fallback and the category-weight walk all agree on real Postgres); that `open_crate` stamps roll_version 2 and
 * keeps every old guarantee (no duplicate, already_opened, pool_exhausted leaves the crate sealed); that the admin_off
 * kill switch keeps an item out of every draw; and that re-running the file changes nothing.
 */
const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const MVP = read('2026-09-27-account-progression.sql');
const CRATES = read('2026-09-28-progression-crates.sql');
const SKINS = read('2026-09-28-progression-skins.sql');
const ACH = read('2026-09-28-achievements.sql');
const ATTACK = read('2026-09-28-progression-hero-attack.sql');
const ODDS = read('2026-09-29-crate-fixed-rarity-odds.sql');

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
let userSeq = 0;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0]!;
}
async function sync(payload: CatalogSyncPayload = catalogSyncPayload(), hash: string = catalogHash(payload)): Promise<string> {
  return (await one<{ j: { status: string } }>('select public.sync_cosmetic_catalog($1::jsonb, $2) as j', [JSON.stringify(payload), hash])).j.status;
}
/** A settled player (so they hold their Welcome Crate) who already owns `ids`. */
async function playerOwning(ids: readonly string[]): Promise<string> {
  userSeq++;
  const u = `00000000-0000-0000-0000-${String(userSeq).padStart(12, '0')}`;
  await db.query('insert into auth.users (id) values ($1)', [u]);
  await db.query('insert into public.rank_results (user_id, run_id, placement, seed) values ($1, $2, 6, 1)', [u, `r-${u}`]);
  await db.query('select public.settle_progression($1, $2, $3, null, false, 1, null)', [u, 'ranked', `r-${u}`]);
  for (const id of ids) await db.query("insert into public.player_cosmetics (user_id, cosmetic_id, source) values ($1, $2, 'test') on conflict do nothing", [u, id]);
  return u;
}
async function ownedIds(u: string): Promise<string[]> {
  return (await db.query<{ cosmetic_id: string }>('select cosmetic_id from public.player_cosmetics where user_id = $1', [u])).rows.map((r) => r.cosmetic_id);
}
async function sqlPick(u: string, draw: number): Promise<string | null> {
  return (await one<{ p: string | null }>('select public.progression_crate_pick($1, $2::double precision) as p', [u, draw])).p;
}
async function sealedCrate(u: string): Promise<string> {
  return (await one<{ crate_id: string }>("select crate_id from public.loot_crates where user_id = $1 and state = 'sealed' order by earned_level limit 1", [u])).crate_id;
}
async function open(u: string, crateId: string) {
  return parseOpenCrateResult((await one<{ j: unknown }>('select public.open_crate($1, $2) as j', [u, crateId])).j)!;
}

const DRAWS = 400;
const crateIds = COSMETICS.filter((c) => c.acquisition.type === 'crate').map((c) => c.id);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MVP);
  await db.exec(API_GRANTS);
  await db.exec(`update public.progression_config set epoch = now() - interval '1 day' where id = 1;`);
  for (const f of [CRATES, SKINS, ACH, ATTACK, ODDS]) { await db.exec(f); await db.exec(API_GRANTS); }
  expect(await sync()).toBe('synced');
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('the SQL pick equals the TS pick, draw for draw', () => {
  const all = eligibleCrateCosmetics([]);
  const ownedSets: Array<[string, string[]]> = [
    ['a fresh player', []],
    ['every Common owned (Common draws fall to Rare)', all.filter((c) => c.rarity === 'common').map((c) => c.id)],
    ['every Epic owned (Epic draws fall to Rare before Legendary)', all.filter((c) => c.rarity === 'epic').map((c) => c.id)],
    ['only Legendaries left', all.filter((c) => c.rarity !== 'legendary').map((c) => c.id)],
    ['one item left', all.slice(1).map((c) => c.id)],
  ];
  for (const [label, owned] of ownedSets) {
    it(label, async () => {
      const u = await playerOwning(owned);
      const eligible = eligibleCrateCosmetics(owned);
      for (let k = 0; k <= DRAWS; k++) {
        const draw = k / DRAWS;
        expect(await sqlPick(u, draw), `draw ${draw}`).toBe(pickCrateReward(eligible, draw)?.id ?? null);
      }
      // the band edges exactly
      for (const draw of [0, 0.5, 0.8, 0.95, 0.4999999, 0.7999999, 0.9499999, 0.9999999]) {
        expect(await sqlPick(u, draw), `edge ${draw}`).toBe(pickCrateReward(eligible, draw)?.id ?? null);
      }
    }, 60_000);
  }

  it('every rarity band of a fresh player gives its own rarity (the 50 / 30 / 15 / 5 split, on Postgres)', async () => {
    const u = await playerOwning([]);
    const rarity = Object.fromEntries(COSMETICS.map((c) => [c.id, c.rarity]));
    const counts: Record<string, number> = {};
    for (let k = 0; k < 200; k++) {
      const id = (await sqlPick(u, (k + 0.5) / 200))!;
      counts[rarity[id]!] = (counts[rarity[id]!] ?? 0) + 1;
    }
    expect(COSMETIC_RARITIES.map((r) => counts[r])).toEqual([100, 60, 30, 10]);
  }, 60_000);
});

describe('open_crate under the fixed odds', () => {
  it('opens into an eligible item, stamps roll_version 2, and a second open is already_opened', async () => {
    const u = await playerOwning([]);
    const c = await sealedCrate(u);
    const first = await open(u, c);
    expect(first.status).toBe('opened');
    expect(crateIds).toContain(first.rewardId);
    const row = await one<{ roll_version: number; reward_cosmetic_id: string }>('select roll_version, reward_cosmetic_id from public.loot_crates where crate_id = $1', [c]);
    expect(row).toEqual({ roll_version: CRATE_ROLL_VERSION, reward_cosmetic_id: first.rewardId });
    expect(CRATE_ROLL_VERSION).toBe(2);
    const second = await open(u, c);
    expect(second).toMatchObject({ status: 'already_opened', rewardId: first.rewardId });
  });

  it('never gives an owned item: with one item left, the crate gives exactly it; then pool_exhausted leaves the next crate sealed', async () => {
    const keep = 'title_kingbreaker';
    const u = await playerOwning(crateIds.filter((id) => id !== keep));
    await db.query("insert into public.loot_crates (user_id, earned_level) values ($1, 2)", [u]);
    const got = await open(u, await sealedCrate(u));
    expect(got).toMatchObject({ status: 'opened', rewardId: keep });
    const last = await sealedCrate(u);
    const exhausted = await open(u, last);
    expect(exhausted).toMatchObject({ status: 'pool_exhausted', rewardId: null, sealedRemaining: 1 });
    expect((await one<{ state: string }>('select state from public.loot_crates where crate_id = $1', [last])).state).toBe('sealed');
    expect(await sqlPick(u, 0.5)).toBeNull();
    expect((await ownedIds(u)).filter((id) => id === keep)).toHaveLength(1);
  });

  it('the admin_off kill switch keeps an item out of EVERY draw (its rarity share goes to the rest of the rarity); restore brings it back', async () => {
    const u = await playerOwning([]);
    const target = 'skin_blackbelt_4';
    await db.exec(`update public.cosmetic_catalog set admin_off = true where cosmetic_id = '${target}';`);
    try {
      const eligible = eligibleCrateCosmetics([target]);
      for (let k = 0; k <= 200; k++) {
        const p = await sqlPick(u, k / 200);
        expect(p).not.toBe(target);
        expect(p).toBe(pickCrateReward(eligible, k / 200)!.id);
      }
    } finally {
      await db.exec(`update public.cosmetic_catalog set admin_off = false where cosmetic_id = '${target}';`);
    }
    expect(await sqlPick(u, 0)).toBe(pickCrateReward(eligibleCrateCosmetics([]), 0)!.id);
  }, 60_000);

  it('keeps the per-user lock and the crate row lock; one random() per opening', () => {
    const at = ODDS.indexOf('create or replace function public.open_crate(');
    const body = ODDS.slice(at, ODDS.indexOf('$$;', ODDS.indexOf('begin', at)));
    const lock = "pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0))";
    expect(body.indexOf(lock)).toBeGreaterThan(0);
    expect(body.indexOf(lock)).toBeLessThan(body.indexOf('from public.loot_crates where crate_id = p_crate_id'));
    expect(body).toMatch(/where crate_id = p_crate_id and user_id = p_user for update;/);
    expect(body).toMatch(/where crate_id = p_crate_id and state = 'sealed'/);
    expect(body.match(/random\(\)/g)).toHaveLength(1);
  });

  it('is idempotent: re-running the file changes no crate, ownership or catalog row, and the pick is unchanged', async () => {
    const u = await playerOwning(['title_wanderer']);
    const snap = async () => [
      (await db.query('select crate_id, state, reward_cosmetic_id, roll_version from public.loot_crates order by 1')).rows,
      (await db.query('select user_id, cosmetic_id from public.player_cosmetics order by 1, 2')).rows,
      (await db.query('select * from public.cosmetic_catalog order by 1')).rows,
    ];
    const before = await snap();
    const picks = await Promise.all([0.1, 0.6, 0.9, 0.97].map((d) => sqlPick(u, d)));
    await db.exec(ODDS);
    await db.exec(ODDS);
    expect(await snap()).toEqual(before);
    expect(await Promise.all([0.1, 0.6, 0.9, 0.97].map((d) => sqlPick(u, d)))).toEqual(picks);
    expect(await sync()).toBe('unchanged');
  });

  it('clients can never call the pick, the pool or open_crate', async () => {
    for (const sig of ['public.progression_crate_pick(uuid, double precision)', 'public.progression_crate_pool(uuid)', 'public.open_crate(uuid, uuid)']) {
      const acl = await one<{ anon: boolean; auth: boolean; svc: boolean }>(
        `select has_function_privilege('anon', '${sig}', 'execute') as anon, has_function_privilege('authenticated', '${sig}', 'execute') as auth, has_function_privilege('service_role', '${sig}', 'execute') as svc`);
      expect(acl, sig).toEqual({ anon: false, auth: false, svc: true });
    }
  });
});
