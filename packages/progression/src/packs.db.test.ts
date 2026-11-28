import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COSMETICS, catalogHash, catalogSyncPayload, type CosmeticDef } from './cosmetics';
import { DEFAULT_PACK_ECONOMY, PACK_ROLL_VERSION, rarityPackOdds, type PackEconomy } from './packEconomy';
import { STYLE_PACK_IDS, parsePackOpenResult, type PackCard, type PackLook } from './packs';
import { packPool } from './packRoll';
import { counterHasRoom, lookKey, nextShopRefresh, shopWindowId, windowOffers, type OwnedPack, type PackOffer } from './packShop';

/**
 * THE PACK SHOP, EXECUTED (spec docs/superpowers/specs/2026-11-27-pack-economy-design.md, sections 8 and 9). PGlite runs
 * the progression migrations in production order, then 2026-12-01-packs.sql, syncs a code catalog whose items carry
 * style packs, and checks on real Postgres:
 *
 *   the window id and the next refresh equal `shopWindowId` / `nextShopRefresh` hour by hour across both DST weeks;
 *   the window's offers equal `windowOffers` draw for draw (a retuned economy and an empty catalog included), and a
 *   window is made once; the counter check equals `counterHasRoom`; `buy_pack` refuses in spec 9.3 order and every
 *   refusal changes nothing; a repeated request is charged once; the free pack is one per window; a deal's stock is
 *   per player; 15 paid packs make a reward ready; a claim is a grant (never refused for room); `open_pack` rolls from
 *   the pack row, pays duplicates once and answers the stored cards again; guests can neither buy nor open nor claim;
 *   the writers hold the per-user lock; `pack_shop_json` carries per-player stock, `newToYou` and live odds on Rarity
 *   offers only; the service role is the only caller.
 */
const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = ['2026-09-27-account-progression.sql', '2026-09-28-progression-crates.sql', '2026-09-28-progression-skins.sql', '2026-09-28-achievements.sql', '2026-09-29-crate-fixed-rarity-odds.sql', '2026-09-29-crate-uniform-within-rarity.sql', '2026-09-29-gauntlet-progress.sql', '2026-10-02-ancient-rarity.sql', '2026-10-03-placement-xp.sql', '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql', '2026-10-14-versus-progression.sql'];
const STARTER_CHECK = ((t: string): string => t.slice(0, t.indexOf('-- ── 2. equip_cosmetic')))(read('2026-10-13-emotes.sql'));
const AETHER = read('2026-10-18-aether.sql');
const SECRET = read('2026-11-03-secret-plushie-plate.sql');
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

/** A seeded LCG in [0, 1) (no Math.random). */
const rand = (seed: number) => (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

/** The packRoll.db.test.ts catalog: style membership spread over the crate items, the last style left empty. */
const MEMBER_STYLES = STYLE_PACK_IDS.slice(0, -1);
const CATALOG: CosmeticDef[] = COSMETICS.map((c, i) => {
  if (c.acquisition.type !== 'crate' || i % 3 === 2) return c;
  const a = MEMBER_STYLES[i % MEMBER_STYLES.length]!;
  const b = MEMBER_STYLES[(i + 4) % MEMBER_STYLES.length]!;
  return { ...c, packStyles: i % 3 === 0 ? [a] : [a, b] };
});
const crate = CATALOG.filter((c) => c.acquisition.type === 'crate');
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

let db: PGlite;
let userSeq = 0;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0]!;
}
async function raises(sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); } catch (e) { return String((e as Error).message); }
  return 'no error';
}
async function newUser(opts: { owned?: readonly string[]; aether?: number; guest?: boolean } = {}): Promise<string> {
  userSeq++;
  const u = `00000000-0000-0000-0001-${String(userSeq).padStart(12, '0')}`;
  await db.query('insert into auth.users (id, is_anonymous) values ($1, $2)', [u, opts.guest ?? false]);
  await db.query('insert into public.profiles (user_id) values ($1)', [u]);
  if (opts.owned?.length) {
    await db.query("insert into public.player_cosmetics (user_id, cosmetic_id, source) select $1, x, 'test' from unnest($2::text[]) x on conflict do nothing", [u, `{${opts.owned.join(',')}}`]);
  }
  if (opts.aether) await db.query('insert into public.aether_wallets (user_id, balance) values ($1, $2)', [u, opts.aether]);
  return u;
}
const arr = (d: readonly number[]): string => `{${d.join(',')}}`;
const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);

type Answer = { status: string; reason?: string; aether?: number; packs?: OwnedPack[]; meter?: { progress: number; ready: number }; offers?: PackOffer[] };
async function buy(u: string, offerId: string, price: number, rid: string = randomUUID()): Promise<Answer> {
  return (await one<{ j: Answer }>('select public.buy_pack($1, $2, $3, $4) as j', [u, offerId, price, rid])).j;
}
async function claim(u: string, rid: string = randomUUID()): Promise<Answer> {
  return (await one<{ j: Answer }>('select public.claim_pack_reward($1, $2) as j', [u, rid])).j;
}
type Opened = { status: string; reason?: string; packId: string; pack: PackLook; cards: PackCard[]; aether: number };
async function open(u: string, packId: string): Promise<Opened> {
  return (await one<{ j: Opened }>('select public.open_pack($1, $2) as j', [u, packId])).j;
}
type Shop = { windowId: string; nextRefreshAt: number; shelves: unknown[]; offers: PackOffer[]; packs: OwnedPack[]; packMeter: { progress: number; ready: number }; aether: number };
async function shop(u: string): Promise<Shop> {
  return (await one<{ j: Shop }>('select public.pack_shop_json($1) as j', [u])).j;
}
/**
 * The writers read the clock (`now()`), so a test that makes the current window and then buys from it must not straddle
 * a refresh. Before every test: if the next refresh is under two minutes away, wait it out (every test here takes
 * well under that), so one test always sees one window.
 */
