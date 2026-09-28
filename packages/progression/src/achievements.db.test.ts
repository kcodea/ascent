import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACHIEVEMENTS, ACHIEVEMENT_INDEX, SERVER_METRICS, achievementCatalogHash, achievementCatalogPayload, evaluateAchievements,
  type AchievementCatalogPayload, type AchievementProgressRow, type AchievementSettlement,
} from './achievements';
import { levelOfXp, parseProgressionResult, xpForSettlement, type ProgressionMode } from './rules';
import { settlementParity } from './server';

/**
 * THE ACHIEVEMENTS SQL, EXECUTED (achievements batch 1, 2026-09-28). PGlite runs the real MVP, crates, skins and
 * achievements migrations in order over a minimal Supabase stub (with the rank columns the medal-rank migration
 * adds), syncs the code's catalog, and drives `settle_progression` exactly as the Edge Function would:
 *
 *   the epoch switch (nothing evaluated before it, V1 still settles); completions grant XP in the SAME ledger row as
 *   the match XP and never twice (duplicate settlement, repeat completion); the SQL agrees with the TS evaluator
 *   (`evaluateAchievements`) game after game; the practice gate (Normal Health AND a timer); a client can never
 *   supply a server metric; rank achievements from the Career best; streaks; distinct heroes; the emergency switch;
 *   the catalog sync; RLS (completions public, progress private, clients never write).
 */

const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const MVP = read('2026-09-27-account-progression.sql');
const CRATES = read('2026-09-28-progression-crates.sql');
const SKINS = read('2026-09-28-progression-skins.sql');
const ACH = read('2026-09-28-achievements.sql');

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
async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}
async function raises(sql: string, params: unknown[] = []): Promise<string> {
  try { await db.query(sql, params); } catch (e) { return String((e as Error).message); }
  return 'no error';
}
async function newUser(over: { highestDivision?: number } = {}): Promise<string> {
  userSeq++;
  const id = `00000000-0000-0000-0000-${String(userSeq).padStart(12, '0')}`;
  await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query('insert into public.profiles (user_id, rank_highest_division) values ($1, $2)', [id, over.highestDivision ?? 0]);
  return id;
}
async function sync(payload: AchievementCatalogPayload = achievementCatalogPayload(), hash = achievementCatalogHash(payload)): Promise<Record<string, unknown>> {
  return (await one<{ j: Record<string, unknown> }>('select public.sync_achievement_catalog($1::jsonb, $2) as j', [JSON.stringify(payload), hash])).j;
}

interface Game {
  mode?: ProgressionMode;
  placement?: number;
  heroId?: string;
  setId?: string;
  metrics?: Record<string, number>;
  version?: 1 | 2;
  comeback?: boolean;
  practice?: { health?: 'normal' | 'unlimited'; timeMult?: number | null };
  rank?: Partial<{ promoted: boolean; division_before: number; was_demotion_game: boolean; demoted: boolean; lobby_strength: number }>;
  createdAt?: string;
}

