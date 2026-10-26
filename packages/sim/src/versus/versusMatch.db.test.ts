/**
 * VERSUS end to end, two scripted clients (blueprint 12 Phase 0/1 "exercise two scripted clients against a local
 * coordinator"): the REAL migration in PGlite, the REAL finalize handler, two greedy runs that shop, upload
 * candidates, lock (or time out), land the one authoritative fight and acknowledge the barrier, until a player is
 * out of hearts. Then a reconnect: a client rebuilt from its last lock checkpoint plus the committed rounds lands
 * on exactly the run that never disconnected.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentRevision } from '@game/content';
import type { CombatResult } from '@game/core';
import { GREEDY_PILOT } from '../balance/pilots';
import { reduce } from '../reducer';
import { modalOpen } from '../recruit';
import { deserialize, serialize, type RunState } from '../state';
import { canonicalJson } from './canonical';
import { VERSUS_HEARTS, type VersusSeat } from './constants';
import { handleVersusFinalize, type VersusFinalizeStore } from './finalize';
import { buildVersusCandidate, catchUpVersusRun, createVersusRun, versusAutoResolve, versusHeroOffer, versusTimeoutRng } from './run';

const root = join(__dirname, '../../../..');
const MIGRATION = readFileSync(join(root, 'supabase/migrations/2026-10-13-versus.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-14-versus-shop-start.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-14-versus-scout.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-14-versus-ready-pause.sql'), 'utf8')
  // The 2026-10-24 group + options migration replaces the room RPCs: every 1v1 test here runs against it (R-VERSUS-GROUP-01).
  + readFileSync(join(root, 'supabase/migrations/2026-10-24-versus-group.sql'), 'utf8') + readFileSync(join(root, 'supabase/migrations/2026-10-26-versus-lock-order.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-27-versus-egress.sql'), 'utf8');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;
const USER: Record<VersusSeat, string> = { p1: '00000000-0000-0000-0000-0000000000a1', p2: '00000000-0000-0000-0000-0000000000b2' };

let db: PGlite;
let clock = Date.parse('2026-10-13T12:00:00Z');
async function as<T = any>(user: string | null, sql: string, params: unknown[] = []): Promise<T> {
  await db.exec(`set versus.test_now = '${new Date(clock).toISOString()}'`);
  await db.exec(user ? `select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;` : `select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
  try {
    const r = await db.query<Record<string, unknown>>(sql, params);
    const row = r.rows[0];
    return (row ? Object.values(row)[0] : undefined) as T;
  } finally {
    await db.exec('reset role');
  }
}
const store: VersusFinalizeStore = {
  async match(id) { return (await db.query<any>('select id, phase, round, seed, content_revision, p1_user, p2_user from public.versus_matches where id = $1', [id])).rows[0] ?? null; },
  async finalSides(matchId, round) {
    const out: Record<VersusSeat, unknown> = { p1: null, p2: null };
    for (const r of (await db.query<any>('select seat, prepared_side, final from public.versus_submissions where match_id = $1 and round = $2', [matchId, round])).rows) if (r.final) out[r.seat as VersusSeat] = r.prepared_side;
    return out;
  },
  async commit(a) {
    return as(null, 'select public.versus_commit_round($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)', [a.p_match, a.p_round, a.p_chair, a.p_outcome, a.p_heart_lost_by, JSON.stringify(a.p_p1), JSON.stringify(a.p_p2), a.p_digest]);
  },
  log: () => undefined,
};
const matchRow = async (id: string): Promise<any> => (await db.query<{ m: any }>('select to_jsonb(m) m from public.versus_matches m where id = $1', [id])).rows[0]!.m;
const beat = async (room: string): Promise<void> => { for (const s of ['p1', 'p2'] as const) await as(USER[s], 'select public.versus_heartbeat($1)', [room]); };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MIGRATION);
}, 60_000);
afterAll(async () => { await db?.close(); });

/** One client's shop turn: greedy play, decisions answered by the timeout policy. */
function shop(run: RunState, round: number): RunState {
  let s = run;
  for (let step = 0; step < 60; step++) {
    if (modalOpen(s)) { s = versusAutoResolve(s, versusTimeoutRng(round * 31, round, 'p1')); continue; }
    const a = GREEDY_PILOT.decide(s, { seatId: 'x', round, scoutedOpponent: null });
    if (!a) break;
    const next = reduce(s, a);
    if (next === s) break;
    s = next;
  }
  return s;
}

