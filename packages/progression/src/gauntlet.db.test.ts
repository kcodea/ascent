import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { achievementCatalogHash, achievementCatalogPayload } from './achievements';
import { catalogHash, catalogSyncPayload } from './cosmetics';
import { parseProgressionResult } from './rules';

/**
 * GAUNTLET PROGRESS, EXECUTED. PGlite runs every progression migration in production order, then the Gauntlet file,
 * and drives `record_gauntlet_clear` as the Edge Function would (service role):
 *
 *   the FIRST clear of a stage records a `gauntlet_progress` row AND grants one sealed crate (no level, source
 *   `gauntlet:N`) in the same transaction; every later clear of that stage is `already_cleared` and grants nothing;
 *   the stage is validated (1 to 10); level crates keep settling exactly as before; the Gauntlet crate opens through
 *   the normal `open_crate`; with `crates_enabled = false` the crate is still granted (the switch only gates opening); clients can
 *   neither call the writer nor write the table, and read only their own rows. The file re-runs cleanly.
 */

const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = [
  '2026-09-28-progression-crates.sql', '2026-09-28-progression-skins.sql', '2026-09-28-achievements.sql', '2026-09-28-progression-hero-attack.sql',
  '2026-09-29-crate-fixed-rarity-odds.sql', '2026-09-29-crate-uniform-within-rarity.sql', '2026-09-29-hero-titles.sql',
].map(read);
const MVP = read('2026-09-27-account-progression.sql');
const ACH = read('2026-09-28-achievements.sql');
const GAUNTLET = read('2026-09-29-gauntlet-progress.sql');

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
// Supabase grants table privileges to the API roles by default; RLS is what stands between them and the rows.
const API_GRANTS = `grant select, insert, update, delete on all tables in schema public to anon, authenticated;`;
const SWITCH = /^-- (update public\.progression_config set achievements_epoch = now\(\).*;)$/m.exec(ACH)![1]!;

type Clear = { status: string; crate: { crateId: string; earnedLevel: number | null; source: string | null; state: string } | null };
type CrateDbRow = { crate_id: string; earned_level: number | null; source: string | null; source_id: string | null; state: string };

