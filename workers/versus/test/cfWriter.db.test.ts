/**
 * VERSUS ON CLOUDFLARE — the result writer, executed (PGlite runs every Versus migration in order, then
 * `2026-11-04-versus-cf-writer.sql` twice: idempotent). Owner ruling 2026-10-28: results go through a dedicated,
 * limited path, never the service role. Proves: no key, no write; a Cloudflare match and its rounds land as the readers
 * expect (scouts kept); a Supabase-hosted match can never be touched; a finished Cloudflare match is frozen; the sweep
 * leaves Cloudflare matches alone.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { duosBoardOfSide, duosBoardOfSnapshot, parseDuosHistory } from '@game/sim/versus/duosHistory';

const root = join(__dirname, '../../..');
const mig = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
  '2026-10-24-versus-group.sql', '2026-10-24-versus-group-knockout-stands.sql',
  '2026-10-25-versus-duos.sql', '2026-10-25-versus-duos-edges.sql', '2026-10-25-versus-duos-random-order.sql',
  '2026-10-25-versus-duos-pass-back.sql', '2026-10-26-versus-lock-order.sql', '2026-10-27-versus-egress.sql', '2026-10-28-versus-health.sql',
  '2026-10-15-lobby-live.sql', '2026-10-26-lobby-live-hero-select.sql', '2026-10-28-friends.sql',
  '2026-10-29-ranked-duos.sql', '2026-10-30-ranked-duos-client.sql', '2026-10-31-ranked-duos-live-fixes.sql',
  '2026-11-01-ranked-duos-party.sql', '2026-11-01-versus-ready-signal.sql', '2026-11-02-ranked-duos-both-ready.sql', '2026-11-02-ranked-duos-party-split.sql',
  '2026-11-02-versus-server-reliability.sql', '2026-11-03-versus-live-armor.sql',
];
const WRITER = mig('2026-11-04-versus-cf-writer.sql') + '\n' + mig('2026-11-05-versus-cf-writer-group.sql') + '\n' + mig('2026-11-06-versus-cf-writer-duos.sql')
  + '\n' + mig('2026-11-07-versus-cf-ranked.sql') + '\n' + mig('2026-11-13-duos-match-history.sql');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema extensions;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  create table public.profiles (user_id uuid primary key, author text, discriminator text, avatar text, favorite_hero text);
  grant select on public.profiles to anon, authenticated;
  create table public.cosmetic_loadouts (user_id uuid, slot text, target_id text not null default '', cosmetic_id text, primary key (user_id, slot, target_id));
  grant select on public.cosmetic_loadouts to anon, authenticated;
`;
const P1 = '00000000-0000-0000-0000-000000000001';
const P2 = '00000000-0000-0000-0000-000000000002';
const MATCH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SECRET = 'test-writer-secret-not-real';

let db: PGlite;
async function call(key: string | null, kind: string, row: unknown): Promise<unknown> {
  await db.exec('set role anon');
  try {
    const r = await db.query<{ v: unknown }>('select public.versus_cf_persist($1, $2, $3::jsonb) as v', [key, kind, JSON.stringify(row)]);
    return r.rows[0]!.v;
  } finally {
    await db.exec('reset role');
  }
}
async function fails(key: string | null, kind: string, row: unknown): Promise<string> {
  try { await call(key, kind, row); } catch (e) { return (e as Error).message; }
  return 'did not fail';
}
const matchRow = (over: Record<string, unknown> = {}) => ({
  id: MATCH, seed: 42, set_id: 'set1', content_revision: 'rev1', protocol: 2, phase: 'combat', revision: 5, round: 1,
  p1_user: P1, p2_user: P2, p1_name: 'Claudebot1', p2_name: 'Claudebot2', p1_hero: 'h1', p2_hero: 'h2', heroes_revealed: true,
  p1_health: 30, p1_armor: 5, p2_health: 27, p2_armor: 0, p1_missed: 0, p2_missed: 0, p1_auto: false, p2_auto: false,
  winner_seat: null, end_reason: null, options: { v: 1, mode: 'duel', modifiers: [] },
  created_at: '2026-10-28T12:00:00.000Z', updated_at: '2026-10-28T12:01:00.000Z', completed_at: null, ...over,
});
const roundRow = (round: number) => ({
  match_id: MATCH, round, chair: 'p1', outcome: 'p1', heart_lost_by: 'p2', p1_result: { result: 'win' }, p2_result: { result: 'lose' },
  digest: 'd' + round, p1_health: 30, p1_armor: 5, p2_health: 27, p2_armor: 0, p1_damage: 0, p2_damage: 3,
  p1_scout: { tier: 2 }, p2_scout: { tier: 1 }, committed_at: '2026-10-28T12:01:00.000Z',
});

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  await db.exec(FILES.map(mig).join('\n'));
  await db.exec(WRITER);
  await db.exec(WRITER);
  const hash = createHash('sha256').update(SECRET).digest('hex');
  await db.query('insert into public.versus_cf_writer_keys (key_hash, note) values ($1, $2)', [hash, 'test']);
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('versus_cf_persist (the Cloudflare room\'s only write path)', () => {
  it('refuses without the writer key, and anon cannot read the key table', async () => {
    expect(await fails(null, 'match', matchRow())).toContain('not_authorized');
    expect(await fails('wrong', 'match', matchRow())).toContain('not_authorized');
    await db.exec('set role anon');
    await expect(db.query('select * from public.versus_cf_writer_keys')).rejects.toThrow();
    await db.exec('reset role');
  });

  it('writes a Cloudflare match and its rounds as the readers expect (scouts kept, room-less, backend marked)', async () => {
    expect(await call(SECRET, 'match', matchRow())).toMatchObject({ ok: true });
    expect(await call(SECRET, 'round', roundRow(1))).toMatchObject({ ok: true });
    expect(await call(SECRET, 'round', roundRow(1))).toMatchObject({ ok: true }); // a retry is harmless
    const m = (await db.query<Record<string, unknown>>(`select * from public.versus_matches where id = '${MATCH}'`)).rows[0]!;
    expect(m).toMatchObject({ backend: 'cloudflare', room_id: null, phase: 'combat', p2_health: 27 });
    const r = (await db.query<Record<string, unknown>>(`select * from public.versus_rounds where match_id = '${MATCH}'`)).rows;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ p1_scout: { tier: 2 }, p2_scout: { tier: 1 }, p2_damage: 3 });
  });

  it('leaves Cloudflare matches to their room: the sweep skips them', async () => {
    await call(SECRET, 'match', matchRow({ updated_at: '2020-01-01T00:00:00.000Z', revision: 6 }));
    await db.exec('set role service_role');
    await db.query('select public.versus_sweep()');
    await db.exec('reset role');
    const m = (await db.query<{ phase: string }>(`select phase from public.versus_matches where id = '${MATCH}'`)).rows[0]!;
    expect(m.phase).toBe('combat');
  });

  it('a finished Cloudflare match is frozen; a Supabase-hosted match can never be written', async () => {
    await call(SECRET, 'match', matchRow({ phase: 'complete', winner_seat: 'p1', end_reason: 'hearts', completed_at: '2026-10-28T12:10:00.000Z' }));
    expect(await call(SECRET, 'match', matchRow({ phase: 'combat' }))).toMatchObject({ frozen: true });
    const m = (await db.query<{ phase: string }>(`select phase from public.versus_matches where id = '${MATCH}'`)).rows[0]!;
    expect(m.phase).toBe('complete');
    const other = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await db.query(`insert into public.versus_matches (id, seed, set_id, content_revision, protocol, phase, p1_user, p2_user, p1_name, p2_name)
      values ('${other}', 1, 'set1', 'rev1', 2, 'shop', '${P1}', '${P2}', 'a', 'b')`);
    expect(await fails(SECRET, 'match', matchRow({ id: other }))).toContain('not_cloudflare');
    expect(await fails(SECRET, 'round', { ...roundRow(1), match_id: other })).toContain('not_cloudflare');
  });
});

describe('versus_cf_persist, GROUP (2026-11-05-versus-cf-writer-group.sql)', () => {
  const GM = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const P3 = '00000000-0000-0000-0000-000000000003';
  const seat = (s: string, user: string, over: Record<string, unknown> = {}) => ({
    seat: s, user_id: user, name: s, health: 30, armor: 5, hero: 'h', locked: false, ready: false, intro: true, auto: false, missed: 0,
    eliminated_round: null, out_reason: null, placement: null, ...over,
  });
  const gmatch = (over: Record<string, unknown> = {}) => ({
    id: GM, seed: 7, set_id: 'set1', content_revision: 'rev1', protocol: 2, options: { v: 1, mode: 'group', modifiers: [] }, phase: 'combat',
    revision: 3, round: 1, seat_count: 3, heroes_revealed: true, winner_seat: null, end_reason: null, created_at: '2026-10-28T12:00:00.000Z',
    updated_at: '2026-10-28T12:01:00.000Z', completed_at: null, seats: [seat('p1', P1), seat('p2', P2), seat('p3', P3)], ...over,
  });

  it('writes a Cloudflare group match, its seats, a round and its fights; frozen once complete; key-gated', async () => {
    expect(await call(SECRET, 'group_match', gmatch())).toMatchObject({ ok: true });
    const round = {
      match_id: GM, round: 1, digest: 'g1', vitals: { p1: { health: 30, armor: 5 } }, eliminated: [],
      fights: [
        { fight: 0, a_seat: 'p1', b_seat: 'p2', b_copy: false, chair: 'a', outcome: 'a', heart_lost_by: 'p2', damage: 3, a_result: { r: 1 }, b_result: { r: 2 }, a_scout: { tier: 1 }, b_scout: { tier: 1 } },
        { fight: 1, a_seat: 'p3', b_seat: 'p1', b_copy: true, chair: 'a', outcome: 'draw', heart_lost_by: null, damage: 0, a_result: {}, b_result: {}, a_scout: {}, b_scout: {} },
      ],
    };
    expect(await call(SECRET, 'group_round', round)).toMatchObject({ ok: true });
    expect(await call(SECRET, 'group_round', round)).toMatchObject({ ok: true }); // a retry is harmless
    expect((await db.query('select * from public.versus_group_fights where match_id = $1', [GM])).rows).toHaveLength(2);
    await call(SECRET, 'group_match', gmatch({
      phase: 'complete', winner_seat: 'p1', end_reason: 'hearts',
      seats: [seat('p1', P1, { placement: 1 }), seat('p2', P2, { eliminated_round: 1, out_reason: 'hearts', placement: 3, health: 0 }),
        seat('p3', P3, { eliminated_round: 1, out_reason: 'hearts', placement: 3, health: 0 })],
    }));
    const seats = (await db.query<{ placement: number }>('select placement from public.versus_group_seats where match_id = $1 order by seat', [GM])).rows;
    expect(seats.map((s) => s.placement)).toEqual([1, 3, 3]);
    expect(await call(SECRET, 'group_match', gmatch({ phase: 'shop' }))).toMatchObject({ frozen: true });
    expect(await fails(null, 'group_match', gmatch())).toContain('not_authorized');
  });

  it('a Duos match writes its seats\' teams and the two team pools (2026-11-06-versus-cf-writer-duos.sql)', async () => {
    const DM = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const P4 = '00000000-0000-0000-0000-000000000004';
    const teams = [
      { team: 'a', health: 30, armor: 12, eliminated_round: null, out_reason: null, placement: null },
      { team: 'b', health: 0, armor: 0, eliminated_round: 4, out_reason: 'hearts', placement: 2 },
    ];
    expect(await call(SECRET, 'group_match', gmatch({
      id: DM, seat_count: 4, options: { v: 1, mode: 'duos', modifiers: [] }, teams,
      seats: [seat('p1', P1, { team: 'a' }), seat('p2', P2, { team: 'a' }), seat('p3', P3, { team: 'b' }), seat('p4', P4, { team: 'b' })],
    }))).toMatchObject({ ok: true });
    const t = (await db.query<{ team: string; armor: number; placement: number | null }>('select team, armor, placement from public.versus_group_teams where match_id = $1 order by team', [DM])).rows;
    expect(t).toEqual([{ team: 'a', armor: 12, placement: null }, { team: 'b', armor: 0, placement: 2 }]);
    const s = (await db.query<{ team: string }>('select team from public.versus_group_seats where match_id = $1 order by seat', [DM])).rows;
    expect(s.map((x) => x.team)).toEqual(['a', 'a', 'b', 'b']);
  });
});

describe('RANKED DUOS (2026-11-07-versus-cf-ranked.sql)', () => {
  const RM = '12121212-1212-4121-8121-121212121212';
  async function ranked(kind: string, args: unknown, key: string | null = SECRET): Promise<any> {
    await db.exec('set role anon');
    try {
      return (await db.query<{ v: unknown }>('select public.versus_cf_ranked($1, $2, $3::jsonb) as v', [key, kind, JSON.stringify(args)])).rows[0]!.v;
    } finally {
      await db.exec('reset role');
    }
  }

  it('reads: the pair\'s team (created once, division 0 when new) and the samples, key-gated', async () => {
    const t1 = await ranked('team', { a: P2, b: P1 });
    const t2 = await ranked('team', { a: P1, b: P2 });
    expect(t1.teamId).toBe(t2.teamId);
    expect(t1.division).toBe(0);
    expect(await ranked('duo_sample', { p_limit: 10, p_set: 'set1', p_seed: 'x' })).toEqual({ rows: [], names: {} });
    await expect(ranked('team', { a: P1, b: P2 }, 'wrong')).rejects.toThrow('not_authorized');
  });

  it('ranked_finish writes the whole match once, settles the team rating and records the duo run; a repeat is frozen', async () => {
    const team = (await ranked('team', { a: P1, b: P2 })).teamId as string;
    const side = (n: number) => ({ board: [], state: { tier: n }, config: {} });
    const rounds = [1, 2, 3, 4].map((round) => ({
      match_id: RM, kind: 'ranked', round, digest: `r${round}`, vitals: { a: { health: 30, armor: 0 } }, eliminated: [], first: { a: 'p1' },
      fights: [{ round, fight: 0, a_team: 'a', b_team: 'b', ghost: false, chair: 'a', outcome: 'a', loser: 'b', damage: 2, first: { a: 0, b: 1 }, live_result: { r: round } }],
    }));
    const row = {
      placement: 2,
      match: { id: RM, seed: 5, set_id: 'set1', content_revision: 'rev1', protocol: 2, options: { v: 1, mode: 'ranked_duos', modifiers: [] }, round: 4,
        winner_seat: null, end_reason: 'hearts', ranked_team: team, unrated: null, seated_at: '2026-10-28T12:00:00.000Z', created_at: '2026-10-28T12:00:00.000Z' },
      seats: [{ seat: 'p1', user_id: P1, name: 'A', hero: 'h1', placement: 2, health: 0, armor: 0 }, { seat: 'p2', user_id: P2, name: 'B', hero: 'h2', placement: 2, health: 0, armor: 0 }],
      teams: [{ team: 'a', health: 0, armor: 0, eliminated_round: 4, out_reason: 'hearts', placement: 2 }, { team: 'b', placement: 1, served_kind: 'generated' },
        { team: 'c', placement: 3, served_kind: 'generated' }, { team: 'd', placement: 4, served_kind: 'generated' }],
      served: [{ team: 'b', member: 0, kind: 'generated', source_key: 'g1', owner_id: null, name: 'Bot', hero: 'h3', recording: { kind: 'generated' } }],
      rounds,
      submissions: [1, 2, 3, 4].flatMap((round) => [{ round, seat: 'p1', user_id: P1, prepared_side: side(round), source: 'lock' }, { round, seat: 'p2', user_id: P2, prepared_side: side(round), source: 'lock' }]),
    };
    expect(await call(SECRET, 'ranked_finish', row)).toMatchObject({ ok: true });
    expect(await call(SECRET, 'ranked_finish', row)).toMatchObject({ frozen: true });
    expect((await db.query('select * from public.versus_ranked_duos_fights where match_id = $1', [RM])).rows).toHaveLength(4);
    const settled = (await db.query<{ placement: number }>('select placement from public.duos_rank_results where team_id = $1 and match_id = $2', [team, RM])).rows;
    expect(settled).toEqual([{ placement: 2 }]);
    const run = (await db.query<{ round_count: number; placement: number }>('select round_count, placement from public.duo_runs where match_id = $1', [RM])).rows;
    expect(run).toEqual([{ round_count: 4, placement: 2 }]);
    expect((await db.query('select * from public.duo_run_rounds dr join public.duo_runs r on r.id = dr.duo_run_id where r.match_id = $1', [RM])).rows).toHaveLength(4);
  });
});

describe('DUOS MATCH HISTORY (2026-11-13-duos-match-history.sql, R-DUOS-HISTORY-01)', () => {
  const P3 = '00000000-0000-0000-0000-000000000003';
  const P4 = '00000000-0000-0000-0000-000000000004';
  const minion = (cardId: string, attack: number, health: number, extra: Record<string, unknown> = {}) => ({ cardId, attack, health, uid: 'u' + cardId, buffs: [{ x: 1 }], ...extra });
  async function readAs(user: string | null, match: string): Promise<unknown[]> {
    await db.exec(user ? 'set role authenticated' : 'set role anon');
    if (user) await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user]);
    try {
      return (await db.query('select match_id from public.duos_match_history where match_id = $1', [match])).rows;
    } catch {
      return ['denied'];
    } finally {
      await db.exec('reset role');
      await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    }
  }
  const history = (mode: string, teams: unknown[]) => ({ v: 1, mode, endRound: 3, teams });

  it('Versus Duos: the final group_match row stores the record once, readable by its four players only', async () => {
    const VM = '31313131-3131-4131-8131-313131313131';
    const seat = (s: string, user: string, team: string, over: Record<string, unknown> = {}) => ({
      seat: s, user_id: user, name: s.toUpperCase(), health: 0, armor: 0, hero: 'h' + s, locked: false, ready: false, intro: true, auto: false, missed: 0,
      eliminated_round: null, out_reason: null, placement: null, team, ...over,
    });
    const base = {
      id: VM, seed: 9, set_id: 'set1', content_revision: 'rev1', protocol: 2, options: { v: 1, mode: 'duos', modifiers: [] }, revision: 9, round: 3,
      seat_count: 4, heroes_revealed: true, created_at: '2026-10-28T12:00:00.000Z', updated_at: '2026-10-28T12:09:00.000Z',
      seats: [seat('p1', P1, 'a'), seat('p2', P2, 'a'), seat('p3', P3, 'b'), seat('p4', P4, 'b')],
      teams: [{ team: 'a', health: 20, armor: 0 }, { team: 'b', health: 0, armor: 0 }],
    };
    const rec = history('versus_duos', [
      { team: 'a', kind: 'live', placement: 1, members: [{ seat: 'p1', userId: P1, name: 'P1', heroId: 'hp1', board: { round: 3, tier: 3, minions: [{ cardId: 'c1', attack: 2, health: 3 }] } }] },
      { team: 'b', kind: 'live', placement: 2, outRound: 3, members: [] },
    ]);
    // A mid-game row never stores one, even when it carries a record.
    expect(await call(SECRET, 'group_match', { ...base, phase: 'combat', history: rec })).toMatchObject({ ok: true });
    expect((await db.query('select 1 from public.duos_match_history where match_id = $1', [VM])).rows).toHaveLength(0);
    expect(await call(SECRET, 'group_match', {
      ...base, phase: 'complete', winner_seat: 'p1', end_reason: 'hearts', completed_at: '2026-10-28T12:10:00.000Z', history: rec,
      teams: [{ team: 'a', health: 20, armor: 0, placement: 1 }, { team: 'b', health: 0, armor: 0, eliminated_round: 3, out_reason: 'hearts', placement: 2 }],
    })).toMatchObject({ ok: true });
    const row = (await db.query<{ mode: string; players: string[]; record: unknown; source: string; rank: unknown }>('select mode, players, record, source, rank from public.duos_match_history where match_id = $1', [VM])).rows[0]!;
    expect(row).toMatchObject({ mode: 'versus_duos', players: [P1, P2, P3, P4], source: 'live', rank: null });
    expect(parseDuosHistory(row.record)!.teams[0]!.members[0]!.board!.minions).toEqual([{ cardId: 'c1', attack: 2, health: 3 }]);
    for (const u of [P1, P2, P3, P4]) expect(await readAs(u, VM)).toHaveLength(1);
    expect(await readAs('00000000-0000-0000-0000-000000000009', VM)).toHaveLength(0);
    expect(await readAs(null, VM)).toEqual(['denied']);
  });

  it('a Group match and a bad record store nothing, and a bad record never fails the result write', async () => {
    const GM2 = '32323232-3232-4232-8232-323232323232';
    const seat = (s: string, user: string) => ({ seat: s, user_id: user, name: s, health: 30, armor: 0, hero: 'h', locked: false, ready: false, intro: true, auto: false, missed: 0, eliminated_round: null, out_reason: null, placement: null });
    const row = {
      id: GM2, seed: 1, set_id: 'set1', content_revision: 'rev1', protocol: 2, options: { v: 1, mode: 'group', modifiers: [] }, phase: 'complete', revision: 2, round: 2,
      seat_count: 3, heroes_revealed: true, winner_seat: 'p1', end_reason: 'hearts', created_at: '2026-10-28T12:00:00.000Z', updated_at: '2026-10-28T12:01:00.000Z',
      completed_at: '2026-10-28T12:02:00.000Z', seats: [seat('p1', P1), seat('p2', P2), seat('p3', P3)], history: history('versus_duos', []),
    };
    expect(await call(SECRET, 'group_match', row)).toMatchObject({ ok: true });
    expect((await db.query('select 1 from public.duos_match_history where match_id = $1', [GM2])).rows).toHaveLength(0);
    const DM2 = '33333333-3333-4333-8333-333333333334';
    expect(await call(SECRET, 'group_match', {
      ...row, id: DM2, seat_count: 4, options: { v: 1, mode: 'duos', modifiers: [] }, history: { v: 2, teams: 'no' },
      seats: [seat('p1', P1), seat('p2', P2), seat('p3', P3), seat('p4', P4)],
    })).toMatchObject({ ok: true });
    expect((await db.query('select phase from public.versus_group_matches where id = $1', [DM2])).rows).toEqual([{ phase: 'complete' }]);
    expect((await db.query('select 1 from public.duos_match_history where match_id = $1', [DM2])).rows).toHaveLength(0);
  });

  it('Ranked Duos: ranked_finish stores the record after the settle, with the team rating change', async () => {
    const RM2 = '34343434-3434-4343-8343-343434343434';
    const P5 = '00000000-0000-0000-0000-000000000005';
    const P6 = '00000000-0000-0000-0000-000000000006';
    await db.exec('set role anon');
    const team = ((await db.query<{ v: { teamId: string } }>('select public.versus_cf_ranked($1, $2, $3::jsonb) as v', [SECRET, 'team', JSON.stringify({ a: P5, b: P6 })])).rows[0]!.v).teamId;
    await db.exec('reset role');
    const rec = history('ranked_duos', [{ team: 'a', kind: 'live', placement: 1, members: [{ seat: 'p1', userId: P5, name: 'A', heroId: 'h1', board: null }] }]);
    const row = {
      placement: 1, history: rec,
      match: {
        id: RM2, seed: 5, set_id: 'set1', content_revision: 'rev1', protocol: 2, options: { v: 1, mode: 'ranked_duos', modifiers: [] }, round: 3,
        winner_seat: 'p1', end_reason: 'hearts', ranked_team: team, unrated: null, seated_at: '2026-10-28T12:00:00.000Z', created_at: '2026-10-28T12:00:00.000Z',
      },
      seats: [{ seat: 'p1', user_id: P5, name: 'A', hero: 'h1', placement: 1, health: 10, armor: 0 }, { seat: 'p2', user_id: P6, name: 'B', hero: 'h2', placement: 1, health: 10, armor: 0 }],
      teams: [{ team: 'a', placement: 1 }], served: [], rounds: [], submissions: [],
    };
    expect(await call(SECRET, 'ranked_finish', row)).toMatchObject({ ok: true });
    const h = (await db.query<{ players: string[]; team_id: string; rank: { delta: number; divisionBefore: number } }>('select players, team_id, rank from public.duos_match_history where match_id = $1', [RM2])).rows[0]!;
    expect(h.players).toEqual([P5, P6]);
    expect(h.team_id).toBe(team);
    expect(h.rank.delta).toBe(34);
    expect(h.rank.divisionBefore).toBe(0);
    expect(await readAs(P6, RM2)).toHaveLength(1);
    expect(await readAs(P1, RM2)).toHaveLength(0);
  });

  it('the backfill builds the same record from the tables (live boards from the last final submission, recorded boards from recordings)', async () => {
    const BM = '35353535-3535-4353-8353-353535353535';
    const P7 = '00000000-0000-0000-0000-000000000007';
    const P8 = '00000000-0000-0000-0000-000000000008';
    // A Supabase-hosted Ranked Duos game, as its tables hold it.
    await db.query(`insert into public.versus_group_matches (id, seed, set_id, content_revision, protocol, options, phase, round, seat_count, created_at, completed_at)
      values ($1, 1, 'set1', 'rev1', 2, '{"v":1,"mode":"ranked_duos","modifiers":[]}', 'complete', 5, 2, '2026-10-26T18:00:00Z', '2026-10-26T18:20:00Z')`, [BM]);
    await db.query(`insert into public.versus_group_seats (match_id, seat, user_id, name, hero, team, placement, eliminated_round) values
      ($1, 'p1', $2, 'Seven', 'hA', 'a', 3, 5), ($1, 'p2', $3, 'Eight', 'hB', 'a', 3, 5)`, [BM, P7, P8]);
    await db.query(`insert into public.versus_group_teams (match_id, team, placement, eliminated_round, served_kind, name) values
      ($1, 'a', 3, 5, null, null), ($1, 'b', 4, 2, 'pair', null), ($1, 'c', null, null, 'duo', 'Goats'), ($1, 'd', null, null, 'generated', null)`, [BM]);
    const side = (cards: string[], tier: number) => ({ board: cards.map((c, i) => minion(c, i + 1, i + 2, i === 0 ? { golden: true, keywords: ['taunt'] } : {})), state: { tier }, config: {} });
    const subs: [number, string, string[]][] = [[4, 'p1', ['x1']], [5, 'p1', ['y1', 'y2']], [5, 'p2', ['z1']]];
    for (const [round, seat, cards] of subs) {
      await db.query(`insert into public.versus_group_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source, scout)
        values ($1, $2, $3, $4, 0, $5, true, 'lock', $6)`, [BM, round, seat, seat === 'p1' ? P7 : P8, JSON.stringify(side(cards, round)), JSON.stringify(round === 5 && seat === 'p1' ? { runes: ['r1'] } : {})]);
    }
    const solo = { kind: 'solo', boards: [1, 2, 3].map((w) => ({ wave: w, tier: w, minions: [minion(`s${w}`, w, w)], runes: ['rs'] })) };
    const duo = { kind: 'duo', rounds: [1, 2, 3, 4, 5, 6].map((r) => ({ round: r, side: side([`d${r}`], 2) })) };
    const late = { kind: 'duo', rounds: [{ round: 7, side: side(['late'], 1) }] };
    const served: [string, number, string, unknown][] = [['b', 0, 'solo', solo], ['b', 1, 'solo', solo], ['c', 0, 'duo', duo], ['c', 1, 'duo', late], ['d', 0, 'generated', { kind: 'generated' }], ['d', 1, 'generated', { kind: 'generated' }]];
    for (const [team, member, kind, rec] of served) {
      await db.query(`insert into public.versus_ranked_duos_served (match_id, team, member, kind, source_key, name, hero, recording)
        values ($1, $2, $3, $4, 'k', $5, $6, $7)`, [BM, team, member, kind, `${team}${member}`, `hero${team}${member}`, JSON.stringify(rec)]);
    }
    const n = (await db.query<{ n: number }>('select public.duos_history_backfill() as n')).rows[0]!.n;
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await db.query<{ n: number }>('select public.duos_history_backfill() as n')).rows[0]!.n).toBe(0); // re-runnable: nothing twice
    const row = (await db.query<{ record: unknown; source: string; players: string[] }>('select record, source, players from public.duos_match_history where match_id = $1', [BM])).rows[0]!;
    expect(row.source).toBe('backfill');
    expect(row.players).toEqual([P7, P8]);
    const rec = parseDuosHistory(row.record)!;
    expect(rec).not.toBeNull();
    expect(rec.mode).toBe('ranked_duos');
    expect(rec.endRound).toBe(5);
    // Table order: the two teams still standing, then 3rd, then 4th.
    expect(rec.teams.map((t) => [t.team, t.placement ?? null, t.kind, t.name ?? null, t.outRound ?? null])).toEqual([
      ['c', null, 'duo', 'Goats', null], ['d', null, 'generated', null, null], ['a', 3, 'live', null, 5], ['b', 4, 'pair', null, 2]]);
    const live = rec.teams[2]!.members;
    expect(live.map((m) => [m.seat, m.userId, m.name, m.heroId])).toEqual([['p1', P7, 'Seven', 'hA'], ['p2', P8, 'Eight', 'hB']]);
    // The last final submission, compacted exactly as the Worker does it (no uid, no buffs), runes from its scout.
    expect(live[0]!.board).toEqual({ round: 5, tier: 5, minions: [{ cardId: 'y1', attack: 1, health: 2, golden: true, keywords: ['taunt'] }, { cardId: 'y2', attack: 2, health: 3 }], runes: ['r1'] });
    expect(live[0]!.board).toEqual(duosBoardOfSide(side(['y1', 'y2'], 5), 5, ['r1']));
    expect(live[1]!.board).toEqual(duosBoardOfSide(side(['z1'], 5), 5));
    // A recorded member: its recording's board at the round its team went out (b: round 2) or the end (c: round 5).
    const b0 = rec.teams[3]!.members[0]!;
    expect(b0).toMatchObject({ seat: 'b0', name: 'b0', heroId: 'herob0' });
    expect(b0.board).toEqual(duosBoardOfSnapshot(solo.boards[1], 2));
    expect(rec.teams[0]!.members[0]!.board).toEqual(duosBoardOfSide(duo.rounds[4]!.side, 5));
    expect(rec.teams[0]!.members[1]!.board).toBeNull(); // a recording that starts after the end round: nothing
    expect(rec.teams[1]!.members.map((m) => m.board)).toEqual([null, null]); // a generated seat keeps no recording
  });
});
