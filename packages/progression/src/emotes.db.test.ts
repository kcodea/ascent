import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COSMETICS, catalogHash, catalogSyncPayload, emoteLoadoutOf, type CatalogSyncPayload, type CosmeticDef } from './cosmetics';
import { parseProgressionProfile } from './rules';

/**
 * THE EMOTE SQL, EXECUTED (owner spec 2026-10-13: "Players equip up to 4 in Collections"; reworked 2026-10-15: "remove
 * all emotes as 'given' and put them in various loot tiers between rare and legendary", then "all emotes are crate only
 * except give all players the zen brian emote"). PGlite runs the progression migrations in order up to
 * 2026-10-13-emotes.sql, syncs the code catalog (the emote category, Zen Brian as the one STARTER, twenty CRATE emotes since 2026-10-18
 * and the retired Angry Mushy and Sad Wrangler) and drives `equip_cosmetic` on the four-position `emote` slot: Zen Brian equips with no
 * ownership row, a crate emote needs one; a position is '0'..'3'; an emote MOVES (it leaves its other position); every
 * older slot still works; a re-run changes nothing; clients can never call it. It also syncs over the #2099 catalog
 * (Zen Brian a crate item) to prove the move back needs no SQL.
 */
const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const MVP = read('2026-09-27-account-progression.sql');
const CRATES = read('2026-09-28-progression-crates.sql');
const SKINS = read('2026-09-28-progression-skins.sql');
const ACH = read('2026-09-28-achievements.sql');
const ATTACK = read('2026-09-28-progression-hero-attack.sql');
const FRAMES = read('2026-10-01-portrait-frames.sql');
const ANNOUNCER = read('2026-10-11-announcer-slot.sql');
const ANCIENT_CHECK = ((t: string): string => t.slice(0, t.indexOf('-- ── 1. The pick')))(read('2026-10-02-ancient-rarity.sql'));
const EMOTES = read('2026-10-13-emotes.sql');
/** Angry Mushy was a starter until the owner retired it on 2026-10-15 ("remove the angry mushy emote"). */
const RETIRED = 'emote_angry_mushy';
/** Sad Wrangler was a Rare crate emote until the owner retired it on 2026-10-15 ("remove the sad wrangler"). */
const RETIRED_CRATE = 'emote_sad_wrangler';
/** Two crate emotes (Epic, Rare) and THE starter. */
const [A, B] = ['emote_flirty_midas', 'emote_nervous_jensen'];
const Z = 'emote_zen_brian';

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

/** The catalog #2099 shipped (2026-10-15, earlier): Zen Brian a Rare CRATE emote like the rest. */
const CRATE_ERA = catalogSyncPayload(COSMETICS.map((c): CosmeticDef => (c.id === Z ? { ...c, rarity: 'rare', acquisition: { type: 'crate' } } : c)));