async function clearOfRefresh(marginMs = 120_000): Promise<void> {
  const left = nextShopRefresh(new Date()) - Date.now();
  if (left < marginMs) await new Promise((r) => setTimeout(r, left + 1_000));
}
/** The window before `w` (walking back from now: a window may be 5, 6 or 7 hours long). */
function windowBefore(w: string): string {
  let t = Date.now();
  while (shopWindowId(new Date(t)) === w) t -= 15 * 60_000;
  return shopWindowId(new Date(t));
}
async function currentWindow(): Promise<string> {
  return (await one<{ w: string }>('select public.pack_window_id(now()) as w')).w;
}
/** Replace the current window with the offers made from these draws (the server's twin, so prices are the server's). */
async function setWindow(draws: readonly number[] = zeros(12)): Promise<PackOffer[]> {
  const w = await currentWindow();
  await db.query('delete from public.pack_shop_windows where window_id = $1', [w]);
  await db.query('insert into public.pack_shop_windows (window_id, offers) values ($1, public.progression_pack_window_offers($1, $2::float8[]))', [w, arr(draws)]);
  return (await one<{ o: PackOffer[] }>('select offers as o from public.pack_shop_windows where window_id = $1', [w])).o;
}
async function setEconomy(eco: PackEconomy | Readonly<PackEconomy>): Promise<void> {
  await db.query('update public.pack_config set economy = $1::jsonb where id = 1', [JSON.stringify(eco)]);
}
/** What a refusal must not change. */
async function snapshot(u: string): Promise<unknown> {
  return one(`select (select coalesce(sum(balance), 0) from public.aether_wallets where user_id = $1)::int as balance,
    (select count(*) from public.aether_ledger where user_id = $1)::int as ledger,
    (select coalesce(jsonb_agg(pack_id order by pack_id), '[]') from public.packs where user_id = $1) as packs,
    (select coalesce(jsonb_agg(jsonb_build_object('p', purchased, 'c', claimed)), '[]') from public.pack_meters where user_id = $1) as meter`, [u]);
}
/** Sealed packs inserted straight into the table, oldest first (the counter order is created_at, then pack_id). */
async function hand(u: string, looks: ReadonlyArray<{ kind: string; id: string; floor?: string }>, opts: { source?: string } = {}): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < looks.length; i++) {
    const l = looks[i]!;
    ids.push((await one<{ id: string }>(
      `insert into public.packs (user_id, look_kind, look_id, floor_rarity, source, created_at)
       values ($1, $2, $3, $4, $5, now() - interval '1 day' + make_interval(secs => $6)) returning pack_id as id`,
      [u, l.kind, l.id, l.floor ?? (l.kind === 'rarity' ? l.id.slice(7) : 'common'), `${opts.source ?? 'test'}:${randomUUID()}`, i])).id);
  }
  return ids;
}
const cat = (c: string) => ({ kind: 'category', id: `category-${c}` });
const rar = (r: string) => ({ kind: 'rarity', id: `rarity-${r}` });
const times = <T>(n: number, x: T): T[] => Array.from({ length: n }, () => x);
/** Four types on the counter that no shop rarity pack shares. */
const FOUR = [cat('emote'), cat('title'), cat('hero_skin'), cat('minion_skin')];

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
  await db.exec('update public.progression_config set packs_enabled = true where id = 1;');
}, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(() => clearOfRefresh(), 150_000);

