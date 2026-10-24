/**
 * `versus_records` against the real SQL (PGlite): each room player's lifetime Versus wins and losses (owner 2026-10-16:
 * "their versus wins as the attack pill, their versus losses as their health pill"). R-VERSUS-PLAYER-CARD-01.
 * Pinned: a win is a complete match won from either seat (hearts, forfeit, missed); a loss is one the other seat won; an
 * abandoned or unfinished match is neither; a match against an anonymous or profile-less account is neither; at most
 * 22 ids are answered; it exposes only the two counts per id.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const SQL = readFileSync(join(root, 'supabase/migrations/2026-10-13-versus.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-16-versus-records.sql'), 'utf8')
  // A full group room reads 24 ids (four seats + 20 spectators, R-VERSUS-GROUP-05).
  + readFileSync(join(root, 'supabase/migrations/2026-10-24-versus-records-24.sql'), 'utf8');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  create table public.profiles (user_id uuid primary key);
`;
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const ANON = '00000000-0000-0000-0000-0000000000a0'; // an anonymous / test account (auth row, is_anonymous)
const NOPROF = '00000000-0000-0000-0000-0000000000a1'; // a signed-in account with no profiles row

let db: PGlite;
async function match(p1: string, p2: string, phase: string, winner: 'p1' | 'p2' | null, reason: string | null): Promise<void> {
  await db.query(
    `insert into public.versus_matches (seed, set_id, content_revision, protocol, phase, p1_user, p2_user, p1_name, p2_name, winner_seat, end_reason, completed_at)
     values (1, 'set1', 'rev', 1, $1, $2, $3, 'a', 'b', $4, $5, case when $1 = 'complete' then now() end)`,
    [phase, p1, p2, winner, reason],
  );
}
async function records(users: string[]): Promise<Array<{ userId: string; wins: number; losses: number }>> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${C}', false); set role authenticated;`);
  try {
    const r = await db.query<{ v: Array<{ userId: string; wins: number; losses: number }> }>('select public.versus_records($1::uuid[]) as v', [users]);
    return r.rows[0]!.v;
  } finally { await db.exec('reset role'); }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(SQL);
  for (const u of [A, B, C, NOPROF]) await db.query('insert into auth.users (id, is_anonymous) values ($1, false)', [u]);
  await db.query('insert into auth.users (id, is_anonymous) values ($1, true)', [ANON]);
  for (const u of [A, B, C, ANON]) await db.query('insert into public.profiles (user_id) values ($1)', [u]);
  // Kevin's real case (2026-10-16): piles of matches against anonymous / profile-less test accounts never count.
  for (let i = 0; i < 5; i++) await match(A, ANON, 'complete', 'p2', 'forfeit');
  for (let i = 0; i < 4; i++) await match(NOPROF, A, 'complete', 'p1', 'hearts');
  await match(ANON, A, 'complete', 'p2', 'hearts');
  await match(A, B, 'complete', 'p1', 'hearts'); // A wins as p1
  await match(B, A, 'complete', 'p2', 'forfeit'); // A wins as p2 (B forfeited)
  await match(A, B, 'complete', 'p2', 'missed'); // A loses as p1
  await match(B, A, 'complete', null, 'abandoned'); // nobody
  await match(A, B, 'shop', null, null); // still running: nobody
  await match(C, B, 'complete', 'p1', 'hearts'); // not A's
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('versus_records', () => {
  it('counts each player\'s finished wins and losses from either seat; abandoned / running matches count for nobody', async () => {
    const out = await records([A, B]);
    expect(out).toEqual(expect.arrayContaining([{ userId: A, wins: 2, losses: 1 }, { userId: B, wins: 1, losses: 3 }]));
    expect(out).toHaveLength(2);
  });

  it('only matches where BOTH seats are real accounts (non-anonymous, with a profile) count', async () => {
    const out = await records([A, ANON, NOPROF]);
    expect(out).toEqual(expect.arrayContaining([{ userId: A, wins: 2, losses: 1 }, { userId: ANON, wins: 0, losses: 0 }, { userId: NOPROF, wins: 0, losses: 0 }]));
  });

  it('answers at most 24 ids, exposes only the two counts, and a player with no matches reads 0 / 0', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `00000000-0000-0000-0000-${String(1000 + i).padStart(12, '0')}`);
    expect(await records(many)).toHaveLength(24);
    const out = await records([A, B, C]);
    expect(out).toHaveLength(3);
    const fresh = await records(['00000000-0000-0000-0000-0000000000ff']);
    expect(fresh).toEqual([{ userId: '00000000-0000-0000-0000-0000000000ff', wins: 0, losses: 0 }]);
    for (const row of out) expect(Object.keys(row).sort()).toEqual(['losses', 'userId', 'wins']);
    expect(await records([])).toEqual([]);
  });
});