let db: PGlite;
let userSeq = 0;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0]!;
}
async function raises(sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); } catch (e) { return String((e as Error).message); }
  return 'no error';
}
async function sync(payload: CatalogSyncPayload = catalogSyncPayload(), hash: string = catalogHash(payload)): Promise<string> {
  return (await one<{ j: { status: string } }>('select public.sync_cosmetic_catalog($1::jsonb, $2) as j', [JSON.stringify(payload), hash])).j.status;
}
async function player(owned: readonly string[] = []): Promise<string> {
  userSeq++;
  const u = `00000000-0000-0000-0000-${String(userSeq).padStart(12, '0')}`;
  await db.query('insert into auth.users (id) values ($1)', [u]);
  await db.query('insert into public.rank_results (user_id, run_id, placement, seed) values ($1, $2, 6, 1)', [u, `r-${u}`]);
  await db.query('select public.settle_progression($1, $2, $3, null, false, 1, null)', [u, 'ranked', `r-${u}`]);
  for (const id of owned) await db.query("insert into public.player_cosmetics (user_id, cosmetic_id, source) values ($1, $2, 'test') on conflict do nothing", [u, id]);
  return u;
}
async function equip(u: string, slot: string, target: string | null, id: string | null) {
  const r = await one<{ j: { status: string; profile: unknown } }>('select public.equip_cosmetic($1, $2, $3, $4) as j', [u, slot, target, id]);
  expect(r.j.status).toBe('equipped');
  return parseProgressionProfile(r.j.profile)!;
}
const EQUIP = 'select public.equip_cosmetic($1, $2, $3, $4)';
const rowsOf = async (u: string) => (await db.query<{ target_id: string; cosmetic_id: string }>("select target_id, cosmetic_id from public.cosmetic_loadouts where user_id = $1 and slot = 'emote' order by target_id", [u])).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MVP);
  await db.exec(API_GRANTS);
  await db.exec(`update public.progression_config set epoch = now() - interval '1 day' where id = 1;`);
  for (const f of [CRATES, SKINS, ACH, ATTACK, FRAMES, ANNOUNCER, ANCIENT_CHECK]) { await db.exec(f); await db.exec(API_GRANTS); }
  // BEFORE the emote file the starters cannot sync: the old acquisition check refuses 'starter' (why the owner runs the
  // SQL before deploying progression-inventory).
  expect(await raises('select public.sync_cosmetic_catalog($1::jsonb, $2)', [JSON.stringify(catalogSyncPayload()), 'pre-emote-hash'])).toMatch(/acquisition_source/);
  await db.exec(EMOTES);
  await db.exec(API_GRANTS);
  expect(await sync()).toBe('synced');
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('the emote catalog (2026-10-15: Zen Brian the one starter, crate emotes, Angry Mushy + Sad Wrangler retired)', () => {
  it('the sync adds the category (global, on), Zen Brian as a starter, twenty live CRATE emotes and the two retired', async () => {
    expect(await one("select enabled, target from public.cosmetic_categories where category = 'emote'")).toEqual({ enabled: true, target: 'global' });
    const rows = (await db.query<{ cosmetic_id: string; acquisition_source: string; rarity: string; active: boolean }>("select cosmetic_id, acquisition_source, rarity, active from public.cosmetic_catalog where category = 'emote' and target_type is null order by cosmetic_id")).rows;
    expect(rows.find((r) => r.cosmetic_id === RETIRED)).toEqual({ cosmetic_id: RETIRED, acquisition_source: 'starter', rarity: 'common', active: false });
    expect(rows.find((r) => r.cosmetic_id === Z)).toEqual({ cosmetic_id: Z, acquisition_source: 'starter', rarity: 'common', active: true });
    expect(rows.find((r) => r.cosmetic_id === RETIRED_CRATE)).toEqual({ cosmetic_id: RETIRED_CRATE, acquisition_source: 'crate', rarity: 'rare', active: false });
    const crate = rows.filter((r) => r.active && r.cosmetic_id !== Z);
    expect(crate).toHaveLength(20);
    expect(crate.every((r) => r.acquisition_source === 'crate')).toBe(true);
    expect(crate.map((r) => r.rarity).sort()).toEqual([...Array(7).fill('epic'), ...Array(5).fill('legendary'), ...Array(8).fill('rare')]);
  });

  it('every crate emote is in a fresh player\x27s crate pool; Zen Brian and the retired one never are', async () => {
    const u = await player();
    const pool = (await db.query<{ pool_cosmetic_id: string }>('select pool_cosmetic_id from public.progression_crate_pool($1)', [u])).rows.map((r) => r.pool_cosmetic_id);
    for (const id of [A, B, 'emote_baby_rubies', 'emote_mad_tormentor', 'emote_iggy', 'emote_pup_pup']) expect(pool).toContain(id);
    expect(pool.filter((id) => id.startsWith('emote_'))).toHaveLength(20);
    expect(pool).not.toContain(Z);
    expect(pool).not.toContain(RETIRED);
    expect(pool).not.toContain(RETIRED_CRATE);
    const owner = await player([A]);
    expect((await db.query<{ pool_cosmetic_id: string }>('select pool_cosmetic_id from public.progression_crate_pool($1)', [owner])).rows.map((r) => r.pool_cosmetic_id)).not.toContain(A);
  });
});

