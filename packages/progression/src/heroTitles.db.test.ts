import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { achievementCatalogHash, achievementCatalogPayload } from './achievements';
import { catalogHash, catalogSyncPayload, heroMasterTitleId, heroTitleId } from './cosmetics';
import { parseProgressionResult } from './rules';
import { settlementParity } from './server';

/**
 * HERO TITLES, EXECUTED (owner 2026-09-29: "the hero's title is granted at 3 wins with a hero, then the mastery of
 * that title is after 10 wins with that hero. the master title should be a golden plate and embroidered text").
 * PGlite runs every progression migration in production order, then the hero titles file, syncs both code catalogs,
 * and drives `settle_progression` as the Edge Function would:
 *
 *   3 Ranked 1sts with a hero grant its title in the SAME settlement (owned, reported in `unlockedTitles`, worn when
 *   nothing else is); 10 grant the master, which replaces a worn base title in place; Practice 1sts never count;
 *   the grant is keyed (a duplicate settlement grants nothing again); the titles never enter the crate pool; the
 *   backfill brings existing Mastery progress into the new tier without paying XP; the file re-runs cleanly.
 */

const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = [
  '2026-09-28-progression-crates.sql', '2026-09-28-progression-skins.sql', '2026-09-28-achievements.sql', '2026-09-28-progression-hero-attack.sql',
  '2026-09-29-crate-fixed-rarity-odds.sql', '2026-09-29-crate-uniform-within-rarity.sql', '2026-10-02-ancient-rarity.sql',
].map(read);
const MVP = read('2026-09-27-account-progression.sql');
const ACH = read('2026-09-28-achievements.sql');
const HERO = read('2026-09-29-hero-titles.sql');

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
async function syncAll(): Promise<void> {
  const a = achievementCatalogPayload();
  await db.query('select public.sync_achievement_catalog($1::jsonb, $2)', [JSON.stringify(a), achievementCatalogHash(a)]);
  const c = catalogSyncPayload();
  await db.query('select public.sync_cosmetic_catalog($1::jsonb, $2)', [JSON.stringify(c), catalogHash(c)]);
}

