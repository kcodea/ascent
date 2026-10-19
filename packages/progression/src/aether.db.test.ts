import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_AETHER_ECONOMY, aetherForSettlement, milestoneLevelsThrough, type CrateTier } from './aether';
import { atOrAbove, eligibleForCrate, pickTieredCrateReward, quoteCrate } from './crateShop';
import { COSMETICS, COSMETIC_INDEX, catalogHash, catalogSyncPayload, parseOpenCrateResult, type CosmeticCategory, type CosmeticRarity } from './cosmetics';
import { levelOfXp, parseProgressionProfile, parseProgressionResult, versusRunId, xpAtLevelStart, xpForSettlement } from './rules';
import { parseGauntletClearResult } from './gauntlet';

/**
 * THE AETHER WALLET AND THE CRATE SHOP, EXECUTED (owner decisions 2026-10-18; spec
 * docs/superpowers/specs/2026-10-18-aether-crate-shop-design.md). PGlite runs the progression migrations in production
 * order, then 2026-10-18-aether.sql, syncs the code catalog and checks, on real Postgres:
 *
 *   the seeded `aether_config` IS `DEFAULT_AETHER_ECONOMY`; the tiered pick (`progression_tiered_crate_pick`) chooses
 *   EXACTLY what the TS `pickTieredCrateReward` chooses, draw for draw, across floors and focuses; `aether_quote` agrees
 *   with `quoteCrate`; `buy_crate` charges, opens and records once per request id, refuses one Aether short, a stale
 *   price, a bad focus and a sold-out tier, and never rolls below the floor; a milestone crate can be focused at open
 *   for the Legendary fee; old crates (floor Common, no focus) open exactly as before, through the 2-argument call; the
 *   switches refuse; the guard keeps floor and price immutable; clients can call none of it. EARNING (sections 11-14):
 *   a Ranked / Versus settlement pays exactly `aetherForSettlement` once (a replay is deduped), Practice pays nothing,
 *   milestone Legendary crates replace level crates (self-healing, the Welcome Crate kept), the switch off keeps
 *   today's crate per level, a Gauntlet first clear pays 200 once and grants no crate, the profile carries the balance,
 *   and `aether_rollout()` backdates the milestone crates idempotently. PGlite is one connection,
 *   so concurrency is proven the way the other db tests prove it: the per-user advisory lock, the row lock and the
 *   unique keys (ledger (user, reason, source), one crate per source).
 */
const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = ['2026-09-27-account-progression.sql', '2026-09-28-progression-crates.sql', '2026-09-28-progression-skins.sql', '2026-09-28-achievements.sql', '2026-09-29-crate-fixed-rarity-odds.sql', '2026-09-29-crate-uniform-within-rarity.sql', '2026-09-29-gauntlet-progress.sql', '2026-10-02-ancient-rarity.sql', '2026-10-03-placement-xp.sql', '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql', '2026-10-14-versus-progression.sql'];
/** The emote file's starter-acquisition check only (2026-10-13): the code catalog holds STARTER emotes, which the
 *  catalog sync would otherwise refuse. Loaded right before the Aether file, as the other db tests load it. */
const STARTER_CHECK = ((t: string): string => t.slice(0, t.indexOf('-- ── 2. equip_cosmetic')))(read('2026-10-13-emotes.sql'));
const AETHER = read('2026-10-18-aether.sql');

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
  -- Hosted Supabase's default privileges: EXECUTE on every new function in public to all three API roles, so the ACL
  -- test below proves the migration's revokes, not the stub's silence.
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;
// Supabase grants table privileges to the API roles by default; RLS is what stands between them and the rows.
const API_GRANTS = `grant select, insert, update, delete on all tables in schema public to anon, authenticated;`;

let db: PGlite;
let userSeq = 0;
let reqSeq = 0;

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
/** A fresh request id (a lowercase UUID, as the client sends). */
const rid = (): string => { reqSeq++; return `22222222-0000-4000-8000-${String(reqSeq).padStart(12, '0')}`; };
async function grant(u: string, n: number): Promise<number> {
  return (await one<{ b: number }>("select public.aether_apply($1, $2, 'grant', gen_random_uuid()::text) as b", [u, n])).b;
}
async function balance(u: string): Promise<number> {
  return (await db.query<{ balance: number }>('select balance from public.aether_wallets where user_id = $1', [u])).rows[0]?.balance ?? 0;
}
async function ledger(u: string, reason?: string): Promise<Array<{ delta: number; balance_after: number; reason: string; source_id: string }>> {
  return (await db.query<{ delta: number; balance_after: number; reason: string; source_id: string }>(
    'select delta, balance_after, reason, source_id from public.aether_ledger where user_id = $1 and ($2::text is null or reason = $2) order by id', [u, reason ?? null])).rows;
}
async function crateCount(u: string): Promise<number> {
  return (await one<{ n: number }>('select count(*)::int as n from public.loot_crates where user_id = $1', [u])).n;
}
type BuyJson = { status: string; rewardId: string | null; aether: number; quote: Record<string, unknown> | null; crate: Record<string, unknown>; sealedRemaining: number; profile: unknown };
async function buy(u: string, tier: string, focus: string[] | null, expected: number, requestId: string): Promise<BuyJson> {
  return (await one<{ j: BuyJson }>('select public.buy_crate($1, $2, $3::text[], $4, $5::uuid) as j', [u, tier, focus, expected, requestId])).j;
}
async function sqlPick(u: string, draw: number, floor: string, focus: string[] | null): Promise<string | null> {
  return (await one<{ p: string | null }>('select public.progression_tiered_crate_pick($1, $2::double precision, $3, $4::text[]) as p', [u, draw, floor, focus])).p;
}
async function milestoneCrate(u: string, level = 10): Promise<string> {
  return (await one<{ crate_id: string }>(
    "insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity) values ($1, null, $2, $2, 'legendary') returning crate_id",
    [u, `milestone:${level}`])).crate_id;
}
async function levelCrate(u: string, level = 1): Promise<string> {
  return (await one<{ crate_id: string }>('insert into public.loot_crates (user_id, earned_level) values ($1, $2) returning crate_id', [u, level])).crate_id;
}

