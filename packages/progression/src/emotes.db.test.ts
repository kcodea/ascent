import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COSMETICS, catalogHash, catalogSyncPayload, emoteLoadoutOf, type CatalogSyncPayload, type CosmeticDef } from './cosmetics';
import { parseProgressionProfile } from './rules';

/**
 * THE EMOTE SQL, EXECUTED (owner spec 2026-10-13: "Players equip up to 4 in Collections. Unlock source: crates, plus
 * starter emotes everyone owns"). PGlite runs the progression migrations in order up to 2026-10-13-emotes.sql, syncs
 * the code catalog (the emote category and the four STARTER emotes, whose acquisition the new check allows), and drives
 * `equip_cosmetic` on the four-position `emote` slot: a starter equips with NO ownership row; a position is '0'..'3'; an
 * emote MOVES (it leaves its other position); a crate emote still needs ownership; every older slot still works; a
 * re-run changes nothing; clients can never call it.
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
const [A, B, C, D] = ['emote_angry_mushy', 'emote_flirty_midas', 'emote_nervous_jensen', 'emote_zen_brian'];

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

/** A CRATE emote (none ships yet): proves the ordinary ownership path still guards the slot. */
const CRATE_EMOTE: CosmeticDef = { id: 'emote_test_crate', category: 'emote', name: 'Test', rarity: 'rare', acquisition: { type: 'crate' }, assets: {}, active: true };
const WITH_CRATE_EMOTE = catalogSyncPayload([...COSMETICS, CRATE_EMOTE]);

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
  expect(await sync(WITH_CRATE_EMOTE)).toBe('synced');
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('the emote category and the starter acquisition', () => {
  it('the sync adds the category (global, on) and the four starters as targetless starter items', async () => {
    expect(await one("select enabled, target from public.cosmetic_categories where category = 'emote'")).toEqual({ enabled: true, target: 'global' });
    const rows = (await db.query<{ cosmetic_id: string; acquisition_source: string }>("select cosmetic_id, acquisition_source from public.cosmetic_catalog where category = 'emote' and target_type is null order by cosmetic_id")).rows;
    expect(rows).toEqual([
      { cosmetic_id: A, acquisition_source: 'starter' }, { cosmetic_id: B, acquisition_source: 'starter' },
      { cosmetic_id: C, acquisition_source: 'starter' }, { cosmetic_id: CRATE_EMOTE.id, acquisition_source: 'crate' },
      { cosmetic_id: D, acquisition_source: 'starter' },
    ]);
  });

  it('starters are never in the crate pool; a crate emote is', async () => {
    const u = await player();
    const pool = (await db.query<{ pool_cosmetic_id: string }>('select pool_cosmetic_id from public.progression_crate_pool($1)', [u])).rows.map((r) => r.pool_cosmetic_id);
    expect(pool).toContain(CRATE_EMOTE.id);
    for (const id of [A, B, C, D]) expect(pool).not.toContain(id);
  });
});