describe('equip_cosmetic: the four-position emote slot', () => {
  it('Zen Brian equips with NO ownership row; a crate emote needs one; the profile loadout carries its position', async () => {
    const stranger = await player();
    expect(await raises(EQUIP, [stranger, 'emote', '0', B])).toContain('not_owned');
    expect((await equip(stranger, 'emote', '2', Z)).loadout).toEqual({ emotes: { 2: Z } });
    expect((await db.query("select 1 from public.player_cosmetics where user_id = $1 and cosmetic_id like 'emote_%'", [stranger])).rows).toHaveLength(0);
    const u = await player([A, B]);
    const p = await equip(u, 'emote', '0', A);
    expect(p.loadout).toEqual({ emotes: { 0: A } });
    expect(emoteLoadoutOf(p.loadout, p.cosmetics)).toEqual([A, B, Z]); // Z pushed out of slot 1 takes the gap; B its own
  });

  it('an emote MOVES: put in another position, it leaves the first; null clears a position', async () => {
    const u = await player([A, B]);
    await equip(u, 'emote', '0', B);
    await equip(u, 'emote', '1', A);
    expect(await rowsOf(u)).toEqual([{ target_id: '0', cosmetic_id: B }, { target_id: '1', cosmetic_id: A }]);
    await equip(u, 'emote', '3', B);
    expect(await rowsOf(u)).toEqual([{ target_id: '1', cosmetic_id: A }, { target_id: '3', cosmetic_id: B }]);
    await equip(u, 'emote', '1', null);
    expect(await rowsOf(u)).toEqual([{ target_id: '3', cosmetic_id: B }]);
  });

  it('refuses a bad position, a non-emote, an emote in another slot, and the retired emote', async () => {
    const u = await player(['frame_fire', A]);
    for (const t of ['', '4', '01', 'albus']) expect(await raises(EQUIP, [u, 'emote', t, A]), t).toContain('bad_target');
    expect(await raises(EQUIP, [u, 'emote', null, A])).toContain('bad_target');
    expect(await raises(EQUIP, [u, 'emote', '0', 'frame_fire'])).toContain('wrong_target');
    expect(await raises(EQUIP, [u, 'portrait_frame', '', A])).toContain('wrong_target');
    expect(await raises(EQUIP, [u, 'emote', '0', RETIRED])).toContain('not_equippable');
    expect((await equip(u, 'emote', '2', A)).loadout).toEqual({ emotes: { 2: A } });
  });

  it('the kill switch: a disabled category refuses the equip and drops the rows from the profile (they survive)', async () => {
    const u = await player([A, B]);
    await equip(u, 'emote', '0', A);
    await db.exec("update public.cosmetic_categories set admin_off = true, updated_at = now() where category = 'emote';");
    try {
      expect(await raises(EQUIP, [u, 'emote', '1', B])).toContain('not_equippable');
      const p = parseProgressionProfile((await one<{ j: unknown }>('select public.progression_profile_json($1) as j', [u])).j)!;
      expect(p.loadout?.emotes).toBeUndefined();
      expect(await rowsOf(u)).toHaveLength(1);
    } finally {
      await db.exec("update public.cosmetic_categories set admin_off = false, updated_at = now() where category = 'emote';");
    }
  });

  it('every older slot works exactly as before under the replaced function, side by side with emotes', async () => {
    const u = await player(['skin_albus_1', 'attack_blast', 'frame_water', 'announcer_lemon', A]);
    await equip(u, 'hero_attack', '', 'attack_blast');
    await equip(u, 'portrait_frame', '', 'frame_water');
    await equip(u, 'announcer', '', 'announcer_lemon');
    await equip(u, 'emote', '2', A);
    const p = await equip(u, 'hero_skin', 'albus', 'skin_albus_1');
    expect(p.loadout).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, heroAttack: 'attack_blast', portraitFrame: 'frame_water', announcer: 'announcer_lemon', emotes: { 2: A } });
    expect(await raises(EQUIP, [u, 'announcer', 'x', 'announcer_lemon'])).toContain('bad_target');
    expect(await raises(EQUIP, [u, 'title', '', 'title_wanderer'])).toContain('bad_slot');
  });
});