/** Record a source row the way the ladder / practice upload would, then settle it as the Edge Function would. */
async function settle(u: string, g: Game = {}): Promise<{ status: string; result: NonNullable<ReturnType<typeof parseProgressionResult>>; runId: string; mode: ProgressionMode }> {
  const mode = g.mode ?? 'ranked';
  runSeq++;
  let runId = `run-${runSeq}`;
  let sourceId: number | null = null;
  const placement = g.placement ?? 5;
  if (mode === 'ranked') {
    const r = g.rank ?? {};
    await db.query(
      `insert into public.rank_results (user_id, run_id, placement, seed, created_at, promoted, division_before, was_demotion_game, demoted, lobby_strength)
       values ($1, $2, $3, $4, coalesce($5::timestamptz, now()), $6, $7, $8, $9, $10)`,
      [u, runId, placement, runSeq, g.createdAt ?? null, r.promoted ?? false, r.division_before ?? 0, r.was_demotion_game ?? false, r.demoted ?? false, r.lobby_strength ?? null],
    );
  } else if (mode === 'practice') {
    const cfg: Record<string, unknown> = { opponents: 'bots', botDifficulty: 3, health: g.practice?.health ?? 'normal' };
    if (g.practice?.timeMult !== null) cfg.timeMult = g.practice?.timeMult ?? 1;
    const row = await one<{ id: number }>('insert into public.practice_games (user_id, hero_id, placement, config) values ($1, $2, $3, $4) returning id', [u, g.heroId ?? 'warden', placement, cfg]);
    sourceId = Number(row.id);
    runId = `practice:${sourceId}`;
  } else {
    runId = 'learn-ascent:v1';
  }
  const base = {
    runId, mode, setId: g.setId ?? 'set2', patch: 'p', heroId: g.heroId ?? 'warden', placement: mode === 'tutorial' ? null : placement,
    waveReached: 12, terminal: true, comebackAfterFourLosses: g.comeback ?? false, combats: { wins: 5, losses: 5, draws: 0 },
  };
  const facts = (g.version ?? 2) === 2 ? { version: 2, ...base, metrics: g.metrics ?? {} } : { version: 1, ...base };
  const out = await one<{ j: { status: string; result: unknown } }>(
    'select public.settle_progression($1, $2, $3, $4, $5, 1, $6::jsonb) as j', [u, mode, runId, sourceId, g.comeback ?? false, JSON.stringify(facts)],
  );
  return { status: out.j.status, result: parseProgressionResult(out.j.result)!, runId, mode };
}
async function progressOf(u: string): Promise<Record<string, AchievementProgressRow>> {
  const r = await rows<{ achievement_id: string; progress: string | number; completed: boolean }>(
    'select achievement_id, progress, completed_at is not null as completed from public.achievement_progress where user_id = $1', [u]);
  return Object.fromEntries(r.map((x) => [x.achievement_id, { progress: Number(x.progress), completed: x.completed }]));
}
async function completionsOf(u: string): Promise<string[]> {
  return (await rows<{ achievement_id: string }>('select achievement_id from public.achievement_completions where user_id = $1 order by achievement_id', [u])).map((r) => r.achievement_id);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const f of [MVP, CRATES, SKINS, ACH]) { await db.exec(f); await db.exec(API_GRANTS); }
  await db.exec(`update public.progression_config set epoch = now() - interval '2 days' where id = 1;`);
  expect((await sync()).status).toBe('synced');
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('the switch (no retroactive counting)', () => {
  it('while the achievements epoch is null nothing is evaluated; the game still earns its match XP (V1 and V2 both settle)', async () => {
    const u = await newUser({ highestDivision: 4 });
    const v2 = await settle(u, { placement: 1, metrics: { goldSpentTurnMax: 30 } });
    const v1 = await settle(u, { placement: 1, version: 1 });
    for (const s of [v2, v1]) {
      expect(s.status).toBe('ok');
      expect(s.result.achievements).toEqual([]);
      expect(s.result.achievementXp).toBe(0);
      expect(s.result.xp.total).toBe(200);
    }
    expect(await completionsOf(u)).toEqual([]);
  });

  it('the documented switch turns it on; a game recorded BEFORE the epoch is still never evaluated', async () => {
    await db.exec(SWITCH);
    await db.exec(SWITCH); // idempotent: `and achievements_epoch is null`
    const u = await newUser();
    const old = await settle(u, { placement: 1, createdAt: new Date(Date.now() - 86_400_000).toISOString() });
    expect(old.result.achievements).toEqual([]);
    const fresh = await settle(u, { placement: 1 });
    expect(fresh.result.achievements).toContain('ranked.first_win');
  });
});

