import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALPHA_TESTER_TITLE_ID, COSMETICS, eligibleCrateCosmetics, parseOpenCrateResult } from './cosmetics';
import { parseProgressionProfile, parseProgressionResult } from './rules';

/**
 * THE CRATES SQL, EXECUTED. An embedded Postgres (PGlite, WASM) runs the real 2026-09-27 MVP migration and then
 * the 2026-09-28 crates migration over a minimal stub of the Supabase schema (auth.users, profiles and the source
 * tables the writer reads), then drives `settle_progression`, `open_crate` and `equip_title` as the service role
 * would. This catches plpgsql errors before the owner pastes the file, and proves the contract end to end:
 *
 *   crates per level (Welcome Crate on enrollment, one per level, multi-level jumps), no duplicate reward across
 *   the whole pool, `pool_exhausted` keeping the crate sealed, a second open of the same crate returning the same
 *   committed reward, the backfill being idempotent, ownership-checked equip, and clients never writing.
 *
 * CONCURRENCY. PGlite is a single connection, so two transactions cannot truly race here. What makes a race safe
 * is asserted instead: both writers take the same per-user advisory lock before anything else, the crate row is
 * locked FOR UPDATE, the unique keys refuse a duplicate even when a writer is bypassed, and an opened crate is
 * immutable (a replayed or interleaved second open can only read the committed reward).
 */

