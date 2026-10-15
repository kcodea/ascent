import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COSMETICS, catalogHash, catalogSyncPayload, emoteLoadoutOf, type CatalogSyncPayload, type CosmeticDef } from './cosmetics';
import { parseProgressionProfile } from './rules';

/**
 * THE EMOTE SQL, EXECUTED (owner spec 2026-10-13: "Players equip up to 4 in Collections"; reworked 2026-10-15: "remove
 * all emotes as 'given' and put them in various loot tiers between rare and legendary"). PGlite runs the progression
 * migrations in order up to 2026-10-13-emotes.sql, syncs the code catalog (the emote category, thirteen CRATE emotes
 * and the retired starter Angry Mushy) and drives `equip_cosmetic` on the four-position `emote` slot: an emote needs
 * an ownership row; a position is '0'..'3'; an emote MOVES (it leaves its other position); every older slot still
 * works; a re-run changes nothing; clients can never call it. It also runs the 2026-10-15 grandfather file over the
 * 2026-10-13 catalog (three live starters) and the move to the current one.
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
const SEEN = read('2026-10-11-cosmetics-seen.sql'); // the grandfather file writes seen_at
const ANCIENT_CHECK = ((t: string): string => t.slice(0, t.indexOf('-- ── 1. The pick')))(read('2026-10-02-ancient-rarity.sql'));
const EMOTES = read('2026-10-13-emotes.sql');
const GRANDFATHER = read('2026-10-15-emotes-grandfather.sql');
/** Angry Mushy was a starter until the owner retired it on 2026-10-15 ("remove the angry mushy emote"). */
const RETIRED = 'emote_angry_mushy';
/** The three starters of 2026-10-13 that became crate emotes on 2026-10-15. */
const [A, B, C] = ['emote_flirty_midas', 'emote_nervous_jensen', 'emote_zen_brian'];

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

/** The catalog as it was on 2026-10-13: the four starter emotes, all live (and none of the later emotes). */
const STARTER_ERA = catalogSyncPayload(COSMETICS
  .filter((c) => c.category !== 'emote' || ['emote_angry_mushy', A, B, C].includes(c.id))
  .map((c): CosmeticDef => (c.category === 'emote' ? { ...c, rarity: 'common', acquisition: { type: 'starter' }, active: true } : c)));

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
  for (const f of [CRATES, SKINS, ACH, ATTACK, FRAMES, ANNOUNCER, SEEN, ANCIENT_CHECK]) { await db.exec(f); await db.exec(API_GRANTS); }
  // BEFORE the emote file the starters cannot sync: the old acquisition check refuses 'starter' (why the owner runs the
  // SQL before deploying progression-inventory).
  expect(await raises('select public.sync_cosmetic_catalog($1::jsonb, $2)', [JSON.stringify(catalogSyncPayload()), 'pre-emote-hash'])).toMatch(/acquisition_source/);
  await db.exec(EMOTES);
  await db.exec(API_GRANTS);
  expect(await sync()).toBe('synced');
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('the emote catalog (2026-10-15: crate emotes, Angry Mushy retired)', () => {
  it('the sync adds the category (global, on), thirteen live CRATE emotes and the retired starter', async () => {
    expect(await one("select enabled, target from public.cosmetic_categories where category = 'emote'")).toEqual({ enabled: true, target: 'global' });
    const rows = (await db.query<{ cosmetic_id: string; acquisition_source: string; rarity: string; active: boolean }>("select cosmetic_id, acquisition_source, rarity, active from public.cosmetic_catalog where category = 'emote' and target_type is null order by cosmetic_id")).rows;
    expect(rows.find((r) => r.cosmetic_id === RETIRED)).toEqual({ cosmetic_id: RETIRED, acquisition_source: 'starter', rarity: 'common', active: false });
    const live = rows.filter((r) => r.active);
    expect(live).toHaveLength(13);
    expect(live.every((r) => r.acquisition_source === 'crate')).toBe(true);
    expect(live.map((r) => r.rarity).sort()).toEqual([...Array(4).fill('epic'), ...Array(3).fill('legendary'), ...Array(6).fill('rare')]);
    expect(rows.filter((r) => [A, B, C].includes(r.cosmetic_id)).map((r) => [r.cosmetic_id, r.rarity])).toEqual([[A, 'epic'], [B, 'rare'], [C, 'rare']]);
  });

  it('every live emote is in a fresh player\x27s crate pool; the retired one never is', async () => {
    const u = await player();
    const pool = (await db.query<{ pool_cosmetic_id: string }>('select pool_cosmetic_id from public.progression_crate_pool($1)', [u])).rows.map((r) => r.pool_cosmetic_id);
    for (const id of [A, B, C, 'emote_baby_rubies', 'emote_mad_tormentor']) expect(pool).toContain(id);
    expect(pool.filter((id) => id.startsWith('emote_'))).toHaveLength(13);
    expect(pool).not.toContain(RETIRED);
    const owner = await player([A]);
    expect((await db.query<{ pool_cosmetic_id: string }>('select pool_cosmetic_id from public.progression_crate_pool($1)', [owner])).rows.map((r) => r.pool_cosmetic_id)).not.toContain(A);
  });
});