describe('settlement (the switch is on from here)', () => {
  it('completions pay in the SAME ledger row: after = before + match XP + achievement XP, levels and crates included', async () => {
    const u = await newUser({ highestDivision: 3 });
    const s = await settle(u, { placement: 1, metrics: { goldSpentTurnMax: 21, rubyPlaysTurnMax: 8 } });
    expect(s.result.achievements.sort()).toEqual([
      'career.games.1', 'economy.spend_turn_20', 'hero.warden.victory', 'ranked.first_game', 'ranked.first_top_four', 'ranked.first_win',
      'ranked.reach_bronze_2', 'ranked.reach_bronze_3', 'ranked.reach_silver_1', 's2.kobold.rubies_turn_8',
      'career.achievements.10', // the meta family, evaluated last: these are the account's 10th completion
    ].sort());
    const expectXp = s.result.achievements.reduce((n, id) => n + ACHIEVEMENT_INDEX[id]!.rewards.xp, 0);
    expect(s.result.achievementXp).toBe(expectXp);
    expect(s.result.xp).toEqual(xpForSettlement({ mode: 'ranked', placement: 1, comeback: false }));
    expect(s.result.after.lifetimeXp).toBe(s.result.before.lifetimeXp + s.result.xp.total + expectXp);
    expect(s.result.after.level).toBe(levelOfXp(s.result.after.lifetimeXp));
    expect(s.result.cratesAwarded).toBe(s.result.after.level); // Welcome Crate + one per level, achievement XP included
    expect(settlementParity(s.result)).toBe(true);
    const ledger = await one<{ achievement_xp: number; achievement_ids: string[]; total_xp: number }>('select achievement_xp, achievement_ids, total_xp from public.progression_results where user_id = $1', [u]);
    expect(ledger).toMatchObject({ achievement_xp: expectXp, total_xp: 200 });
    expect(ledger.achievement_ids.sort()).toEqual(s.result.achievements.sort());
  });

  it('idempotent: a duplicate settlement returns the ORIGINAL result and evaluates nothing; a completion never pays twice', async () => {
    const u = await newUser();
    const first = await settle(u, { placement: 1 });
    const again = await one<{ j: { status: string; result: unknown } }>(
      'select public.settle_progression($1, $2, $3, null, false, 1, null) as j', [u, 'ranked', first.runId]);
    expect(again.j.status).toBe('deduped');
    expect(parseProgressionResult(again.j.result)).toEqual(first.result);
    const next = await settle(u, { placement: 1 });
    expect(next.result.achievements).not.toContain('ranked.first_win');
    const xp = await one<{ account_xp: string }>('select account_xp from public.profiles where user_id = $1', [u]);
    expect(Number(xp.account_xp)).toBe(next.result.after.lifetimeXp);
    expect(await completionsOf(u)).toContain('ranked.first_win');
  });

  it('agrees with the TS evaluator game after game (progress rows and completions), across modes and metrics', async () => {
    const u = await newUser({ highestDivision: 1 });
    const games: Game[] = [
      { placement: 3, metrics: { rubyPlays: 20, alesTurnMax: 4, goldSpent: 300 } },
      { mode: 'practice', placement: 1, heroId: 'indy', metrics: { rubyPlays: 30, goldSpent: 400, finalKobolds: 5 } },
      { mode: 'practice', placement: 2, practice: { timeMult: null }, metrics: { rubyPlays: 500 } }, // no timer: `any` gate closed
      { placement: 1, metrics: { rubyPlays: 61, finalKobolds: 5, spellsTurnMax: 7, goldSpent: 400 }, setId: 'set2' },
      { placement: 2, setId: 'set1', metrics: { rubyPlaysTurnMax: 12, goldSpentTurnMax: 25 } },
      { mode: 'tutorial', metrics: { goldSpentTurnMax: 99 } },
      { placement: 1, heroId: 'indy', comeback: true, metrics: { goldSpent: 100 } },
    ];
    for (const g of games) {
      const prior = await progressOf(u);
      const s = await settle(u, g);
      const mode = g.mode ?? 'ranked';
      const heroes = await one<{ played: string; won: string }>('select count(*) filter (where games > 0) as played, count(*) filter (where firsts > 0) as won from public.achievement_hero_stats where user_id = $1', [u]);
      const eligibleRun = mode === 'ranked' || (mode === 'practice' && (g.practice?.health ?? 'normal') === 'normal' && g.practice?.timeMult !== null);
      const settlement: AchievementSettlement = {
        mode, eligibleRun, setId: g.setId ?? 'set2', heroId: mode === 'tutorial' ? null : g.heroId ?? 'warden', placement: mode === 'tutorial' ? null : g.placement ?? 5,
        metrics: {
          ...g.metrics, game: 1, comeback: s.result.comeback ? 1 : 0, highestDivision: 1, promoted: 0, ascendantFirst: 0, demotionEscape: 0, brutalFirst: 0,
          firstStreak: 0, topFourStreak: 0, heroesPlayed: Number(heroes.played), heroesWon: Number(heroes.won),
        },
      };
      if (mode === 'ranked') {
        // The streaks the SQL reads from rank_results (this test's own ranked history)
        const placements = (await rows<{ placement: number }>('select placement from public.rank_results where user_id = $1 order by created_at desc, run_id desc', [u])).map((r) => r.placement);
        const streak = (ok: (p: number) => boolean): number => { const i = placements.findIndex((p) => !ok(p)); return i < 0 ? placements.length : i; };
        Object.assign(settlement.metrics, { firstStreak: streak((p) => p === 1), topFourStreak: streak((p) => p <= 4) });
      }
      const ts = evaluateAchievements(ACHIEVEMENTS, settlement, prior);
      expect(s.result.achievements, JSON.stringify(g)).toEqual(ts.completed);
      expect(s.result.achievementXp).toBe(ts.xp);
      const after = await progressOf(u);
      for (const [id, p] of Object.entries(ts.progress)) expect(after[id]?.progress, `${id} after ${JSON.stringify(g)}`).toBe(p);
      // nothing moved that the evaluator did not move
      for (const [id, row] of Object.entries(after)) if (!(id in ts.progress)) expect(row, id).toEqual(prior[id]);
    }
    const p = await progressOf(u);
    expect(p['s2.kobold.rubies_life_500']!.progress).toBe(20 + 30 + 61); // the no-timer Practice's 500 never counted
    // completed at 1,100 by the 4th game; a completed achievement never moves again (the 7th game's 100 is not added)
    expect(p['economy.spend_lifetime_1000']).toEqual({ progress: 1100, completed: true });
    expect(p['hero.indy.debut']!.progress).toBe(2);
    expect(await completionsOf(u)).toEqual(expect.arrayContaining(['s2.kobold.win_rubies_60', 's2.kobold.win_banner', 'ranked.comeback_win', 'career.comebacks.1']));
  });

  it('the Practice gate: Normal Health AND a turn timer (owner default 1); Unlimited Health or no timer never counts for `any`', async () => {
    const u = await newUser();
    const unlimited = await settle(u, { mode: 'practice', placement: 1, practice: { health: 'unlimited' }, metrics: { goldSpentTurnMax: 40 } });
    const noTimer = await settle(u, { mode: 'practice', placement: 1, practice: { timeMult: 0 }, metrics: { goldSpentTurnMax: 40 } });
    expect(unlimited.result.achievements).toEqual([]);
    expect(noTimer.result.achievements).toEqual([]);
    const ok = await settle(u, { mode: 'practice', placement: 1, practice: { timeMult: 2 }, metrics: { goldSpentTurnMax: 40 } });
    expect(ok.result.achievements).toEqual(expect.arrayContaining(['career.games.1', 'economy.spend_turn_20']));
    // Ranked-only never moves in Practice
    expect(ok.result.achievements.some((id) => ACHIEVEMENT_INDEX[id]!.mode === 'ranked')).toBe(false);
  });

  it('a client can never supply a server metric: its keys are overwritten by the server values', async () => {
    const u = await newUser();
    const forged: Record<string, number> = Object.fromEntries(SERVER_METRICS.map((k) => [k, 9999]));
    const s = await settle(u, { placement: 8, metrics: forged });
    expect(s.result.achievements.sort()).toEqual(['career.games.1', 'ranked.first_game'].sort());
  });

  it('rank achievements read the Career best, so the first game after the switch pays every rank already reached (owner default 2)', async () => {
    const u = await newUser({ highestDivision: 8 }); // Gold 3
    const s = await settle(u, { mode: 'practice', placement: 6 });
    const reach = s.result.achievements.filter((id) => id.startsWith('ranked.reach_'));
    expect(reach).toHaveLength(8);
    expect(reach).toContain('ranked.reach_gold_3');
    expect(reach).not.toContain('ranked.reach_platinum_1');
    // and the tutorial (an `account` settlement) moves them too
    await db.query('update public.profiles set rank_highest_division = 9 where user_id = $1', [u]);
    const t = await settle(u, { mode: 'tutorial' });
    expect(t.result.achievements).toEqual(expect.arrayContaining(['tutorial.complete_course', 'ranked.reach_platinum_1']));
  });

  it('server-known Ranked feats: promotions, demotion escape, a Brutal-lobby 1st, Ascendant 1sts, streaks', async () => {
    const u = await newUser();
    const s = await settle(u, { placement: 1, rank: { promoted: true, lobby_strength: 72, division_before: 15 } });
    expect(s.result.achievements).toEqual(expect.arrayContaining(['ranked.promotion_win', 'ranked.brutal_win']));
    const d = await settle(u, { placement: 4, rank: { was_demotion_game: true, demoted: false } });
    expect(d.result.achievements).toContain('ranked.demotion_escape');
    await settle(u, { placement: 1 });
    const third = await settle(u, { placement: 1 });
    expect(third.result.achievements).not.toContain('ranked.win_streak_3'); // 1, 4, 1, 1: the 4th broke it
    const fourth = await settle(u, { placement: 1 });
    expect(fourth.result.achievements).toContain('ranked.win_streak_3');
    expect((await progressOf(u))['ranked.ascendant_wins_10']!.progress).toBe(1);
  });

  it('distinct heroes and the meta family (Collector at 10 completions) are server-counted', async () => {
    const u = await newUser();
    const heroes = ['warden', 'indy', 'myra', 'soren', 'nadja'];
    let last: Awaited<ReturnType<typeof settle>> | null = null;
    for (const heroId of heroes) last = await settle(u, { placement: 1, heroId });
    expect(last!.result.achievements).toEqual(expect.arrayContaining(['career.heroes_played.5', 'career.hero_wins.5']));
    expect((await completionsOf(u)).length).toBeGreaterThanOrEqual(10);
    expect(await completionsOf(u)).toContain('career.achievements.10');
  });

  it('the emergency switch: an admin_off row is never evaluated, and survives a re-sync', async () => {
    await db.exec("update public.achievement_catalog set admin_off = true where achievement_id = 'economy.spend_turn_20'");
    try {
      await sync(achievementCatalogPayload(), 'test-hash-resync');
      const u = await newUser();
      const s = await settle(u, { placement: 5, metrics: { goldSpentTurnMax: 30 } });
      expect(s.result.achievements).not.toContain('economy.spend_turn_20');
      expect(await one("select admin_off from public.achievement_catalog where achievement_id = 'economy.spend_turn_20'")).toEqual({ admin_off: true });
    } finally {
      await db.exec("update public.achievement_catalog set admin_off = false where achievement_id = 'economy.spend_turn_20'");
      await sync();
    }
  });
});

