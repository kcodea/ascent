import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogHash, catalogSyncPayload, heroAttackOf, type CatalogSyncPayload } from './cosmetics';
import { parseProgressionProfile } from './rules';

/**
 * THE HERO ATTACK SQL, EXECUTED (owner 2026-09-28: "the new blast attack is going to be a cosmetic unlock, not a
 * new default"). PGlite runs the MVP, crates, skins and hero attack migrations in order, syncs the code catalog, and
 * drives `equip_cosmetic` on the account-wide `hero_attack` slot: an owned attack equips with target '' and shows in
 * the profile's loadout; null goes back to Classic; any other target, an unowned item, a skin in the attack slot or
 * the attack in a skin slot is refused; the category kill switch makes it unequippable and drops it from the
 * loadout; the skins still equip exactly as before; re-running the file changes nothing.
 */
const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const MVP = read('2026-09-27-account-progression.sql');
const CRATES = read('2026-09-28-progression-crates.sql');
const SKINS = read('2026-09-28-progression-skins.sql');
const ATTACK = read('2026-09-28-progression-hero-attack.sql');

const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.profiles (user_id uuid primary key references auth.users(id), rating int not null default 0, updated_at timestamptz not null default now());
  alter table public.profiles enable row level security;
  create policy "read profiles" on public.profiles for select using (true);
  create policy "update own profile" on public.profiles for update to authenticated using (auth.uid() = user_id);
  create table public.rank_results (user_id uuid, run_id text, placement int, seed bigint, created_at timestamptz default now(), primary key (user_id, run_id));
  create table public.run_history (user_id uuid, mode text, entry jsonb, wins int, created_at timestamptz default now());
  create table public.practice_games (id bigserial primary key, user_id uuid, placement int, config jsonb, record jsonb, created_at timestamptz default now());
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
  for (const f of [CRATES, SKINS, ATTACK]) { await db.exec(f); await db.exec(API_GRANTS); }
  expect(await sync()).toBe('synced');
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('the hero attack slot', () => {
  it('the sync switches the category on and adds attack_blast as a global (targetless) Epic crate item', async () => {
    const cat = await one<{ enabled: boolean; target: string }>("select enabled, target from public.cosmetic_categories where category = 'hero_attack'");
    expect(cat).toEqual({ enabled: true, target: 'global' });
    const item = await one("select category, rarity, acquisition_source, target_type, target_id, active from public.cosmetic_catalog where cosmetic_id = 'attack_blast'");
    expect(item).toEqual({ category: 'hero_attack', rarity: 'epic', acquisition_source: 'crate', target_type: null, target_id: null, active: true });
  });

  it('equips an owned attack with target \'\'; the profile loadout carries it; null goes back to Classic', async () => {
    const u = await playerOwning(['attack_blast']);
    const on = await equip(u, 'hero_attack', '', 'attack_blast');
    expect(on.loadout).toEqual({ heroAttack: 'attack_blast' });
    expect(heroAttackOf(on.loadout)?.id).toBe('attack_blast');
    const rows = (await db.query('select slot, target_id, cosmetic_id from public.cosmetic_loadouts where user_id = $1', [u])).rows;
    expect(rows).toEqual([{ slot: 'hero_attack', target_id: '', cosmetic_id: 'attack_blast' }]);
    const off = await equip(u, 'hero_attack', '', null);
    expect(off.loadout?.heroAttack).toBeUndefined();
  });

  it('refuses a named target, an unowned attack, a skin in the attack slot and the attack in a skin slot', async () => {
    const u = await playerOwning(['attack_blast', 'skin_albus_1']);
    expect(await raises(EQUIP, [u, 'hero_attack', 'albus', 'attack_blast'])).toContain('bad_target');
    expect(await raises(EQUIP, [u, 'hero_attack', null, 'attack_blast'])).toContain('bad_target');
    expect(await raises(EQUIP, [u, 'hero_attack', '', 'skin_albus_1'])).toContain('wrong_target');
    expect(await raises(EQUIP, [u, 'hero_skin', 'albus', 'attack_blast'])).toContain('wrong_target');
    const stranger = await playerOwning([]);
    expect(await raises(EQUIP, [stranger, 'hero_attack', '', 'attack_blast'])).toContain('not_owned');
  });

  it('the category kill switch makes it unequippable and drops it from the loadout (the row survives); restore brings it back', async () => {
    const u = await playerOwning(['attack_blast']);
    await equip(u, 'hero_attack', '', 'attack_blast');
    await db.exec("update public.cosmetic_categories set admin_off = true, updated_at = now() where category = 'hero_attack';");
    try {
      expect(await raises(EQUIP, [u, 'hero_attack', '', 'attack_blast'])).toContain('not_equippable');
      const p = parseProgressionProfile((await one<{ j: unknown }>('select public.progression_profile_json($1) as j', [u])).j)!;
      expect(p.loadout?.heroAttack).toBeUndefined();
      expect((await db.query('select 1 from public.cosmetic_loadouts where user_id = $1', [u])).rows).toHaveLength(1);
    } finally {
      await db.exec("update public.cosmetic_categories set admin_off = false, updated_at = now() where category = 'hero_attack';");
    }
    const p = parseProgressionProfile((await one<{ j: unknown }>('select public.progression_profile_json($1) as j', [u])).j)!;
    expect(p.loadout?.heroAttack).toBe('attack_blast');
  });

  it('skins equip exactly as before under the replaced function', async () => {
    const u = await playerOwning(['skin_albus_1', 'attack_blast']);
    await equip(u, 'hero_attack', '', 'attack_blast');
    const p = await equip(u, 'hero_skin', 'albus', 'skin_albus_1');
    expect(p.loadout).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, heroAttack: 'attack_blast' });
    expect(await raises(EQUIP, [u, 'hero_skin', 'warden', 'skin_albus_1'])).toContain('wrong_target');
    expect(await raises(EQUIP, [u, 'title', '', 'title_wanderer'])).toContain('bad_slot');
  });

  it('is idempotent: re-running the file changes no loadout, ownership or catalog row', async () => {
    const before = (await db.query('select user_id, slot, target_id, cosmetic_id from public.cosmetic_loadouts order by 1, 2, 3')).rows;
    await db.exec(ATTACK);
    await db.exec(ATTACK);
    expect((await db.query('select user_id, slot, target_id, cosmetic_id from public.cosmetic_loadouts order by 1, 2, 3')).rows).toEqual(before);
    expect(await sync()).toBe('unchanged');
  });

  it('clients can never call it', async () => {
    const acl = await one<{ anon: boolean; auth: boolean; svc: boolean }>(
      "select has_function_privilege('anon', 'public.equip_cosmetic(uuid, text, text, text)', 'execute') as anon, has_function_privilege('authenticated', 'public.equip_cosmetic(uuid, text, text, text)', 'execute') as auth, has_function_privilege('service_role', 'public.equip_cosmetic(uuid, text, text, text)', 'execute') as svc");
    expect(acl).toEqual({ anon: false, auth: false, svc: true });
  });
});
