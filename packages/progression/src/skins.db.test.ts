import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COSMETICS, eligibleCrateCosmetics, parseOpenCrateResult } from './cosmetics';
import { parseProgressionProfile } from './rules';

/**
 * THE SKINS SQL, EXECUTED (2026-09-28). An embedded Postgres (PGlite) runs the real MVP, crates and skins
 * migrations in order over the same minimal Supabase stub as crates.db.test.ts, then drives `equip_cosmetic`,
 * `open_crate` and the kill switch exactly as the owner would run them:
 *
 *   the skins join the crate pool; equip checks slot, target, liveness and ownership; Default (null) is
 *   selectable; the one-line retire (item or category) removes an item from the pool, from equip and from every
 *   profile's loadout WITHOUT deleting ownership or the loadout row, and the one-line restore brings it all back;
 *   a re-run of the skins file keeps an item retire; clients can never call the writer or write a loadout.
 */

const root = join(__dirname, '../../..');
const MVP = readFileSync(join(root, 'supabase/migrations/2026-09-27-account-progression.sql'), 'utf8');
const CRATES = readFileSync(join(root, 'supabase/migrations/2026-09-28-progression-crates.sql'), 'utf8');
const SKINS = readFileSync(join(root, 'supabase/migrations/2026-09-28-progression-skins.sql'), 'utf8');

/** The owner's one-line switches, read out of the migration header so the test runs EXACTLY what is documented. */
function switchLine(pattern: RegExp): string {
  const m = pattern.exec(SKINS);
  if (!m) throw new Error(`no documented line for ${pattern}`);
  return m[0];
}
const RETIRE_ITEM = switchLine(/update public\.cosmetic_catalog set active = false where cosmetic_id = 'skin_blackbelt_2';/);
const RESTORE_ITEM = switchLine(/update public\.cosmetic_catalog set active = true where cosmetic_id = 'skin_blackbelt_2';/);
const RETIRE_CATEGORY = switchLine(/update public\.cosmetic_categories set enabled = false, updated_at = now\(\) where category = 'minion_skin';/);
const RESTORE_CATEGORY = switchLine(/update public\.cosmetic_categories set enabled = true, updated_at = now\(\) where category = 'minion_skin';/);

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

async function newUser(): Promise<string> {
  userSeq++;
  const id = `00000000-0000-0000-0000-${String(userSeq).padStart(12, '0')}`;
  await db.query('insert into auth.users (id) values ($1)', [id]);
  return id;
}
async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0]!;
}
async function raises(sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); } catch (e) { return String((e as Error).message); }
  return 'no error';
}
/** An enrolled player (one ranked settlement) who owns `ids` (granted directly, as a crate would). */
async function playerOwning(ids: readonly string[]): Promise<string> {
  const u = await newUser();
  await db.query('insert into public.rank_results (user_id, run_id, placement, seed) values ($1, $2, 6, 1)', [u, `r-${u}`]);
  await db.query('select public.settle_progression($1, $2, $3, null, false, 1, null)', [u, 'ranked', `r-${u}`]);
  for (const id of ids) await db.query("insert into public.player_cosmetics (user_id, cosmetic_id, source) values ($1, $2, 'test') on conflict do nothing", [u, id]);
  return u;
}
async function equip(u: string, slot: string | null, target: string | null, id: string | null): Promise<ReturnType<typeof parseProgressionProfile>> {
  const r = await one<{ j: { status: string; profile: unknown } }>('select public.equip_cosmetic($1, $2, $3, $4) as j', [u, slot, target, id]);
  expect(r.j.status).toBe('equipped');
  return parseProgressionProfile(r.j.profile);
}
async function profile(u: string): Promise<NonNullable<ReturnType<typeof parseProgressionProfile>>> {
  return parseProgressionProfile((await one<{ j: unknown }>('select public.progression_profile_json($1) as j', [u])).j)!;
}
async function loadoutRows(u: string): Promise<Array<{ slot: string; target_id: string; cosmetic_id: string }>> {
  return (await db.query<{ slot: string; target_id: string; cosmetic_id: string }>('select slot, target_id, cosmetic_id from public.cosmetic_loadouts where user_id = $1 order by slot, target_id', [u])).rows;
}
async function poolIds(u: string): Promise<string[]> {
  return (await db.query<{ pool_cosmetic_id: string }>('select pool_cosmetic_id from public.progression_crate_pool($1)', [u])).rows.map((r) => r.pool_cosmetic_id);
}