const crateItems = COSMETICS.filter((c) => c.acquisition.type === 'crate');
const idsAtOrAbove = (floor: CosmeticRarity): string[] => crateItems.filter((c) => atOrAbove(c.rarity, floor)).map((c) => c.id);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const f of FILES) { await db.exec(read(f)); await db.exec(API_GRANTS); }
  await db.exec(STARTER_CHECK);
  await db.exec(AETHER);
  await db.exec(API_GRANTS);
  const c = catalogSyncPayload();
  await db.query('select public.sync_cosmetic_catalog($1::jsonb, $2)', [JSON.stringify(c), catalogHash(c)]);
  await db.exec('update public.progression_config set crates_enabled = true, aether_enabled = true where id = 1;');
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('the economy and the tiered roll mirror the TS', () => {
  it('the seeded config is the TS default', async () => {
    const row = await one<{ economy: unknown }>('select economy from public.aether_config where id = 1');
    expect(row.economy).toEqual(JSON.parse(JSON.stringify(DEFAULT_AETHER_ECONOMY)));
  });

  it('the Aether switch ships OFF (a fresh database sells nothing until the owner flips it)', async () => {
    const col = await one<{ d: string | null }>(
      "select column_default as d from information_schema.columns where table_schema = 'public' and table_name = 'progression_config' and column_name = 'aether_enabled'");
    expect(col.d).toBe('false');
  });

  const everyLegendary = crateItems.filter((c) => c.rarity === 'legendary').map((c) => c.id);
  const ownedSets: Array<[string, string[]]> = [['a fresh player', []], ['every Legendary owned (Legendary draws fall to Ancient or Epic)', everyLegendary]];
  for (const [label, owned] of ownedSets) {
    for (const floor of ['common', 'epic', 'legendary'] as const) {
      for (const focus of [null, ['card_plate']] as Array<CosmeticCategory[] | null>) {
        it(`tiered pick equals the TS pick draw for draw: ${label}, floor ${floor}, focus ${focus ? focus.join('+') : 'none'}`, async () => {
          const u = await newUser(owned);
          const eligible = eligibleForCrate(owned, floor, focus);
          for (let k = 0; k <= 200; k++) {
            const draw = k / 200;
            expect(await sqlPick(u, draw, floor, focus), `draw ${draw}`).toBe(pickTieredCrateReward(eligible, floor, draw)?.id ?? null);
          }
        }, 60_000);
      }
    }
  }

  it('a Common-floor, unfocused tiered pick IS the version-4 pick (old crates roll exactly as before)', async () => {
    const u = await newUser(['title_wanderer']);
    for (let k = 0; k <= 100; k++) {
      const draw = k / 100;
      const v4 = (await one<{ p: string | null }>('select public.progression_crate_pick($1, $2::double precision) as p', [u, draw])).p;
      expect(await sqlPick(u, draw, 'common', null), `draw ${draw}`).toBe(v4);
    }
  }, 60_000);

  it('aether_quote agrees with quoteCrate (tier, floor, canonical focus, fee, total, remaining)', async () => {
    const owned = crateItems.filter((c) => c.category === 'announcer').map((c) => c.id).slice(0, 1);
    const u = await newUser(owned);
    const cases: Array<[CrateTier, string[] | null, boolean]> = [
      ['standard', null, false], ['epic', ['card_plate'], false], ['epic', ['title', 'card_plate', 'title'], false],
      ['rare', ['hero_skin', 'minion_skin', 'title'], false], ['ancient', null, false], ['standard', ['card_plate'], true],
    ];
    for (const [tier, focus, milestone] of cases) {
      const ts = quoteCrate({ tier, focus, owned, milestone });
      const sql = (await one<{ q: unknown }>('select public.aether_quote($1, $2, $3::text[], $4) as q', [u, tier, focus, milestone])).q;
      expect(sql, `${tier} ${focus} ${milestone}`).toEqual(JSON.parse(JSON.stringify(ts)));
    }
    // ticking every available category is no focus, and costs nothing
    const all = [...new Set(eligibleForCrate(owned, 'epic', null).map((c) => c.category))];
    const full = (await one<{ q: { focus: unknown; fee: number } }>('select public.aether_quote($1, $2, $3::text[], false) as q', [u, 'epic', all])).q;
    expect(full).toMatchObject({ focus: null, fee: 0 });
    // a retuned price whose fee is fractional rounds DOWN in both copies (333 x 60% = 199.8 → 199)
    const retuned = { ...DEFAULT_AETHER_ECONOMY, cratePrice: { ...DEFAULT_AETHER_ECONOMY.cratePrice, epic: 333 } };
    await db.query('update public.aether_config set economy = $1::jsonb where id = 1', [JSON.stringify(retuned)]);
    try {
      const sql = (await one<{ q: unknown }>("select public.aether_quote($1, 'epic', array['title', 'card_plate'], false) as q", [u])).q;
      expect(sql).toEqual(JSON.parse(JSON.stringify(quoteCrate({ tier: 'epic', focus: ['title', 'card_plate'], owned, economy: retuned }))));
      expect(sql).toMatchObject({ fee: 199, total: 532 });
    } finally {
      await db.query('update public.aether_config set economy = $1::jsonb where id = 1', [JSON.stringify(DEFAULT_AETHER_ECONOMY)]);
    }
    expect(await raises('select public.aether_quote($1, $2, null, false)', [u, 'mythic'])).toMatch(/bad_tier/);
    expect(await raises("select public.aether_quote($1, 'epic', array['nope'], false)", [u])).toMatch(/bad_focus/);
  });
});