describe('the shop window', () => {
  it('pack_window_id and pack_next_refresh_at equal shopWindowId / nextShopRefresh, hourly across both DST weeks', async () => {
    const at: number[] = [];
    for (const start of [Date.UTC(2026, 2, 4), Date.UTC(2026, 9, 29)]) {
      for (let h = 0; h < 8 * 24; h++) for (const m of [0, 1, 59]) at.push(start + h * 3_600_000 + m * 60_000);
    }
    const rows = (await db.query<{ w: string; n: number }>(
      'select public.pack_window_id(t) as w, public.pack_next_refresh_at(t)::float8 as n from unnest($1::timestamptz[]) with ordinality as u(t, o) order by o',
      [`{${at.map((ms) => new Date(ms).toISOString()).join(',')}}`])).rows;
    expect(rows.length).toBe(at.length);
    rows.forEach((r, i) => {
      const d = new Date(at[i]!);
      expect(r.w, d.toISOString()).toBe(shopWindowId(d));
      expect(r.n, d.toISOString()).toBe(nextShopRefresh(d));
    });
    // not vacuous: both clock changes are inside the range, so a 5-hour and a 7-hour window occur
    const lengths = new Set(rows.map((r, i) => Math.round((r.n - at[i]!) / 3_600_000)));
    expect(lengths.has(5) && lengths.has(7)).toBe(true);
  });

  it('the offers equal windowOffers draw for draw (300 draw sets, edge draws included)', async () => {
    const r = rand(20261128);
    const edge = 1 - 2 ** -53;
    for (let k = 0; k < 300; k++) {
      const d = Array.from({ length: 12 }, () => { const x = r(); return x < 0.05 ? 0 : x < 0.1 ? edge : r(); });
      const w = `2026-11-${String(1 + (k % 28)).padStart(2, '0')}T${['00', '06', '12', '18'][k % 4]}`;
      const sql = (await one<{ o: PackOffer[] }>('select public.progression_pack_window_offers($1, $2::float8[]) as o', [w, arr(d)])).o;
      expect(sql, `${w} ${arr(d)}`).toEqual(json(windowOffers(w, d, CATALOG)));
    }
  });

  it('a retuned economy and a catalog with fewer offers than deals: still equal, every draw consumed', async () => {
    const eco: PackEconomy = {
      ...DEFAULT_PACK_ECONOMY, featuredDeals: 40, freePackRarity: 'epic', themedPackPrice: 7,
      dealOff: { min: 10, max: 90, step: 10 }, dealStock: { min: 1, max: 9 },
    };
    await setEconomy(eco);
    try {
      const r = rand(7);
      const shelf = windowOffers('2026-11-28T06', zeros(120), CATALOG, eco).filter((o) => o.shelf !== 'featured').length;
      expect(shelf).toBeLessThan(40); // the pool runs out before the deals do
      for (let k = 0; k < 40; k++) {
        const d = Array.from({ length: 120 }, r);
        const sql = (await one<{ o: PackOffer[] }>('select public.progression_pack_window_offers($1, $2::float8[]) as o', ['2026-11-28T06', arr(d)])).o;
        expect(sql).toEqual(json(windowOffers('2026-11-28T06', d, CATALOG, eco)));
      }
      // the 5 Aether floor: 7 at 90% off
      const cheap = await one<{ o: PackOffer[] }>('select public.progression_pack_window_offers($1, $2::float8[]) as o', ['2026-11-28T06', arr(Array.from({ length: 120 }, (_, i) => (i % 3 === 1 ? 0.999 : 0)))]);
      const themed = cheap.o.filter((o) => o.shelf === 'featured' && o.fullPrice === 7);
      expect(themed.length).toBeGreaterThan(0);
      for (const o of themed) expect(o.price).toBe(5);
      expect(await raises('select public.progression_pack_window_offers($1, $2::float8[])', ['2026-11-28T06', arr(zeros(12))])).toContain('bad_draws');
    } finally {
      await setEconomy(DEFAULT_PACK_ECONOMY);
    }
  });

  it('an empty catalog offers nothing, as windowOffers', async () => {
    await db.exec('create temp table was_active as select cosmetic_id from public.cosmetic_catalog where active; update public.cosmetic_catalog set active = false;');
    try {
      const sql = (await one<{ o: PackOffer[] }>('select public.progression_pack_window_offers($1, $2::float8[]) as o', ['2026-11-28T00', arr(zeros(12))])).o;
      expect(sql).toEqual([]);
      expect(windowOffers('2026-11-28T00', zeros(12), CATALOG.map((c) => ({ ...c, active: false })))).toEqual([]);
    } finally {
      await db.exec('update public.cosmetic_catalog set active = true where cosmetic_id in (select cosmetic_id from was_active); drop table was_active;');
    }
  });

  it('malformed draws and window ids are refused', async () => {
    const w = '2026-11-28T00';
    for (const bad of [null, '{}', arr(zeros(11)), arr(zeros(13)), arr([1, ...zeros(11)]), arr([-0.5, ...zeros(11)]), `{NaN,${zeros(11).join(',')}}`, `{NULL,${zeros(11).join(',')}}`]) {
      expect(await raises('select public.progression_pack_window_offers($1, $2::float8[])', [w, bad]), String(bad)).toContain('bad_draws');
    }
    for (const bad of [null, '', '2026-11-28', '2026-11-28T6', "2026-11-28T00'; --"]) {
      expect(await raises('select public.pack_shop_window($1)', [bad]), String(bad)).toContain('bad_window');
    }
  });

  it('a window is made once, from 12 draws: the free Rare, four different deals (never the Rare pack), then the shelves', async () => {
    const w = '2030-01-01T12';
    const a = (await one<{ o: PackOffer[] }>('select public.pack_shop_window($1) as o', [w])).o;
    const b = (await one<{ o: PackOffer[] }>('select public.pack_shop_window($1) as o', [w])).o;
    expect(b).toEqual(a);
    expect((await one<{ n: number }>('select count(*)::int as n from public.pack_shop_windows where window_id = $1', [w])).n).toBe(1);
    const shelf = windowOffers(w, zeros(12), CATALOG).filter((o) => o.shelf !== 'featured');
    expect(a.filter((o) => o.shelf !== 'featured')).toEqual(json(shelf));
    expect(a[0]).toMatchObject({ offerId: `${w}:free`, price: 0, badge: 'free', look: { id: 'rarity-rare' } });
    const deals = a.filter((o) => o.offerId.includes(':deal:'));
    expect(deals.map((o) => o.offerId)).toEqual([0, 1, 2, 3].map((k) => `${w}:deal:${k}`));
    expect(new Set(deals.map((o) => o.look.id)).size).toBe(4);
    for (const d of deals) {
      expect(d.look.id).not.toBe('rarity-rare');
      expect(d.stock).toBeGreaterThanOrEqual(2);
      expect(d.stock).toBeLessThanOrEqual(5);
      expect(d.fullPrice).toBe(shelf.find((o) => o.look.id === d.look.id)!.price);
      expect(d.price % 5).toBe(0);
      expect(d.price).toBeGreaterThanOrEqual(5);
      expect(d.price).toBeLessThan(d.fullPrice!);
    }
  });
});