describe('the catalog sync', () => {
  it('rows equal the code payload; unchanged is a no-op; a removed def is deactivated, never deleted; re-running the file forces a resync', async () => {
    expect((await sync()).status).toBe('unchanged');
    const r = await rows<Record<string, unknown>>('select achievement_id, mode, set_id, hero_id, placement_max, metric, agg, target, xp, title_id, hidden, trust, active from public.achievement_catalog order by achievement_id collate "C"');
    expect(r.map((x) => ({ ...x, target: Number(x.target) }))).toEqual(achievementCatalogPayload().items.map((i) => ({
      achievement_id: i.achievementId, mode: i.mode, set_id: i.setId, hero_id: i.heroId, placement_max: i.placementMax, metric: i.metric, agg: i.agg,
      target: i.target, xp: i.xp, title_id: i.titleId, hidden: i.hidden, trust: i.trust, active: i.active,
    })));
    const fewer = { ...achievementCatalogPayload(), items: achievementCatalogPayload().items.filter((i) => i.achievementId !== 'career.games.100') };
    expect(await sync(fewer, 'test-hash-fewer')).toMatchObject({ status: 'synced', itemsDeactivated: 1 });
    expect(await one("select active from public.achievement_catalog where achievement_id = 'career.games.100'")).toEqual({ active: false });
    await db.exec(ACH); // idempotent re-run: clears the hash so the next cold start syncs
    expect((await sync()).status).toBe('synced');
    expect(await one("select active from public.achievement_catalog where achievement_id = 'career.games.100'")).toEqual({ active: true });
    expect(await raises('select public.sync_achievement_catalog($1::jsonb, $2)', ['{"items": 3}', 'test-hash-bad'])).toContain('bad_catalog');
  });
});

