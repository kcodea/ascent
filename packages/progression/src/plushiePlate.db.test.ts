import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { achievementCatalogHash, achievementCatalogPayload } from './achievements';
import {
  PLUSHIE_BEASTS_COLLECTION_ID, PLUSHIE_BEAST_SKIN_IDS, PLUSHIE_PLATE_ID, catalogHash, catalogSyncPayload, type CatalogSyncPayload,
} from './cosmetics';

/**
 * THE PLUSHIE PLATE, EXECUTED (owner 2026-10-27: "i want this to be a secrete unlock that the players are given once
 * they unlock every Plushie Beast cosmetic ... can we create a new achievement and say the reward is a 'Unique Card
 * Plate Only Available From Completing This Achievement'?"). PGlite runs the progression migrations in production
 * order, then 2026-11-03-secret-plushie-plate.sql, syncs both code catalogs, and checks:
 *
 *   the sync tags the 24 Plushie Beast skins and adds the Secret plate as an achievement item no crate can roll; each
 *   granted Plushie moves the achievement's progress; the 24th completes it (no XP) and grants the plate in the same
 *   transaction; a game's metrics can never move it; a player who owned them all before the file is credited on the
 *   first sync; a new Plushie raises the count without taking a completion back; the file re-runs cleanly.
 */

const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = [
  '2026-09-28-progression-crates.sql', '2026-09-28-progression-skins.sql', '2026-09-28-achievements.sql', '2026-09-28-progression-hero-attack.sql',
  '2026-09-29-crate-fixed-rarity-odds.sql', '2026-09-29-crate-uniform-within-rarity.sql', '2026-10-02-ancient-rarity.sql', '2026-09-29-hero-titles.sql',
  '2026-10-03-placement-xp.sql',
].map(read);
// The emote file's starter-acquisition check only (2026-10-13): the code catalog holds STARTER emotes.
FILES.push(((t: string): string => t.slice(0, t.indexOf('-- ── 2. equip_cosmetic')))(read('2026-10-13-emotes.sql')));
const MVP = read('2026-09-27-account-progression.sql');
const ACH = read('2026-09-28-achievements.sql');
const SECRET = read('2026-11-03-secret-plushie-plate.sql');

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
const SWITCH = /^-- (update public\.progression_config set achievements_epoch = now\(\).*;)$/m.exec(ACH)![1]!;
const ID = PLUSHIE_BEASTS_COLLECTION_ID;