const root = join(__dirname, '../../..');
const MVP = readFileSync(join(root, 'supabase/migrations/2026-09-27-account-progression.sql'), 'utf8');
const CRATES = readFileSync(join(root, 'supabase/migrations/2026-09-28-progression-crates.sql'), 'utf8');

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
// Supabase grants table privileges to the API roles by default; RLS is what stands between them and the rows.
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
  const r = await db.query<T>(sql, params);
  return r.rows[0]!;
}
/** Settle a Ranked game at `placement` (writes its rank_results source row first). */
async function settleRanked(user: string, runId: string, placement: number): Promise<ReturnType<typeof parseProgressionResult>> {
  await db.query('insert into public.rank_results (user_id, run_id, placement, seed) values ($1, $2, $3, 1)', [user, runId, placement]);
  const row = await one<{ j: { result: unknown } }>('select public.settle_progression($1, $2, $3, null, false, 1, null) as j', [user, 'ranked', runId]);
  return parseProgressionResult(row.j.result);
}
async function settleTutorial(user: string): Promise<{ status: string; result: ReturnType<typeof parseProgressionResult> }> {
  const row = await one<{ j: { status: string; result: unknown } }>('select public.settle_progression($1, $2, $3, null, false, 1, null) as j', [user, 'tutorial', 'learn-ascent:v1']);
  return { status: row.j.status, result: parseProgressionResult(row.j.result) };
}
async function crates(user: string): Promise<Array<{ crate_id: string; earned_level: number; state: string; reward_cosmetic_id: string | null }>> {
  return (await db.query<{ crate_id: string; earned_level: number; state: string; reward_cosmetic_id: string | null }>(
    'select crate_id, earned_level, state, reward_cosmetic_id from public.loot_crates where user_id = $1 order by earned_level', [user])).rows;
}
async function open(user: string, crateId: string): Promise<{ raw: Record<string, unknown>; parsed: ReturnType<typeof parseOpenCrateResult> }> {
  const row = await one<{ j: Record<string, unknown> }>('select public.open_crate($1, $2) as j', [user, crateId]);
  return { raw: row.j, parsed: parseOpenCrateResult(row.j) };
}
async function owned(user: string): Promise<string[]> {
  return (await db.query<{ cosmetic_id: string }>('select cosmetic_id from public.player_cosmetics where user_id = $1 order by cosmetic_id', [user])).rows.map((r) => r.cosmetic_id);
}
async function raises(sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); } catch (e) { return String((e as Error).message); }
  return 'no error';
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MVP);
  await db.exec(API_GRANTS);
  // A player enrolled BEFORE the crates migration (the live DB has real ones): Level 3 through the MVP writer.
  await db.exec(`update public.progression_config set epoch = now() - interval '1 day' where id = 1;`);
  const early = await newUser();
  await db.query('insert into public.rank_results (user_id, run_id, placement, seed) values ($1, $2, 1, 1)', [early, 'pre-1']);
  await db.query('select public.settle_progression($1, $2, $3, null, false, 1, null)', [early, 'ranked', 'pre-1']);
  await db.query('insert into public.rank_results (user_id, run_id, placement, seed) values ($1, $2, 1, 1)', [early, 'pre-2']);
  await db.query('select public.settle_progression($1, $2, $3, null, false, 1, null)', [early, 'ranked', 'pre-2']);
  await db.query('insert into public.rank_results (user_id, run_id, placement, seed) values ($1, $2, 1, 1)', [early, 'pre-3']);
  await db.query('select public.settle_progression($1, $2, $3, null, false, 1, null)', [early, 'ranked', 'pre-3']);
  // A profile row that never settled (never enrolled): no crates for it.
  const idle = await newUser();
  await db.query('insert into public.profiles (user_id, rating) values ($1, 0)', [idle]);
  // NOW the crates migration.
  await db.exec(CRATES);
  await db.exec(API_GRANTS);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('the backfill for accounts enrolled before the migration', () => {
  const EARLY = '00000000-0000-0000-0000-000000000001';
  const IDLE = '00000000-0000-0000-0000-000000000002';

  it('an enrolled Level 3 account gets the Welcome Crate plus one per level reached (3 sealed); the Alpha Tester title moves over', async () => {
    const p = await one<{ account_level: number }>('select account_level from public.profiles where user_id = $1', [EARLY]);
    expect(p.account_level).toBe(3); // 675 XP
    expect((await crates(EARLY)).map((c) => [c.earned_level, c.state])).toEqual([[1, 'sealed'], [2, 'sealed'], [3, 'sealed']]);
    expect(await owned(EARLY)).toEqual([ALPHA_TESTER_TITLE_ID]);
  });

  it('a profile that never settled is not enrolled and gets nothing', async () => {
    expect(await crates(IDLE)).toEqual([]);
  });

  it('re-running the whole migration changes nothing (idempotent)', async () => {
    const before = await db.query('select user_id, earned_level, crate_id, state from public.loot_crates order by user_id, earned_level');
    const ownedBefore = await db.query('select user_id, cosmetic_id from public.player_cosmetics order by 1, 2');
    await db.exec(CRATES);
    await db.exec(CRATES);
    expect((await db.query('select user_id, earned_level, crate_id, state from public.loot_crates order by user_id, earned_level')).rows).toEqual(before.rows);
    expect((await db.query('select user_id, cosmetic_id from public.player_cosmetics order by 1, 2')).rows).toEqual(ownedBefore.rows);
  });

  it('the first settlement after the migration adds only NEW levels (no second Welcome Crate)', async () => {
    const r = await settleRanked(EARLY, 'post-1', 1); // 675 + 225 = 900 → Level 4
    expect(r!.after.level).toBe(4);
    expect(r!.cratesAwarded).toBe(1);
    expect((await crates(EARLY)).map((c) => c.earned_level)).toEqual([1, 2, 3, 4]);
  });
});