describe('the counter', () => {
  it('progression_counter_has_room equals counterHasRoom over 150 random hands', async () => {
    const looks: PackLook[] = [
      ...['common', 'rare', 'epic', 'legendary', 'ancient'].map((r) => ({ kind: 'rarity' as const, id: `rarity-${r}`, name: '', guaranteedFloor: r as PackLook['guaranteedFloor'] })),
      ...['emote', 'title', 'hero_skin'].map((c) => ({ kind: 'category' as const, id: `category-${c}`, name: '', guaranteedFloor: 'common' as const })),
    ];
    const r = rand(42);
    let yes = 0;
    let no = 0;
    for (let k = 0; k < 150; k++) {
      const u = await newUser();
      const n = Math.floor(r() * 55);
      const mine = Array.from({ length: n }, () => looks[Math.floor(r() * (k % 2 ? looks.length : 6))]!);
      await hand(u, mine.map((l) => ({ kind: l.kind, id: l.id, floor: l.guaranteedFloor })));
      const owned: OwnedPack[] = mine.map((look, i) => ({ packId: String(i), look }));
      const rows = (await db.query<{ k: string; room: boolean }>(
        'select x.kind || \':\' || x.id as k, public.progression_counter_has_room($1, x.kind, x.id) as room from unnest($2::text[], $3::text[]) as x(kind, id)',
        [u, `{${looks.map((l) => l.kind).join(',')}}`, `{${looks.map((l) => l.id).join(',')}}`])).rows;
      for (const look of looks) {
        const want = counterHasRoom(owned, look);
        expect(rows.find((x) => x.k === lookKey(look))!.room, `${k} ${lookKey(look)}`).toBe(want);
        if (want) yes++; else no++;
      }
    }
    expect(yes).toBeGreaterThan(100);
    expect(no).toBeGreaterThan(100);
  });

  it('an opened pack leaves the counter', async () => {
    const u = await newUser();
    const ids = await hand(u, [...FOUR, rar('epic')]);
    const room = async (): Promise<boolean> => (await one<{ r: boolean }>("select public.progression_counter_has_room($1, 'rarity', 'rarity-common') as r", [u])).r;
    expect(await room()).toBe(false);
    await db.query("update public.packs set state = 'opened', opened_at = now(), roll_version = 1, cards = '[]' where pack_id = $1", [ids[0]]);
    expect(await room()).toBe(true);
  });
});