const SKIN_IDS = COSMETICS.filter((c) => c.category === 'hero_skin' || c.category === 'minion_skin').map((c) => c.id).sort();
const TITLE_CRATE_IDS = COSMETICS.filter((c) => c.category === 'title' && c.acquisition.type === 'crate').map((c) => c.id);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MVP);
  await db.exec(API_GRANTS);
  await db.exec(`update public.progression_config set epoch = now() - interval '1 day' where id = 1;`);
  await db.exec(CRATES);
  await db.exec(API_GRANTS);
  await db.exec(SKINS);
  await db.exec(API_GRANTS);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('the migration', () => {
  it('switches the two skin categories on and adds the four skins (rows equal the TS catalog)', async () => {
    const cats = (await db.query<{ category: string }>('select category from public.cosmetic_categories where enabled order by category')).rows.map((r) => r.category);
    expect(cats).toEqual(['hero_skin', 'minion_skin', 'title']);
    const rows = (await db.query<{ cosmetic_id: string; category: string; target_type: string; target_id: string; active: boolean }>(
      "select cosmetic_id, category, target_type, target_id, active from public.cosmetic_catalog where category in ('hero_skin', 'minion_skin') order by cosmetic_id")).rows;
    expect(rows).toEqual(COSMETICS.filter((c) => c.target).sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((c) => ({ cosmetic_id: c.id, category: c.category, target_type: c.target!.type, target_id: c.target!.id, active: true })));
  });

  it('is idempotent: running it twice more changes no ownership, loadout or catalog row', async () => {
    const u = await playerOwning(['skin_albus_1']);
    await equip(u, 'hero_skin', 'albus', 'skin_albus_1');
    const snap = async (): Promise<unknown[]> => [
      (await db.query('select * from public.cosmetic_catalog order by cosmetic_id')).rows.map((r) => ({ ...r, created_at: null })),
      (await db.query('select user_id, cosmetic_id from public.player_cosmetics order by 1, 2')).rows,
      (await db.query('select user_id, slot, target_id, cosmetic_id from public.cosmetic_loadouts order by 1, 2, 3')).rows,
    ];
    const before = await snap();
    await db.exec(SKINS);
    await db.exec(SKINS);
    expect(await snap()).toEqual(before);
  });
});

describe('the crate pool', () => {
  it('a crate can now give a skin: with every title owned, the next openings give each skin once, then pool_exhausted', async () => {
    const u = await playerOwning(TITLE_CRATE_IDS);
    expect((await poolIds(u)).sort()).toEqual(SKIN_IDS);
    // enough crates: grant levels directly as sealed crates
    for (let lvl = 2; lvl <= 6; lvl++) await db.query('insert into public.loot_crates (user_id, earned_level) values ($1, $2) on conflict do nothing', [u, lvl]);
    const ids = (await db.query<{ crate_id: string }>("select crate_id from public.loot_crates where user_id = $1 and state = 'sealed' order by earned_level", [u])).rows.map((r) => r.crate_id);
    const got: string[] = [];
    for (const id of ids) {
      const r = parseOpenCrateResult((await one<{ j: unknown }>('select public.open_crate($1, $2) as j', [u, id])).j)!;
      if (r.status === 'opened') got.push(r.rewardId!);
      else expect(r.status).toBe('pool_exhausted');
    }
    expect(got.sort()).toEqual(SKIN_IDS);
  });

  it('the SQL pool and the TS eligible list agree for a fresh player (titles + skins)', async () => {
    const u = await playerOwning([]);
    expect(await poolIds(u)).toEqual(eligibleCrateCosmetics([]).map((c) => c.id).sort((a, b) => (Buffer.from(a) < Buffer.from(b) ? -1 : 1)));
  });
});