describe('buy_crate', () => {
  it('buy charges, opens and records', async () => {
    const u = await newUser();
    expect(await grant(u, 400)).toBe(400);
    const r = rid();
    const out = await buy(u, 'epic', null, 400, r);
    expect(out.status).toBe('opened');
    expect(out.aether).toBe(0);
    expect(atOrAbove(COSMETIC_INDEX[out.rewardId!]!.rarity, 'epic')).toBe(true);
    expect(out.quote).toMatchObject({ tier: 'epic', floor: 'epic', focus: null, crate: 400, fee: 0, total: 400 });
    expect(await ledger(u, 'crate_purchase')).toEqual([{ delta: -400, balance_after: 0, reason: 'crate_purchase', source_id: r }]);
    const row = await one<{ price_paid: number; floor_rarity: string; focus_categories: string[] | null; source: string; earned_level: number | null; roll_version: number; state: string }>(
      'select price_paid, floor_rarity, focus_categories, source, earned_level, roll_version, state from public.loot_crates where user_id = $1', [u]);
    expect(row).toEqual({ price_paid: 400, floor_rarity: 'epic', focus_categories: null, source: `shop:${r}`, earned_level: null, roll_version: 5, state: 'opened' });
    // the client's parser reads the crate (a shop source, floor Epic) and the result
    const parsed = parseOpenCrateResult(out)!;
    expect(parsed.crate).toMatchObject({ source: `shop:${r}`, floor: 'epic', state: 'opened', rewardId: out.rewardId });
    expect(await one('select 1 as ok from public.player_cosmetics where user_id = $1 and cosmetic_id = $2', [u, out.rewardId])).toEqual({ ok: 1 });
  });

  it('buy_crate is idempotent per request id', async () => {
    const u = await newUser();
    await grant(u, 500);
    const r = rid();
    const first = await buy(u, 'epic', null, 400, r);
    const again = await buy(u, 'epic', null, 400, r);
    expect(again.status).toBe('already_opened');
    expect(again.rewardId).toBe(first.rewardId);
    expect(again.aether).toBe(100);
    expect(await balance(u)).toBe(100);
    expect(await ledger(u, 'crate_purchase')).toHaveLength(1);
    expect(await crateCount(u)).toBe(1);
  });

  it('exact balance buys, one short refuses', async () => {
    const u = await newUser();
    await grant(u, 799);
    expect(await raises('select public.buy_crate($1, $2, $3::text[], $4, $5::uuid)', [u, 'epic', ['card_plate'], 800, rid()])).toMatch(/insufficient_aether/);
    expect(await crateCount(u)).toBe(0);
    expect(await balance(u)).toBe(799);
    expect(await ledger(u, 'crate_purchase')).toHaveLength(0);
    await grant(u, 1);
    const out = await buy(u, 'epic', ['card_plate'], 800, rid());
    expect(out.status).toBe('opened');
    expect(out.aether).toBe(0);
    expect(await balance(u)).toBe(0);
    expect(COSMETIC_INDEX[out.rewardId!]!.category).toBe('card_plate');
    expect(out.quote).toMatchObject({ focus: ['card_plate'], crate: 400, fee: 400, total: 800 });
    const row = await one<{ focus_categories: string[]; price_paid: number }>('select focus_categories, price_paid from public.loot_crates where user_id = $1', [u]);
    expect(row).toEqual({ focus_categories: ['card_plate'], price_paid: 800 });
  });

  it('stale price is refused', async () => {
    const u = await newUser();
    await grant(u, 1000);
    await db.exec(`update public.aether_config set economy = jsonb_set(economy, '{cratePrice,epic}', '500') where id = 1;`);
    try {
      expect(await raises('select public.buy_crate($1, $2, null, $3, $4::uuid)', [u, 'epic', 400, rid()])).toMatch(/price_changed/);
      expect(await ledger(u, 'crate_purchase')).toHaveLength(0);
      expect(await crateCount(u)).toBe(0);
      expect(await balance(u)).toBe(1000);
    } finally {
      await db.query('update public.aether_config set economy = $1::jsonb where id = 1', [JSON.stringify(DEFAULT_AETHER_ECONOMY)]);
    }
    expect((await buy(u, 'epic', null, 400, rid())).status).toBe('opened');
  });

  it('an unreadable price or fee rung is aether_config_missing: never a cast error, a rounded guess or a charge', async () => {
    const u = await newUser();
    await grant(u, 5000);
    // [the economy edit, the tier, the focus] -- a fractional price, a string price, a garbled fee rung, a non-array ladder
    const cases: Array<[string, string, string[] | null]> = [
      [`jsonb_set(economy, '{cratePrice,epic}', '400.5')`, 'epic', null],
      [`jsonb_set(economy, '{cratePrice,epic}', '"lots"')`, 'epic', null],
      [`jsonb_set(economy, '{focusFeePercent,0}', '"x"')`, 'epic', ['card_plate']],
      [`jsonb_set(economy, '{focusFeePercent,0}', '99.9')`, 'epic', ['card_plate']],
      [`jsonb_set(economy, '{focusFeePercent}', '5')`, 'epic', ['card_plate']],
    ];
    try {
      for (const [edit, tier, focus] of cases) {
        await db.exec(`update public.aether_config set economy = ${edit} where id = 1;`);
        expect(await raises('select public.aether_quote($1, $2, $3::text[], false)', [u, tier, focus]), edit).toMatch(/aether_config_missing/);
        expect(await raises('select public.buy_crate($1, $2, $3::text[], $4, $5::uuid)', [u, tier, focus, 800, rid()]), edit).toMatch(/aether_config_missing/);
        await db.query('update public.aether_config set economy = $1::jsonb where id = 1', [JSON.stringify(DEFAULT_AETHER_ECONOMY)]);
      }
      expect(await ledger(u, 'crate_purchase')).toHaveLength(0);
      expect(await crateCount(u)).toBe(0);
      expect(await balance(u)).toBe(5000);
    } finally {
      await db.query('update public.aether_config set economy = $1::jsonb where id = 1', [JSON.stringify(DEFAULT_AETHER_ECONOMY)]);
    }
  });

  it('bad focus is refused', async () => {
    const u = await newUser();
    await grant(u, 5000);
    // no Ancient title exists, so a title focus at the Ancient floor names an unavailable category
    expect(await raises("select public.buy_crate($1, 'ancient', array['title'], 1800, $2::uuid)", [u, rid()])).toMatch(/bad_focus/);
    expect(await raises("select public.buy_crate($1, 'epic', array['nope'], 800, $2::uuid)", [u, rid()])).toMatch(/bad_focus/);
    expect(await raises("select public.buy_crate($1, 'mythic', null, 100, $2::uuid)", [u, rid()])).toMatch(/bad_tier/);
    expect(await raises("select public.buy_crate($1, 'epic', null, null, $2::uuid)", [u, rid()])).toMatch(/bad_price/);
    expect(await raises("select public.buy_crate($1, 'epic', null, 400, null)", [u])).toMatch(/bad_request_id/);
    expect(await balance(u)).toBe(5000);
    expect(await crateCount(u)).toBe(0);
  });

  it('never falls below the floor', async () => {
    const u = await newUser(idsAtOrAbove('legendary'));
    await grant(u, 600);
    expect(await raises("select public.buy_crate($1, 'legendary', null, 600, $2::uuid)", [u, rid()])).toMatch(/sold_out/);
    const m = await milestoneCrate(u);
    const out = parseOpenCrateResult((await one<{ j: unknown }>('select public.open_crate($1, $2) as j', [u, m])).j)!;
    expect(out).toMatchObject({ status: 'pool_exhausted', rewardId: null });
    expect((await one<{ state: string }>('select state from public.loot_crates where crate_id = $1', [m])).state).toBe('sealed');
    // a focused open of the exhausted milestone crate is also pool_exhausted, and charges nothing
    const focused = (await one<{ j: { status: string } }>("select public.open_crate($1, $2, array['card_plate'], 600) as j", [u, m])).j;
    expect(focused.status).toBe('pool_exhausted');
    expect(await balance(u)).toBe(600);
    expect(await ledger(u, 'crate_focus')).toHaveLength(0);
    // a tiered pick below an empty floor is null, never a Common
    expect(await sqlPick(u, 0, 'legendary', null)).toBeNull();
    // and an Epic crate still sells (its floor has items) and gives an Epic, never anything below
    await grant(u, 400);
    const epic = await buy(u, 'epic', null, 400, rid());
    expect(COSMETIC_INDEX[epic.rewardId!]!.rarity).toBe('epic');
  });

  it('switch off', async () => {
    const u = await newUser();
    await grant(u, 400);
    await db.exec('update public.progression_config set aether_enabled = false where id = 1;');
    try {
      expect(await raises("select public.buy_crate($1, 'epic', null, 400, $2::uuid)", [u, rid()])).toMatch(/aether_disabled/);
      const m = await milestoneCrate(u);
      expect(await raises("select public.open_crate($1, $2, array['card_plate'], 600)", [u, m])).toMatch(/aether_disabled/);
    } finally {
      await db.exec('update public.progression_config set aether_enabled = true where id = 1;');
    }
    await db.exec('update public.progression_config set crates_enabled = false where id = 1;');
    try {
      expect(await raises("select public.buy_crate($1, 'epic', null, 400, $2::uuid)", [u, rid()])).toMatch(/crates_disabled/);
    } finally {
      await db.exec('update public.progression_config set crates_enabled = true where id = 1;');
    }
    expect(await balance(u)).toBe(400);
    expect(await ledger(u, 'crate_purchase')).toHaveLength(0);
  });
});