let db: PGlite;
let userSeq = 0;
let runSeq = 0;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0]!;
}
async function newUser(): Promise<string> {
  userSeq++;
  const id = `00000000-0000-0000-0000-${String(userSeq).padStart(12, '0')}`;
  await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query('insert into public.profiles (user_id) values ($1)', [id]);
  return id;
}
async function syncCosmetics(c: CatalogSyncPayload = catalogSyncPayload()): Promise<Record<string, unknown>> {
  return (await one<{ j: Record<string, unknown> }>('select public.sync_cosmetic_catalog($1::jsonb, $2) as j', [JSON.stringify(c), catalogHash(c)])).j;
}
/** Grant items the way open_crate does: one ownership row each. */
async function grant(u: string, ids: readonly string[]): Promise<void> {
  for (const id of ids) await db.query("insert into public.player_cosmetics (user_id, cosmetic_id, source) values ($1, $2, 'crate') on conflict do nothing", [u, id]);
}
async function progress(u: string): Promise<{ progress: number; completed: boolean } | undefined> {
  return (await db.query<{ progress: number; completed: boolean }>(
    'select progress::int as progress, completed_at is not null as completed from public.achievement_progress where user_id = $1 and achievement_id = $2', [u, ID])).rows[0];
}
async function completion(u: string): Promise<{ xp_awarded: number } | undefined> {
  return (await db.query<{ xp_awarded: number }>('select xp_awarded from public.achievement_completions where user_id = $1 and achievement_id = $2', [u, ID])).rows[0];
}
async function hasPlate(u: string): Promise<boolean> {
  return (await db.query('select 1 from public.player_cosmetics where user_id = $1 and cosmetic_id = $2', [u, PLUSHIE_PLATE_ID])).rows.length === 1;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MVP);
  await db.exec(API_GRANTS);
  await db.exec(`update public.progression_config set epoch = now() - interval '2 days' where id = 1;`);
  for (const f of FILES) { await db.exec(f); await db.exec(API_GRANTS); }
  await db.exec(SWITCH);
  await db.exec(SECRET);
  await db.exec(API_GRANTS);
  const a = achievementCatalogPayload();
  await db.query('select public.sync_achievement_catalog($1::jsonb, $2)', [JSON.stringify(a), achievementCatalogHash(a)]);
  expect((await syncCosmetics()).status).toBe('synced');
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('the catalog', () => {
  it('tags exactly the 24 Plushie Beast skins with the collection, and the plate is a Secret achievement item', async () => {
    const tagged = (await db.query<{ cosmetic_id: string }>('select cosmetic_id from public.cosmetic_catalog where collection_id = $1 order by 1', [ID])).rows.map((r) => r.cosmetic_id);
    expect(tagged).toEqual([...PLUSHIE_BEAST_SKIN_IDS].sort());
    expect(tagged).toHaveLength(24);
    expect(await one("select rarity, acquisition_source, achievement_id, collection_id from public.cosmetic_catalog where cosmetic_id = 'plate_plushie'"))
      .toEqual({ rarity: 'secret', acquisition_source: 'achievement', achievement_id: ID, collection_id: null });
    expect(await one('select target::int as target, xp from public.achievement_catalog where achievement_id = $1', [ID])).toEqual({ target: 24, xp: 0 });
  });

  it('no crate can roll the plate', async () => {
    const u = await newUser();
    const pool = (await db.query<{ pool_cosmetic_id: string }>('select pool_cosmetic_id from public.progression_crate_pool($1)', [u])).rows.map((r) => r.pool_cosmetic_id);
    expect(pool.length).toBeGreaterThan(100);
    expect(pool).not.toContain(PLUSHIE_PLATE_ID);
  });
});

describe('collecting', () => {
  it('each Plushie moves the progress; the 24th completes it with no XP and grants the plate', async () => {
    const u = await newUser();
    await grant(u, ['skin_hawkus_1']);
    expect(await progress(u)).toEqual({ progress: 1, completed: false });
    await grant(u, ['title_wanderer']); // not in the collection: nothing moves
    expect(await progress(u)).toEqual({ progress: 1, completed: false });
    await grant(u, PLUSHIE_BEAST_SKIN_IDS.slice(0, 23));
    expect(await progress(u)).toEqual({ progress: 23, completed: false });
    expect(await completion(u)).toBeUndefined();
    expect(await hasPlate(u)).toBe(false);
    await grant(u, PLUSHIE_BEAST_SKIN_IDS.slice(23));
    expect(await progress(u)).toEqual({ progress: 24, completed: true });
    expect(await completion(u)).toEqual({ xp_awarded: 0 });
    expect(await one('select source, source_id from public.player_cosmetics where user_id = $1 and cosmetic_id = $2', [u, PLUSHIE_PLATE_ID]))
      .toEqual({ source: 'achievement', source_id: ID });
  });

  it("a game's metrics can never move it, and nothing but the recount can write it", async () => {
    const u = await newUser();
    runSeq++;
    const runId = `run-${runSeq}`;
    await db.query('insert into public.rank_results (user_id, run_id, placement, seed) values ($1, $2, 1, $3)', [u, runId, runSeq]);
    const facts = { version: 2, runId, mode: 'ranked', setId: 'set2', patch: 'p', heroId: 'warden', placement: 1, waveReached: 12, terminal: true,
      comebackAfterFourLosses: false, combats: { wins: 5, losses: 5, draws: 0 }, metrics: { collectionOwned: 999 } };
    const out = await one<{ j: { status: string } }>("select public.settle_progression($1, 'ranked', $2, null, false, 1, $3::jsonb) as j", [u, runId, JSON.stringify(facts)]);
    expect(out.j.status).toBe('ok');
    expect(await progress(u)).toBeUndefined();
    expect(await completion(u)).toBeUndefined();
    expect(await hasPlate(u)).toBe(false);
    await db.query('insert into public.achievement_progress (user_id, achievement_id, progress, completed_at) values ($1, $2, 24, now())', [u, ID]);
    await db.query("insert into public.achievement_completions (user_id, achievement_id, xp_awarded) values ($1, $2, 0)", [u, ID]);
    expect(await progress(u)).toBeUndefined();
    expect(await completion(u)).toBeUndefined();
  });

  it('two players never share a count', async () => {
    const a = await newUser();
    const b = await newUser();
    await grant(a, PLUSHIE_BEAST_SKIN_IDS.slice(0, 5));
    await grant(b, PLUSHIE_BEAST_SKIN_IDS.slice(0, 2));
    expect(await progress(a)).toEqual({ progress: 5, completed: false });
    expect(await progress(b)).toEqual({ progress: 2, completed: false });
  });
});

