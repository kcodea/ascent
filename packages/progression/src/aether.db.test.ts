import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_AETHER_ECONOMY, type CrateTier } from './aether';
import { atOrAbove, eligibleForCrate, pickTieredCrateReward, quoteCrate } from './crateShop';
import { COSMETICS, COSMETIC_INDEX, catalogHash, catalogSyncPayload, parseOpenCrateResult, type CosmeticCategory, type CosmeticRarity } from './cosmetics';

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
 *   switches refuse; the guard keeps floor and price immutable; clients can call none of it. PGlite is one connection,
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

  it('clients can call none of it; aether_apply is internal even to the service role', async () => {
    const sigs: Array<[string, boolean]> = [
      ['public.buy_crate(uuid, text, text[], integer, uuid)', true],
      ['public.open_crate(uuid, uuid, text[], integer)', true],
      ['public.aether_quote(uuid, text, text[], boolean)', true],
      ['public.progression_tiered_crate_pool(uuid, text, text[])', true],
      ['public.progression_tiered_crate_pick(uuid, double precision, text, text[])', true],
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
