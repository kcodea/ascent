import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { achievementCatalogHash, achievementCatalogPayload, evaluateAchievements, ACHIEVEMENTS } from './achievements';
import { parseProgressionResult, versusRunId, XP_RULES } from './rules';
import { validateSubmitBody } from './server';

/**
 * VERSUS PROGRESSION (the 2026-10-14 writer; its numbers were replaced 2026-10-24, see versusSpectatorXp.db.test.ts), EXECUTED (owner 2026-10-14: "versus can complete achievements and grant XP but no rank
 * progress"). PGlite runs the progression migrations in order, then the Versus migration and the Versus progression
 * migration, and settles real `versus_matches` rows as the Edge Function would: XP 100 (+60 for the winner), the
 * `any` achievements with the server-recorded hero, NO placement-gated (Top 4 / 1st) or Ranked achievement, NO rank
 * row and no rating change, one settlement per player per match, and refusals for a non-player, an unfinished
 * match and a match with no round.
 */
const root = join(__dirname, '../../..');
const read = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = ['2026-09-27-account-progression.sql', '2026-09-28-progression-crates.sql', '2026-09-28-progression-skins.sql', '2026-09-28-achievements.sql', '2026-10-03-placement-xp.sql', '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql', '2026-10-14-versus-progression.sql'];
const ACH = read('2026-09-28-achievements.sql');
const SWITCH = /^-- (update public\.progression_config set achievements_epoch = now\(\).*;)$/m.exec(ACH)![1]!;