let db: PGlite;
let userSeq = 0;
let runSeq = 0;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0]!;
}
async function raises(sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); } catch (e) { return String((e as Error).message); }
  return 'no error';
}
async function newUser(): Promise<string> {
  userSeq++;
  const id = `00000000-0000-0000-0000-${String(userSeq).padStart(12, '0')}`;
  await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query('insert into public.profiles (user_id) values ($1)', [id]);
  return id;
}
async function clear(u: string, stage: number): Promise<Clear> {
  return (await one<{ j: Clear }>('select public.record_gauntlet_clear($1, $2) as j', [u, stage])).j;
}
async function crates(u: string): Promise<CrateDbRow[]> {
  return (await db.query<CrateDbRow>(
    'select crate_id, earned_level, source, source_id, state from public.loot_crates where user_id = $1 order by earned_level nulls last, source', [u])).rows;
}
async function progress(u: string): Promise<Array<{ stage: number; crate_granted: boolean; crate_id: string | null }>> {
  return (await db.query<{ stage: number; crate_granted: boolean; crate_id: string | null }>(
    'select stage, crate_granted, crate_id from public.gauntlet_progress where user_id = $1 order by stage', [u])).rows;
}
/** One Ranked game settled as the Edge Function would (the level-crate path). */
async function settleRanked(u: string, placement = 1) {
  runSeq++;
  const runId = `run-${runSeq}`;
  await db.query('insert into public.rank_results (user_id, run_id, placement, seed) values ($1, $2, $3, $4)', [u, runId, placement, runSeq]);
  const facts = { version: 2, runId, mode: 'ranked', setId: 'set2', patch: 'p', heroId: 'warden', placement, waveReached: 12, terminal: true, comebackAfterFourLosses: false, combats: { wins: 5, losses: 5, draws: 0 }, metrics: {} };
  const out = await one<{ j: { result: unknown } }>('select public.settle_progression($1, $2, $3, null, false, 1, $4::jsonb) as j', [u, 'ranked', runId, JSON.stringify(facts)]);
  return parseProgressionResult(out.j.result)!;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MVP);
  await db.exec(API_GRANTS);
  await db.exec(`update public.progression_config set epoch = now() - interval '2 days' where id = 1;`);
  for (const f of FILES) { await db.exec(f); await db.exec(API_GRANTS); }
  await db.exec(SWITCH);
  const a = achievementCatalogPayload();
  await db.query('select public.sync_achievement_catalog($1::jsonb, $2)', [JSON.stringify(a), achievementCatalogHash(a)]);
  const c = catalogSyncPayload();
  await db.query('select public.sync_cosmetic_catalog($1::jsonb, $2)', [JSON.stringify(c), catalogHash(c)]);
  await db.exec(GAUNTLET);
  await db.exec(API_GRANTS);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('the first clear of a stage grants one crate; replays grant nothing', () => {
  it('first clear: a progress row plus ONE sealed crate with no level and source gauntlet:N, returned as JSON', async () => {
    const u = await newUser();
    const r = await clear(u, 1);
    expect(r.status).toBe('first_clear');
    expect(r.crate).toMatchObject({ earnedLevel: null, source: 'gauntlet:1', state: 'sealed' });
    const cs = await crates(u);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ earned_level: null, source: 'gauntlet:1', source_id: 'gauntlet:1', state: 'sealed' });
    expect(cs[0]!.crate_id).toBe(r.crate!.crateId);
    expect(await progress(u)).toEqual([{ stage: 1, crate_granted: true, crate_id: cs[0]!.crate_id }]);
  });

  it('a second clear of the same stage is already_cleared and grants nothing', async () => {
    const u = await newUser();
    await clear(u, 3);
    expect(await clear(u, 3)).toEqual({ status: 'already_cleared', crate: null });
    expect(await clear(u, 3)).toEqual({ status: 'already_cleared', crate: null });
    expect(await crates(u)).toHaveLength(1);
    expect(await progress(u)).toHaveLength(1);
  });

  it('every stage is its own first clear: ten stages, ten crates, no collision on the null level', async () => {
    const u = await newUser();
    for (let s = 1; s <= 10; s++) expect((await clear(u, s)).status).toBe('first_clear');
    const cs = await crates(u);
    expect(cs.map((c) => c.source).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `gauntlet:${i + 1}`).sort());
    expect(cs.every((c) => c.earned_level === null)).toBe(true);
  });

  it('the stage is validated: 0, 11, negative and null raise bad_stage (a null user: unauthenticated) and write nothing', async () => {
    const u = await newUser();
    for (const s of [0, 11, -1]) expect(await raises('select public.record_gauntlet_clear($1, $2)', [u, s])).toContain('bad_stage');
    expect(await raises('select public.record_gauntlet_clear($1, null)', [u])).toContain('bad_stage');
    expect(await raises('select public.record_gauntlet_clear(null, 1)')).toContain('unauthenticated');
    expect(await crates(u)).toEqual([]);
    expect(await progress(u)).toEqual([]);
  });

  it('with crates_enabled = false a first clear STILL grants its crate (banked sealed); the switch only gates opening', async () => {
    const u = await newUser();
    await db.exec('update public.progression_config set crates_enabled = false where id = 1');
    try {
      const r = await clear(u, 2);
      expect(r.status).toBe('first_clear');
      expect(r.crate).toMatchObject({ earnedLevel: null, source: 'gauntlet:2', state: 'sealed' });
      expect(await raises('select public.open_crate($1, $2)', [u, r.crate!.crateId])).toContain('crates_disabled');
      expect(await clear(u, 2)).toEqual({ status: 'already_cleared', crate: null });
    } finally {
      await db.exec('update public.progression_config set crates_enabled = true where id = 1');
    }
    const cs = await crates(u);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ source: 'gauntlet:2', state: 'sealed' });
    expect(await progress(u)).toEqual([{ stage: 2, crate_granted: true, crate_id: cs[0]!.crate_id }]);
  });
});