describe('open_crate: the floor, the milestone focus, and old crates', () => {
  it('milestone focus charges the Legendary fee', async () => {
    const u = await newUser();
    await grant(u, 600);
    const m = await milestoneCrate(u);
    const out = (await one<{ j: { status: string; rewardId: string; aether: number } }>("select public.open_crate($1, $2, array['card_plate'], 600) as j", [u, m])).j;
    expect(out.status).toBe('opened');
    expect(COSMETIC_INDEX[out.rewardId]!.category).toBe('card_plate');
    expect(atOrAbove(COSMETIC_INDEX[out.rewardId]!.rarity, 'legendary')).toBe(true);
    expect(out.aether).toBe(0);
    expect(await balance(u)).toBe(0);
    expect(await ledger(u, 'crate_focus')).toEqual([{ delta: -600, balance_after: 0, reason: 'crate_focus', source_id: m }]);
    const row = await one<{ focus_categories: string[]; roll_version: number; price_paid: number | null }>('select focus_categories, roll_version, price_paid from public.loot_crates where crate_id = $1', [m]);
    expect(row).toEqual({ focus_categories: ['card_plate'], roll_version: 5, price_paid: null });
    // a replay is already_opened and charges nothing more
    const again = (await one<{ j: { status: string; rewardId: string } }>("select public.open_crate($1, $2, array['card_plate'], 600) as j", [u, m])).j;
    expect(again).toMatchObject({ status: 'already_opened', rewardId: out.rewardId });
    expect(await ledger(u, 'crate_focus')).toHaveLength(1);
    // a non-milestone crate with a focus is refused
    const lc = await levelCrate(u, 2);
    expect(await raises("select public.open_crate($1, $2, array['card_plate'], 600)", [u, lc])).toMatch(/focus_not_allowed/);
  });

  it('a milestone focus refuses a stale fee and too little Aether, and leaves the crate sealed', async () => {
    const u = await newUser();
    await grant(u, 599);
    const m = await milestoneCrate(u);
    expect(await raises("select public.open_crate($1, $2, array['card_plate'], 500)", [u, m])).toMatch(/price_changed/);
    expect(await raises("select public.open_crate($1, $2, array['card_plate'], 600)", [u, m])).toMatch(/insufficient_aether/);
    expect(await raises("select public.open_crate($1, $2, array['card_plate'], null)", [u, m])).toMatch(/bad_price/);
    expect(await raises("select public.open_crate($1, $2, array['nope'], 600)", [u, m])).toMatch(/bad_focus/);
    expect((await one<{ state: string; focus_categories: string[] | null }>('select state, focus_categories from public.loot_crates where crate_id = $1', [m])))
      .toEqual({ state: 'sealed', focus_categories: null });
    expect(await balance(u)).toBe(599);
    // unfocused, the milestone crate is free and rolls Legendary or better
    const free = (await one<{ j: { status: string; rewardId: string } }>('select public.open_crate($1, $2) as j', [u, m])).j;
    expect(free.status).toBe('opened');
    expect(atOrAbove(COSMETIC_INDEX[free.rewardId]!.rarity, 'legendary')).toBe(true);
    expect(await balance(u)).toBe(599);
  });

  it('old crates open as before', async () => {
    const u = await newUser();
    const c = await levelCrate(u, 1);
    const out = parseOpenCrateResult((await one<{ j: unknown }>('select public.open_crate($1, $2) as j', [u, c])).j)!;
    expect(out.status).toBe('opened');
    expect(crateItems.map((x) => x.id)).toContain(out.rewardId);
    expect(out.crate.floor).toBe('common');
    expect(out.crate.focus).toBeUndefined();
    const named = (await one<{ j: { status: string; aether: number } }>('select public.open_crate(p_user => $1, p_crate_id => $2) as j', [u, c])).j;
    expect(named).toMatchObject({ status: 'already_opened', aether: 0 });
    // the 2-argument overload is gone, so the named 2-argument call cannot be ambiguous
    expect((await one<{ n: number }>("select count(*)::int as n from pg_proc where proname = 'open_crate'")).n).toBe(1);
    // a full-pool roll: across many level crates a Common-floor crate gives Commons too
    const v = await newUser();
    const rarities = new Set<string>();
    for (let lvl = 1; lvl <= 25; lvl++) {
      const id = await levelCrate(v, lvl);
      const r = (await one<{ j: { rewardId: string } }>('select public.open_crate($1, $2) as j', [v, id])).j;
      rarities.add(COSMETIC_INDEX[r.rewardId]!.rarity);
    }
    expect(rarities.has('common')).toBe(true);
  });

  it('the guard keeps floor and price immutable, and the focus moves only as the crate opens', async () => {
    const u = await newUser();
    const m = await milestoneCrate(u);
    expect(await raises("update public.loot_crates set floor_rarity = 'common' where crate_id = $1", [m])).toMatch(/crate_identity_is_immutable/);
    expect(await raises('update public.loot_crates set price_paid = 1 where crate_id = $1', [m])).toMatch(/crate_identity_is_immutable/);
    expect(await raises("update public.loot_crates set focus_categories = array['title'] where crate_id = $1", [m])).toMatch(/crate_identity_is_immutable/);
    expect(await raises("update public.loot_crates set floor_rarity = 'mythic' where crate_id = $1", [m])).toMatch(/check|immutable/);
  });
});

