import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COSMETICS, COSMETIC_CATEGORIES, COSMETIC_RARITIES, catalogHash, catalogSyncPayload, type CosmeticDef, type CrateRarity,
} from './cosmetics';
import { DEFAULT_PACK_ECONOMY } from './packEconomy';
import { STYLE_PACK_IDS, type PackCard, type PackLook } from './packs';
import { rollPack } from './packRoll';

/**
 * THE PACK ROLL, EXECUTED (spec docs/superpowers/specs/2026-11-27-pack-economy-design.md, sections 6, 7, 9.1, 11).
 * PGlite runs the progression migrations in production order (the Aether file and the Secret file included), then
 * 2026-12-01-packs.sql, syncs a code catalog whose items carry style packs, and checks on real Postgres:
 *
 *   the seeded `pack_config` IS `DEFAULT_PACK_ECONOMY`; the switch ships OFF; the sync writes `pack_styles`;
 *   `progression_pack_roll` gives EXACTLY the five cards `rollPack` gives, card for card, for 2,000 draw sets across
 *   every pack look and a spread of owned sets (the fully-owned category and style, everything owned, fall-backs); an
 *   empty pool raises `pack_pool_empty` exactly where the TS throws; malformed draws raise `bad_draws`; an `admin_off`
 *   item or category never rolls; the roll reads ownership and writes nothing; the pack row's guard freezes its
 *   identity and opens it once; owners read only their own packs and meters; clients can call none of it.
 */
const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = ['2026-09-27-account-progression.sql', '2026-09-28-progression-crates.sql', '2026-09-28-progression-skins.sql', '2026-09-28-achievements.sql', '2026-09-29-crate-fixed-rarity-odds.sql', '2026-09-29-crate-uniform-within-rarity.sql', '2026-09-29-gauntlet-progress.sql', '2026-10-02-ancient-rarity.sql', '2026-10-03-placement-xp.sql', '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql', '2026-10-14-versus-progression.sql'];
/** The emote file's starter-acquisition check only (2026-10-13): the code catalog holds STARTER emotes. */
const STARTER_CHECK = ((t: string): string => t.slice(0, t.indexOf('-- ── 2. equip_cosmetic')))(read('2026-10-13-emotes.sql'));
const AETHER = read('2026-10-18-aether.sql');
const SECRET = read('2026-11-03-secret-plushie-plate.sql');
const PACKS = read('2026-12-01-packs.sql');

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