const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.profiles (user_id uuid primary key references auth.users(id), rating int not null default 0,
    rank_highest_division int not null default 0, updated_at timestamptz not null default now());
  alter table public.profiles enable row level security;
  create table public.rank_results (user_id uuid, run_id text, placement int, seed bigint, created_at timestamptz default now(),
    promoted boolean not null default false, division_before int not null default 0, was_demotion_game boolean not null default false,
    demoted boolean not null default false, lobby_strength int, primary key (user_id, run_id));
  create table public.run_history (user_id uuid, mode text, entry jsonb, wins int, created_at timestamptz default now());
  create table public.practice_games (id bigserial primary key, user_id uuid, hero_id text, placement int, config jsonb, record jsonb, created_at timestamptz default now());
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
`;

let db: PGlite;
let seq = 0;
const P1 = '00000000-0000-0000-0000-0000000000a1';
const P2 = '00000000-0000-0000-0000-0000000000b2';
const OUTSIDER = '00000000-0000-0000-0000-0000000000c3';

async function match(opts: { winner: 'p1' | 'p2' | null; phase?: string; rounds?: number }): Promise<string> {
  seq++;
  const id = `11111111-0000-0000-0000-${String(seq).padStart(12, '0')}`;
  await db.query(
    `insert into public.versus_matches (id, seed, set_id, content_revision, protocol, phase, round, p1_user, p2_user, p1_name, p2_name, p1_hero, p2_hero, winner_seat, end_reason, completed_at)
     values ($1, 1, 'set3', 'x', 1, $2, $3, $4, $5, 'A', 'B', 'warden', 'indy', $6, $7, case when $2 = 'complete' then now() end)`,
    [id, opts.phase ?? 'complete', opts.rounds ?? 7, P1, P2, opts.winner, opts.winner ? 'hearts' : 'abandoned'],
  );
  for (let r = 1; r <= (opts.rounds ?? 7); r++) {
    await db.query(`insert into public.versus_rounds (match_id, round, chair, outcome, heart_lost_by, p1_result, p2_result, digest, p1_hearts, p2_hearts)
      values ($1, $2, 'p1', 'p1', 'p2', '{}', '{}', 'd', 7, 7)`, [id, r]);
  }
  return id;
}

async function settle(user: string, matchId: string, metrics: Record<string, number> = {}): Promise<{ status: string; result: ReturnType<typeof parseProgressionResult> }> {
  const runId = versusRunId(matchId);
  const facts = { version: 2, runId, mode: 'versus', setId: 'set3', patch: 'p', heroId: 'warden', placement: null, waveReached: 7, terminal: true, comebackAfterFourLosses: false, combats: { wins: 7, losses: 0, draws: 0 }, metrics };
  const r = await db.query<{ j: { status: string; result: unknown } }>('select public.settle_progression($1, $2, $3, null, false, 1, $4::jsonb) as j', [user, 'versus', runId, JSON.stringify(facts)]);
  return { status: r.rows[0]!.j.status, result: parseProgressionResult(r.rows[0]!.j.result) };
}
async function raises(user: string, runId: string): Promise<string> {
  try { await db.query('select public.settle_progression($1, $2, $3, null, false, 1, null)', [user, 'versus', runId]); } catch (e) { return (e as Error).message; }
  return 'no error';
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const u of [P1, P2, OUTSIDER]) {
    await db.query('insert into auth.users (id) values ($1)', [u]);
    await db.query('insert into public.profiles (user_id, rating) values ($1, 1234)', [u]);
  }
  for (const f of FILES) await db.exec(read(f));
  await db.exec(`update public.progression_config set epoch = now() - interval '2 days' where id = 1;`);
  const payload = achievementCatalogPayload();
  await db.query('select public.sync_achievement_catalog($1::jsonb, $2)', [JSON.stringify(payload), achievementCatalogHash(payload)]);
  await db.exec(SWITCH.replace('now()', "now() - interval '1 day'"));
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('Versus progression: XP and achievements, never rank', () => {
  it('the winner earns 100 + 60, the loser 100; the ledger says versus; no rank row, rating untouched', async () => {
    // THIS file's (2026-10-14) Versus XP. Since 2026-10-24 Versus pays half the lobby equivalent instead (125 / 50 for a
    // 1v1), proven against the newer writer in versusSpectatorXp.db.test.ts, so the TS rules no longer match these rows.
    const m = await match({ winner: 'p1' });
    const w = await settle(P1, m);
    const l = await settle(P2, m);
    expect(w.status).toBe('ok');
    expect(w.result!.xp).toEqual({ base: XP_RULES.complete, topFour: 0, firstPlace: 60, comeback: 0, total: XP_RULES.complete + 60 });
    expect(l.result!.xp.total).toBe(XP_RULES.complete);
    expect([w.result!.placement, l.result!.placement]).toEqual([1, 2]);
    const ranks = await db.query('select * from public.rank_results');
    expect(ranks.rows).toHaveLength(0);
    const prof = await db.query<{ rating: number }>('select rating from public.profiles where user_id = $1', [P1]);
    expect(prof.rows[0]!.rating).toBe(1234);
    const mode = await db.query<{ mode: string }>('select distinct mode from public.progression_results');
    expect(mode.rows.map((r) => r.mode)).toEqual(['versus']);
  });

  it('a second settlement for the same match is deduped (no double XP)', async () => {
    const m = await match({ winner: 'p2' });
    await settle(P2, m);
    const again = await settle(P2, m);
    expect(again.status).toBe('deduped');
  });

  it('a draw-less abandoned match pays the completion only; refusals: outsider, unfinished, no round, bad id', async () => {
    const m = await match({ winner: null });
    expect((await settle(P1, m)).result!.xp.total).toBe(XP_RULES.complete);
    expect(await raises(OUTSIDER, versusRunId(await match({ winner: 'p1' })))).toMatch(/source_not_found/);
    expect(await raises(P1, versusRunId(await match({ winner: null, phase: 'shop' })))).toMatch(/not_terminal/);
    expect(await raises(P1, versusRunId(await match({ winner: 'p1', rounds: 0 })))).toMatch(/not_terminal/);
    expect(await raises(P1, 'versus:not-a-uuid')).toMatch(/bad_run_id/);
  });

  it('achievements: `any` ones count with the server hero; Top 4 / 1st and Ranked-only ones never do (SQL = TS evaluator)', async () => {
    const m = await match({ winner: 'p1' });
    const prior = await db.query<{ achievement_id: string; progress: string; completed: boolean }>(
      'select achievement_id, progress, completed_at is not null as completed from public.achievement_progress where user_id = $1', [P1]);
    const priorMap = Object.fromEntries(prior.rows.map((r) => [r.achievement_id, { progress: Number(r.progress), completed: r.completed }]));
    const out = await settle(P1, m, {});
    const ids = out.result!.achievements;
    for (const id of ids) {
      const def = ACHIEVEMENTS.find((d) => d.id === id)!;
      expect(def.mode, id).not.toBe('ranked');
      expect(def.placementMax, id).toBeNull();
    }
    // The TS mirror, fed what the SQL uses for Versus: the `any` gate open, the server hero, NO placement.
    const heroes = await db.query<{ n: number }>('select count(*)::int as n from public.achievement_hero_stats where user_id = $1 and games > 0', [P1]);
    const ts = evaluateAchievements(ACHIEVEMENTS, { mode: 'versus', eligibleRun: true, setId: 'set3', heroId: 'warden', placement: null,
      metrics: { game: 1, comeback: 0, highestDivision: 0, promoted: 0, ascendantFirst: 0, demotionEscape: 0, brutalFirst: 0, firstStreak: 0, topFourStreak: 0, heroesPlayed: heroes.rows[0]!.n, heroesWon: 0 } }, priorMap);
    expect(ids).toEqual(ts.completed);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('the Edge Function accepts `versus:<uuid>` and nothing else for Versus', () => {
    const ok = validateSubmitBody({ mode: 'versus', runId: versusRunId('11111111-0000-0000-0000-000000000001'), rulesVersion: 1 });
    expect(ok.ok).toBe(true);
    expect(validateSubmitBody({ mode: 'versus', runId: 'versus:abc', rulesVersion: 1 })).toMatchObject({ ok: false, error: 'bad_run_id' });
  });
});
