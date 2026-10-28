import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cardPlateOf, catalogHash, catalogSyncPayload, type CatalogSyncPayload } from './cosmetics';
import { parseProgressionProfile } from './rules';

/**
 * THE CARD PLATE SQL, EXECUTED (owner 2026-10-14: "Turn Aquarium Rocks into a real equippable card plate cosmetic").
 * PGlite runs every migration that defines equip_cosmetic in order (the MVP, crates, skins, achievements, hero attack,
 * portrait frames, announcer, emotes) and then the card plate file, syncs the code catalog (which adds the category and
 * Aquarium Rocks), and drives `equip_cosmetic` on the account-wide `card_plate` slot: an owned plate equips with target
 * '' and shows in the loadout; null goes back to the standard plates; a named target, an unowned plate, another item in
 * the plate slot or the plate in another slot is refused; the kill switch drops it; every older slot (emotes included)
 * still works; re-running the file changes nothing; clients can never call it.
 */
const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const MVP = read('2026-09-27-account-progression.sql');
/** The Ancient rarity file's rarity check only (2026-10-02): the code catalog holds Ancient items, which the crates
 *  file's four-rarity check would reject. Its pick + open_crate are crateOdds.db.test.ts's business. */
const ANCIENT_CHECK = ((t: string): string => t.slice(0, t.indexOf('-- ── 1. The pick')))(read('2026-10-02-ancient-rarity.sql'));
/** The Secret rarity file's rarity check + collection column only (2026-11-03): the code catalog holds a Secret item
 *  (the Plushie Plate), which the five-rarity check would reject. Its collection logic is plushiePlate.db.test.ts's. */
const SECRET_CHECK = ((t: string): string => t.slice(0, t.indexOf('-- ── 2. One account')))(readFileSync(join(root, 'supabase/migrations/2026-11-03-secret-plushie-plate.sql'), 'utf8'));
/** In order: every file between the MVP and the card plates that the catalog sync or equip_cosmetic depends on. */
const BEFORE = [
  read('2026-09-28-progression-crates.sql'), read('2026-09-28-progression-skins.sql'), read('2026-09-28-achievements.sql'),
  read('2026-09-28-progression-hero-attack.sql'), read('2026-10-01-portrait-frames.sql'), ANCIENT_CHECK, SECRET_CHECK,
  read('2026-10-11-announcer-slot.sql'), read('2026-10-13-emotes.sql'),
];
const PLATES = read('2026-10-14-card-plates.sql');

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
  for (const f of [...BEFORE, PLATES]) { await db.exec(f); await db.exec(API_GRANTS); }
  expect(await sync()).toBe('synced');
}, 60_000);
afterAll(async () => { await db?.close(); });

/** Every active plate's rarity (owner's rarity pass, 2026-10-19). */
const PLATE_RARITY: Record<string, string> = {
  plate_amethyst: 'rare',
  plate_aquarium_rocks: 'rare',
  plate_armored_knight: 'legendary',
  plate_astral_relic: 'legendary',
  plate_bamboo: 'rare',
  plate_battletorn: 'legendary',
  plate_beach: 'rare',
  plate_blood_omen: 'legendary',
  plate_blossom: 'legendary',
  plate_blue_hand_drawn: 'rare',
  plate_bordered_land: 'legendary',
  plate_burden: 'legendary',
  plate_carved_aetherstone: 'epic',
  plate_celestial: 'legendary',
  plate_chrome: 'epic',
  plate_crackling_gemstone: 'epic',
  plate_dark_arcane: 'epic',
  plate_divine: 'legendary',
  plate_elder: 'epic',
  plate_elegant: 'legendary',
  plate_emerald: 'legendary',
  plate_ethereal: 'legendary',
  plate_frozen_aurora: 'ancient',
  plate_galaxy: 'epic',
  plate_gilt_etched: 'legendary',
  plate_gjally: 'ancient',
  plate_goop: 'epic',
  plate_green_hand_drawn: 'rare',
  plate_gryphon: 'rare',
  plate_hand_drawn: 'rare',
  plate_hivemind: 'legendary',
  plate_honey: 'epic',
  plate_huffle: 'rare',
  plate_iridescent: 'epic',
  plate_ironwood: 'legendary',
  plate_magma: 'rare',
  plate_mooncloud: 'ancient',
  plate_moonstone: 'epic',
  plate_mystic_obsidian: 'legendary',
  plate_mytho: 'legendary',
  plate_nano: 'ancient',
  plate_nimbus_2k: 'epic',
  plate_plasma: 'legendary',
  plate_porcelain: 'epic',
  plate_raven: 'rare',
  plate_round_magic: 'legendary',
  plate_runic: 'epic',
  plate_shotsun: 'legendary',
  plate_simple_black: 'ancient',
  plate_simple_glass: 'ancient',
  plate_simple_white: 'ancient',
  plate_slyther: 'rare',
  plate_smooth_aqua: 'rare',
  plate_smooth_blue: 'rare',
  plate_smooth_iridescent: 'epic',
  plate_smooth_red: 'rare',
  plate_solar: 'legendary',
  plate_soulwitch: 'legendary',
  plate_spades: 'legendary',
  plate_spirit_carving: 'legendary',
  plate_standard_black: 'rare',
  plate_standard_blue: 'rare',
  plate_standard_pink: 'rare',
  plate_standard_teal: 'rare',
  plate_static: 'legendary',
  plate_stonevines: 'epic',
  plate_tattle: 'epic',
  plate_the_howl: 'ancient',
  plate_the_last: 'legendary',
  plate_topaz: 'epic',
  plate_trichalice: 'epic',
  plate_twisted_ether: 'legendary',
  plate_verdant: 'legendary',
  plate_verdant_magic: 'legendary',
  plate_vintage_oak: 'legendary',
  plate_volcanic: 'legendary',
  plate_white_magic: 'epic',
  plate_wither: 'legendary',
};