describe('RLS: completions public, progress private, clients never write', () => {
  async function asClient<T>(role: 'anon' | 'authenticated', user: string, fn: () => Promise<T>): Promise<T> {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    await db.exec(`set role ${role}`);
    try { return await fn(); } finally { await db.exec('reset role'); }
  }

  it('anyone reads completions and the catalog; only the owner reads progress; no client writes or calls a writer', async () => {
    const owner = await newUser();
    const other = await newUser();
    await settle(owner, { placement: 1, metrics: { rubyPlays: 3 } });
    await asClient('anon', other, async () => {
      expect((await rows('select achievement_id from public.achievement_completions where user_id = $1', [owner])).length).toBeGreaterThan(0);
      expect((await rows('select achievement_id from public.achievement_catalog')).length).toBe(ACHIEVEMENTS.length);
      expect(await rows('select * from public.achievement_progress where user_id = $1', [owner])).toEqual([]);
    });
    await asClient('authenticated', other, async () => {
      expect(await rows('select * from public.achievement_progress where user_id = $1', [owner])).toEqual([]);
      expect(await raises("insert into public.achievement_completions (user_id, achievement_id, xp_awarded) values ($1, 'career.games.100', 100)", [other])).toMatch(/row-level security/);
      expect(await raises('select public.sync_achievement_catalog($1::jsonb, $2)', ['{"items":[]}', 'test-hash-client'])).toMatch(/permission denied/);
    });
    await asClient('authenticated', owner, async () => {
      expect((await rows('select * from public.achievement_progress where user_id = $1', [owner])).length).toBeGreaterThan(0);
      await db.query("update public.achievement_progress set progress = 999 where user_id = $1", [owner]); // silently filtered by RLS (no update policy)
    });
    expect(Number((await rows<{ progress: string }>("select progress from public.achievement_progress where user_id = $1 and achievement_id = 's2.kobold.rubies_life_500'", [owner]))[0]!.progress)).toBe(3);
  });
});