describe('crates per level', () => {
  it('enrollment grants the Level 1 Welcome Crate even with no level gained', async () => {
    const u = await newUser();
    const r = await settleRanked(u, 'r1', 6); // 100 XP, still Level 1
    expect(r!.after.level).toBe(1);
    expect(r!.cratesAwarded).toBe(1);
    expect(r!.crateIds).toHaveLength(1);
    expect((await crates(u)).map((c) => [c.earned_level, c.state])).toEqual([[1, 'sealed']]);
  });

  it('a first game that also crosses a level: the Welcome Crate AND the Level 2 crate (Learn Ascent, 250 XP)', async () => {
    const u = await newUser();
    const t = await settleTutorial(u);
    expect(t.status).toBe('ok');
    expect([t.result!.before.level, t.result!.after.level, t.result!.cratesAwarded]).toEqual([1, 2, 2]);
    expect(t.result!.unlockedTitles).toEqual([ALPHA_TESTER_TITLE_ID]);
    expect((await crates(u)).map((c) => c.earned_level)).toEqual([1, 2]);
    // the level title is owned through player_cosmetics and still mirrored into the MVP's player_titles
    expect(await owned(u)).toEqual([ALPHA_TESTER_TITLE_ID]);
    expect((await db.query('select title_id from public.player_titles where user_id = $1', [u])).rows).toEqual([{ title_id: ALPHA_TESTER_TITLE_ID }]);
  });

  it('one crate per level crossed; a settlement that crosses nothing creates none; a duplicate returns the same crates', async () => {
    const u = await newUser();
    const a = await settleRanked(u, 'a', 1); // 225 → L1 (Welcome Crate)
    expect([a!.after.level, a!.cratesAwarded]).toEqual([1, 1]);
    const b = await settleRanked(u, 'b', 6); // 325 → L2: one crate
    expect([b!.after.level, b!.cratesAwarded]).toEqual([2, 1]);
    const c = await settleRanked(u, 'c', 6); // 425 → still L2: none
    expect([c!.after.level, c!.cratesAwarded, c!.crateIds]).toEqual([2, 0, []]);
    const dup = await one<{ j: { status: string; result: unknown } }>('select public.settle_progression($1, $2, $3, null, false, 1, null) as j', [u, 'ranked', 'b']);
    expect(dup.j.status).toBe('deduped');
    expect(parseProgressionResult(dup.j.result)!.crateIds).toEqual(b!.crateIds);
    expect((await crates(u)).map((x) => x.earned_level)).toEqual([1, 2]);
  });

  it('a MULTI-LEVEL jump creates one crate per level in one settlement, ids oldest level first', async () => {
    // Today one game crosses at most one 250 XP level, so a jump is exercised with a steeper test curve
    // (50 XP per level) swapped in for this test, then the real curve is restored.
    const at = MVP.indexOf('create or replace function public.progression_level_of(');
    const realCurve = MVP.slice(at, MVP.indexOf('$$;', MVP.indexOf('begin', at)) + 3);
    await db.exec('create or replace function public.progression_level_of(p_xp bigint) returns int language sql immutable as $$ select (1 + greatest(coalesce(p_xp, 0), 0) / 50)::int $$;');
    try {
      const u = await newUser();
      const first = await settleRanked(u, 'j1', 6); // 0 → 100 XP: L1 → L3, enrolling → Welcome + L2 + L3
      expect([first!.before.level, first!.after.level, first!.cratesAwarded]).toEqual([1, 3, 3]);
      const jump = await settleRanked(u, 'j2', 1); // 100 → 325 XP: L3 → L7 → four crates
      expect([jump!.before.level, jump!.after.level, jump!.cratesAwarded]).toEqual([3, 7, 4]);
      const rows = await crates(u);
      expect(rows.map((x) => x.earned_level)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(jump!.crateIds).toEqual(rows.filter((x) => x.earned_level >= 4).map((x) => x.crate_id));
      const ledger = await one<{ crates_awarded: number }>('select crates_awarded from public.progression_results where user_id = $1 and run_id = $2', [u, 'j2']);
      expect(ledger.crates_awarded).toBe(4);
    } finally {
      await db.exec(realCurve);
    }
    expect((await one<{ l: number }>('select public.progression_level_of(2500) as l')).l).toBe(11);
  });
});

describe('opening crates', () => {
  it('every crate gives a DIFFERENT eligible title until the pool of 15 is empty; then the crate stays sealed (pool_exhausted)', async () => {
    const u = await newUser();
    await settleRanked(u, 'o1', 6); // Welcome Crate
    // bank 15 more crates by hand (as a long career would), so 16 sealed crates exist for a pool of 15
    await db.query("insert into public.loot_crates (user_id, earned_level, source_id) select $1, g, 'test' from generate_series(2, 16) g", [u]);
    const pool = eligibleCrateCosmetics([]).map((c) => c.id);
    expect(pool).toHaveLength(15);
    const got: string[] = [];
    for (const c of (await crates(u)).slice(0, 15)) {
      const { parsed } = await open(u, c.crate_id);
      expect(parsed!.status).toBe('opened');
      expect(parsed!.crate.state).toBe('opened');
      got.push(parsed!.rewardId!);
    }
    expect(new Set(got).size).toBe(15);
    expect([...got].sort()).toEqual([...pool].sort());
    expect(got).not.toContain(ALPHA_TESTER_TITLE_ID);
    // the 16th: nothing left → pool_exhausted, still sealed, nothing written
    const last = (await crates(u))[15]!;
    const { parsed } = await open(u, last.crate_id);
    expect(parsed).toMatchObject({ status: 'pool_exhausted', rewardId: null, sealedRemaining: 1 });
    expect(parsed!.crate.state).toBe('sealed');
    expect((await crates(u))[15]!.state).toBe('sealed');
    // a new catalog item later: the banked crate opens into it
    await db.exec("insert into public.cosmetic_catalog (cosmetic_id, category, rarity, acquisition_source) values ('title_test_late', 'title', 'epic', 'crate')");
    try {
      const again = await open(u, last.crate_id);
      expect(again.parsed).toMatchObject({ status: 'opened', rewardId: 'title_test_late', sealedRemaining: 0 });
    } finally {
      await db.exec("update public.cosmetic_catalog set active = false where cosmetic_id = 'title_test_late'");
    }
  });

  it('opening the SAME crate twice returns the committed reward (already_opened), never a second item', async () => {
    const u = await newUser();
    await settleRanked(u, 's1', 6);
    const [c] = await crates(u);
    const first = await open(u, c!.crate_id);
    const second = await open(u, c!.crate_id);
    expect(first.parsed!.status).toBe('opened');
    expect(second.parsed).toMatchObject({ status: 'already_opened', rewardId: first.parsed!.rewardId });
    expect(await owned(u)).toEqual([first.parsed!.rewardId]);
  });

  it('a crate never draws an item the player already owns (a title granted another way is excluded)', async () => {
    const u = await newUser();
    await settleRanked(u, 'e1', 6);
    const pool = eligibleCrateCosmetics([]).map((c) => c.id);
    const keep = pool[7]!;
    for (const id of pool.filter((x) => x !== keep)) {
      await db.query("insert into public.player_cosmetics (user_id, cosmetic_id, source) values ($1, $2, 'test')", [u, id]);
    }
    const [c] = await crates(u);
    expect((await open(u, c!.crate_id)).parsed!.rewardId).toBe(keep);
  });

  it('a new crate title is worn at once only when nothing is worn; the revision moves', async () => {
    const u = await newUser();
    await settleRanked(u, 't1', 6);
    const before = await one<{ equipped_title_id: string | null; progression_revision: number }>('select equipped_title_id, progression_revision from public.profiles where user_id = $1', [u]);
    expect(before.equipped_title_id).toBeNull();
    const [c] = await crates(u);
    const { raw } = await open(u, c!.crate_id);
    const profile = parseProgressionProfile(raw.profile);
    expect(profile!.equippedTitleId).toBe(raw.rewardId);
    expect(profile!.titles).toEqual([raw.rewardId]);
    expect(profile!.revision).toBe(Number(before.progression_revision) + 1);
    // a second title does NOT replace the one worn
    await db.query("insert into public.loot_crates (user_id, earned_level) values ($1, 2)", [u]);
    const second = (await crates(u))[1]!;
    const { raw: raw2 } = await open(u, second.crate_id);
    expect(parseProgressionProfile(raw2.profile)!.equippedTitleId).toBe(raw.rewardId);
  });

  it("refusals: another player's crate, an unknown crate, crates switched off (still earned, banked)", async () => {
    const u = await newUser();
    const other = await newUser();
    await settleRanked(u, 'f1', 6);
    const [c] = await crates(u);
    expect(await raises('select public.open_crate($1, $2)', [other, c!.crate_id])).toContain('crate_not_found');
    expect(await raises('select public.open_crate($1, $2)', [u, '11111111-1111-1111-1111-111111111111'])).toContain('crate_not_found');
    await db.exec('update public.progression_config set crates_enabled = false where id = 1');
    try {
      expect(await raises('select public.open_crate($1, $2)', [u, c!.crate_id])).toContain('crates_disabled');
      const v = await newUser();
      expect((await settleRanked(v, 'f2', 6))!.cratesAwarded).toBe(1);
    } finally {
      await db.exec('update public.progression_config set crates_enabled = true where id = 1');
    }
  });

  it('the database is the final no-duplicate guard: a second ownership row, a second crate for a level, a reopened crate', async () => {
    const u = await newUser();
    await settleRanked(u, 'g1', 6);
    const [c] = await crates(u);
    const { parsed } = await open(u, c!.crate_id);
    expect(await raises("insert into public.player_cosmetics (user_id, cosmetic_id, source) values ($1, $2, 'x')", [u, parsed!.rewardId])).toMatch(/duplicate key/);
    expect(await raises('insert into public.loot_crates (user_id, earned_level) values ($1, 1)', [u])).toMatch(/duplicate key/);
    expect(await raises("update public.loot_crates set reward_cosmetic_id = 'title_wanderer' where crate_id = $1", [c!.crate_id])).toContain('crate_already_opened');
    expect(await raises("update public.loot_crates set state = 'sealed', reward_cosmetic_id = null, opened_at = null where crate_id = $1", [c!.crate_id])).toContain('crate_already_opened');
  });

  it('both writers serialize on the SAME per-user lock, and open_crate locks the crate row (what makes a real race safe)', () => {
    const lock = "pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0))";
    const body = (name: string): string => {
      const at = CRATES.indexOf(`create or replace function public.${name}(`);
      return CRATES.slice(at, CRATES.indexOf('$$;', CRATES.indexOf('begin', at)));
    };
    for (const fn of ['settle_progression', 'open_crate', 'equip_title']) expect(body(fn), fn).toContain(lock);
    const openBody = body('open_crate');
    // the lock comes before the crate is read, the crate is read FOR UPDATE, and the flip is guarded on 'sealed'
    expect(openBody.indexOf(lock)).toBeLessThan(openBody.indexOf('from public.loot_crates where crate_id = p_crate_id'));
    expect(openBody).toMatch(/where crate_id = p_crate_id and user_id = p_user for update;/);
    expect(openBody).toMatch(/where crate_id = p_crate_id and state = 'sealed'/);
  });

  it('the draw is spread by weight: over many fresh players the first crate lands on Commons most, the Legendary least', async () => {
    // A statistical smoke test of the SQL draw (the exact walk is pinned in cosmetics.test.ts / sqlParity.test.ts).
    const counts: Record<string, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const rarity = Object.fromEntries(COSMETICS.map((c) => [c.id, c.rarity]));
    for (let i = 0; i < 150; i++) {
      const u = await newUser();
      await db.query('insert into public.loot_crates (user_id, earned_level) values ($1, 1)', [u]);
      const [c] = await crates(u);
      counts[rarity[(await open(u, c!.crate_id)).parsed!.rewardId!]!]!++;
    }
    // expected shares: Common 7x55 = 385 of 562 (68.5%), Rare 150 (26.7%), Epic 24 (4.3%), Legendary 3 (0.5%)
    expect(counts.common).toBeGreaterThan(counts.rare);
    expect(counts.rare).toBeGreaterThan(counts.epic + counts.legendary);
  }, 30_000);
});

describe('equip_title', () => {
  it('equips an owned title, takes it off with null, and refuses one the player does not own', async () => {
    const u = await newUser();
    await settleRanked(u, 'q1', 6);
    const [c] = await crates(u);
    const got = (await open(u, c!.crate_id)).parsed!.rewardId!;
    const off = await one<{ j: { profile: unknown } }>('select public.equip_title($1, null) as j', [u]);
    expect(parseProgressionProfile(off.j.profile)!.equippedTitleId).toBeNull();
    const on = await one<{ j: { profile: unknown } }>('select public.equip_title($1, $2) as j', [u, got]);
    expect(parseProgressionProfile(on.j.profile)!.equippedTitleId).toBe(got);
    const notMine = eligibleCrateCosmetics([got])[0]!.id;
    expect(await raises('select public.equip_title($1, $2)', [u, notMine])).toContain('not_owned');
    expect(await raises('select public.equip_title($1, $2)', [u, 'no_such_title'])).toContain('not_owned');
    expect((await one<{ equipped_title_id: string }>('select equipped_title_id from public.profiles where user_id = $1', [u])).equipped_title_id).toBe(got);
  });
});

describe('clients can never write (RLS + the guard trigger + service-role-only functions)', () => {
  async function asClient<T>(role: 'anon' | 'authenticated', user: string, fn: () => Promise<T>): Promise<T> {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    await db.exec(`set role ${role}`);
    try { return await fn(); } finally { await db.exec('reset role'); }
  }

  it('an authenticated player cannot insert ownership or crates, flip a crate, equip directly, or call the writers', async () => {
    const u = await newUser();
    await settleRanked(u, 'z1', 6);
    const [c] = await crates(u);
    await asClient('authenticated', u, async () => {
      expect(await raises("insert into public.player_cosmetics (user_id, cosmetic_id, source) values ($1, 'title_the_unbroken', 'hack')", [u])).toMatch(/row-level security/);
      expect(await raises('insert into public.loot_crates (user_id, earned_level) values ($1, 50)', [u])).toMatch(/row-level security/);
      await db.query("update public.loot_crates set state = 'opened', reward_cosmetic_id = 'title_the_unbroken', opened_at = now() where crate_id = $1", [c!.crate_id]);
      expect(await raises("update public.profiles set equipped_title_id = 'title_the_unbroken' where user_id = $1", [u])).toContain('progression_columns_are_server_owned');
      expect(await raises("insert into public.cosmetic_loadouts (user_id, slot, cosmetic_id) values ($1, 'title', 'title_the_unbroken')", [u])).toMatch(/row-level security/);
      expect(await raises('select public.open_crate($1, $2)', [u, c!.crate_id])).toMatch(/permission denied/);
      expect(await raises('select public.equip_title($1, $2)', [u, 'title_wanderer'])).toMatch(/permission denied/);
    });
    expect((await crates(u))[0]!.state).toBe('sealed'); // the update above matched no row (no update policy)
  });

  it('public reads: the catalog, owned titles and the equipped title; crates only for their owner', async () => {
    const u = await newUser();
    const stranger = await newUser();
    await settleRanked(u, 'z2', 6);
    const [c] = await crates(u);
    await open(u, c!.crate_id);
    await asClient('anon', stranger, async () => {
      expect(((await db.query<{ n: number }>('select count(*)::int as n from public.cosmetic_catalog')).rows[0]!.n)).toBeGreaterThanOrEqual(16);
      expect((await db.query('select cosmetic_id from public.player_cosmetics where user_id = $1', [u])).rows).toHaveLength(1);
      expect((await db.query('select equipped_title_id from public.profiles where user_id = $1', [u])).rows).toHaveLength(1);
      expect((await db.query('select * from public.loot_crates where user_id = $1', [u])).rows).toHaveLength(0);
    });
    await asClient('authenticated', u, async () => {
      expect((await db.query('select * from public.loot_crates where user_id = $1', [u])).rows).toHaveLength(1);
    });
  });
});