describe('buy_pack', () => {
  it('refuses in spec 9.3 order, and every refusal changes nothing', async () => {
    const offers = await setWindow();
    const w = await currentWindow();
    const common = offers.find((o) => o.offerId === `${w}:rarity-common`)!;
    expect(common.price).toBe(100);
    const deal = offers.find((o) => o.offerId === `${w}:deal:0`)!;
    expect(deal.look.id).toBe('rarity-common');

    const refused = async (u: string, offerId: string, price: number, reason: string): Promise<Answer> => {
      const before = await snapshot(u);
      const a = await buy(u, offerId, price);
      expect(a, `${offerId} ${price}`).toMatchObject({ status: 'error', reason });
      expect(await snapshot(u), reason).toEqual(before);
      return a;
    };

    // a guest, before anything else (even a stale offer)
    const guest = await newUser({ guest: true, aether: 5000 });
    await refused(guest, common.offerId, 100, 'guest');
    await refused(guest, 'nope', 1, 'guest');

    // expired before price_changed; price_changed before sold_out; sold_out before no_room; no_room before insufficient
    const u = await newUser({ aether: 5000 });
    await refused(u, `${w}:rarity-nope`, 1, 'expired');
    await refused(u, common.offerId, 99, 'price_changed');
    expect((await buy(u, deal.offerId, deal.price)).status).toBe('ok');
    expect((await buy(u, deal.offerId, deal.price)).status).toBe('ok');
    expect(deal.stock).toBe(2);
    await refused(u, deal.offerId, deal.price + 1, 'price_changed');
    await hand(u, [...times(6, rar('common')), ...FOUR]); // the Common stack is full (8) and so is the counter
    await refused(u, deal.offerId, deal.price, 'sold_out');
    await refused(u, common.offerId, 100, 'no_room');
    const broke = await newUser({ aether: 0 });
    await hand(broke, [...FOUR, rar('epic')]);
    await refused(broke, common.offerId, 100, 'no_room');
    const poor = await newUser({ aether: 99 });
    expect(await refused(poor, common.offerId, 100, 'insufficient')).toMatchObject({ aether: 99 });
    expect((await buy(poor, `${w}:free`, 0)).status).toBe('ok'); // nothing else stands in the way of a free pack
  });

  it('Review Focus 2: an offer of the previous window is expired, uncharged, and the answer carries the current offers', async () => {
    await setWindow();
    const now = await currentWindow();
    const prev = windowBefore(now);
    expect(prev).not.toBe(now);
    await db.query('select public.pack_shop_window($1)', [prev]);
    const u = await newUser({ aether: 1000 });
    const before = await snapshot(u);
    const a = await buy(u, `${prev}:rarity-common`, 100);
    expect(a).toMatchObject({ status: 'error', reason: 'expired', aether: 1000 });
    expect(await snapshot(u)).toEqual(before);
    expect(a.offers!.length).toBeGreaterThan(10);
    expect(a.offers!.every((o) => o.offerId.startsWith(`${now}:`))).toBe(true);
    expect(a.offers).toEqual((await shop(u)).offers);
    // and buying the current one works
    expect((await buy(u, `${now}:rarity-common`, 100)).status).toBe('ok');
  });

  it('a purchase charges once, makes the pack, and a repeated request id answers the first result', async () => {
    await setWindow();
    const w = await currentWindow();
    const u = await newUser({ aether: 500 });
    const rid = randomUUID();
    const a = await buy(u, `${w}:rarity-epic`, 300, rid);
    expect(a).toMatchObject({ status: 'ok', aether: 200, meter: { progress: 1, ready: 0 } });
    expect(a.packs).toEqual([{ packId: a.packs![0]!.packId, look: { kind: 'rarity', id: 'rarity-epic', name: 'Epic Pack', guaranteedFloor: 'epic' } }]);
    const b = await buy(u, `${w}:rarity-epic`, 300, rid);
    expect(b).toEqual(a);
    expect(await buy(u, `${w}:rarity-common`, 100, rid)).toEqual(a); // the request, not the offer, is the key
    const row = await one('select source, price_paid, offer_id, request_id, state from public.packs where user_id = $1', [u]);
    expect(row).toEqual({ source: `shop:${rid}:1`, price_paid: 300, offer_id: `${w}:rarity-epic`, request_id: rid, state: 'sealed' });
    expect((await db.query("select delta, reason, source_id from public.aether_ledger where user_id = $1", [u])).rows).toEqual([{ delta: -300, reason: 'pack_purchase', source_id: rid }]);
    expect((await one<{ b: number }>('select balance as b from public.aether_wallets where user_id = $1', [u])).b).toBe(200);
  });

  it('the free pack: one per player per window, uncharged, never counted', async () => {
    await setWindow();
    const w = await currentWindow();
    const u = await newUser();
    const a = await buy(u, `${w}:free`, 0);
    expect(a).toMatchObject({ status: 'ok', aether: 0, meter: { progress: 0, ready: 0 } });
    const b = await buy(u, `${w}:free`, 0);
    expect(b.packs).toEqual(a.packs);
    expect((await db.query('select source, price_paid from public.packs where user_id = $1', [u])).rows).toEqual([{ source: `free:${w}`, price_paid: 0 }]);
    expect((await one<{ n: number }>('select count(*)::int as n from public.aether_ledger where user_id = $1', [u])).n).toBe(0);
    expect((await one<{ n: number }>('select count(*)::int as n from public.pack_meters where user_id = $1', [u])).n).toBe(0);
    // another player has their own
    expect((await buy(await newUser(), `${w}:free`, 0)).packs![0]!.packId).not.toBe(a.packs![0]!.packId);
  });

  it("a deal's stock is per player: one player buying it all leaves everyone else's", async () => {
    const offers = await setWindow([0, 0, 0.99, ...zeros(9)]); // deal 0: Common, 20% off, stock 5
    const w = await currentWindow();
    const deal = offers.find((o) => o.offerId === `${w}:deal:0`)!;
    expect(deal).toMatchObject({ price: 80, fullPrice: 100, stock: 5 });
    const u = await newUser({ aether: 5000 });
    const v = await newUser({ aether: 5000 });
    for (let i = 0; i < 5; i++) expect((await buy(u, deal.offerId, 80)).status).toBe('ok');
    expect(await buy(u, deal.offerId, 80)).toMatchObject({ status: 'error', reason: 'sold_out' });
    expect((await shop(u)).offers.find((o) => o.offerId === deal.offerId)).toMatchObject({ stock: 0, soldOut: true });
    expect((await shop(v)).offers.find((o) => o.offerId === deal.offerId)!.stock).toBe(5);
    expect((await shop(v)).offers.find((o) => o.offerId === deal.offerId)!.soldOut).toBeUndefined();
    expect((await buy(v, deal.offerId, 80)).status).toBe('ok');
    expect((await shop(v)).offers.find((o) => o.offerId === deal.offerId)!.stock).toBe(4);
    // the deal counts toward the reward meter and is charged its deal price
    expect((await one<{ n: number }>('select purchased as n from public.pack_meters where user_id = $1', [u])).n).toBe(5);
    expect((await one<{ b: number }>('select balance as b from public.aether_wallets where user_id = $1', [u])).b).toBe(5000 - 5 * 80);
  });

  it('15 paid packs make one reward ready; free packs and price-0 offers do not count, deals do', async () => {
    let offers = await setWindow();
    const w = await currentWindow();
    const u = await newUser({ aether: 20000 });
    expect((await buy(u, `${w}:free`, 0)).meter).toEqual({ progress: 0, ready: 0 });
    const deal = offers.find((o) => o.offerId === `${w}:deal:0`)!;
    expect((await buy(u, deal.offerId, deal.price)).meter).toEqual({ progress: 1, ready: 0 });
    const plan = [...times(6, 'rarity-common'), ...times(4, 'rarity-epic'), ...times(4, 'rarity-legendary')];
    let last: Answer | null = null;
    for (const id of plan) {
      const o = offers.find((x) => x.offerId === `${w}:${id}`)!;
      last = await buy(u, o.offerId, o.price);
      expect(last.status, id).toBe('ok');
    }
    expect(last!.meter).toEqual({ progress: 0, ready: 1 });
    // a shelf offer retuned to price 0 is not a purchase
    await setEconomy({ ...DEFAULT_PACK_ECONOMY, rarityPackPrice: { ...DEFAULT_PACK_ECONOMY.rarityPackPrice, ancient: 0 } });
    try {
      offers = await setWindow();
      expect(offers.find((o) => o.offerId === `${w}:rarity-ancient`)!.price).toBe(0);
      const z = await buy(u, `${w}:rarity-ancient`, 0);
      expect(z).toMatchObject({ status: 'ok', meter: { progress: 0, ready: 1 } });
      expect((await one<{ n: number }>("select count(*)::int as n from public.aether_ledger where user_id = $1 and reason = 'pack_purchase'", [u])).n).toBe(15);
    } finally {
      await setEconomy(DEFAULT_PACK_ECONOMY);
      await setWindow();
    }
  });

  it('Review Focus 1: two purchases racing for the last place on the counter: one wins, one is refused, charged once', async () => {
    await setWindow();
    const w = await currentWindow();
    const u = await newUser({ aether: 1000 });
    await hand(u, [...times(7, rar('common')), ...FOUR]); // one place left: the eighth Common
    // The writers serialize on the per-user lock, so two concurrent calls run one after the other; run them in sequence.
    const a = await buy(u, `${w}:rarity-common`, 100);
    const b = await buy(u, `${w}:rarity-common`, 100);
    expect([a.status, b.reason]).toEqual(['ok', 'no_room']);
    expect((await one<{ n: number }>("select count(*)::int as n from public.aether_ledger where user_id = $1", [u])).n).toBe(1);
    expect((await one<{ b: number }>('select balance as b from public.aether_wallets where user_id = $1', [u])).b).toBe(900);
    // ...and each writer really holds that lock until its transaction ends
    const key = (await one<{ k: string }>("select hashtextextended('progression:' || $1, 0)::text as k", [u])).k;
    const p = (await hand(u, [rar('epic')]))[0]!;
    for (const call of [
      ['select public.buy_pack($1, $2, 100, $3)', [u, `${w}:rarity-common`, randomUUID()]],
      ['select public.open_pack($1, $2)', [u, p]],
      ['select public.claim_pack_reward($1, $2)', [u, randomUUID()]],
    ] as const) {
      await db.exec('begin;');
      try {
        await db.query(call[0], [...call[1]]);
        const held = await one<{ n: number }>(
          "select count(*)::int as n from pg_locks where locktype = 'advisory' and granted and ((classid::bigint << 32) | objid::bigint) = $1::bigint",
          [key]);
        expect(held.n, call[0]).toBeGreaterThan(0);
      } finally {
        await db.exec('rollback;');
      }
    }
  });

  it('the switch off refuses the purchase, the opening, the claim and the shop read, and writes nothing', async () => {
    await setWindow();
    const w = await currentWindow();
    const u = await newUser({ aether: 1000 });
    const p = (await hand(u, [rar('epic')]))[0]!;
    await db.query('insert into public.pack_meters (user_id, purchased) values ($1, 15)', [u]);
    const before = await snapshot(u);
    await db.exec('update public.progression_config set packs_enabled = false where id = 1;');
    try {
      expect(await raises('select public.buy_pack($1, $2, 100, $3)', [u, `${w}:rarity-common`, randomUUID()])).toContain('packs_disabled');
      expect(await raises('select public.open_pack($1, $2)', [u, p])).toContain('packs_disabled');
      expect(await raises('select public.claim_pack_reward($1, $2)', [u, randomUUID()])).toContain('packs_disabled');
      expect(await raises('select public.pack_shop_json($1)', [u])).toContain('packs_disabled');
    } finally {
      await db.exec('update public.progression_config set packs_enabled = true where id = 1;');
    }
    expect(await snapshot(u)).toEqual(before);
  });

  it('an offer whose pool emptied mid-window (its category admin_off) is expired, uncharged', async () => {
    await setWindow();
    const w = await currentWindow();
    const u = await newUser({ aether: 1000 });
    expect((await shop(u)).offers.some((o) => o.offerId === `${w}:category-emote`)).toBe(true);
    await db.exec("update public.cosmetic_categories set admin_off = true where category = 'emote';");
    try {
      const before = await snapshot(u);
      const a = await buy(u, `${w}:category-emote`, 200);
      expect(a).toMatchObject({ status: 'error', reason: 'expired', aether: 1000 });
      expect(a.offers!.length).toBeGreaterThan(0);
      expect(await snapshot(u)).toEqual(before);
    } finally {
      await db.exec("update public.cosmetic_categories set admin_off = false where category = 'emote';");
    }
    expect((await buy(u, `${w}:category-emote`, 200)).status).toBe('ok');
  });

  it('an offer of more than one pack (a box, not designed yet) is refused and charges nothing', async () => {
    const offers = await setWindow();
    const w = await currentWindow();
    const i = offers.findIndex((o) => o.offerId === `${w}:rarity-common`);
    await db.query(`update public.pack_shop_windows set offers = jsonb_set(offers, '{${i},contains}', '2') where window_id = $1`, [w]);
    try {
      const u = await newUser({ aether: 1000 });
      const before = await snapshot(u);
      expect(await raises('select public.buy_pack($1, $2, 100, $3)', [u, `${w}:rarity-common`, randomUUID()])).toContain('unsupported_offer');
      expect(await snapshot(u)).toEqual(before);
    } finally {
      await setWindow();
    }
  });

  it('a replayed request answers before the switch: the first packs, even with packs switched off', async () => {
    await setWindow();
    const w = await currentWindow();
    const u = await newUser({ aether: 500 });
    const rid = randomUUID();
    const a = await buy(u, `${w}:rarity-common`, 100, rid);
    expect(a.status).toBe('ok');
    await db.exec('update public.progression_config set packs_enabled = false where id = 1;');
    try {
      expect(await buy(u, `${w}:rarity-common`, 100, rid)).toEqual(a);
      expect(await raises('select public.buy_pack($1, $2, 100, $3)', [u, `${w}:rarity-common`, randomUUID()])).toContain('packs_disabled');
    } finally {
      await db.exec('update public.progression_config set packs_enabled = true where id = 1;');
    }
    expect((await one<{ n: number }>('select count(*)::int as n from public.aether_ledger where user_id = $1', [u])).n).toBe(1);
  });

  it('malformed input raises', async () => {
    const u = await newUser();
    expect(await raises('select public.buy_pack(null, $1, 0, $2)', ['x', randomUUID()])).toContain('unauthenticated');
    expect(await raises('select public.buy_pack($1, $2, 0, null)', [u, 'x'])).toContain('bad_request_id');
    expect(await raises('select public.buy_pack($1, null, 0, $2)', [u, randomUUID()])).toContain('bad_offer_id');
    expect(await raises('select public.buy_pack($1, $2, -1, $3)', [u, 'x', randomUUID()])).toContain('bad_price');
    expect(await raises('select public.buy_pack($1, $2, null, $3)', [u, 'x', randomUUID()])).toContain('bad_price');
    expect(await raises('select public.open_pack($1, null)', [u])).toContain('bad_pack_id');
    expect(await raises('select public.claim_pack_reward($1, null)', [u])).toContain('bad_request_id');
  });
});

