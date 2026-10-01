import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogHash, catalogSyncPayload, portraitFrameOf, type CatalogSyncPayload } from './cosmetics';
import { parseProgressionProfile } from './rules';

/**
 * THE PORTRAIT FRAME SQL, EXECUTED (owner 2026-10-01: "we're adding portrait skins ... we want this to replace the
 * default portrait png when a skin is applied"). PGlite runs the MVP, crates, skins, achievements, hero attack and
 * portrait frame migrations in order, syncs the code catalog (which adds the category and the 26 frames), and drives
 * `equip_cosmetic` on the account-wide `portrait_frame` slot: an owned frame equips with target '' and shows in the
 * loadout; null goes back to the default ring; a named target, an unowned frame, a frame in another slot or another
 * item in the frame slot is refused; the kill switch drops it; the hero attack and skin slots still work; re-running
 * the file changes nothing; clients can never call it.
 */
const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const MVP = read('2026-09-27-account-progression.sql');
const CRATES = read('2026-09-28-progression-crates.sql');
const SKINS = read('2026-09-28-progression-skins.sql');
const ACH = read('2026-09-28-achievements.sql');
const ATTACK = read('2026-09-28-progression-hero-attack.sql');
const FRAMES = read('2026-10-01-portrait-frames.sql');

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
async function raises(sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); } catch (e) { return String((e as Error).message); }
  return 'no error';
}
async function sync(payload: CatalogSyncPayload = catalogSyncPayload(), hash: string = catalogHash(payload)): Promise<string> {
  return (await one<{ j: { status: string } }>('select public.sync_cosmetic_catalog($1::jsonb, $2) as j', [JSON.stringify(payload), hash])).j.status;
}
async function playerOwning(ids: readonly string[]): Promise<string> {
  userSeq++;
  const u = `00000000-0000-0000-0000-${String(userSeq).padStart(12, '0')}`;
  await db.query('insert into auth.users (id) values ($1)', [u]);
  await db.query('insert into public.rank_results (user_id, run_id, placement, seed) values ($1, $2, 6, 1)', [u, `r-${u}`]);
  await db.query('select public.settle_progression($1, $2, $3, null, false, 1, null)', [u, 'ranked', `r-${u}`]);
  for (const id of ids) await db.query("insert into public.player_cosmetics (user_id, cosmetic_id, source) values ($1, $2, 'test') on conflict do nothing", [u, id]);
  return u;
}
async function equip(u: string, slot: string | null, target: string | null, id: string | null) {
  const r = await one<{ j: { status: string; profile: unknown } }>('select public.equip_cosmetic($1, $2, $3, $4) as j', [u, slot, target, id]);
  expect(r.j.status).toBe('equipped');
  return parseProgressionProfile(r.j.profile)!;
}
const EQUIP = 'select public.equip_cosmetic($1, $2, $3, $4)';

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MVP);
  await db.exec(API_GRANTS);
  await db.exec(`update public.progression_config set epoch = now() - interval '1 day' where id = 1;`);
  for (const f of [CRATES, SKINS, ACH, ATTACK, FRAMES]) { await db.exec(f); await db.exec(API_GRANTS); }
  expect(await sync()).toBe('synced');
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('the portrait frame slot', () => {
  it('the sync switches the category on (global) and adds the 26 frames as targetless crate items at their rarity', async () => {
    const cat = await one<{ enabled: boolean; target: string }>("select enabled, target from public.cosmetic_categories where category = 'portrait_frame'");
    expect(cat).toEqual({ enabled: true, target: 'global' });
    const rows = (await db.query<{ rarity: string; n: number }>("select rarity, count(*)::int as n from public.cosmetic_catalog where category = 'portrait_frame' and active and acquisition_source = 'crate' and target_type is null group by rarity order by rarity")).rows;
    expect(rows).toEqual([{ rarity: 'common', n: 5 }, { rarity: 'epic', n: 8 }, { rarity: 'legendary', n: 5 }, { rarity: 'rare', n: 8 }]);
  });

  it('equips an owned frame with target \'\'; the profile loadout carries it; null goes back to the default ring', async () => {
    const u = await playerOwning(['frame_fire']);
    const on = await equip(u, 'portrait_frame', '', 'frame_fire');
    expect(on.loadout).toEqual({ portraitFrame: 'frame_fire' });
    expect(portraitFrameOf(on.loadout)?.id).toBe('frame_fire');
    const rows = (await db.query('select slot, target_id, cosmetic_id from public.cosmetic_loadouts where user_id = $1', [u])).rows;
    expect(rows).toEqual([{ slot: 'portrait_frame', target_id: '', cosmetic_id: 'frame_fire' }]);
    const off = await equip(u, 'portrait_frame', '', null);
    expect(off.loadout?.portraitFrame).toBeUndefined();
  });

  it('refuses a named target, an unowned frame, another item in the frame slot and the frame in another slot', async () => {
    const u = await playerOwning(['frame_fire', 'attack_blast', 'skin_albus_1']);
    expect(await raises(EQUIP, [u, 'portrait_frame', 'albus', 'frame_fire'])).toContain('bad_target');
    expect(await raises(EQUIP, [u, 'portrait_frame', null, 'frame_fire'])).toContain('bad_target');
    expect(await raises(EQUIP, [u, 'portrait_frame', '', 'attack_blast'])).toContain('wrong_target');
    expect(await raises(EQUIP, [u, 'portrait_frame', '', 'skin_albus_1'])).toContain('wrong_target');
    expect(await raises(EQUIP, [u, 'hero_attack', '', 'frame_fire'])).toContain('wrong_target');
    expect(await raises(EQUIP, [u, 'hero_skin', 'albus', 'frame_fire'])).toContain('wrong_target');
    const stranger = await playerOwning([]);
    expect(await raises(EQUIP, [stranger, 'portrait_frame', '', 'frame_fire'])).toContain('not_owned');
  });

  it('the category kill switch makes it unequippable and drops it from the loadout (the row survives); restore brings it back', async () => {
    const u = await playerOwning(['frame_gold']);
    await equip(u, 'portrait_frame', '', 'frame_gold');
    await db.exec("update public.cosmetic_categories set admin_off = true, updated_at = now() where category = 'portrait_frame';");
    try {
      expect(await raises(EQUIP, [u, 'portrait_frame', '', 'frame_gold'])).toContain('not_equippable');
      const p = parseProgressionProfile((await one<{ j: unknown }>('select public.progression_profile_json($1) as j', [u])).j)!;
      expect(p.loadout?.portraitFrame).toBeUndefined();
      expect((await db.query('select 1 from public.cosmetic_loadouts where user_id = $1', [u])).rows).toHaveLength(1);
    } finally {
      await db.exec("update public.cosmetic_categories set admin_off = false, updated_at = now() where category = 'portrait_frame';");
    }
    const p = parseProgressionProfile((await one<{ j: unknown }>('select public.progression_profile_json($1) as j', [u])).j)!;
    expect(p.loadout?.portraitFrame).toBe('frame_gold');
  });

  it('the hero attack and skin slots work exactly as before under the replaced function, side by side with a frame', async () => {
    const u = await playerOwning(['skin_albus_1', 'attack_blast', 'frame_water']);
    await equip(u, 'hero_attack', '', 'attack_blast');
    await equip(u, 'portrait_frame', '', 'frame_water');
    const p = await equip(u, 'hero_skin', 'albus', 'skin_albus_1');
    expect(p.loadout).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, heroAttack: 'attack_blast', portraitFrame: 'frame_water' });
    expect(await raises(EQUIP, [u, 'title', '', 'title_wanderer'])).toContain('bad_slot');
  });

  it('is idempotent: re-running the file changes no loadout, ownership or catalog row', async () => {
    const before = (await db.query('select user_id, slot, target_id, cosmetic_id from public.cosmetic_loadouts order by 1, 2, 3')).rows;
    await db.exec(FRAMES);
    await db.exec(FRAMES);
    expect((await db.query('select user_id, slot, target_id, cosmetic_id from public.cosmetic_loadouts order by 1, 2, 3')).rows).toEqual(before);
    expect(await sync()).toBe('unchanged');
  });

  it('clients can never call it', async () => {
    const acl = await one<{ anon: boolean; auth: boolean; svc: boolean }>(
      "select has_function_privilege('anon', 'public.equip_cosmetic(uuid, text, text, text)', 'execute') as anon, has_function_privilege('authenticated', 'public.equip_cosmetic(uuid, text, text, text)', 'execute') as auth, has_function_privilege('service_role', 'public.equip_cosmetic(uuid, text, text, text)', 'execute') as svc");
    expect(acl).toEqual({ anon: false, auth: false, svc: true });
  });
});