/** One game with `heroId`, settled as the Edge Function would (Ranked by default). */
async function play(u: string, heroId: string, placement = 1, mode: 'ranked' | 'practice' = 'ranked') {
  runSeq++;
  let runId = `run-${runSeq}`;
  let sourceId: number | null = null;
  if (mode === 'ranked') {
    await db.query('insert into public.rank_results (user_id, run_id, placement, seed) values ($1, $2, $3, $4)', [u, runId, placement, runSeq]);
  } else {
    const row = await one<{ id: number }>('insert into public.practice_games (user_id, hero_id, placement, config) values ($1, $2, $3, $4) returning id',
      [u, heroId, placement, { opponents: 'bots', botDifficulty: 3, health: 'normal', timeMult: 1 }]);
    sourceId = Number(row.id);
    runId = `practice:${sourceId}`;
  }
  const facts = { version: 2, runId, mode, setId: 'set2', patch: 'p', heroId, placement, waveReached: 12, terminal: true, comebackAfterFourLosses: false, combats: { wins: 5, losses: 5, draws: 0 }, metrics: {} };
  const out = await one<{ j: { status: string; result: unknown } }>('select public.settle_progression($1, $2, $3, $4, false, 1, $5::jsonb) as j', [u, mode, runId, sourceId, JSON.stringify(facts)]);
  return { runId, mode, result: parseProgressionResult(out.j.result)! };
}
async function owned(u: string): Promise<string[]> {
  return (await db.query<{ cosmetic_id: string }>("select cosmetic_id from public.player_cosmetics where user_id = $1 and cosmetic_id like 'title_hero_%' order by cosmetic_id", [u])).rows.map((r) => r.cosmetic_id);
}
async function worn(u: string): Promise<string | null> {
  return (await one<{ equipped_title_id: string | null }>('select equipped_title_id from public.profiles where user_id = $1', [u])).equipped_title_id;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MVP);
  await db.exec(API_GRANTS);
  await db.exec(`update public.progression_config set epoch = now() - interval '2 days' where id = 1;`);
  for (const f of FILES) { await db.exec(f); await db.exec(API_GRANTS); }
  await db.exec(SWITCH);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('the backfill (runs BEFORE the new code catalog is synced, like the owner runbook)', () => {
  it('existing Mastery progress starts the Titled tier; a completed tier grants its title with no XP; a worn base title is upgraded', async () => {
    const two = await newUser();   // 2 Ranked 1sts with Warden: Titled progress 2, nothing granted
    const five = await newUser();  // 5 with Indy: Titled completed (backfill), base title granted
    const ten = await newUser();   // Mastery done with Soren and wearing the base title: both granted, upgraded
    const put = (u: string, id: string, p: number, done: boolean): Promise<unknown> => db.query(
      'insert into public.achievement_progress (user_id, achievement_id, progress, completed_at) values ($1, $2, $3, $4)', [u, id, p, done ? new Date().toISOString() : null]);
    await put(two, 'hero.warden.mastery', 2, false);
    await put(five, 'hero.indy.mastery', 5, false);
    await put(ten, 'hero.soren.mastery', 10, true);
    await db.query("insert into public.achievement_completions (user_id, achievement_id, run_id, mode, xp_awarded) values ($1, 'hero.soren.mastery', 'r', 'ranked', 250)", [ten]);
    // (a base title held before the master, e.g. from an earlier grant)
    await db.exec(HERO);
    await db.query("insert into public.player_cosmetics (user_id, cosmetic_id, source) values ($1, 'title_hero_soren', 'test') on conflict do nothing", [ten]);
    await db.query("update public.profiles set equipped_title_id = 'title_hero_soren' where user_id = $1", [ten]);
    await db.exec(HERO); // the owner's re-run: idempotent, and it upgrades the worn base title now the master is owned
    const tier = async (u: string, id: string) => one<{ progress: string; completed: boolean } | undefined>(
      'select progress, completed_at is not null as completed from public.achievement_progress where user_id = $1 and achievement_id = $2', [u, id]);
    expect(await tier(two, 'hero.warden.titled')).toEqual({ progress: 2, completed: false });
    expect(await tier(five, 'hero.indy.titled')).toEqual({ progress: 3, completed: true });
    expect(await owned(two)).toEqual([]);
    expect(await owned(five)).toEqual([heroTitleId('indy')]);
    expect(await owned(ten)).toEqual([heroTitleId('soren'), heroMasterTitleId('soren')].sort());
    expect(await worn(ten)).toBe(heroMasterTitleId('soren'));
    const c = await one<{ xp_awarded: number; title_id: string }>("select xp_awarded, title_id from public.achievement_completions where user_id = $1 and achievement_id = 'hero.indy.titled'", [five]);
    expect(c).toEqual({ xp_awarded: 0, title_id: heroTitleId('indy') });
    expect((await one<{ title_id: string }>("select title_id from public.achievement_completions where user_id = $1 and achievement_id = 'hero.soren.mastery'", [ten])).title_id).toBe(heroMasterTitleId('soren'));
    await syncAll();
  });
});