describe('claim_pack_reward', () => {
  it('none ready answers none; a ready reward makes one Epic pack, once per request, even beside a full counter', async () => {
    const u = await newUser();
    expect(await claim(u)).toEqual({ status: 'error', reason: 'none' });
    await hand(u, [...times(8, rar('common')), ...FOUR.flatMap((l) => times(8, l))]); // a full counter
    await db.query('insert into public.pack_meters (user_id, purchased) values ($1, 31)', [u]);
    const rid = randomUUID();
    const a = await claim(u, rid);
    expect(a).toMatchObject({ status: 'ok', meter: { progress: 1, ready: 1 } });
    expect(a.packs![0]!.look).toEqual({ kind: 'rarity', id: 'rarity-epic', name: 'Epic Pack', guaranteedFloor: 'epic' });
    expect(await claim(u, rid)).toEqual(a);
    const b = await claim(u);
    expect(b).toMatchObject({ status: 'ok', meter: { progress: 1, ready: 0 } });
    expect(await claim(u)).toEqual({ status: 'error', reason: 'none' });
    expect((await db.query("select source, price_paid, state from public.packs where user_id = $1 and source like 'reward:%' order by source", [u])).rows)
      .toEqual([{ source: 'reward:1', price_paid: 0, state: 'sealed' }, { source: 'reward:2', price_paid: 0, state: 'sealed' }]);
    expect((await one<{ c: number }>('select claimed as c from public.pack_meters where user_id = $1', [u])).c).toBe(2);
    // the reward waits: it is in the hand, after the full counter
    const s = await shop(u);
    expect(s.packs.slice(-2).map((p) => p.packId)).toEqual([a.packs![0]!.packId, b.packs![0]!.packId]);
  });

  it('a guest has nothing to claim and is told so', async () => {
    const g = await newUser({ guest: true });
    await db.query('insert into public.pack_meters (user_id, purchased) values ($1, 15)', [g]);
    const before = await snapshot(g);
    expect(await claim(g)).toEqual({ status: 'error', reason: 'guest' });
    expect(await snapshot(g)).toEqual(before);
  });
});