describe('the wallet, the ledger and the grants', () => {
  it('aether_apply: a replayed source changes nothing; the balance never goes negative', async () => {
    const u = await newUser();
    expect(await one<{ b: number }>("select public.aether_apply($1, 50, 'ranked', 'run-1') as b", [u])).toEqual({ b: 50 });
    expect(await one<{ b: number }>("select public.aether_apply($1, 50, 'ranked', 'run-1') as b", [u])).toEqual({ b: 50 });
    expect(await one<{ b: number }>("select public.aether_apply($1, 25, 'versus', 'run-1') as b", [u])).toEqual({ b: 75 });
    expect(await raises("select public.aether_apply($1, -76, 'crate_purchase', 'x')", [u])).toMatch(/insufficient_aether/);
    expect(await raises("select public.aether_apply($1, 1, 'gift', 'x')", [u])).toMatch(/check|bad/);
    expect(await ledger(u)).toEqual([
      { delta: 50, balance_after: 50, reason: 'ranked', source_id: 'run-1' },
      { delta: 25, balance_after: 75, reason: 'versus', source_id: 'run-1' },
    ]);
  });

  it('owners read their own wallet and ledger; everyone reads the config; nobody writes', async () => {
    const u = await newUser();
    const other = await newUser();
    await grant(u, 10);
    await grant(other, 20);
    await db.exec('set role authenticated;');
    try {
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [u]);
      expect((await db.query('select balance from public.aether_wallets')).rows).toEqual([{ balance: 10 }]);
      expect((await db.query('select delta from public.aether_ledger')).rows).toEqual([{ delta: 10 }]);
      expect((await db.query('select id from public.aether_config')).rows).toEqual([{ id: 1 }]);
      await db.query('update public.aether_wallets set balance = 9999');
      await db.query('update public.aether_config set economy = \'{}\'::jsonb');
    } finally {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
    }
    expect(await balance(u)).toBe(10);
    expect((await one<{ economy: unknown }>('select economy from public.aether_config where id = 1')).economy).toEqual(JSON.parse(JSON.stringify(DEFAULT_AETHER_ECONOMY)));
    await db.exec('set role anon;');
    try {
      expect((await db.query('select id from public.aether_config')).rows).toEqual([{ id: 1 }]);
      expect((await db.query('select * from public.aether_wallets')).rows).toEqual([]);
    } finally {
      await db.exec('reset role;');
    }
  });

  it('clients can call none of it; only the two writers belong to the service role, every helper is internal (even under the Supabase default EXECUTE grants)', async () => {
    const sigs: Array<[string, boolean]> = [
      ['public.buy_crate(uuid, text, text[], integer, uuid)', true],
      ['public.open_crate(uuid, uuid, text[], integer)', true],
      ['public.progression_crate_json(public.loot_crates)', true],
      ['public.aether_quote(uuid, text, text[], boolean)', false],
      ['public.progression_tiered_crate_pool(uuid, text, text[])', false],
      ['public.progression_tiered_crate_pick(uuid, double precision, text, text[])', false],
      ['public.aether_apply(uuid, integer, text, text)', false],
    ];
    for (const [sig, svc] of sigs) {
      const acl = await one<{ anon: boolean; auth: boolean; svc: boolean }>(
        `select has_function_privilege('anon', '${sig}', 'execute') as anon, has_function_privilege('authenticated', '${sig}', 'execute') as auth, has_function_privilege('service_role', '${sig}', 'execute') as svc`);
      expect(acl, sig).toEqual({ anon: false, auth: false, svc });
    }
  });

  it('is idempotent: re-running the file changes no wallet, ledger, crate or config row', async () => {
    const u = await newUser();
    await grant(u, 300);
    await buy(u, 'standard', null, 100, rid());
    await db.query("update public.aether_config set economy = jsonb_set(economy, '{version}', '2') where id = 1");
    const snap = async () => [
      (await db.query('select * from public.aether_wallets order by user_id')).rows,
      (await db.query('select * from public.aether_ledger order by id')).rows,
      (await db.query('select crate_id, state, reward_cosmetic_id, roll_version, floor_rarity, focus_categories, price_paid from public.loot_crates order by 1')).rows,
      (await db.query('select economy from public.aether_config')).rows,
      (await db.query('select aether_enabled, crates_enabled from public.progression_config')).rows,
    ];
    const before = await snap();
    await db.exec(AETHER);
    await db.exec(AETHER);
    expect(await snap()).toEqual(before);
    await db.query('update public.aether_config set economy = $1::jsonb where id = 1', [JSON.stringify(DEFAULT_AETHER_ECONOMY)]);
  });
});

// ── Sections 11-14: earning, milestone crates, the profile balance, the rollout ─────────────────────────────

type SettleJson = { status: string; result: Record<string, unknown>; profile: Record<string, unknown> };
let runSeq = 0;
let matchSeq = 0;
async function settleRanked(u: string, placement: number): Promise<{ runId: string; out: SettleJson }> {
  runSeq++;
  const runId = `aether-run-${runSeq}`;
  await db.query('insert into public.rank_results (user_id, run_id, placement, seed) values ($1, $2, $3, 1)', [u, runId, placement]);
  return { runId, out: (await one<{ j: SettleJson }>("select public.settle_progression($1, 'ranked', $2, null, false, 1, null) as j", [u, runId])).j };
}
async function resettle(u: string, mode: string, runId: string, sourceId: number | null = null): Promise<SettleJson> {
  return (await one<{ j: SettleJson }>('select public.settle_progression($1, $2, $3, $4, false, 1, null) as j', [u, mode, runId, sourceId])).j;
}
async function settlePractice(u: string, placement: number): Promise<SettleJson> {
  const id = (await one<{ id: number }>(
    'insert into public.practice_games (user_id, hero_id, placement, config) values ($1, $2, $3, $4::jsonb) returning id::int as id',
    [u, 'warden', placement, JSON.stringify({ health: 'normal', timeMult: '1' })])).id;
  return resettle(u, 'practice', `practice:${id}`, id);
}
/** A completed Versus match between `p1` and `p2` (7 rounds fought); `winner` null = abandoned with no winner. */
async function versusMatch(p1: string, p2: string, winner: 'p1' | 'p2' | null): Promise<string> {
  matchSeq++;
  const id = `33333333-0000-0000-0000-${String(matchSeq).padStart(12, '0')}`;
  await db.query(
    `insert into public.versus_matches (id, seed, set_id, content_revision, protocol, phase, round, p1_user, p2_user, p1_name, p2_name, p1_hero, p2_hero, winner_seat, end_reason, completed_at)
     values ($1, 1, 'set3', 'x', 1, 'complete', 7, $2, $3, 'A', 'B', 'warden', 'indy', $4, $5, now())`,
    [id, p1, p2, winner, winner ? 'hearts' : 'abandoned']);
  for (let r = 1; r <= 7; r++) {
    await db.query(`insert into public.versus_rounds (match_id, round, chair, outcome, heart_lost_by, p1_result, p2_result, digest, p1_hearts, p2_hearts)
      values ($1, $2, 'p1', 'p1', 'p2', '{}', '{}', 'd', 7, 7)`, [id, r]);
  }
  return id;
}
type CrateLine = { crate_id: string; earned_level: number | null; source: string | null; floor_rarity: string };
async function crates(u: string): Promise<CrateLine[]> {
  return (await db.query<CrateLine>(
    'select crate_id, earned_level, source, floor_rarity from public.loot_crates where user_id = $1 order by earned_level nulls last, source collate "C"', [u])).rows;
}
/** An account seeded just below Level 21 (Ruling R2: one real settlement cannot climb 0 XP to Level 21), not yet enrolled. */
async function nearLevel21(): Promise<string> {
  const u = await newUser();
  const xp = xpAtLevelStart(21) - 50;
  await db.query('update public.profiles set account_xp = $2, account_level = $3 where user_id = $1', [u, xp, levelOfXp(xp)]);
  return u;
}
async function withAetherOff<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec('update public.progression_config set aether_enabled = false where id = 1;');
  try { return await fn(); } finally { await db.exec('update public.progression_config set aether_enabled = true where id = 1;'); }
}