/** A seeded LCG in [0, 1) (no Math.random). */
const rand = (seed: number) => (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

/** The style packs used by the test catalog: every one but the last has members, so the last one's pool is empty. */
const MEMBER_STYLES = STYLE_PACK_IDS.slice(0, -1);
const EMPTY_STYLE = STYLE_PACK_IDS[STYLE_PACK_IDS.length - 1]!;
/** The code catalog with style-pack membership spread over the crate items (one or two styles each, some none). */
const CATALOG: CosmeticDef[] = COSMETICS.map((c, i) => {
  if (c.acquisition.type !== 'crate' || i % 3 === 2) return c;
  const a = MEMBER_STYLES[i % MEMBER_STYLES.length]!;
  const b = MEMBER_STYLES[(i + 4) % MEMBER_STYLES.length]!;
  return { ...c, packStyles: i % 3 === 0 ? [a] : [a, b] };
});
const crate = CATALOG.filter((c) => c.acquisition.type === 'crate');

const LOOKS: PackLook[] = [
  ...COSMETIC_RARITIES.map((r): PackLook => ({ kind: 'rarity', id: `rarity-${r}`, name: r, guaranteedFloor: r })),
  ...COSMETIC_CATEGORIES.map((c): PackLook => ({ kind: 'category', id: `category-${c}`, name: c, guaranteedFloor: 'common' })),
  ...STYLE_PACK_IDS.map((s): PackLook => ({ kind: 'themed', id: s, name: s, guaranteedFloor: 'common' })),
];

let db: PGlite;
let userSeq = 0;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0]!;
}
async function raises(sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); } catch (e) { return String((e as Error).message); }
  return 'no error';
}
async function newUser(ids: readonly string[] = []): Promise<string> {
  userSeq++;
  const u = `00000000-0000-0000-0000-${String(userSeq).padStart(12, '0')}`;
  await db.query('insert into auth.users (id) values ($1)', [u]);
  await db.query('insert into public.profiles (user_id) values ($1)', [u]);
  await db.query("insert into public.player_cosmetics (user_id, cosmetic_id, source) select $1, x, 'test' from unnest($2::text[]) x on conflict do nothing", [u, `{${ids.join(',')}}`]);
  return u;
}
const arr = (d: readonly number[]): string => `{${d.join(',')}}`;
async function sqlRoll(u: string, look: PackLook, draws: readonly number[] | string): Promise<PackCard[]> {
  return (await one<{ j: PackCard[] }>('select public.progression_pack_roll($1, $2, $3, $4, $5::float8[]) as j',
    [u, look.kind, look.id, look.guaranteedFloor, typeof draws === 'string' ? draws : arr(draws)])).j;
}
const zeros = Array.from({ length: 15 }, () => 0);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const f of FILES) { await db.exec(read(f)); await db.exec(API_GRANTS); }
  await db.exec(STARTER_CHECK);
  await db.exec(AETHER);
  await db.exec(SECRET);
  await db.exec(PACKS);
  await db.exec(API_GRANTS);
  const c = catalogSyncPayload(CATALOG);
  expect((await one<{ j: { status: string } }>('select public.sync_cosmetic_catalog($1::jsonb, $2) as j', [JSON.stringify(c), catalogHash(c)])).j.status).toBe('synced');
}, 180_000);
afterAll(async () => { await db?.close(); });