describe('equip_cosmetic', () => {
  it('equips an owned skin on its own target; Default (null) takes it off; the revision moves each time', async () => {
    const u = await playerOwning(['skin_blackbelt_1', 'skin_blackbelt_2', 'skin_warden_1']);
    const r0 = (await profile(u)).revision;
    let p = await equip(u, 'minion_skin', 'blackbelt', 'skin_blackbelt_2');
    expect(p!.loadout).toEqual({ minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } });
    expect(p!.revision).toBe(r0 + 1);
    // swapping to the other skin of the same target replaces it (one row per slot + target)
    p = await equip(u, 'minion_skin', 'blackbelt', 'skin_blackbelt_1');
    p = await equip(u, 'hero_skin', 'warden', 'skin_warden_1');
    expect(p!.loadout).toEqual({ heroSkinByHeroId: { warden: 'skin_warden_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } });
    expect(await loadoutRows(u)).toHaveLength(2);
    // Default
    p = await equip(u, 'minion_skin', 'blackbelt', null);
    expect(p!.loadout).toEqual({ heroSkinByHeroId: { warden: 'skin_warden_1' } });
    expect(p!.revision).toBe(r0 + 4);
    // Default when nothing is worn is fine (no error, no row)
    await equip(u, 'hero_skin', 'albus', null);
    expect(await loadoutRows(u)).toEqual([{ slot: 'hero_skin', target_id: 'warden', cosmetic_id: 'skin_warden_1' }]);
    // the profile lists every owned cosmetic (titles and skins)
    expect((await profile(u)).cosmetics!.sort()).toEqual(['skin_blackbelt_1', 'skin_blackbelt_2', 'skin_warden_1']);
  });

  it('refuses: not owned, the wrong target, the wrong slot, a bad slot/target/id, an unknown id', async () => {
    const u = await playerOwning(['skin_albus_1', 'title_wanderer']);
    expect(await raises('select public.equip_cosmetic($1, $2, $3, $4)', [u, 'hero_skin', 'warden', 'skin_warden_1'])).toContain('not_owned');
    expect(await raises('select public.equip_cosmetic($1, $2, $3, $4)', [u, 'hero_skin', 'warden', 'skin_albus_1'])).toContain('wrong_target');
    expect(await raises('select public.equip_cosmetic($1, $2, $3, $4)', [u, 'minion_skin', 'albus', 'skin_albus_1'])).toContain('wrong_target');
    expect(await raises('select public.equip_cosmetic($1, $2, $3, $4)', [u, 'hero_skin', 'albus', 'title_wanderer'])).toContain('wrong_target');
    expect(await raises('select public.equip_cosmetic($1, $2, $3, $4)', [u, 'title', '', 'title_wanderer'])).toContain('bad_slot');
    expect(await raises('select public.equip_cosmetic($1, $2, $3, $4)', [u, 'hero_skin', "albus'; drop", 'skin_albus_1'])).toContain('bad_target');
    expect(await raises('select public.equip_cosmetic($1, $2, $3, $4)', [u, 'hero_skin', 'albus', 'Skin-Albus'])).toContain('bad_cosmetic_id');
    expect(await raises('select public.equip_cosmetic($1, $2, $3, $4)', [u, 'hero_skin', 'albus', 'skin_nobody_9'])).toContain('bad_cosmetic_id');
    expect(await loadoutRows(u)).toEqual([]);
  });
});

describe('the kill switch (owner 2026-09-28: "remove any rewards from the game")', () => {
  it('retire ONE item: out of the pool, cannot be equipped, gone from the loadout; ownership + the row stay; restore puts it all back', async () => {
    const holder = await playerOwning(['skin_blackbelt_2']);
    await equip(holder, 'minion_skin', 'blackbelt', 'skin_blackbelt_2');
    const fresh = await playerOwning([]);
    expect(await poolIds(fresh)).toContain('skin_blackbelt_2');

    await db.exec(RETIRE_ITEM);
    expect(await poolIds(fresh)).not.toContain('skin_blackbelt_2');
    expect(await poolIds(fresh)).toContain('skin_blackbelt_1'); // only that item
    expect((await profile(holder)).loadout).toEqual({});
    expect(await loadoutRows(holder)).toEqual([{ slot: 'minion_skin', target_id: 'blackbelt', cosmetic_id: 'skin_blackbelt_2' }]);
    expect((await profile(holder)).cosmetics).toContain('skin_blackbelt_2');
    expect(await raises('select public.equip_cosmetic($1, $2, $3, $4)', [holder, 'minion_skin', 'blackbelt', 'skin_blackbelt_2'])).toContain('not_equippable');
    // a re-run of the skins file keeps the retire
    await db.exec(SKINS);
    expect((await one<{ active: boolean }>("select active from public.cosmetic_catalog where cosmetic_id = 'skin_blackbelt_2'")).active).toBe(false);

    await db.exec(RESTORE_ITEM);
    expect(await poolIds(fresh)).toContain('skin_blackbelt_2');
    expect((await profile(holder)).loadout).toEqual({ minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } });
  });

  it('retire a whole CATEGORY: every minion skin leaves the pool and every loadout; hero skins are untouched; restore', async () => {
    const holder = await playerOwning(['skin_blackbelt_1', 'skin_albus_1']);
    await equip(holder, 'minion_skin', 'blackbelt', 'skin_blackbelt_1');
    await equip(holder, 'hero_skin', 'albus', 'skin_albus_1');
    const fresh = await playerOwning([]);

    await db.exec(RETIRE_CATEGORY);
    expect((await poolIds(fresh)).filter((id) => id.startsWith('skin_blackbelt'))).toEqual([]);
    expect(await poolIds(fresh)).toContain('skin_albus_1');
    expect((await profile(holder)).loadout).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' } });
    expect(await raises('select public.equip_cosmetic($1, $2, $3, $4)', [holder, 'minion_skin', 'blackbelt', 'skin_blackbelt_1'])).toContain('not_equippable');
    // Default stays selectable while retired (taking a skin off never needs the item to be live)
    await equip(holder, 'minion_skin', 'blackbelt', null);
    await equip(holder, 'minion_skin', 'blackbelt', null);
    expect((await profile(holder)).cosmetics!.sort()).toEqual(['skin_albus_1', 'skin_blackbelt_1']);

    await db.exec(RESTORE_CATEGORY);
    expect((await poolIds(fresh)).filter((id) => id.startsWith('skin_blackbelt')).sort()).toEqual(['skin_blackbelt_1', 'skin_blackbelt_2']);
    await equip(holder, 'minion_skin', 'blackbelt', 'skin_blackbelt_1');
    expect((await profile(holder)).loadout).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } });
  });

  it('a player who owns ONLY retired items and everything else sees pool_exhausted (the crate stays sealed, never converted)', async () => {
    const allButOne = eligibleCrateCosmetics([]).map((c) => c.id).filter((id) => id !== 'skin_blackbelt_2');
    const u = await playerOwning(allButOne);
    await db.exec(RETIRE_ITEM);
    try {
      const [c] = (await db.query<{ crate_id: string }>("select crate_id from public.loot_crates where user_id = $1 and state = 'sealed' order by earned_level", [u])).rows;
      const r = parseOpenCrateResult((await one<{ j: unknown }>('select public.open_crate($1, $2) as j', [u, c!.crate_id])).j)!;
      expect(r.status).toBe('pool_exhausted');
      expect(r.crate.state).toBe('sealed');
    } finally {
      await db.exec(RESTORE_ITEM);
    }
  });
});