describe('equip_cosmetic: the four-position emote slot', () => {
  it('an emote needs an ownership row (no emote is given away any more); the profile loadout carries its position', async () => {
    const stranger = await player();
    expect(await raises(EQUIP, [stranger, 'emote', '0', B])).toContain('not_owned');
    const u = await player([A, B, C]);
    const p = await equip(u, 'emote', '0', C);
    expect(p.loadout).toEqual({ emotes: { 0: C } });
    expect(emoteLoadoutOf(p.loadout, p.cosmetics)).toEqual([C, B, A]); // owned, in catalog order: B, C (Rares), A (Epic)
  });

  it('an emote MOVES: put in another position, it leaves the first; null clears a position', async () => {
    const u = await player([A, B, C]);
    await equip(u, 'emote', '0', C);
    await equip(u, 'emote', '1', A);
    expect(await rowsOf(u)).toEqual([{ target_id: '0', cosmetic_id: C }, { target_id: '1', cosmetic_id: A }]);
    await equip(u, 'emote', '3', C);
    expect(await rowsOf(u)).toEqual([{ target_id: '1', cosmetic_id: A }, { target_id: '3', cosmetic_id: C }]);
    await equip(u, 'emote', '1', null);
    expect(await rowsOf(u)).toEqual([{ target_id: '3', cosmetic_id: C }]);
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

describe('the 2026-10-15 move: starters become crate emotes, Angry Mushy retires', () => {
  it('the grandfather file gives every existing account the three former starters (seen), once; a slot keeps its emote', async () => {
    expect(await sync(STARTER_ERA)).toBe('synced');
    let veteran = '';
    let quiet = '';
    try {
      veteran = await player();
      await equip(veteran, 'emote', '0', RETIRED); // starters equip with no ownership row in the 2026-10-13 catalog
      await equip(veteran, 'emote', '1', C);
      quiet = await player(); // never touched the menu: the starters were simply its default
      const rev = async (u: string) => (await one<{ r: number }>('select progression_revision as r from public.profiles where user_id = $1', [u])).r;
      const before = await rev(veteran);
      await db.exec(GRANDFATHER);
      expect(await rev(veteran)).toBe(before + 1);
      const owned = async (u: string) => (await db.query<{ cosmetic_id: string; source: string; seen: boolean }>("select cosmetic_id, source, seen_at is not null as seen from public.player_cosmetics where user_id = $1 and cosmetic_id like 'emote_%' order by cosmetic_id", [u])).rows;
      for (const u of [veteran, quiet]) {
        expect(await owned(u)).toEqual([A, B, C].map((id) => ({ cosmetic_id: id, source: 'starter_grandfather', seen: true })));
      }
      await db.exec(GRANDFATHER); // a re-run changes nothing
      expect(await rev(veteran)).toBe(before + 1);
      expect(await owned(veteran)).toHaveLength(3);
    } finally {
      expect(await sync()).toBe('synced');
    }
    // After the move: the retired emote leaves the profile at once (its row survives), the owned one stays where it was.
    const p = parseProgressionProfile((await one<{ j: unknown }>('select public.progression_profile_json($1) as j', [veteran])).j)!;
    expect(p.loadout).toEqual({ emotes: { 1: C } });
    expect(emoteLoadoutOf(p.loadout, p.cosmetics)).toEqual([B, C, A]);
    expect(await rowsOf(veteran)).toEqual([{ target_id: '0', cosmetic_id: RETIRED }, { target_id: '1', cosmetic_id: C }]);
    const q = parseProgressionProfile((await one<{ j: unknown }>('select public.progression_profile_json($1) as j', [quiet])).j)!;
    expect(emoteLoadoutOf(q.loadout, q.cosmetics)).toEqual([B, C, A]);
    // An account made after the file ran owns nothing.
    const fresh = await player();
    const f = parseProgressionProfile((await one<{ j: unknown }>('select public.progression_profile_json($1) as j', [fresh])).j)!;
    expect(emoteLoadoutOf(f.loadout, f.cosmetics)).toEqual([]);
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
