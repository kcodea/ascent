/**
 * THE VERSUS TEST BOT, driven to a finish against the real SQL (PGlite) and the real finalize handler.
 *
 * Two `VersusBotDriver`s share a room through an API backed by the migration (no shortcuts): the "test bot" plays
 * random minions; the scripted opponent never buys anything, so it loses round after round. The bot must press its
 * gate gem, pick a hero, shop, lock, finalize, acknowledge every fight and reach the 7-heart finish, with its own run
 * history agreeing with the server's rounds. Then: a "disconnected" bot pauses the match.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentRevision } from '@game/content';
import { handleVersusFinalize, type VersusFinalizeStore } from '@game/sim/versus/server';
import { VERSUS_HEARTS } from '@game/sim';
import { VersusBotDriver, type VersusBotApi } from './versusBotDriver';
import type { VersusRoom } from './versusRemote';

const root = join(__dirname, '../../../..');
const MIGRATION = readFileSync(join(root, 'supabase/migrations/2026-10-13-versus.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-14-versus-shop-start.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-14-versus-scout.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-14-versus-ready-pause.sql'), 'utf8');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;
const BOT = '00000000-0000-0000-0000-0000000000b0';
const DUMMY = '00000000-0000-0000-0000-0000000000d0';

let db: PGlite;
let clock = Date.parse('2026-10-14T12:00:00Z');
let queue: Promise<unknown> = Promise.resolve();

/** One statement as `user` at the test clock (serialized: PGlite is one connection). */
function as<T = any>(user: string | null, sql: string, params: unknown[] = []): Promise<T> {
  const run = async (): Promise<T> => {
    await db.exec(`set versus.test_now = '${new Date(clock).toISOString()}'`);
    await db.exec(user ? `select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;` : `select set_config('request.jwt.claim.sub', '', false); set role service_role;`);
    try {
      const r = await db.query<Record<string, unknown>>(sql, params);
      const row = r.rows[0];
      return (row ? Object.values(row)[0] : undefined) as T;
    } finally {
      await db.exec('reset role');
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}
const rows = async <T,>(sql: string, params: unknown[] = []): Promise<T[]> => { await queue; return (await db.query<T>(sql, params)).rows; };

const store: VersusFinalizeStore = {
  async match(id) { return (await rows<any>('select id, phase, round, seed, content_revision, p1_user, p2_user from public.versus_matches where id = $1', [id]))[0] ?? null; },
  async finalSides(matchId, round) {
    const out: Record<'p1' | 'p2', unknown> = { p1: null, p2: null };
    for (const r of await rows<any>('select seat, prepared_side, final from public.versus_submissions where match_id = $1 and round = $2', [matchId, round])) if (r.final) out[r.seat as 'p1' | 'p2'] = r.prepared_side;
    return out;
  },
  async commit(a) {
    return as(null, 'select public.versus_commit_round($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)', [a.p_match, a.p_round, a.p_chair, a.p_outcome, a.p_heart_lost_by, JSON.stringify(a.p_p1), JSON.stringify(a.p_p2), a.p_digest]);
  },
  log: () => undefined,
};

/** The bot API over PGlite: the same RPCs and reads the browser adapter makes. */
function apiFor(user: string): VersusBotApi {
  return {
    async room(roomId) {
      const r = (await rows<any>('select * from public.versus_rooms where id = $1', [roomId]))[0];
      if (!r) return null;
      const members = await rows<any>('select user_id, role, display_name, profile, last_seen_at from public.versus_members where room_id = $1 order by joined_at', [roomId]);
      return { ...r, members: members.map((m) => ({ userId: m.user_id, role: m.role, displayName: m.display_name, profile: m.profile, lastSeenAt: m.last_seen_at })), serverNow: '' } as VersusRoom;
    },
    pressGate: (roomId) => as(user, 'select public.versus_press_gate($1)', [roomId]),
    heartbeat: (roomId) => as(user, 'select public.versus_heartbeat($1)', [roomId]),
    async match(id) { return (await rows<any>('select to_jsonb(m) m from public.versus_matches m where id = $1', [id]))[0]?.m ?? null; },
    async myPrivate(id) { return (await rows<any>('select * from public.versus_seat_private where match_id = $1 and user_id = $2', [id, user]))[0] ?? null; },
    registerOffer: (id, offer) => as(user, 'select public.versus_register_offer($1, $2)', [id, offer]),
    pickHero: (id, i) => as(user, 'select public.versus_pick_hero($1, $2)', [id, i]),
    submit: (id, round, seq, side, final, ck, scout) => as(user, 'select public.versus_submit($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7::jsonb)', [id, round, seq, JSON.stringify(side), final, ck == null ? null : JSON.stringify(ck), scout == null ? null : JSON.stringify(scout)]),
    combatReady: (id, round) => as(user, 'select public.versus_combat_ready($1, $2)', [id, round]),
    introDone: (id) => as(user, 'select public.versus_intro_done($1)', [id]),
    requestResume: (id) => as(user, 'select public.versus_request_resume($1)', [id]),
    async rounds(id, from = 1) { return rows<any>('select * from public.versus_rounds where match_id = $1 and round >= $2 order by round', [id, from]); },
    reconcile: (id) => as(user, 'select public.versus_reconcile($1)', [id]),
    async finalize(id, round) { await handleVersusFinalize(user, { matchId: id, round }, contentRevision(), store); },
  };
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MIGRATION);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('the Versus test bot', () => {
  it('joins, gates, picks, shops random minions, locks, acks every fight and reaches the 7-heart finish', async () => {
    const room = await as<any>(DUMMY, `select public.versus_create_room('Bot test', 'Dummy', '{}', 'set2', $1, 1)`, [contentRevision()]);
    await as(BOT, `select public.versus_join_room($1, 'player', 'Test Bot', '{}', $2, 1)`, [room.id, contentRevision()]);
    const now = () => clock;
    const bot = new VersusBotDriver(apiFor(BOT), room.id, { userId: BOT, now, seed: 7, beatMs: 3000 });
    // The scripted opponent: the same driver, but it never takes a shop action (an empty board every round).
    const dummy = new VersusBotDriver(apiFor(DUMMY), room.id, { userId: DUMMY, now, seed: 9, maxActions: 0, beatMs: 3000 });
    await as(DUMMY, 'select public.versus_start_game($1)', [room.id]);
    let steps = 0;
    while (steps < 6000) {
      steps++;
      await bot.step();
      await dummy.step();
      clock += 500;
      const m = (await rows<any>('select phase from public.versus_matches'))[0];
      if (m?.phase === 'complete' && bot.finished.length) break;
    }
    const m = (await rows<any>('select * from public.versus_matches'))[0];
    expect(m.phase).toBe('complete');
    const botSeat = m.p1_user === BOT ? 'p1' : 'p2';
    const hearts = { p1: m.p1_hearts, p2: m.p2_hearts };
    expect(Math.min(hearts.p1, hearts.p2)).toBe(0);
    expect(m.winner_seat).toBe(botSeat); // random minions beat an empty board
    expect(hearts[botSeat as 'p1' | 'p2']).toBe(VERSUS_HEARTS);
    const committed = await rows<any>('select outcome from public.versus_rounds order by round');
    expect(committed.length).toBeGreaterThanOrEqual(VERSUS_HEARTS);
    // The bot's own run agrees with the server: it won every round it fought.
    // Round by round, every fight the bot landed matches the server's outcome from its own side.
    expect(bot.run!.history.length).toBeGreaterThanOrEqual(committed.length - 1);
    bot.run!.history.forEach((h, i) => expect(h, `round ${i + 1}`).toBe(committed[i].outcome === 'draw' ? 'draw' : committed[i].outcome === botSeat ? 'win' : 'lose'));
    expect(bot.run!.board.length).toBeGreaterThan(0);
  }, 180_000);

  it('a "disconnected" bot stops heartbeating, so the match pauses on its seat', async () => {
    await db.exec('delete from public.versus_matches; delete from public.versus_rooms;');
    const room = await as<any>(DUMMY, `select public.versus_create_room('Pause test', 'Dummy', '{}', 'set2', $1, 1)`, [contentRevision()]);
    await as(BOT, `select public.versus_join_room($1, 'player', 'Test Bot', '{}', $2, 1)`, [room.id, contentRevision()]);
    const now = () => clock;
    const bot = new VersusBotDriver(apiFor(BOT), room.id, { userId: BOT, now, seed: 3, beatMs: 3000 });
    const dummy = new VersusBotDriver(apiFor(DUMMY), room.id, { userId: DUMMY, now, seed: 4, maxActions: 0, beatMs: 3000 });
    await as(DUMMY, 'select public.versus_start_game($1)', [room.id]);
    for (let i = 0; i < 400; i++) {
      await bot.step(); await dummy.step(); clock += 500;
      const m = (await rows<any>('select phase, round from public.versus_matches'))[0];
      if (m?.phase === 'shop' && m.round >= 2) break;
    }
    bot.disconnected = true;
    let paused: string | null = null;
    for (let i = 0; i < 80 && !paused; i++) {
      await dummy.step(); clock += 500;
      paused = (await rows<any>('select paused_seat from public.versus_matches'))[0]?.paused_seat ?? null;
    }
    const m = (await rows<any>('select * from public.versus_matches'))[0];
    expect(paused).toBe(m.p1_user === BOT ? 'p1' : 'p2');
    // Back: the next heartbeat resumes it.
    bot.disconnected = false;
    for (let i = 0; i < 20; i++) { await bot.step(); clock += 500; }
    expect((await rows<any>('select paused_seat from public.versus_matches'))[0]?.paused_seat).toBeNull();
  }, 120_000);
});