describe('config, switch and columns', () => {
  it('the seeded pack_config is DEFAULT_PACK_ECONOMY', async () => {
    const row = await one<{ economy: unknown }>('select economy from public.pack_config where id = 1');
    expect(row.economy).toEqual(JSON.parse(JSON.stringify(DEFAULT_PACK_ECONOMY)));
  });

  it('the packs switch ships OFF; the level baseline starts null', async () => {
    const col = await one<{ d: string | null }>(
      "select column_default as d from information_schema.columns where table_schema = 'public' and table_name = 'progression_config' and column_name = 'packs_enabled'");
    expect(col.d).toBe('false');
    expect((await one<{ p: boolean }>('select packs_enabled as p from public.progression_config where id = 1')).p).toBe(false);
    const u = await newUser();
    expect((await one<{ b: number | null }>('select pack_level_baseline as b from public.profiles where user_id = $1', [u])).b).toBeNull();
  });

  it('the catalog sync writes pack_styles from packStyles (empty when none)', async () => {
    const rows = (await db.query<{ cosmetic_id: string; pack_styles: string[] }>('select cosmetic_id, pack_styles from public.cosmetic_catalog')).rows;
    const want = new Map(CATALOG.map((c) => [c.id, [...(c.packStyles ?? [])]]));
    expect(rows.length).toBe(CATALOG.length);
    for (const r of rows) expect(r.pack_styles, r.cosmetic_id).toEqual(want.get(r.cosmetic_id));
    expect(rows.some((r) => r.pack_styles.length === 2)).toBe(true);
  });

  it('the SQL constants equal the TS order: rarities, COSMETIC_CATEGORIES (not alphabetical) and STYLE_PACK_IDS', () => {
    const list = (name: string): string[] => {
      const m = new RegExp(`${name}\\s+constant\\s+text\\[\\]\\s*:=\\s*array\\[([^\\]]*)\\]`).exec(PACKS);
      if (!m) throw new Error(`no ${name}`);
      return [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
    };
    expect(list('c_rarities')).toEqual([...COSMETIC_RARITIES]);
    expect(list('c_categories')).toEqual([...COSMETIC_CATEGORIES]);
    expect(list('c_styles')).toEqual([...STYLE_PACK_IDS]);
    // every definition of a list in the file is the same list
    for (const name of ['c_rarities', 'c_categories', 'c_styles']) {
      const all = [...PACKS.matchAll(new RegExp(`${name}\\s+constant\\s+text\\[\\]\\s*:=\\s*(array\\[[^\\]]*\\])`, 'g'))].map((m) => m[1]);
      expect(new Set(all).size, name).toBe(1);
    }
  });
});

describe('progression_pack_roll equals rollPack card for card', () => {
  it('2,000 seeded draw sets across every look and owned set', async () => {
    const r = rand(20261201);
    const ofCat = (cat: string): string[] => crate.filter((c) => c.category === cat).map((c) => c.id);
    const owned: Array<[string, string[]]> = [
      ['fresh', []],
      ['random 30%', crate.filter(() => r() < 0.3).map((c) => c.id)],
      ['random 75%', crate.filter(() => r() < 0.75).map((c) => c.id)],
      ['every emote (fully-owned category)', ofCat('emote')],
      ['every announcer and title', [...ofCat('announcer'), ...ofCat('title')]],
      ['every Legendary', crate.filter((c) => c.rarity === 'legendary').map((c) => c.id)],
      ['every Plushie-pack item (fully-owned style)', crate.filter((c) => (c.packStyles ?? []).includes('themed-plushie')).map((c) => c.id)],
      ['everything', crate.map((c) => c.id)],
      ['everything but one Common card plate', crate.filter((c) => !(c.category === 'card_plate' && c.rarity === 'common')).map((c) => c.id)],
    ];
    const users: string[] = [];
    for (const [, ids] of owned) users.push(await newUser(ids));
    const edge = 1 - 2 ** -53;
    let rolled = 0;
    let empty = 0;
    let dups = 0;
    for (let k = 0; k < 2000; k++) {
      const look = LOOKS[k % LOOKS.length]!;
      const ui = Math.floor(k / LOOKS.length) % users.length;
      const draws = Array.from({ length: 15 }, () => { const x = r(); return x < 0.04 ? 0 : x < 0.08 ? edge : r(); });
      let want: PackCard[] | 'throws';
      try { want = rollPack({ look, owned: owned[ui]![1], draws, catalog: CATALOG }); } catch { want = 'throws'; }
      const label = `${look.id} / ${owned[ui]![0]} / ${arr(draws)}`;
      if (want === 'throws') {
        expect(await raises('select public.progression_pack_roll($1, $2, $3, $4, $5::float8[])', [users[ui], look.kind, look.id, look.guaranteedFloor, arr(draws)]), label).toContain('pack_pool_empty');
        empty++;
      } else {
        expect(await sqlRoll(users[ui]!, look, draws), label).toEqual(want);
        rolled++;
        dups += want.filter((c) => c.duplicate).length;
      }
    }
    // not vacuous: most sets roll, the empty pools (Board, Music, the memberless style) are hit, duplicates are paid
    expect(rolled).toBeGreaterThan(1700);
    expect(empty).toBeGreaterThan(0);
    expect(dups).toBeGreaterThan(500);
  }, 300_000);

  it('the empty pools raise pack_pool_empty (a switched-off category, a style with no members)', async () => {
    const u = await newUser();
    for (const look of LOOKS.filter((l) => l.id === 'category-board' || l.id === 'category-music' || l.id === EMPTY_STYLE)) {
      expect(() => rollPack({ look, owned: [], draws: zeros, catalog: CATALOG }), look.id).toThrow();
      expect(await raises('select public.progression_pack_roll($1, $2, $3, $4, $5::float8[])', [u, look.kind, look.id, look.guaranteedFloor, arr(zeros)]), look.id).toContain('pack_pool_empty');
    }
  });
});

describe('the roll refuses malformed input', () => {
  const call = (u: string, kind: string, id: string, floor: string | null, draws: string | null): Promise<string> =>
    raises('select public.progression_pack_roll($1, $2, $3, $4, $5::float8[])', [u, kind, id, floor, draws]);

  it('draws: exactly 15, each finite and in [0, 1)', async () => {
    const u = await newUser();
    const with15 = (x: string): string => `{${[x, ...zeros.slice(1)].join(',')}}`;
    for (const bad of [null, '{}', arr(zeros.slice(1)), arr([...zeros, 0]), with15('1'), with15('-0.1'), with15('NaN'), with15('Infinity'), with15('-Infinity'), with15('NULL'), `{${arr(zeros.slice(0, 5))},${arr(zeros.slice(0, 5))},${arr(zeros.slice(0, 5))}}`]) {
      expect(await call(u, 'rarity', 'rarity-common', 'common', bad), String(bad)).toContain('bad_draws');
    }
    expect(await call(u, 'rarity', 'rarity-common', 'common', arr(zeros))).toBe('no error');
  });

  it('Standard odds that do not sum to exactly 100 are a missing config, never a roll', async () => {
    const u = await newUser();
    try {
      for (const odds of [{ common: 35, rare: 31, epic: 22, legendary: 9, ancient: 2 }, { common: 1000000000, rare: 1000000000, epic: 1000000000, legendary: 0, ancient: 0 }]) {
        await db.query("update public.pack_config set economy = jsonb_set(economy, '{standardOdds}', $1::jsonb) where id = 1", [JSON.stringify(odds)]);
        expect(await call(u, 'rarity', 'rarity-common', 'common', arr(zeros)), JSON.stringify(odds)).toContain('pack_config_missing');
      }
    } finally {
      await db.exec(`update public.pack_config set economy = '${JSON.stringify(DEFAULT_PACK_ECONOMY)}'::jsonb where id = 1;`);
    }
    expect(await call(u, 'rarity', 'rarity-common', 'common', arr(zeros))).toBe('no error');
  });

  it('an unknown look, category or style, and a bad floor', async () => {
    const u = await newUser();
    const d = arr(zeros);
    expect(await call(u, 'chest', 'x', 'common', d)).toContain('unknown_pack');
    expect(await call(u, 'category', 'category-nope', 'common', d)).toContain('unknown_pack');
    expect(await call(u, 'category', 'emote', 'common', d)).toContain('unknown_pack');
    expect(await call(u, 'themed', 'themed-nope', 'common', d)).toContain('unknown_pack');
    expect(await call(u, 'rarity', 'rarity-secret', 'secret', d)).toContain('bad_floor');
    expect(await call(u, 'rarity', 'rarity-common', null, d)).toContain('bad_floor');
  });
});

describe('the SQL-only pool rules', () => {
  it('an admin_off item and an admin_off category never roll', async () => {
    const u = await newUser();
    const titles = crate.filter((c) => c.category === 'title').map((c) => c.id);
    await db.query('update public.cosmetic_catalog set admin_off = true where cosmetic_id = any($1::text[])', [`{${titles.join(',')}}`]);
    await db.exec("update public.cosmetic_categories set admin_off = true where category = 'announcer';");
    try {
      const off = new Set([...titles, ...crate.filter((c) => c.category === 'announcer').map((c) => c.id)]);
      const r = rand(99);
      for (let k = 0; k < 200; k++) {
        const look = LOOKS.filter((l) => l.kind === 'rarity')[k % 5]!;
        const cards = await sqlRoll(u, look, Array.from({ length: 15 }, r));
        for (const c of cards) expect(off.has(c.rewardId), c.rewardId).toBe(false);
      }
      for (const id of ['category-title', 'category-announcer']) {
        expect(await raises('select public.progression_pack_roll($1, $2, $3, $4, $5::float8[])', [u, 'category', id, 'common', arr(zeros)]), id).toContain('pack_pool_empty');
      }
    } finally {
      await db.query('update public.cosmetic_catalog set admin_off = false where cosmetic_id = any($1::text[])', [`{${titles.join(',')}}`]);
      await db.exec("update public.cosmetic_categories set admin_off = false where category = 'announcer';");
    }
  });

  it('reads ownership and writes nothing', async () => {
    const counts = async (): Promise<unknown> => one('select (select count(*) from public.player_cosmetics)::int as owned, (select count(*) from public.packs)::int as packs, (select count(*) from public.pack_meters)::int as meters');
    const u = await newUser(['title_wanderer']);
    const before = await counts();
    const look = LOOKS.find((l) => l.id === 'category-title')!;
    const cards = await sqlRoll(u, look, zeros);
    expect(cards).toEqual(rollPack({ look, owned: ['title_wanderer'], draws: zeros, catalog: CATALOG }));
    expect(await counts()).toEqual(before);
    expect((await one<{ v: string }>("select provolatile as v from pg_proc where proname = 'progression_pack_roll'")).v).toBe('s');
  });
});

describe('the pack tables', () => {
  async function insertPack(u: string, source: string): Promise<string> {
    return (await one<{ pack_id: string }>(
      "insert into public.packs (user_id, look_kind, look_id, floor_rarity, source, price_paid, offer_id) values ($1, 'rarity', 'rarity-rare', 'rare', $2, 175, 'w:rarity-rare') returning pack_id",
      [u, source])).pack_id;
  }

  it('a pack opens once, and its identity is frozen', async () => {
    const u = await newUser();
    const p = await insertPack(u, 'shop:a:1');
    expect((await one<{ state: string; price_paid: number }>('select state, price_paid from public.packs where pack_id = $1', [p]))).toEqual({ state: 'sealed', price_paid: 175 });
    for (const col of ['pack_id = gen_random_uuid()', "user_id = gen_random_uuid()", 'request_id = gen_random_uuid()', "look_kind = 'category'", "look_id = 'rarity-epic'", "floor_rarity = 'epic'", "source = 'x'", 'price_paid = 0', "offer_id = 'other'", 'created_at = now() - interval \'1 day\'']) {
      expect(await raises(`update public.packs set ${col} where pack_id = $1`, [p]), col).toContain('pack_identity_is_immutable');
    }
    expect(await raises("update public.packs set state = 'opened' where pack_id = $1", [p])).toContain('packs_opened_consistent');
    await db.query("update public.packs set state = 'opened', opened_at = now(), roll_version = 1, cards = '[]'::jsonb where pack_id = $1", [p]);
    expect(await raises("update public.packs set state = 'sealed', opened_at = null, roll_version = null, cards = null where pack_id = $1", [p])).toContain('pack_already_opened');
    expect(await raises("update public.packs set cards = '[1]'::jsonb where pack_id = $1", [p])).toContain('pack_already_opened');
  });

  it('one pack per (user, source); bad kinds, floors, states and prices are refused', async () => {
    const u = await newUser();
    await insertPack(u, 'shop:b:1');
    expect(await raises("insert into public.packs (user_id, look_kind, look_id, floor_rarity, source) values ($1, 'rarity', 'rarity-rare', 'rare', 'shop:b:1')", [u])).toMatch(/duplicate key|unique/);
    expect(await raises("insert into public.packs (user_id, look_kind, look_id, floor_rarity, source) values ($1, 'chest', 'x', 'rare', 's1')", [u])).toContain('check');
    expect(await raises("insert into public.packs (user_id, look_kind, look_id, floor_rarity, source) values ($1, 'rarity', 'x', 'secret', 's2')", [u])).toContain('check');
    expect(await raises("insert into public.packs (user_id, look_kind, look_id, floor_rarity, source, state) values ($1, 'rarity', 'x', 'rare', 's3', 'lost')", [u])).toContain('check');
    expect(await raises("insert into public.packs (user_id, look_kind, look_id, floor_rarity, source, price_paid) values ($1, 'rarity', 'x', 'rare', 's4', -1)", [u])).toContain('check');
  });

  it('owners read only their own packs and meters; everyone reads pack_config; clients write nothing', async () => {
    const u = await newUser();
    const other = await newUser();
    await insertPack(u, 'shop:c:1');
    await insertPack(other, 'shop:c:1');
    await db.query('insert into public.pack_meters (user_id, purchased, claimed) values ($1, 3, 0), ($2, 7, 0)', [u, other]);
    await db.exec('set role authenticated;');
    try {
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [u]);
      expect((await db.query('select user_id from public.packs')).rows).toEqual([{ user_id: u }]);
      expect((await db.query('select purchased from public.pack_meters')).rows).toEqual([{ purchased: 3 }]);
      expect((await db.query('select id from public.pack_config')).rows).toEqual([{ id: 1 }]);
      await db.query('update public.pack_meters set purchased = 999');
      await db.query("update public.pack_config set economy = '{}'::jsonb");
      await db.query('delete from public.packs');
      expect(await raises("insert into public.packs (user_id, look_kind, look_id, floor_rarity, source) values ($1, 'rarity', 'x', 'rare', 'mine')", [u])).toContain('row-level security');
    } finally {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
    }
    expect((await one<{ n: number }>('select purchased as n from public.pack_meters where user_id = $1', [u])).n).toBe(3);
    expect((await one<{ n: number }>('select count(*)::int as n from public.packs where user_id = $1', [u])).n).toBe(1);
    expect((await one<{ economy: unknown }>('select economy from public.pack_config where id = 1')).economy).toEqual(JSON.parse(JSON.stringify(DEFAULT_PACK_ECONOMY)));
    await db.exec('set role anon;');
    try {
      expect((await db.query('select id from public.pack_config')).rows).toEqual([{ id: 1 }]);
      expect((await db.query('select * from public.packs')).rows).toEqual([]);
      expect((await db.query('select * from public.pack_meters')).rows).toEqual([]);
    } finally {
      await db.exec('reset role;');
    }
  });

  it('clients can call none of the new functions (even under the Supabase default EXECUTE grants)', async () => {
    const sigs: Array<[string, boolean]> = [
      ['public.sync_cosmetic_catalog(jsonb, text)', true],
      ['public.progression_pack_roll(uuid, text, text, text, double precision[])', false],
      ['public.progression_pack_draw(text[], text[], text[], double precision, double precision, double precision, integer[], integer)', false],
      ['public.packs_transition_guard()', false],
    ];
    for (const [sig, svc] of sigs) {
      const acl = await one<{ anon: boolean; auth: boolean; svc: boolean }>(
        `select has_function_privilege('anon', '${sig}', 'execute') as anon, has_function_privilege('authenticated', '${sig}', 'execute') as auth, has_function_privilege('service_role', '${sig}', 'execute') as svc`);
      expect(acl, sig).toEqual({ anon: false, auth: false, svc });
    }
  });

  it('is idempotent: re-running the file keeps the config, the packs and the switch', async () => {
    const u = await newUser();
    await insertPack(u, 'shop:d:1');
    await db.exec("update public.pack_config set economy = jsonb_set(economy, '{themedPackPrice}', '250') where id = 1;");
    await db.exec(PACKS);
    await db.exec(API_GRANTS);
    expect((await one<{ n: number }>("select (economy->>'themedPackPrice')::int as n from public.pack_config where id = 1")).n).toBe(250);
    expect((await one<{ n: number }>('select count(*)::int as n from public.packs where user_id = $1', [u])).n).toBe(1);
    expect((await one<{ p: boolean }>('select packs_enabled as p from public.progression_config where id = 1')).p).toBe(false);
    await db.exec(`update public.pack_config set economy = '${JSON.stringify(DEFAULT_PACK_ECONOMY)}'::jsonb where id = 1;`);
  });
});

/** Every crate rarity appears in the test catalog (otherwise the fall-back cases are not exercised). */
it('the test catalog covers every crate rarity', () => {
  for (const r of COSMETIC_RARITIES) expect(crate.some((c) => c.rarity === (r as CrateRarity)), r).toBe(true);
});
