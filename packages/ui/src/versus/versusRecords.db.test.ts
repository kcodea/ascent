/**
 * `versus_records` against the real SQL (PGlite): each room player's lifetime Versus wins and losses (owner 2026-10-16:
 * "their versus wins as the attack pill, their versus losses as their health pill"). R-VERSUS-PLAYER-CARD-01.
 * Pinned: a win is a complete match won from either seat (hearts, forfeit, missed); a loss is one the other seat won; an
 * abandoned or unfinished match is neither; at most two ids are answered; it exposes only the two counts per id.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const SQL = readFileSync(join(root, 'supabase/migrations/2026-10-13-versus.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-16-versus-records.sql'), 'utf8');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;
const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';

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

  it('answers at most two ids, exposes only the two counts, and a player with no matches reads 0 / 0', async () => {
    const out = await records([A, B, C]);
    expect(out).toHaveLength(2);
    const fresh = await records(['00000000-0000-0000-0000-0000000000ff']);
    expect(fresh).toEqual([{ userId: '00000000-0000-0000-0000-0000000000ff', wins: 0, losses: 0 }]);
    for (const row of out) expect(Object.keys(row).sort()).toEqual(['losses', 'userId', 'wins']);
    expect(await records([])).toEqual([]);
  });
});
