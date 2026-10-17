/**
 * `versus_open_rooms` against the real SQL (PGlite): how many Versus rooms the caller could join right now (owner
 * 2026-10-17: "can we add a way to show if a lobby is up in versus mode so players know to look";
 * R-VERSUS-OPEN-ROOMS-01). Pinned: an `open` room with a member seen in the last 2 minutes counts; the caller's OWN
 * room never does; a sealed or in-game room, a stale room (every member older than 2 minutes, the browser's own
 * prune rule) and a room on another protocol or content revision do not; `seatOpen` counts those with a player seat
 * free (a stale player does not hold one); it answers only the two integers, to signed-in players only, and writes
 * nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../..');
const SQL = readFileSync(join(root, 'supabase/migrations/2026-10-13-versus.sql'), 'utf8')
  + readFileSync(join(root, 'supabase/migrations/2026-10-17-versus-open-rooms.sql'), 'utf8');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;
const u = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ME = u(1);

let db: PGlite;
let rooms = 0;
/** A room and its members: [user, role, minutes since last seen]. */
async function room(status: string, members: Array<[string, string, number]>, opts: { protocol?: number; content?: string } = {}): Promise<string> {
  rooms++;
  const r = await db.query<{ id: string }>(
    `insert into public.versus_rooms (name, host_user_id, status, set_id, content_revision, protocol) values ($1, $2, $3, 'set1', $4, $5) returning id`,
    [`Room ${rooms}`, members[0]![0], status, opts.content ?? 'rev', opts.protocol ?? 1],
  );
  const id = r.rows[0]!.id;
  for (const [user, role, ago] of members) {
    await db.query(
      `insert into public.versus_members (room_id, user_id, role, display_name, last_seen_at) values ($1, $2, $3, 'P', now() - make_interval(mins => $4))`,
      [id, user, role, ago],
    );
  }
  return id;
}
async function openRooms(as: string | null, protocol = 1, content = 'rev'): Promise<unknown> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${as ?? ''}', false); set role ${as ? 'authenticated' : 'anon'};`);
  try {
    const r = await db.query<{ v: unknown }>('select public.versus_open_rooms($1, $2) as v', [protocol, content]);
    return r.rows[0]!.v;
  } finally { await db.exec('reset role'); }
}
const counts = async (): Promise<number> => (await db.query<{ n: number }>('select (select count(*) from public.versus_rooms) + (select count(*) from public.versus_members) as n')).rows[0]!.n;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(SQL);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe('versus_open_rooms', () => {
  it('reads 0 / 0 with no rooms', async () => {
    expect(await openRooms(ME)).toEqual({ open: 0, seatOpen: 0 });
  });

  it('counts open, fresh rooms on my version that I am not in; seatOpen = a player seat free', async () => {
    await room('open', [[u(10), 'p1', 0]]); // a host waiting: counts, a seat is free
    await room('open', [[u(11), 'p1', 1], [u(12), 'p2', 0]]); // both seats taken, still open: counts, no seat
    await room('open', [[u(13), 'p1', 0], [u(14), 'p2', 5]]); // p2 went stale: the seat is free again
    await room('open', [[u(15), 'spectator', 0]]); // only a watcher: open, both seats free
    expect(await openRooms(ME)).toEqual({ open: 4, seatOpen: 3 });
  });

  it('never counts my own room, a sealed or in-game room, a stale room, or a room on another version', async () => {
    const before = (await openRooms(ME)) as { open: number; seatOpen: number };
    await room('open', [[ME, 'p1', 0]]); // MY room
    await room('open', [[u(20), 'p1', 0]]); // someone else's: counts
    await room('sealed', [[u(21), 'p1', 0], [u(22), 'p2', 0]]);
    await room('in_game', [[u(23), 'p1', 0], [u(24), 'p2', 0]]);
    await room('open', [[u(25), 'p1', 3], [u(26), 'spectator', 10]]); // every member older than 2 minutes
    await room('open', [[u(27), 'p1', 0]], { protocol: 2 });
    await room('open', [[u(28), 'p1', 0]], { content: 'other' });
    const after = (await openRooms(ME)) as { open: number; seatOpen: number };
    expect(after).toEqual({ open: before.open + 1, seatOpen: before.seatOpen + 1 });
    // Someone else sees my room (it is open to THEM).
    const other = (await openRooms(u(99))) as { open: number };
    expect(other.open).toBe(after.open + 1);
  });

  it('exposes only the two counts, is signed-in only, and writes nothing', async () => {
    const n = await counts();
    const out = await openRooms(ME);
    expect(Object.keys(out as object).sort()).toEqual(['open', 'seatOpen']);
    expect(await counts()).toBe(n); // unlike versus_list_rooms, no prune
    await expect(openRooms(null)).rejects.toThrow(/permission denied/);
  });
});