describe('earning: settlements pay Aether, milestone crates replace level crates', () => {
  beforeAll(async () => {
    await db.exec(`update public.progression_config set epoch = now() - interval '2 days' where id = 1;`);
  });

  it('ranked settlement pays Aether (50 + the placement bonus), once', async () => {
    const u = await newUser();
    const { runId, out } = await settleRanked(u, 1);
    expect(out.status).toBe('ok');
    const r = parseProgressionResult(out.result)!;
    expect(r.aether).toEqual({ base: 50, placement: 140, total: 190 });
    expect(r.aether).toEqual(aetherForSettlement({ mode: 'ranked', placement: 1 }));
    expect(r.aetherBalance).toBe(190);
    expect(await balance(u)).toBe(190);
    expect(parseProgressionProfile(out.profile)!.aether).toBe(190);
    expect(await ledger(u)).toEqual([{ delta: 190, balance_after: 190, reason: 'ranked', source_id: runId }]);
    // a replayed settlement is deduped and pays nothing more
    const again = await resettle(u, 'ranked', runId);
    expect(again.status).toBe('deduped');
    expect(parseProgressionResult(again.result)!.aether).toEqual({ base: 50, placement: 140, total: 190 });
    expect(await balance(u)).toBe(190);
    expect(await ledger(u)).toHaveLength(1);
  });

  it('every Ranked placement pays exactly what the TS pays (SQL = aetherForSettlement)', async () => {
    const u = await newUser();
    let sum = 0;
    for (let p = 1; p <= 8; p++) {
      const r = parseProgressionResult((await settleRanked(u, p)).out.result)!;
      const ts = aetherForSettlement({ mode: 'ranked', placement: p });
      expect(r.aether, `placement ${p}`).toEqual(ts);
      sum += ts.total;
    }
    expect(await balance(u)).toBe(sum);
  });

  it('practice pays nothing (and writes no ledger row)', async () => {
    const u = await newUser();
    const out = await settlePractice(u, 1);
    expect(out.status).toBe('ok');
    const r = parseProgressionResult(out.result)!;
    expect(r.aether).toEqual({ base: 0, placement: 0, total: 0 });
    expect(r.aetherBalance).toBe(0);
    expect(await ledger(u)).toEqual([]);
    expect(await balance(u)).toBe(0);
  });

  it('versus pays 25 + 45: the winner 70, the loser 25, an abandoned match 25; the XP is unchanged', async () => {
    const a = await newUser();
    const b = await newUser();
    const m = await versusMatch(a, b, 'p1');
    const w = parseProgressionResult((await resettle(a, 'versus', versusRunId(m))).result)!;
    const l = parseProgressionResult((await resettle(b, 'versus', versusRunId(m))).result)!;
    expect(w.aether).toEqual({ base: 25, placement: 45, total: 70 });
    expect(l.aether).toEqual({ base: 25, placement: 0, total: 25 });
    expect(w.aether).toEqual(aetherForSettlement({ mode: 'versus', placement: 1 }));
    expect(l.aether).toEqual(aetherForSettlement({ mode: 'versus', placement: 2 }));
    expect(w.xp).toEqual(xpForSettlement({ mode: 'versus', placement: 1, comeback: false }));
    expect(await balance(a)).toBe(70);
    expect(await balance(b)).toBe(25);
    expect(await ledger(a, 'versus')).toEqual([{ delta: 70, balance_after: 70, reason: 'versus', source_id: versusRunId(m) }]);
    const abandoned = await versusMatch(a, b, null);
    expect(parseProgressionResult((await resettle(a, 'versus', versusRunId(abandoned))).result)!.aether).toEqual({ base: 25, placement: 0, total: 25 });
    expect(await balance(a)).toBe(95);
  });

  it('milestones replace level crates: the Welcome Crate + milestone:10 + milestone:20, both floor Legendary', async () => {
    const u = await nearLevel21();
    const { runId, out } = await settleRanked(u, 1);
    const r = parseProgressionResult(out.result)!;
    expect([r.before.level, r.after.level]).toEqual([20, 21]);
    expect(milestoneLevelsThrough(r.after.level)).toEqual([10, 20]);
    const rows = await crates(u);
    expect(rows.map(({ earned_level, source, floor_rarity }) => ({ earned_level, source, floor_rarity }))).toEqual([
      { earned_level: 1, source: null, floor_rarity: 'common' },
      { earned_level: null, source: 'milestone:10', floor_rarity: 'legendary' },
      { earned_level: null, source: 'milestone:20', floor_rarity: 'legendary' },
    ]);
    expect(r.cratesAwarded).toBe(3);
    expect(r.crateIds).toEqual(rows.map((c) => c.crate_id));
    expect(r.aether).toEqual({ base: 50, placement: 140, total: 190 });
    // a replay creates nothing more
    expect((await resettle(u, 'ranked', runId)).status).toBe('deduped');
    expect(await crates(u)).toHaveLength(3);
  });

  it('milestone crates self-heal: an enrolled Level 15 account missing milestone:10 gets it on its next settlement (no Welcome Crate)', async () => {
    const u = await newUser();
    await db.query('update public.profiles set account_xp = $2, account_level = 15, progression_enrolled_at = now() where user_id = $1', [u, xpAtLevelStart(15)]);
    const r = parseProgressionResult((await settleRanked(u, 8)).out.result)!;
    expect(r.after.level).toBe(15);
    expect((await crates(u)).map((c) => [c.earned_level, c.source, c.floor_rarity])).toEqual([[null, 'milestone:10', 'legendary']]);
    expect(r.cratesAwarded).toBe(1);
    // and only once: the next settlement finds it there
    expect(parseProgressionResult((await settleRanked(u, 8)).out.result)!.cratesAwarded).toBe(0);
  });

  it('a milestone crate is always floor Legendary (the table refuses anything else)', async () => {
    const u = await newUser();
    expect(await raises("insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity) values ($1, null, 'milestone:10', 'x', 'common')", [u]))
      .toMatch(/loot_crates_milestone_is_legendary/);
  });

  it('aether off keeps the crate per level: 21 level crates, a null result.aether, an empty wallet', async () => {
    const u = await nearLevel21();
    const out = await withAetherOff(async () => (await settleRanked(u, 1)).out);
    const r = parseProgressionResult(out.result)!;
    expect(r.after.level).toBe(21);
    expect(r.aether).toBeNull();
    expect(r.aetherBalance).toBeNull();
    expect(out.result.aether).toBeNull();
    const rows = await crates(u);
    expect(rows.map((c) => c.earned_level)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    expect(rows.every((c) => c.source === null && c.floor_rarity === 'common')).toBe(true);
    expect(r.cratesAwarded).toBe(21);
    expect(await balance(u)).toBe(0);
    expect(await ledger(u)).toEqual([]);
  });
});

describe('earning: Gauntlet, the profile balance, the rollout', () => {
  it('gauntlet first clear pays 200 once, and grants no crate', async () => {
    const u = await newUser();
    const first = (await one<{ j: unknown }>('select public.record_gauntlet_clear($1, 3) as j', [u])).j;
    expect(first).toEqual({ status: 'first_clear', crate: null, aether: 200 });
    expect(parseGauntletClearResult(first)).toEqual({ status: 'first_clear', crate: null, aether: 200 });
    const again = (await one<{ j: unknown }>('select public.record_gauntlet_clear($1, 3) as j', [u])).j;
    expect(again).toEqual({ status: 'already_cleared', crate: null, aether: 0 });
    expect(await balance(u)).toBe(200);
    expect(await ledger(u)).toEqual([{ delta: 200, balance_after: 200, reason: 'gauntlet', source_id: 'gauntlet:3' }]);
    expect(await crateCount(u)).toBe(0);
    expect(await one('select crate_granted, crate_id from public.gauntlet_progress where user_id = $1 and stage = 3', [u])).toEqual({ crate_granted: false, crate_id: null });
  });

  it('gauntlet with Aether off: the crate as before, plus aether 0', async () => {
    const u = await newUser();
    const first = await withAetherOff(async () => (await one<{ j: { status: string; crate: { source: string }; aether: number } }>('select public.record_gauntlet_clear($1, 4) as j', [u])).j);
    expect(first).toMatchObject({ status: 'first_clear', aether: 0, crate: { source: 'gauntlet:4' } });
    expect(parseGauntletClearResult(first)).toMatchObject({ status: 'first_clear', aether: 0, crate: { source: 'gauntlet:4' } });
    expect(await crateCount(u)).toBe(1);
    expect(await balance(u)).toBe(0);
  });

  it('profile JSON carries the balance (0 with no wallet)', async () => {
    const u = await newUser();
    expect((await one<{ a: string }>("select public.progression_profile_json($1)->>'aether' as a", [u])).a).toBe('0');
    await grant(u, 123);
    expect((await one<{ a: string }>("select public.progression_profile_json($1)->>'aether' as a", [u])).a).toBe(String(await balance(u)));
    const p = (await one<{ p: unknown }>('select public.progression_profile_json($1) as p', [u])).p;
    expect(parseProgressionProfile(p)!.aether).toBe(123);
  });

  it('rollout backdates milestone crates idempotently, and turns Aether on', async () => {
    await db.exec('update public.progression_config set aether_enabled = false where id = 1;');
    try {
      const u = await newUser();
      await db.query('update public.profiles set account_xp = $2, account_level = 34 where user_id = $1', [u, xpAtLevelStart(34)]);
      const low = await newUser();
      await db.query('update public.profiles set account_xp = $2, account_level = 9 where user_id = $1', [low, xpAtLevelStart(9)]);
      const rev0 = (await one<{ r: number }>('select progression_revision::int as r from public.profiles where user_id = $1', [u])).r;
      const first = (await one<{ j: { accounts: number; crates: number } }>('select public.aether_rollout() as j')).j;
      expect(first.crates).toBeGreaterThanOrEqual(3);
      expect(first.accounts).toBeGreaterThanOrEqual(1);
      expect((await crates(u)).map((c) => [c.earned_level, c.source, c.floor_rarity])).toEqual([
        [null, 'milestone:10', 'legendary'], [null, 'milestone:20', 'legendary'], [null, 'milestone:30', 'legendary'],
      ]);
      expect(await crates(low)).toEqual([]);
      expect((await one<{ on: boolean }>('select aether_enabled as on from public.progression_config where id = 1')).on).toBe(true);
      expect((await one<{ r: number }>('select progression_revision::int as r from public.profiles where user_id = $1', [u])).r).toBe(rev0 + 1);
      const second = (await one<{ j: unknown }>('select public.aether_rollout() as j')).j;
      expect(second).toEqual({ accounts: 0, crates: 0 });
      expect(await crates(u)).toHaveLength(3);
    } finally {
      await db.exec('update public.progression_config set aether_enabled = true where id = 1;');
    }
  });

  it('the rollout is the service role alone; settle and the gauntlet writer stay service role; the JSON helpers stay off the client roles', async () => {
    const sigs: Array<[string, boolean]> = [
      ['public.aether_rollout()', true],
      ['public.settle_progression(uuid, text, text, bigint, boolean, integer, jsonb)', true],
      ['public.record_gauntlet_clear(uuid, integer)', true],
      ['public.progression_result_json(public.progression_results)', true],
      ['public.progression_profile_json(uuid)', true],
    ];
    for (const [sig, svc] of sigs) {
      const acl = await one<{ anon: boolean; auth: boolean; svc: boolean }>(
        `select has_function_privilege('anon', '${sig}', 'execute') as anon, has_function_privilege('authenticated', '${sig}', 'execute') as auth, has_function_privilege('service_role', '${sig}', 'execute') as svc`);
      expect(acl, sig).toEqual({ anon: false, auth: false, svc });
    }
  });
});

// ── Fix round 1: an unreadable economy never blocks a game ───────────────────────────────────────────────────

/** Run `fn` with the economy row changed by `change` (SQL against public.aether_config), then put the default back. */
async function withEconomy<T>(change: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(change);
  try { return await fn(); } finally {
    await db.query('insert into public.aether_config (id, economy) values (1, $1::jsonb) on conflict (id) do update set economy = excluded.economy',
      [JSON.stringify(DEFAULT_AETHER_ECONOMY)]);
  }
}
const SET = (path: string, json: string): string => `update public.aether_config set economy = jsonb_set(economy, '${path}', '${json}') where id = 1;`;

describe('fix round 1: an unreadable economy turns Aether off for that game, never blocks it', () => {
  const cases: Array<[string, string, number]> = [
    ['the economy row missing', 'delete from public.aether_config;', 1],
    ['rankedBase a string', SET('{rankedBase}', '"abc"'), 1],
    ['rankedBase fractional', SET('{rankedBase}', '1.5'), 1],
    ['rankedBase negative', SET('{rankedBase}', '-50'), 1],
    ['the placement bonus entry missing (a 7-long ladder, 8th place)', SET('{rankedPlacementBonus}', '[140,80,45,35,25,15,10]'), 8],
    ['milestoneEvery 0', SET('{milestoneEvery}', '0'), 1],
    ['milestoneEvery a string', SET('{milestoneEvery}', '"ten"'), 1],
  ];
  for (const [label, change, placement] of cases) {
    it(`ranked: ${label} -> ok, the right XP, the crate per level, aether null, nothing credited`, async () => {
      const u = await newUser();
      const out = await withEconomy(change, async () => (await settleRanked(u, placement)).out);
      expect(out.status).toBe('ok');
      const r = parseProgressionResult(out.result)!;
      expect(r.xp).toEqual(xpForSettlement({ mode: 'ranked', placement, comeback: false }));
      expect(r.aether).toBeNull();
      expect(r.aetherBalance).toBeNull();
      // exactly the switch-off crates: one per level from the Welcome Crate up
      expect((await crates(u)).map((c) => [c.earned_level, c.source])).toEqual(
        Array.from({ length: r.after.level }, (_, i) => [i + 1, null]));
      expect(r.cratesAwarded).toBe(r.after.level);
      expect(await balance(u)).toBe(0);
      expect(await ledger(u)).toEqual([]);
    });
  }

  it('practice settles with a garbled milestoneEvery (it is read for every mode)', async () => {
    const u = await newUser();
    const out = await withEconomy(SET('{milestoneEvery}', '"x"'), () => settlePractice(u, 1));
    expect(out.status).toBe('ok');
    const r = parseProgressionResult(out.result)!;
    expect(r.xp).toEqual(xpForSettlement({ mode: 'practice', placement: 1, comeback: false }));
    expect(r.aether).toBeNull();
    expect((await crates(u)).map((c) => c.earned_level)).toEqual(Array.from({ length: r.after.level }, (_, i) => i + 1));
  });

  it('versus: a garbled versusWin turns Aether off for BOTH players (the loser too), XP intact', async () => {
    const a = await newUser();
    const b = await newUser();
    const m = await versusMatch(a, b, 'p1');
    const [w, l] = await withEconomy(SET('{versusWin}', '"lots"'), async () => [
      parseProgressionResult((await resettle(a, 'versus', versusRunId(m))).result)!,
      parseProgressionResult((await resettle(b, 'versus', versusRunId(m))).result)!,
    ]);
    expect([w.aether, l.aether]).toEqual([null, null]);
    expect(w.xp).toEqual(xpForSettlement({ mode: 'versus', placement: 1, comeback: false }));
    expect(l.xp).toEqual(xpForSettlement({ mode: 'versus', placement: 2, comeback: false }));
    expect([await balance(a), await balance(b)]).toEqual([0, 0]);
  });

  it('the economy comes back: the next game pays again', async () => {
    const u = await newUser();
    await withEconomy('delete from public.aether_config;', () => settleRanked(u, 1));
    const r = parseProgressionResult((await settleRanked(u, 1)).out.result)!;
    expect(r.aether).toEqual({ base: 50, placement: 140, total: 190 });
    expect(await balance(u)).toBe(190);
  });

  const gauntletCases: Array<[string, string]> = [
    ['gauntletFirstClear retuned to 0', SET('{gauntletFirstClear}', '0')],
    ['gauntletFirstClear a string', SET('{gauntletFirstClear}', '"200"')],
    ['the economy row missing', 'delete from public.aether_config;'],
  ];
  for (const [label, change] of gauntletCases) {
    it(`gauntlet: ${label} -> the crate, aether 0 (a first clear always gives something)`, async () => {
      const u = await newUser();
      const first = await withEconomy(change, async () => (await one<{ j: { status: string; crate: { source: string } | null; aether: number } }>('select public.record_gauntlet_clear($1, 5) as j', [u])).j);
      expect(first).toMatchObject({ status: 'first_clear', aether: 0, crate: { source: 'gauntlet:5' } });
      expect(parseGauntletClearResult(first)).toMatchObject({ status: 'first_clear', aether: 0, crate: { source: 'gauntlet:5' } });
      expect(await one('select crate_granted from public.gauntlet_progress where user_id = $1 and stage = 5', [u])).toEqual({ crate_granted: true });
      expect(await crateCount(u)).toBe(1);
      expect(await balance(u)).toBe(0);
    });
  }

  it('the rollout refuses an unreadable milestoneEvery (aether_config_invalid) and changes nothing', async () => {
    await db.exec('update public.progression_config set aether_enabled = false where id = 1;');
    try {
      const u = await newUser();
      await db.query('update public.profiles set account_xp = $2, account_level = 34 where user_id = $1', [u, xpAtLevelStart(34)]);
      for (const change of [SET('{milestoneEvery}', '"ten"'), SET('{milestoneEvery}', '0'), 'delete from public.aether_config;']) {
        const err = await withEconomy(change, () => raises('select public.aether_rollout()'));
        expect(err, change).toMatch(/aether_config_invalid/);
      }
      expect(await crates(u)).toEqual([]);
      expect((await one<{ on: boolean }>('select aether_enabled as on from public.progression_config where id = 1')).on).toBe(false);
    } finally {
      await db.exec('update public.progression_config set aether_enabled = true where id = 1;');
    }
  });

  it('the defensive read is internal (no API role, not even the service role, can call it)', async () => {
    const sig = 'public.aether_economy_int(jsonb, text[])';
    const acl = await one<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon', '${sig}', 'execute') as anon, has_function_privilege('authenticated', '${sig}', 'execute') as auth, has_function_privilege('service_role', '${sig}', 'execute') as svc`);
    expect(acl).toEqual({ anon: false, auth: false, svc: false });
  });
});