describe('open_pack', () => {
  it('rolls from the pack row, grants the new cards, and a second open answers the same cards without paying again', async () => {
    const u = await newUser({ aether: 10 });
    const [p] = await hand(u, [rar('legendary')]);
    const a = await open(u, p!);
    expect(a.status).toBe('opened');
    expect(parsePackOpenResult(a)).not.toBeNull();
    expect(a.pack).toEqual({ kind: 'rarity', id: 'rarity-legendary', name: 'Legendary Pack', guaranteedFloor: 'legendary' });
    expect(a.cards.length).toBe(5);
    expect(['legendary', 'ancient']).toContain(a.cards[4]!.rarity);
    const fresh = a.cards.filter((c) => !c.duplicate).map((c) => c.rewardId);
    const owned = (await db.query<{ cosmetic_id: string; source: string; source_id: string }>(
      "select cosmetic_id, source, source_id from public.player_cosmetics where user_id = $1 and source = 'pack'", [u])).rows;
    expect(owned.map((r) => r.cosmetic_id).sort()).toEqual([...new Set(fresh)].sort());
    expect(owned.every((r) => r.source_id === p)).toBe(true);
    const row = await one<{ state: string; roll_version: number; cards: PackCard[] }>('select state, roll_version, cards from public.packs where pack_id = $1', [p]);
    expect(row).toEqual({ state: 'opened', roll_version: PACK_ROLL_VERSION, cards: a.cards });
    const b = await open(u, p!);
    expect(b).toEqual({ ...a, status: 'already_opened' });
  });

  it('duplicates pay their own rarity once: a player owning everything', async () => {
    const u = await newUser({ owned: crate.map((c) => c.id), aether: 10 });
    const [p] = await hand(u, [rar('ancient')]);
    const a = await open(u, p!);
    expect(a.cards.every((c) => c.duplicate)).toBe(true);
    expect(a.cards[4]!.rarity).toBe('ancient');
    const paid = a.cards.reduce((s, c) => s + c.duplicate!.aether, 0);
    for (const c of a.cards) expect(c.duplicate!.aether).toBe(DEFAULT_PACK_ECONOMY.duplicateAether[c.rarity]);
    expect(a.aether).toBe(10 + paid);
    const b = await open(u, p!);
    expect(b.cards).toEqual(a.cards);
    expect(b.aether).toBe(10 + paid);
    expect((await db.query('select delta, reason, source_id from public.aether_ledger where user_id = $1', [u])).rows)
      .toEqual([{ delta: paid, reason: 'pack_duplicate', source_id: p }]);
  });

  it("a category pack's guaranteed card is from its category, from the row (not the caller)", async () => {
    const u = await newUser();
    const [p] = await hand(u, [cat('emote')]);
    const a = await open(u, p!);
    const emotes = new Set(crate.filter((c) => c.category === 'emote').map((c) => c.id));
    expect(emotes.has(a.cards[4]!.rewardId)).toBe(true);
    expect(a.pack).toMatchObject({ kind: 'category', id: 'category-emote', name: 'Emote Pack' });
  });

  it("a guest cannot open; nobody opens another player's pack", async () => {
    const g = await newUser({ guest: true });
    const [p] = await hand(g, [rar('rare')]);
    expect(await open(g, p!)).toMatchObject({ status: 'error', reason: 'guest' });
    expect((await one<{ s: string }>('select state as s from public.packs where pack_id = $1', [p])).s).toBe('sealed');
    const other = await newUser();
    expect(await raises('select public.open_pack($1, $2)', [other, p])).toContain('pack_not_found');
    expect(await raises('select public.open_pack($1, $2)', [other, randomUUID()])).toContain('pack_not_found');
  });

  it('a title from a pack is worn at once only when the player wears none', async () => {
    const titles = crate.filter((c) => c.category === 'title').map((c) => c.id);
    const u = await newUser({ owned: crate.filter((c) => c.category !== 'title').map((c) => c.id) });
    for (let i = 0; i < 6; i++) {
      const [p] = await hand(u, [cat('title')]);
      await open(u, p!);
      const worn = (await one<{ t: string | null }>('select equipped_title_id as t from public.profiles where user_id = $1', [u])).t;
      if (worn) { expect(titles).toContain(worn); return; }
    }
    throw new Error('six Title packs gave no title');
  });
});