describe('equip_cosmetic: the four-position emote slot', () => {
  it('a starter equips with NO ownership row; the profile loadout carries its position', async () => {
    const u = await player();
    const p = await equip(u, 'emote', '0', C);
    expect(p.loadout).toEqual({ emotes: { 0: C } });
    expect(emoteLoadoutOf(p.loadout)).toEqual([C, B, A, D]);
    expect((await db.query("select 1 from public.player_cosmetics where user_id = $1 and cosmetic_id like 'emote_%'", [u])).rows).toHaveLength(0);
  });

  it('an emote MOVES: put in another position, it leaves the first; null clears a position', async () => {
    const u = await player();
    await equip(u, 'emote', '0', D);
    await equip(u, 'emote', '1', A);
    expect(await rowsOf(u)).toEqual([{ target_id: '0', cosmetic_id: D }, { target_id: '1', cosmetic_id: A }]);
    const p = await equip(u, 'emote', '3', D);
    expect(await rowsOf(u)).toEqual([{ target_id: '1', cosmetic_id: A }, { target_id: '3', cosmetic_id: D }]);
    expect(emoteLoadoutOf(p.loadout)).toEqual([B, A, C, D]);
    await equip(u, 'emote', '1', null);
    expect(await rowsOf(u)).toEqual([{ target_id: '3', cosmetic_id: D }]);
  });

  it('refuses a bad position, a non-emote, an emote in another slot, and an unowned CRATE emote (owned: fine)', async () => {
    const u = await player(['frame_fire']);
    for (const t of ['', '4', '01', 'albus']) expect(await raises(EQUIP, [u, 'emote', t, A]), t).toContain('bad_target');
    expect(await raises(EQUIP, [u, 'emote', null, A])).toContain('bad_target');
    expect(await raises(EQUIP, [u, 'emote', '0', 'frame_fire'])).toContain('wrong_target');
    expect(await raises(EQUIP, [u, 'portrait_frame', '', A])).toContain('wrong_target');
    expect(await raises(EQUIP, [u, 'emote', '0', CRATE_EMOTE.id])).toContain('not_owned');
    const owner = await player([CRATE_EMOTE.id]);
    expect((await equip(owner, 'emote', '2', CRATE_EMOTE.id)).loadout).toEqual({ emotes: { 2: CRATE_EMOTE.id } });
  });

  it('the kill switch: a disabled category refuses the equip and drops the rows from the profile (they survive)', async () => {
    const u = await player();
    await equip(u, 'emote', '0', B);
    await db.exec("update public.cosmetic_categories set admin_off = true, updated_at = now() where category = 'emote';");
    try {
      expect(await raises(EQUIP, [u, 'emote', '1', A])).toContain('not_equippable');
      const p = parseProgressionProfile((await one<{ j: unknown }>('select public.progression_profile_json($1) as j', [u])).j)!;
      expect(p.loadout?.emotes).toBeUndefined();
      expect(await rowsOf(u)).toHaveLength(1);
    } finally {
      await db.exec("update public.cosmetic_categories set admin_off = false, updated_at = now() where category = 'emote';");
    }
  });

  it('every older slot works exactly as before under the replaced function, side by side with emotes', async () => {
    const u = await player(['skin_albus_1', 'attack_blast', 'frame_water', 'announcer_lemon']);
    await equip(u, 'hero_attack', '', 'attack_blast');
    await equip(u, 'portrait_frame', '', 'frame_water');
    await equip(u, 'announcer', '', 'announcer_lemon');
    await equip(u, 'emote', '2', A);
    const p = await equip(u, 'hero_skin', 'albus', 'skin_albus_1');
    expect(p.loadout).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, heroAttack: 'attack_blast', portraitFrame: 'frame_water', announcer: 'announcer_lemon', emotes: { 2: A } });
    expect(await raises(EQUIP, [u, 'announcer', 'x', 'announcer_lemon'])).toContain('bad_target');
    expect(await raises(EQUIP, [u, 'title', '', 'title_wanderer'])).toContain('bad_slot');
  });

  it('is idempotent: re-running the file changes no loadout, ownership or catalog row', async () => {
    const before = (await db.query('select user_id, slot, target_id, cosmetic_id from public.cosmetic_loadouts order by 1, 2, 3')).rows;
    await db.exec(EMOTES);
    await db.exec(EMOTES);
    expect((await db.query('select user_id, slot, target_id, cosmetic_id from public.cosmetic_loadouts order by 1, 2, 3')).rows).toEqual(before);
    expect(await sync(WITH_CRATE_EMOTE)).toBe('unchanged');
  });

  it('clients can never call it', async () => {
    const acl = await one<{ anon: boolean; auth: boolean; svc: boolean }>(
      "select has_function_privilege('anon', 'public.equip_cosmetic(uuid, text, text, text)', 'execute') as anon, has_function_privilege('authenticated', 'public.equip_cosmetic(uuid, text, text, text)', 'execute') as auth, has_function_privilege('service_role', 'public.equip_cosmetic(uuid, text, text, text)', 'execute') as svc");
    expect(acl).toEqual({ anon: false, auth: false, svc: true });
  });
});