describe('the card plate slot', () => {
  it('the sync switches the category on (global) and adds the seventy-eight active plates as targetless crate items at their rarity', async () => {
    const cat = await one<{ enabled: boolean; target: string }>("select enabled, target from public.cosmetic_categories where category = 'card_plate'");
    expect(cat).toEqual({ enabled: true, target: 'global' });
    const rows = (await db.query("select cosmetic_id, rarity, acquisition_source, target_type from public.cosmetic_catalog where category = 'card_plate' and active and acquisition_source = 'crate' order by cosmetic_id")).rows;
    expect(rows).toEqual(['plate_amethyst', 'plate_aquarium_rocks', 'plate_armored_knight', 'plate_astral_relic', 'plate_bamboo', 'plate_battletorn', 'plate_beach', 'plate_blood_omen', 'plate_blossom', 'plate_blue_hand_drawn', 'plate_bordered_land', 'plate_burden', 'plate_carved_aetherstone', 'plate_celestial', 'plate_chrome', 'plate_crackling_gemstone', 'plate_dark_arcane', 'plate_divine', 'plate_elder', 'plate_elegant', 'plate_emerald', 'plate_ethereal', 'plate_frozen_aurora', 'plate_galaxy', 'plate_gilt_etched', 'plate_gjally', 'plate_goop', 'plate_green_hand_drawn', 'plate_gryphon', 'plate_hand_drawn', 'plate_hivemind', 'plate_honey', 'plate_huffle', 'plate_iridescent', 'plate_ironwood', 'plate_magma', 'plate_mooncloud', 'plate_moonstone', 'plate_mystic_obsidian', 'plate_mytho', 'plate_nano', 'plate_nimbus_2k', 'plate_plasma', 'plate_porcelain', 'plate_raven', 'plate_round_magic', 'plate_runic', 'plate_shotsun', 'plate_simple_black', 'plate_simple_glass', 'plate_simple_white', 'plate_slyther', 'plate_smooth_aqua', 'plate_smooth_blue', 'plate_smooth_iridescent', 'plate_smooth_red', 'plate_solar', 'plate_soulwitch', 'plate_spades', 'plate_spirit_carving', 'plate_standard_black', 'plate_standard_blue', 'plate_standard_pink', 'plate_standard_teal', 'plate_static', 'plate_stonevines', 'plate_tattle', 'plate_the_howl', 'plate_the_last', 'plate_topaz', 'plate_trichalice', 'plate_twisted_ether', 'plate_verdant', 'plate_verdant_magic', 'plate_vintage_oak', 'plate_volcanic', 'plate_white_magic', 'plate_wither']
      .map((cosmetic_id) => ({ cosmetic_id, rarity: PLATE_RARITY[cosmetic_id], acquisition_source: 'crate', target_type: null })));
    // Plus the Secret Plushie Plate (owner 2026-10-27), an achievement reward and never a crate item.
    expect(await one("select rarity, acquisition_source, achievement_id from public.cosmetic_catalog where cosmetic_id = 'plate_plushie'"))
      .toEqual({ rarity: 'secret', acquisition_source: 'achievement', achievement_id: 'collection.plushie_beasts' });
  });

  it('equips an owned plate with target \'\'; the profile loadout carries it; null goes back to the standard plates', async () => {
    const u = await playerOwning(['plate_aquarium_rocks']);
    const on = await equip(u, 'card_plate', '', 'plate_aquarium_rocks');
    expect(on.loadout).toEqual({ cardPlate: 'plate_aquarium_rocks' });
    expect(cardPlateOf(on.loadout)?.id).toBe('plate_aquarium_rocks');
    const rows = (await db.query('select slot, target_id, cosmetic_id from public.cosmetic_loadouts where user_id = $1', [u])).rows;
    expect(rows).toEqual([{ slot: 'card_plate', target_id: '', cosmetic_id: 'plate_aquarium_rocks' }]);
    const off = await equip(u, 'card_plate', '', null);
    expect(off.loadout?.cardPlate).toBeUndefined();
  });

  it('refuses a named target, an unowned plate, another item in the plate slot and the plate in another slot', async () => {
    const u = await playerOwning(['plate_aquarium_rocks', 'frame_fire', 'skin_albus_1']);
    expect(await raises(EQUIP, [u, 'card_plate', 'k_pouchpincher', 'plate_aquarium_rocks'])).toContain('bad_target');
    expect(await raises(EQUIP, [u, 'card_plate', null, 'plate_aquarium_rocks'])).toContain('bad_target');
    expect(await raises(EQUIP, [u, 'card_plate', '', 'frame_fire'])).toContain('wrong_target');
    expect(await raises(EQUIP, [u, 'card_plate', '', 'skin_albus_1'])).toContain('wrong_target');
    expect(await raises(EQUIP, [u, 'portrait_frame', '', 'plate_aquarium_rocks'])).toContain('wrong_target');
    expect(await raises(EQUIP, [u, 'minion_skin', 'k_pouchpincher', 'plate_aquarium_rocks'])).toContain('wrong_target');
    const stranger = await playerOwning([]);
    expect(await raises(EQUIP, [stranger, 'card_plate', '', 'plate_aquarium_rocks'])).toContain('not_owned');
  });

  it('the category kill switch makes it unequippable and drops it from the loadout (the row survives); restore brings it back', async () => {
    const u = await playerOwning(['plate_aquarium_rocks']);
    await equip(u, 'card_plate', '', 'plate_aquarium_rocks');
    await db.exec("update public.cosmetic_categories set admin_off = true, updated_at = now() where category = 'card_plate';");
    try {
      expect(await raises(EQUIP, [u, 'card_plate', '', 'plate_aquarium_rocks'])).toContain('not_equippable');
      const p = parseProgressionProfile((await one<{ j: unknown }>('select public.progression_profile_json($1) as j', [u])).j)!;
      expect(p.loadout?.cardPlate).toBeUndefined();
      expect((await db.query('select 1 from public.cosmetic_loadouts where user_id = $1', [u])).rows).toHaveLength(1);
    } finally {
      await db.exec("update public.cosmetic_categories set admin_off = false, updated_at = now() where category = 'card_plate';");
    }
    const p = parseProgressionProfile((await one<{ j: unknown }>('select public.progression_profile_json($1) as j', [u])).j)!;
    expect(p.loadout?.cardPlate).toBe('plate_aquarium_rocks');
  });

  it('every older slot works exactly as before under the replaced function, side by side with a plate', async () => {
    const u = await playerOwning(['skin_albus_1', 'attack_blast', 'frame_water', 'announcer_lemon', 'plate_aquarium_rocks', 'emote_zen_brian']); // emotes are crate drops since 2026-10-15
    await equip(u, 'hero_attack', '', 'attack_blast');
    await equip(u, 'portrait_frame', '', 'frame_water');
    await equip(u, 'announcer', '', 'announcer_lemon');
    await equip(u, 'card_plate', '', 'plate_aquarium_rocks');
    await equip(u, 'emote', '1', 'emote_zen_brian');
    const p = await equip(u, 'hero_skin', 'albus', 'skin_albus_1');
    expect(p.loadout).toEqual({
      heroSkinByHeroId: { albus: 'skin_albus_1' }, heroAttack: 'attack_blast', portraitFrame: 'frame_water', announcer: 'announcer_lemon',
      cardPlate: 'plate_aquarium_rocks', emotes: { 1: 'emote_zen_brian' },
    });
    expect(await raises(EQUIP, [u, 'title', '', 'title_wanderer'])).toContain('bad_slot');
    expect(await raises(EQUIP, [u, 'emote', '4', 'emote_zen_brian'])).toContain('bad_target');
  });

  it('is idempotent: re-running the file changes no loadout, ownership or catalog row', async () => {
    const before = (await db.query('select user_id, slot, target_id, cosmetic_id from public.cosmetic_loadouts order by 1, 2, 3')).rows;
    await db.exec(PLATES);
    await db.exec(PLATES);
    expect((await db.query('select user_id, slot, target_id, cosmetic_id from public.cosmetic_loadouts order by 1, 2, 3')).rows).toEqual(before);
    expect(await sync()).toBe('unchanged');
  });

  it('clients can never call it', async () => {
    const acl = await one<{ anon: boolean; auth: boolean; svc: boolean }>(
      "select has_function_privilege('anon', 'public.equip_cosmetic(uuid, text, text, text)', 'execute') as anon, has_function_privilege('authenticated', 'public.equip_cosmetic(uuid, text, text, text)', 'execute') as auth, has_function_privilege('service_role', 'public.equip_cosmetic(uuid, text, text, text)', 'execute') as svc");
    expect(acl).toEqual({ anon: false, auth: false, svc: true });
  });
});