describe('the catalog changing', () => {
  it('a player who owned every Plushie before the file is credited on the first sync after it', async () => {
    const u = await newUser();
    await db.exec(`update public.cosmetic_catalog set collection_id = null; update public.progression_config set catalog_hash = null where id = 1;`);
    await grant(u, PLUSHIE_BEAST_SKIN_IDS);
    expect(await progress(u)).toBeUndefined();
    const res = await syncCosmetics();
    expect(res.status).toBe('synced');
    expect(Number(res.collectionsRecounted)).toBeGreaterThan(0);
    expect(await progress(u)).toEqual({ progress: 24, completed: true });
    expect(await hasPlate(u)).toBe(true);
  });

  it('a new Plushie raises the target; a completed player keeps the completion and the plate; the rest need it', async () => {
    const done = await newUser();
    const almost = await newUser();
    await grant(done, PLUSHIE_BEAST_SKIN_IDS);
    await grant(almost, PLUSHIE_BEAST_SKIN_IDS.slice(0, 23));
    const base = catalogSyncPayload();
    const extra = { ...base.items.find((i) => i.cosmeticId === 'skin_hawkus_1')!, cosmeticId: 'skin_zz_new_plushie', targetId: 'b2_hawkus' };
    const next: CatalogSyncPayload = { ...base, items: [...base.items, extra] };
    expect((await syncCosmetics(next)).status).toBe('synced');
    expect(await progress(done)).toEqual({ progress: 24, completed: true });
    expect(await completion(done)).toEqual({ xp_awarded: 0 });
    expect(await hasPlate(done)).toBe(true);
    await grant(almost, PLUSHIE_BEAST_SKIN_IDS.slice(23));
    expect(await progress(almost)).toEqual({ progress: 24, completed: false });
    expect(await hasPlate(almost)).toBe(false);
    await grant(almost, ['skin_zz_new_plushie']);
    expect(await progress(almost)).toEqual({ progress: 25, completed: true });
    expect(await hasPlate(almost)).toBe(true);
    expect((await syncCosmetics()).status).toBe('synced'); // back to the real catalog (the extra item retires)
  });
});

describe('the file', () => {
  it('re-runs cleanly and changes no ownership or completion', async () => {
    const snap = async () => [
      (await db.query('select user_id, cosmetic_id from public.player_cosmetics order by 1, 2')).rows,
      (await db.query('select user_id, achievement_id from public.achievement_completions order by 1, 2')).rows,
    ];
    const before = await snap();
    await db.exec(SECRET);
    await db.exec(SECRET);
    expect(await snap()).toEqual(before);
  });

  it('clients can never call the recount', async () => {
    for (const sig of ['public.progression_refresh_collection(uuid, text)', 'public.progression_refresh_all_collections()']) {
      const acl = await one<{ anon: boolean; auth: boolean }>(
        `select has_function_privilege('anon', '${sig}', 'execute') as anon, has_function_privilege('authenticated', '${sig}', 'execute') as auth`);
      expect(acl, sig).toEqual({ anon: false, auth: false });
    }
  });
});