describe('Versus: two scripted clients, one match', () => {
  it('plays to seven hearts with one fight per round, landed identically on both clients; a reconnect converges', async () => {
    const room = await as<any>(USER.p1, `select public.versus_create_room('E2E', 'Ann', '{}', 'set2', $1, 1)`, [contentRevision()]);
    await as(USER.p2, `select public.versus_join_room($1, 'player', 'Bob', '{}', $2, 1)`, [room.id, contentRevision()]);
    await as(USER.p1, 'select public.versus_start_game($1)', [room.id]);
    await as(USER.p1, 'select public.versus_press_gate($1)', [room.id]);
    const r2 = await as<any>(USER.p2, 'select public.versus_press_gate($1)', [room.id]);
    const matchId: string = r2.current_match_id;

    // Hero Select: each client reads ITS private row (hidden offer), registers it, p1 picks, p2 times out.
    const runs: Partial<Record<VersusSeat, RunState>> = {};
    const priv: Record<VersusSeat, any> = { p1: null, p2: null };
    for (const s of ['p1', 'p2'] as const) {
      priv[s] = (await db.query<any>('select * from public.versus_seat_private where match_id = $1 and seat = $2', [matchId, s])).rows[0];
      const offer = versusHeroOffer(Number(priv[s].hero_seed), Number(priv[s].run_seed), 'set2');
      await as(USER[s], 'select public.versus_register_offer($1, $2)', [matchId, offer]);
      priv[s].offer = offer;
    }
    await as(USER.p1, 'select public.versus_pick_hero($1, 1)', [matchId]);
    clock += 21_000;
    await beat(room.id);
    await as(USER.p1, 'select public.versus_reconcile($1)', [matchId]);
    let m = await matchRow(matchId);
    expect([m.phase, m.round, m.p1_hero]).toEqual(['shop', 1, priv.p1.offer[1]]);
    expect(priv.p2.offer).toContain(m.p2_hero);
    runs.p1 = createVersusRun(Number(priv.p1.run_seed), m.p1_hero, 'set2');
    runs.p2 = createVersusRun(Number(priv.p2.run_seed), m.p2_hero, 'set2');

    const results: Record<VersusSeat, Map<number, CombatResult>> = { p1: new Map(), p2: new Map() };
    const checkpoints: Partial<Record<number, string>> = {};
    let rounds = 0;
    for (let round = 1; round < 40; round++) {
      m = await matchRow(matchId);
      if (m.phase === 'complete') break;
      expect([m.phase, m.round]).toEqual(['shop', round]);
      clock += 3_000; // the synchronized start
      for (const s of ['p1', 'p2'] as const) {
        runs[s] = shop(runs[s]!, round);
        // An idle candidate (clone only), then the lock: p2 lets every third round time out.
        const cand = buildVersusCandidate(runs[s]!, versusTimeoutRng(Number(m.seed), round, s));
        await as(USER[s], 'select public.versus_submit($1, $2, 1, $3::jsonb, false, null)', [matchId, round, JSON.stringify(cand)]);
        if (s === 'p2' && round % 3 === 0) continue;
        const answered = versusAutoResolve(structuredClone(runs[s]!), versusTimeoutRng(Number(m.seed), round, s));
        const side = reduce(answered, { type: 'faceOmen', deferFight: true }).pendingCombatSide;
        const ck = serialize(answered);
        if (s === 'p2') checkpoints[round] = ck;
        await as(USER[s], 'select public.versus_submit($1, $2, 2, $3::jsonb, true, $4::jsonb)', [matchId, round, JSON.stringify(side), JSON.stringify(ck)]);
      }
      if ((await matchRow(matchId)).phase === 'shop') {
        clock += 120_000; // past any turn length: the deadline promotes p2's newest candidate
        await beat(room.id);
        await as(USER.p1, 'select public.versus_reconcile($1)', [matchId]);
      }
      expect((await matchRow(matchId)).phase).toBe('resolving');
      // Both clients ask the resolver at once; exactly one round row results.
      await Promise.all([
        handleVersusFinalize(USER.p1, { matchId, round }, contentRevision(), store),
        handleVersusFinalize(USER.p2, { matchId, round }, contentRevision(), store),
      ]);
      const row = (await db.query<any>('select * from public.versus_rounds where match_id = $1 and round = $2', [matchId, round])).rows[0];
      // Each client: the timeout answers (as the lock did), End Turn, land, settle, return.
      for (const s of ['p1', 'p2'] as const) {
        const fight = (s === 'p1' ? row.p1_result : row.p2_result) as CombatResult;
        results[s].set(round, fight);
        let r = versusAutoResolve(runs[s]!, versusTimeoutRng(Number(m.seed), round, s));
        r = reduce(r, { type: 'faceOmen', deferFight: true });
        r = reduce(r, { type: 'landCombat', fight: { result: fight, damageTaken: 0 } });
        r = reduce(r, { type: 'settleCombat' });
        r = reduce(r, { type: 'resolveCombat' });
        // Hearts, never Resolve: the fight moved neither Resolve nor Armor (whatever the result).
        const before = versusAutoResolve(runs[s]!, versusTimeoutRng(Number(m.seed), round, s));
        expect([r.resolve, r.armor]).toEqual([reduce(before, { type: 'faceOmen', deferFight: true }).resolve, reduce(before, { type: 'faceOmen', deferFight: true }).armor]);
        runs[s] = r;
      }
      rounds = round;
      m = await matchRow(matchId);
      if (m.phase === 'complete') break;
      await beat(room.id);
      await as(USER.p1, 'select public.versus_combat_ready($1, $2)', [matchId, round]);
      await as(USER.p2, 'select public.versus_combat_ready($1, $2)', [matchId, round]);
    }

    // The score is exactly the committed rounds' outcomes; the match ended on the 7th lost heart, no shop after.
    m = await matchRow(matchId);
    const rows = (await db.query<any>('select outcome, heart_lost_by from public.versus_rounds where match_id = $1 order by round', [matchId])).rows;
    expect(rows).toHaveLength(rounds);
    const lost = { p1: rows.filter((r) => r.heart_lost_by === 'p1').length, p2: rows.filter((r) => r.heart_lost_by === 'p2').length };
    expect([m.p1_hearts, m.p2_hearts]).toEqual([VERSUS_HEARTS - lost.p1, VERSUS_HEARTS - lost.p2]);
    expect(m.phase).toBe('complete');
    expect(Math.max(lost.p1, lost.p2)).toBe(VERSUS_HEARTS);
    expect(m.winner_seat).toBe(lost.p1 === VERSUS_HEARTS ? 'p2' : 'p1');
    expect(m.round).toBe(rounds);
    // Each client's history agrees with the canonical outcomes.
    const hist = (s: VersusSeat): string[] => rows.map((r) => (r.outcome === 'draw' ? 'draw' : r.outcome === s ? 'win' : 'lose'));
    expect(runs.p1!.history).toEqual(hist('p1'));
    expect(runs.p2!.history).toEqual(hist('p2'));

    // RECONNECT: p2 lost its tab after locking round 2; rebuild from that checkpoint + the committed rounds.
    const ck = checkpoints[2]!;
    const restored = catchUpVersusRun(deserialize(JSON.parse(JSON.stringify(ck)) as string), results.p2, Number(m.seed), 'p2');
    // It reaches the final round's shop like the live client, with the same history; rounds where p2 timed out
    // were answered by the same policy, so the boards agree too.
    expect(restored.history).toEqual(runs.p2!.history);
    expect(restored.wave).toBe(runs.p2!.wave);
  }, 180_000);

  it('the timeout answer on a clone equals the answer on the live run (the lock and the land agree)', () => {
    let run = createVersusRun(77, 'indy', 'set3');
    run = shop(run, 1);
    run = { ...run, discover: run.shop.slice(0, 3).map((o) => o.cardId) };
    const rng = () => versusTimeoutRng(5, 1, 'p1');
    const fromClone = reduce(versusAutoResolve(structuredClone(run), rng()), { type: 'faceOmen', deferFight: true }).pendingCombatSide;
    const fromLive = reduce(versusAutoResolve(run, rng()), { type: 'faceOmen', deferFight: true }).pendingCombatSide;
    expect(canonicalJson(fromLive)).toBe(canonicalJson(fromClone));
  });
});