describe('clients can never write a loadout', () => {
  async function asClient<T>(role: 'anon' | 'authenticated', user: string, fn: () => Promise<T>): Promise<T> {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    await db.exec(`set role ${role}`);
    try { return await fn(); } finally { await db.exec('reset role'); }
  }

  it('an authenticated player cannot call equip_cosmetic or write cosmetic_loadouts; anyone can READ loadouts', async () => {
    const u = await playerOwning(['skin_warden_1']);
    await equip(u, 'hero_skin', 'warden', 'skin_warden_1');
    await asClient('authenticated', u, async () => {
      expect(await raises('select public.equip_cosmetic($1, $2, $3, $4)', [u, 'hero_skin', 'warden', null])).toMatch(/permission denied/);
      expect(await raises("insert into public.cosmetic_loadouts (user_id, slot, target_id, cosmetic_id) values ($1, 'hero_skin', 'albus', 'skin_albus_1')", [u])).toMatch(/row-level security/);
      await db.query("update public.cosmetic_loadouts set cosmetic_id = 'skin_albus_1' where user_id = $1", [u]);
      await db.query('delete from public.cosmetic_loadouts where user_id = $1', [u]);
    });
    await asClient('anon', u, async () => {
      expect((await db.query('select slot, target_id, cosmetic_id from public.cosmetic_loadouts where user_id = $1', [u])).rows).toEqual([{ slot: 'hero_skin', target_id: 'warden', cosmetic_id: 'skin_warden_1' }]);
    });
  });
});