describe('settlement grants', () => {
  it('3 Ranked 1sts grant the hero title in that settlement (owned, reported, worn when nothing is); 10 upgrade it in place', async () => {
    const u = await newUser();
    for (let i = 1; i <= 2; i++) expect((await play(u, 'gambler')).result.unlockedTitles.filter((t) => t.startsWith('title_hero_'))).toEqual([]);
    const third = await play(u, 'gambler');
    expect(third.result.achievements).toContain('hero.gambler.titled');
    expect(third.result.unlockedTitles).toContain(heroTitleId('gambler'));
    expect(settlementParity(third.result)).toBe(true);
    expect(await owned(u)).toEqual([heroTitleId('gambler')]);
    // Alpha Tester (Level 2, reached in game 1) is already worn, so the new title waits in the Collection; wear it
    expect(await worn(u)).toBe('alpha_tester');
    await db.query('select public.equip_title($1, $2)', [u, heroTitleId('gambler')]);
    for (let i = 4; i <= 9; i++) await play(u, 'gambler');
    expect(await owned(u)).toEqual([heroTitleId('gambler')]);
    const tenth = await play(u, 'gambler');
    expect(tenth.result.achievements).toContain('hero.gambler.mastery');
    expect(tenth.result.unlockedTitles).toEqual([heroMasterTitleId('gambler')]);
    expect(settlementParity(tenth.result)).toBe(true);
    expect(await owned(u)).toEqual([heroTitleId('gambler'), heroMasterTitleId('gambler')].sort());
    expect(await worn(u)).toBe(heroMasterTitleId('gambler')); // upgraded in place
  });

  it('a master does not replace a DIFFERENT worn title; Practice and non-1st games never count; the grant is keyed', async () => {
    const u = await newUser();
    await db.query("insert into public.player_cosmetics (user_id, cosmetic_id, source) values ($1, 'title_wanderer', 'test')", [u]);
    await db.query("update public.profiles set equipped_title_id = 'title_wanderer' where user_id = $1", [u]);
    for (let i = 0; i < 3; i++) await play(u, 'albus', 1, 'practice');
    for (let i = 0; i < 3; i++) await play(u, 'albus', 2);
    expect(await owned(u)).toEqual([]);
    let last = await play(u, 'albus');
    for (let i = 0; i < 2; i++) last = await play(u, 'albus');
    expect(last.result.unlockedTitles).toEqual([heroTitleId('albus')]);
    expect(await worn(u)).toBe('title_wanderer'); // something was worn: the new title waits in the Collection
    const again = await one<{ j: { status: string; result: unknown } }>('select public.settle_progression($1, $2, $3, null, false, 1, null) as j', [u, 'ranked', last.runId]);
    expect(again.j.status).toBe('deduped');
    expect((await one<{ n: string }>("select count(*) as n from public.player_cosmetics where user_id = $1 and cosmetic_id = 'title_hero_albus'", [u])).n).toBe(1);
  });

  it('a new hero title is worn when nothing is worn', async () => {
    const u = await newUser();
    for (let i = 0; i < 2; i++) await play(u, 'flash');
    await db.query('select public.equip_title($1, null)', [u]); // took Alpha Tester off
    await play(u, 'flash');
    expect(await worn(u)).toBe(heroTitleId('flash'));
  });

  it('an unsynced or unknown title id is skipped, never fails the settlement (the ownership FK)', async () => {
    await db.exec("update public.achievement_catalog set title_id = 'title_from_the_future' where achievement_id = 'hero.mimic.titled'");
    try {
      const u = await newUser();
      let s = await play(u, 'mimic');
      for (let i = 0; i < 2; i++) s = await play(u, 'mimic');
      expect(s.result.achievements).toContain('hero.mimic.titled');
      expect(s.result.unlockedTitles).toEqual([]);
    } finally {
      await db.exec("update public.achievement_catalog set title_id = 'title_hero_mimic' where achievement_id = 'hero.mimic.titled'");
    }
  });

  it('hero titles never enter the crate pool', async () => {
    const u = await newUser();
    await play(u, 'warden', 5);
    const pool = (await db.query<{ pool_cosmetic_id: string }>('select pool_cosmetic_id from public.progression_crate_pool($1)', [u])).rows.map((r) => r.pool_cosmetic_id);
    expect(pool.length).toBeGreaterThan(10);
    expect(pool.filter((id) => id.startsWith('title_hero_'))).toEqual([]);
  });
});