describe('level crates are untouched', () => {
  it('a settlement after a Gauntlet clear still creates the Welcome + level crates; both kinds coexist', async () => {
    const u = await newUser();
    await clear(u, 1);
    const r = await settleRanked(u, 1);
    expect(r.cratesAwarded).toBeGreaterThanOrEqual(1);
    const cs = await crates(u);
    const levels = cs.filter((c) => c.earned_level !== null);
    expect(levels.map((c) => c.earned_level)).toEqual(Array.from({ length: levels.length }, (_, i) => i + 1));
    expect(levels.every((c) => c.source === null)).toBe(true);
    expect(cs.filter((c) => c.earned_level === null).map((c) => c.source)).toEqual(['gauntlet:1']);
    // A duplicate level is still refused by the unique key.
    expect(await raises('insert into public.loot_crates (user_id, earned_level) values ($1, 1)', [u])).toMatch(/duplicate key|unique/);
  });

  it('a crate with neither a level nor a source is refused', async () => {
    const u = await newUser();
    expect(await raises('insert into public.loot_crates (user_id, earned_level, source) values ($1, null, null)', [u])).toContain('loot_crates_level_or_source');
  });

  it('a Gauntlet crate opens through the normal open_crate and its source cannot be rewritten', async () => {
    const u = await newUser();
    const { crate } = await clear(u, 4);
    const opened = await one<{ j: { status: string; crate: { source: string; earnedLevel: number | null } } }>('select public.open_crate($1, $2) as j', [u, crate!.crateId]);
    expect(opened.j.status).toBe('opened');
    expect(opened.j.crate).toMatchObject({ source: 'gauntlet:4', earnedLevel: null });
    const sealedAgain = await clear(u, 5);
    expect(await raises("update public.loot_crates set source = 'gauntlet:9' where crate_id = $1", [sealedAgain.crate!.crateId])).toContain('crate_identity_is_immutable');
  });
});

describe('clients never write; owners read only their own progress', () => {
  async function asClient<T>(role: 'anon' | 'authenticated', user: string, fn: () => Promise<T>): Promise<T> {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    await db.exec(`set role ${role}`);
    try { return await fn(); } finally { await db.exec('reset role'); }
  }

  it('anon and authenticated cannot execute record_gauntlet_clear or write gauntlet_progress', async () => {
    const u = await newUser();
    await clear(u, 1);
    for (const role of ['anon', 'authenticated'] as const) {
      await asClient(role, u, async () => {
        expect(await raises('select public.record_gauntlet_clear($1, 2)', [u])).toMatch(/permission denied/);
        expect(await raises('insert into public.gauntlet_progress (user_id, stage) values ($1, 5)', [u])).toMatch(/row-level security/);
        await db.query('update public.gauntlet_progress set crate_granted = false where user_id = $1', [u]);
        await db.query('delete from public.gauntlet_progress where user_id = $1', [u]);
      });
    }
    expect(await progress(u)).toHaveLength(1); // the update/delete above matched no row (no write policies)
    expect((await progress(u))[0]!.crate_granted).toBe(true);
  });

  it('an authenticated owner reads their own rows only; anon reads none', async () => {
    const u = await newUser();
    const other = await newUser();
    await clear(u, 1);
    await clear(u, 2);
    await clear(other, 1);
    await asClient('authenticated', u, async () => {
      expect((await db.query('select stage from public.gauntlet_progress')).rows).toHaveLength(2);
      expect((await db.query('select stage from public.gauntlet_progress where user_id = $1', [other])).rows).toHaveLength(0);
    });
    await asClient('anon', u, async () => {
      expect((await db.query('select stage from public.gauntlet_progress')).rows).toHaveLength(0);
    });
  });
});

describe('idempotence', () => {
  it('re-running the migration changes nothing and keeps the writer working', async () => {
    const before = (await db.query('select user_id, stage, crate_granted, crate_id from public.gauntlet_progress order by 1, 2')).rows;
    const cratesBefore = (await db.query('select crate_id, earned_level, source from public.loot_crates order by crate_id')).rows;
    await db.exec(GAUNTLET);
    await db.exec(GAUNTLET);
    expect((await db.query('select user_id, stage, crate_granted, crate_id from public.gauntlet_progress order by 1, 2')).rows).toEqual(before);
    expect((await db.query('select crate_id, earned_level, source from public.loot_crates order by crate_id')).rows).toEqual(cratesBefore);
    const u = await newUser();
    expect((await clear(u, 7)).status).toBe('first_clear');
  });
});