describe('retiring an OWNED crate emote (2026-10-15: "remove the sad wrangler"), by the catalog sync alone', () => {
  it('an owner who had it equipped keeps the ownership row; the loadout drops it, it cannot be equipped, no crate offers it', async () => {
    const live = catalogSyncPayload(COSMETICS.map((c): CosmeticDef => (c.id === RETIRED_CRATE ? { ...c, active: true } : c)));
    expect(await sync(live)).toBe('synced');
    let u = '';
    try {
      u = await player([RETIRED_CRATE, A]);
      expect((await equip(u, 'emote', '1', RETIRED_CRATE)).loadout).toEqual({ emotes: { 1: RETIRED_CRATE } });
    } finally {
      expect(await sync()).toBe('synced');
    }
    expect((await db.query('select 1 from public.player_cosmetics where user_id = $1 and cosmetic_id = $2', [u, RETIRED_CRATE])).rows).toHaveLength(1);
    expect(await rowsOf(u)).toEqual([{ target_id: '1', cosmetic_id: RETIRED_CRATE }]); // the row survives, ignored
    const p = parseProgressionProfile((await one<{ j: unknown }>('select public.progression_profile_json($1) as j', [u])).j)!;
    expect(p.loadout?.emotes).toBeUndefined();
    expect(emoteLoadoutOf(p.loadout, p.cosmetics)).toEqual([Z, A]); // the client never shows it, owned or not
    expect(await raises(EQUIP, [u, 'emote', '2', RETIRED_CRATE])).toContain('not_equippable');
    const fresh = await player();
    expect((await db.query<{ pool_cosmetic_id: string }>('select pool_cosmetic_id from public.progression_crate_pool($1)', [fresh])).rows.map((r) => r.pool_cosmetic_id)).not.toContain(RETIRED_CRATE);
  });
});

describe('the move back (2026-10-15): Zen Brian a starter again, by the catalog sync alone', () => {
  it('under the #2099 catalog Zen Brian needs ownership; one sync later it is everyone\x27s and leaves the pool', async () => {
    expect(await sync(CRATE_ERA)).toBe('synced');
    let u = '';
    try {
      u = await player();
      expect(await raises(EQUIP, [u, 'emote', '0', Z])).toContain('not_owned');
      expect((await db.query<{ pool_cosmetic_id: string }>('select pool_cosmetic_id from public.progression_crate_pool($1)', [u])).rows.map((r) => r.pool_cosmetic_id)).toContain(Z);
    } finally {
      expect(await sync()).toBe('synced');
    }
    expect((await equip(u, 'emote', '0', Z)).loadout).toEqual({ emotes: { 0: Z } });
    expect((await db.query<{ pool_cosmetic_id: string }>('select pool_cosmetic_id from public.progression_crate_pool($1)', [u])).rows.map((r) => r.pool_cosmetic_id)).not.toContain(Z);
    // A fresh account's menu: Zen Brian, then three empty slots.
    const fresh = await player();
    const f = parseProgressionProfile((await one<{ j: unknown }>('select public.progression_profile_json($1) as j', [fresh])).j)!;
    expect(emoteLoadoutOf(f.loadout, f.cosmetics)).toEqual([Z]);
  });

  it('is idempotent: re-running the emote file changes no loadout, ownership or catalog row', async () => {
    const before = (await db.query('select user_id, slot, target_id, cosmetic_id from public.cosmetic_loadouts order by 1, 2, 3')).rows;
    await db.exec(EMOTES);
    await db.exec(EMOTES);
    expect((await db.query('select user_id, slot, target_id, cosmetic_id from public.cosmetic_loadouts order by 1, 2, 3')).rows).toEqual(before);
    expect(await sync()).toBe('unchanged');
  });

  it('clients can never call it', async () => {
    const acl = await one<{ anon: boolean; auth: boolean; svc: boolean }>(
      "select has_function_privilege('anon', 'public.equip_cosmetic(uuid, text, text, text)', 'execute') as anon, has_function_privilege('authenticated', 'public.equip_cosmetic(uuid, text, text, text)', 'execute') as auth, has_function_privilege('service_role', 'public.equip_cosmetic(uuid, text, text, text)', 'execute') as svc");
    expect(acl).toEqual({ anon: false, auth: false, svc: true });
  });
});