describe('pack_shop_json', () => {
  it('the window, the shelves, per-player offers, live odds on Rarity offers only, the hand, the meter and the balance', async () => {
    const offers = await setWindow();
    const w = await currentWindow();
    const emotes = crate.filter((c) => c.category === 'emote').map((c) => c.id);
    const u = await newUser({ owned: emotes, aether: 1234 });
    const ids = await hand(u, [cat('title'), rar('epic'), cat('title')]);
    await db.query('insert into public.pack_meters (user_id, purchased, claimed) values ($1, 17, 1)', [u]);
    const s = await shop(u);
    expect(s.windowId).toBe(w);
    expect(s.windowId).toBe(shopWindowId(new Date()));
    expect(s.nextRefreshAt).toBe(Number((await one<{ n: string }>('select public.pack_next_refresh_at(now())::text as n')).n));
    expect(s.shelves).toEqual([{ id: 'featured', name: 'Daily Featured' }, { id: 'category', name: 'Themed Packs' }, { id: 'rarity', name: 'Rarity Packs' }]);
    expect(s.offers.map((o) => o.offerId)).toEqual(offers.map((o) => o.offerId));
    for (const o of s.offers) {
      if (o.look.kind === 'rarity') expect(o.odds, o.offerId).toEqual(json(rarityPackOdds(o.look.guaranteedFloor)));
      else expect(o.odds, o.offerId).toBeUndefined();
    }
    expect(s.offers.find((o) => o.look.id === 'rarity-rare' && o.shelf === 'rarity')!.odds!.last)
      .toEqual({ common: 0, rare: 47.7, epic: 33.8, legendary: 13.8, ancient: 4.6 });
    const emote = s.offers.find((o) => o.offerId === `${w}:category-emote`)!;
    expect(emote.newToYou).toEqual({ unowned: 0, total: packPool(CATALOG, { category: 'emote' }).length });
    const all = packPool(CATALOG, 'all').length;
    expect(s.offers.find((o) => o.offerId === `${w}:rarity-common`)!.newToYou).toEqual({ unowned: all - packPool(CATALOG, { category: 'emote' }).length, total: all });
    expect(s.packs.map((p) => p.packId)).toEqual(ids);
    expect(s.packMeter).toEqual({ progress: 2, ready: 0 });
    expect(s.aether).toBe(1234);
  });

  it('the odds a Rarity offer shows are re-read from pack_config (what the roll uses)', async () => {
    await setWindow();
    const eco: PackEconomy = { ...DEFAULT_PACK_ECONOMY, standardOdds: { common: 40, rare: 30, epic: 20, legendary: 7, ancient: 3 } };
    await setEconomy(eco);
    try {
      const s = await shop(await newUser());
      for (const o of s.offers.filter((x) => x.look.kind === 'rarity')) expect(o.odds).toEqual(json(rarityPackOdds(o.look.guaranteedFloor, eco)));
    } finally {
      await setEconomy(DEFAULT_PACK_ECONOMY);
    }
  });
});

describe('grants', () => {
  it('the service role calls only the window, the counter check, the shop read and the writers; every helper is internal', async () => {
    const svc = [
      'public.pack_window_id(timestamptz)', 'public.pack_shop_window(text)', 'public.progression_counter_has_room(uuid, text, text)',
      'public.buy_pack(uuid, text, integer, uuid)', 'public.open_pack(uuid, uuid)', 'public.claim_pack_reward(uuid, uuid)', 'public.pack_shop_json(uuid)',
    ];
    const internal = [
      'public.progression_pack_config_int(jsonb, text[])', 'public.progression_pack_config_rarity(jsonb, text)', 'public.progression_pack_clock(timestamptz)',
      'public.pack_next_refresh_at(timestamptz)', 'public.progression_pack_odds(jsonb, text)', 'public.progression_pack_round1(double precision)',
      'public.progression_pack_pool()', 'public.progression_pack_look_json(text, text, text)', 'public.progression_pack_shelf(text, jsonb)',
      'public.progression_pack_window_offers(text, double precision[])', 'public.progression_owned_pack_json(public.packs)',
      'public.progression_pack_hand_json(uuid)', 'public.progression_pack_meter_json(uuid)', 'public.progression_is_guest(uuid)',
      'public.progression_aether_balance(uuid)', 'public.progression_pack_open_json(public.packs, text)',
    ];
    for (const [sigs, s] of [[svc, true], [internal, false]] as const) {
      for (const sig of sigs) {
        const acl = await one(`select has_function_privilege('anon', '${sig}', 'execute') as anon, has_function_privilege('authenticated', '${sig}', 'execute') as auth, has_function_privilege('service_role', '${sig}', 'execute') as svc`);
        expect(acl, sig).toEqual({ anon: false, auth: false, svc: s });
      }
    }
  });

  it('clients cannot read the shop windows table', async () => {
    await setWindow();
    await db.exec('set role authenticated;');
    try {
      expect((await db.query('select * from public.pack_shop_windows')).rows).toEqual([]);
    } finally {
      await db.exec('reset role;');
    }
  });

  it('the file re-runs cleanly over live packs, windows and meters', async () => {
    await setWindow();
    const w = await currentWindow();
    const u = await newUser({ aether: 500 });
    expect((await buy(u, `${w}:rarity-common`, 100)).status).toBe('ok');
    const before = await snapshot(u);
    await db.exec(PACKS);
    await db.exec(API_GRANTS);
    await db.exec('update public.progression_config set packs_enabled = true where id = 1;');
    expect(await snapshot(u)).toEqual(before);
    expect((await buy(u, `${w}:rarity-common`, 100)).status).toBe('ok');
  });
});
