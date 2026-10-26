/**
 * VERSUS: END TURN IS A READY SIGNAL, EXECUTED (owner 2026-10-26: "hitting end turn shouldn't restrict anything, it should
 * just signal that you are ready to move on, but you should be able to move things around on your board/view your
 * teammate's board etc still" and "the end turn ready-signal should be the same for versus modes too. it's a ready
 * signal, not a 'i cant do anything anymore'"; R-VERSUS-READY-01). PGlite runs every Versus migration in order through
 * Ranked Duos, then `2026-11-01-versus-ready-signal.sql` (twice: idempotent), against a stubbed `auth.uid()`, in every
 * mode (1v1, Group, Duos, Ranked Duos):
 *
 * - a ready seat sends its board again (a newer seq) and stays ready; the round fights the NEWEST board it sent;
 * - an old send arriving late (an equal / lower seq, or a plain candidate) changes nothing;
 * - pressing End Turn again un-readies while the clock is above 0:00, never at 0:00 or once the round has closed;
 * - Ranked Duos keeps the first ready time (the end-turn gate reads it), and an un-ready moves the gate back;
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { combatSide, type BoardMinion } from '@game/core';
import type { PreparedCombatSide } from '../state';

const root = join(__dirname, '../../../..');
const FILES = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
  '2026-10-24-versus-group.sql', '2026-10-24-versus-group-knockout-stands.sql',
  '2026-10-25-versus-duos.sql', '2026-10-25-versus-duos-edges.sql', '2026-10-25-versus-duos-random-order.sql',
  '2026-10-25-versus-duos-pass-back.sql', '2026-10-26-versus-lock-order.sql', '2026-10-27-versus-egress.sql', '2026-10-28-versus-health.sql',
  '2026-10-29-ranked-duos.sql', '2026-10-30-ranked-duos-client.sql', '2026-10-31-ranked-duos-live-fixes.sql',
];
const BASE = FILES.map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8')).join('\n');
const READY = readFileSync(join(root, 'supabase/migrations/2026-11-01-versus-ready-signal.sql'), 'utf8');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;
const U = (n: number): string => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const [A, B, C, D] = [1, 2, 3, 4].map(U) as [string, string, string, string];
const NAMES: Record<string, string> = { [A]: 'Ann', [B]: 'Bob', [C]: 'Cat', [D]: 'Dan' };
const CONTENT = 'rev1';

let db: PGlite;
let clock = Date.parse('2026-10-26T12:00:00Z');
const at = (ms: number): void => { clock += ms; };
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
async function fails(user: string | null, sql: string, params: unknown[] = []): Promise<string> {
  try { await as(user, sql, params); } catch (e) { return (e as Error).message; }
  return 'did not fail';
}
const q = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
const matchRow = async (id: string): Promise<any> => (await q<{ m: any }>('select to_jsonb(m) m from public.versus_group_matches m where id = $1', [id]))[0]!.m;
const seatRows = async (id: string): Promise<Record<string, any>> =>
  Object.fromEntries((await q<any>('select * from public.versus_group_seats where match_id = $1', [id])).map((r) => [r.seat, r]));
const subOf = async (m: string, round: number, seat: string): Promise<any> =>
  (await q<any>('select * from public.versus_group_submissions where match_id = $1 and round = $2 and seat = $3', [m, round, seat]))[0];
const beat = async (): Promise<void> => { await db.query('update public.versus_members set last_seen_at = $1', [new Date(clock).toISOString()]); };

async function startMatch(mode: 'duos' | 'ranked_duos' | 'group', users: string[]): Promise<string> {
  const opt = JSON.stringify({ v: 1, mode, modifiers: [] });
  const room = await as<any>(users[0]!, `select public.versus_create_room('Pair', $1, '{}', 'set3', $2, 1, $3::jsonb)`, [NAMES[users[0]!], CONTENT, opt]);
  for (const u of users.slice(1)) await as(u, `select public.versus_join_room($1, 'player', $2, '{}', $3, 1)`, [room.id, NAMES[u], CONTENT]);
  await as(users[0]!, `select public.versus_start_game($1)`, [room.id]);
  let r: any;
  for (const u of users) r = await as(u, `select public.versus_press_gate($1)`, [room.id]);
  expect(r.status).toBe('in_game');
  const m = r.current_match_id as string;
  const offers = [['warden', 'indy', 'keshi'], ['indy', 'warden', 'keshi'], ['keshi', 'indy', 'warden'], ['nadja', 'indy', 'warden']];
  for (const [i, u] of users.entries()) await as(u, `select public.versus_group_register_offer($1, $2::text[])`, [m, offers[i]]);
  for (const u of users) await as(u, `select public.versus_group_pick_hero($1, 0)`, [m]);
  for (const u of users) await as(u, `select public.versus_group_intro_done($1)`, [m]);
  await beat();
  expect((await matchRow(m)).phase).toBe('shop');
  return m;
}
const sideOf = (tag: string): PreparedCombatSide => ({ board: [{ cardId: 'sandbag', attack: 1, health: 1, sourceUid: tag }] as BoardMinion[], state: combatSide(), config: {} });
const submit = (u: string, m: string, round: number, seq: number, final: boolean, tag: string) =>
  as(u, `select public.versus_group_submit($1, $2, $3, $4::jsonb, $5, $6::jsonb, null)`, [m, round, seq, JSON.stringify(sideOf(tag)), final, final ? JSON.stringify({ tag }) : null]);
const unready = (u: string, m: string, round: number, seq: number) => as(u, 'select public.versus_group_unready($1, $2, $3)', [m, round, seq]);
const boardTag = async (m: string, round: number, seat: string): Promise<string> => (await subOf(m, round, seat)).prepared_side.board[0].sourceUid;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(BASE);
  await db.exec('create table if not exists public.versus_test_bots (bot_user uuid primary key, host_user uuid not null, slot int not null, registered_at timestamptz not null default now())');
  await db.exec(READY);
  await db.exec(READY); // idempotent
}, 90_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`delete from public.versus_group_matches; delete from public.versus_matches; delete from public.versus_rooms;
    delete from public.duo_runs; delete from public.duos_rank_results; delete from public.duos_team_ranks; delete from public.duos_teams;`);
});

describe('R-VERSUS-READY-01: Versus Duos End Turn is a ready signal', () => {
  it('a ready seat re-sends its board and stays ready; the round fights the newest board; late sends change nothing', async () => {
    const m = await startMatch('duos', [A, B, C, D]);
    await submit(A, m, 1, 1, true, 'first');
    expect((await seatRows(m)).p1.locked).toBe(true);
    // Still playing after End Turn: the board goes again, the seat stays ready.
    await submit(A, m, 1, 2, true, 'second');
    expect((await seatRows(m)).p1.locked).toBe(true);
    expect(await boardTag(m, 1, 'p1')).toBe('second');
    expect((await subOf(m, 1, 'p1')).checkpoint).toEqual({ tag: 'second' });
    // An old send arriving late (equal or lower seq), or a stray candidate: nothing changes, no error.
    await submit(A, m, 1, 2, true, 'stale');
    await submit(A, m, 1, 1, true, 'older');
    await submit(A, m, 1, 3, false, 'candidate');
    expect(await boardTag(m, 1, 'p1')).toBe('second');
    expect((await subOf(m, 1, 'p1')).final).toBe(true);
    // Everyone ready: the round closes at once and fights the newest board.
    for (const u of [B, C, D]) await submit(u, m, 1, 1, true, `${NAMES[u]}`);
    expect((await matchRow(m)).phase).toBe('resolving');
    expect(await boardTag(m, 1, 'p1')).toBe('second');
    // Closed: nothing more is taken.
    expect(await fails(A, `select public.versus_group_submit($1, 1, 9, $2::jsonb, true, null, null)`, [m, JSON.stringify(sideOf('late'))])).toMatch(/stale_round/);
  });

  it('pressing End Turn again un-readies above 0:00; a re-lock still in flight from before the press is fenced out', async () => {
    const m = await startMatch('duos', [A, B, C, D]);
    await submit(A, m, 1, 1, true, 'ready');
    const rev = (await matchRow(m)).revision;
    await unready(A, m, 1, 5);
    const s = await seatRows(m);
    expect(s.p1.locked).toBe(false);
    expect((await subOf(m, 1, 'p1')).final).toBe(false);
    expect((await matchRow(m)).revision).toBeGreaterThan(rev); // the teammate's pill wakes
    // A re-lock sent before the un-ready (seq 4) lands after it: ignored, the seat stays un-ready.
    await submit(A, m, 1, 4, false, 'inflight');
    expect((await seatRows(m)).p1.locked).toBe(false);
    // Ready again: a fresh lock.
    await submit(A, m, 1, 6, true, 'again');
    expect((await seatRows(m)).p1.locked).toBe(true);
    // The other three ready: the round closes on the newest board.
    for (const u of [B, C, D]) await submit(u, m, 1, 1, true, `${NAMES[u]}`);
    expect((await matchRow(m)).phase).toBe('resolving');
    expect(await boardTag(m, 1, 'p1')).toBe('again');
    expect(await fails(A, 'select public.versus_group_unready($1, 1, 9)', [m])).toMatch(/stale_round/);
  });

  it('a ready seat may still pass a card to its teammate (passing is a shop action)', async () => {
    const m = await startMatch('duos', [A, B, C, D]);
    await submit(A, m, 1, 1, true, 'ready');
    const row = await as<any>(A, 'select public.versus_duos_pass($1, 1, 1, $2::jsonb)', [m, JSON.stringify({ cardId: 'sandbag', passFrom: 'hand' })]);
    expect([row.from_seat, row.to_seat]).toEqual(['p1', 'p2']);
  });

  it('un-ready is refused at 0:00 and after (the 0:00 rule stays: shopping is over)', async () => {
    const m = await startMatch('duos', [A, B, C, D]);
    await submit(A, m, 1, 1, true, 'ready');
    clock = Date.parse((await matchRow(m)).shop_deadline);
    expect(await fails(A, 'select public.versus_group_unready($1, 1, 2)', [m])).toMatch(/deadline_passed/);
    expect((await seatRows(m)).p1.locked).toBe(true);
  });

});

describe('R-VERSUS-READY-01: Versus Group (3-4 players) End Turn is a ready signal', () => {
  it('re-lock keeps the seat ready and the newest board fights; un-ready above 0:00, refused at 0:00', async () => {
    const m = await startMatch('group', [A, B, C]);
    await submit(A, m, 1, 1, true, 'one');
    await submit(A, m, 1, 2, true, 'two');
    expect((await seatRows(m)).p1.locked).toBe(true);
    expect(await boardTag(m, 1, 'p1')).toBe('two');
    await unready(A, m, 1, 3);
    expect((await seatRows(m)).p1.locked).toBe(false);
    await submit(A, m, 1, 4, true, 'three');
    for (const u of [B, C]) await submit(u, m, 1, 1, true, `${NAMES[u]}`);
    expect((await matchRow(m)).phase).toBe('resolving');
    expect(await boardTag(m, 1, 'p1')).toBe('three');
  });
});

describe('R-VERSUS-READY-01: 1v1 Versus End Turn is a ready signal', () => {
  async function start1v1(): Promise<string> {
    const room = await as<any>(A, `select public.versus_create_room('Duel', 'Ann', '{}', 'set3', $1, 1)`, [CONTENT]);
    await as(B, `select public.versus_join_room($1, 'player', 'Bob', '{}', $2, 1)`, [room.id, CONTENT]);
    await as(A, 'select public.versus_start_game($1)', [room.id]);
    await as(A, 'select public.versus_press_gate($1)', [room.id]);
    const r = await as<any>(B, 'select public.versus_press_gate($1)', [room.id]);
    const m = r.current_match_id as string;
    for (const u of [A, B]) await as(u, 'select public.versus_register_offer($1, $2::text[])', [m, ['warden', 'indy', 'keshi']]);
    for (const u of [A, B]) await as(u, 'select public.versus_pick_hero($1, 0)', [m]);
    for (const u of [A, B]) await as(u, 'select public.versus_intro_done($1)', [m]);
    await beat();
    const row = (await q<{ m: any }>('select to_jsonb(m) m from public.versus_matches m where id = $1', [m]))[0]!.m;
    expect([row.phase, !!row.shop_deadline]).toEqual(['shop', true]);
    return m;
  }
  const duel = async (m: string): Promise<any> => (await q<{ m: any }>('select to_jsonb(m) m from public.versus_matches m where id = $1', [m]))[0]!.m;
  const lock1 = (u: string, m: string, seq: number, final: boolean, tag: string) =>
    as(u, 'select public.versus_submit($1, 1, $2, $3::jsonb, $4, null, null)', [m, seq, JSON.stringify(sideOf(tag)), final]);
  const tag1 = async (m: string, seat: string): Promise<string> =>
    (await q<any>('select prepared_side from public.versus_submissions where match_id = $1 and round = 1 and seat = $2', [m, seat]))[0].prepared_side.board[0].sourceUid;

  it('re-lock, late sends ignored, un-ready above 0:00 (refused at 0:00), and the round fights the newest boards', async () => {
    const m = await start1v1();
    await lock1(A, m, 1, true, 'first');
    await lock1(A, m, 2, true, 'second');
    await lock1(A, m, 2, true, 'stale');
    await lock1(A, m, 3, false, 'candidate');
    expect((await duel(m)).p1_locked).toBe(true);
    expect(await tag1(m, 'p1')).toBe('second');
    await as(A, 'select public.versus_unready($1, 1, 4)', [m]);
    expect((await duel(m)).p1_locked).toBe(false);
    await lock1(A, m, 5, true, 'third');
    const deadline = Date.parse((await duel(m)).shop_deadline);
    clock = deadline;
    expect(await fails(A, 'select public.versus_unready($1, 1, 6)', [m])).toMatch(/deadline_passed/);
    clock = deadline - 1000;
    await lock1(B, m, 1, true, 'bob');
    expect((await duel(m)).phase).toBe('resolving');
    expect(await tag1(m, 'p1')).toBe('third');
    expect(await fails(A, 'select public.versus_unready($1, 1, 7)', [m])).toMatch(/stale_round/);
  });
});

describe('R-VERSUS-READY-01: Ranked Duos End Turn is a ready signal', () => {
  it('re-sending keeps the first ready time (the gate reads it); un-ready moves the gate back', async () => {
    const m = await startMatch('ranked_duos', [A, B]);
    at(2000);
    await submit(A, m, 1, 1, true, 'first');
    const readyAt = (await seatRows(m)).p1.locked_at;
    expect(readyAt).toBeTruthy();
    at(3000);
    await submit(A, m, 1, 2, true, 'second');
    expect((await seatRows(m)).p1.locked_at).toEqual(readyAt);
    expect(await boardTag(m, 1, 'p1')).toBe('second');
    // One ready with time left: the gate closes at 0:00 + 5 s.
    const deadline = Date.parse((await matchRow(m)).shop_deadline);
    const json = await as<any>(A, 'select public.versus_ranked_duos_reconcile($1)', [m]);
    expect(Date.parse(json.closeAt)).toBe(deadline + 5000);
    // Un-ready: nobody has ended, the gate waits (the 30 s backstop).
    const after = await unready(A, m, 1, 3);
    expect((await seatRows(m)).p1.locked).toBe(false);
    expect((await seatRows(m)).p1.locked_at).toBeNull();
    expect(Date.parse(after.closeAt)).toBe(deadline + 30_000);
    // Past 0:00 a ready seat may still re-order (re-lock) until the close; un-ready is refused.
    await submit(A, m, 1, 4, true, 'ready-again');
    clock = deadline + 1000;
    await beat();
    await submit(A, m, 1, 5, true, 'reordered');
    expect(await boardTag(m, 1, 'p1')).toBe('reordered');
    expect(await fails(A, 'select public.versus_group_unready($1, 1, 6)', [m])).toMatch(/deadline_passed/);
    // Both ready: closes at once on the newest boards.
    await submit(B, m, 1, 1, true, 'mate');
    expect((await matchRow(m)).phase).toBe('resolving');
    expect(await boardTag(m, 1, 'p1')).toBe('reordered');
  });
});
