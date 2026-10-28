/**
 * LIVE GAMES ON CLOUDFLARE + SPECTATOR XP FOR EVERY CLOUDFLARE WATCH, executed (PGlite runs the Live Games, switch and
 * writer migrations in order, then `2026-11-10-lobby-live-cf.sql` twice: idempotent). R-LIVE-CF-01, R-LIVE-CF-XP-01.
 *
 *  - The switch has `lobby_live`, on Supabase until flipped.
 *  - `lobby_live_cf`: no key, no write; a lobby game's row lands with its host (`cf:<rev>`), rank from SQL, visible 4
 *    minutes; it can never take another account's row; removal touches only a Cloudflare-hosted row; the Supabase
 *    heartbeat takes a row back (host cleared).
 *  - The Supabase watch refuses a Cloudflare-hosted game (`other_host`).
 *  - `spectate_cf_beat`: no key, no write; time accrues exactly as `spectate_beat` accrues it (between beats <= 45 s
 *    apart on the same game), the one-game-at-a-time presence holds across both writers, a lobby game's end is stamped,
 *    the player is never their own spectator, and a malformed beat is skipped without failing the batch.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../..');
const mig = (f: string): string => readFileSync(join(root, 'supabase/migrations', f), 'utf8');
const FILES = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
  '2026-10-24-versus-group.sql', '2026-10-24-versus-group-knockout-stands.sql',
  '2026-10-25-versus-duos.sql', '2026-10-25-versus-duos-edges.sql', '2026-10-25-versus-duos-random-order.sql',
  '2026-10-25-versus-duos-pass-back.sql', '2026-10-26-versus-lock-order.sql', '2026-10-27-versus-egress.sql', '2026-10-28-versus-health.sql',
  '2026-10-15-lobby-live.sql', '2026-10-15-lobby-live-watcher-identity.sql', '2026-10-26-lobby-live-hero-select.sql', '2026-10-28-friends.sql',
  '2026-10-29-ranked-duos.sql', '2026-10-30-ranked-duos-client.sql', '2026-10-31-ranked-duos-live-fixes.sql',
  '2026-11-01-ranked-duos-party.sql', '2026-11-01-versus-ready-signal.sql', '2026-11-02-ranked-duos-both-ready.sql', '2026-11-02-ranked-duos-party-split.sql',
  '2026-11-02-versus-server-reliability.sql', '2026-11-03-versus-live-armor.sql',
  '2026-11-04-versus-cf-writer.sql', '2026-11-05-versus-cf-writer-group.sql', '2026-11-05-versus-host-config.sql',
  '2026-11-06-versus-cf-writer-duos.sql', '2026-11-07-versus-cf-ranked.sql', '2026-11-08-versus-cf-live-games-invites.sql',
];
const NEW = mig('2026-11-10-lobby-live-cf.sql');
const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema extensions;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  create table public.profiles (user_id uuid primary key, author text, discriminator text, avatar text, favorite_hero text,
    rank_division int not null default 0, rank_points int not null default 0, rating int not null default 0);
  grant select on public.profiles to anon, authenticated;
  create table public.cosmetic_loadouts (user_id uuid, slot text, target_id text not null default '', cosmetic_id text, primary key (user_id, slot, target_id));
  grant select on public.cosmetic_loadouts to anon, authenticated;
`;
// The watch record's tables, verbatim from 2026-10-24-versus-spectator-xp.sql (that file also replaces
// settle_progression, which needs the whole progression schema).
const SPECTATE_TABLES = (() => {
  const src = mig('2026-10-24-versus-spectator-xp.sql');
  const from = src.indexOf('create table if not exists public.spectate_sessions');
  const to = src.indexOf('-- ── 3. spectate_beat');
  const beatFrom = src.indexOf('create or replace function public.spectate_beat');
  const beatTo = src.indexOf('-- ── 4. settle_progression');
  return src.slice(from, to) + '\n' + src.slice(beatFrom, beatTo);
})();
const SECRET = 'test-writer-secret-not-real';
const u = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ANN = u(1);
const BOB = u(2);
const CAT = u(3);
const GAME = 'run-abc-123';
const MATCH = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

let db: PGlite;

async function as<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${who ?? ''}', false); set role ${who ? 'authenticated' : 'anon'};`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally { await db.exec('reset role'); }
}
async function err(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return (e as Error).message; }
  return 'did not fail';
}
const cfRow = (key: string | null, game: string, row: unknown) =>
  as<{ v: Record<string, unknown> }>(null, 'select public.lobby_live_cf($1, $2, $3::jsonb) as v', [key, game, row == null ? null : JSON.stringify(row)]);
const row = (over: Record<string, unknown> = {}) => ({ game: GAME, user: ANN, name: 'Ann', hero: 'hero_x', cosmetics: null, round: 3, phase: 'shop', mode: null, spectators: 1, host: 'cf:abc123', ...over });
const listed = async (game = GAME): Promise<Record<string, unknown>[]> => as(null, `select * from public.lobby_live_games where game_id = '${game}'`);
const beat = (key: string | null, beats: unknown) =>
  as<{ v: Record<string, unknown> }>(null, 'select public.spectate_cf_beat($1, $2::jsonb) as v', [key, JSON.stringify(beats)]);
const lobbyBeat = (user: string, over: Record<string, unknown> = {}) => ({ user, kind: 'lobby', target: GAME, watched_user: ANN, started_at: '2026-10-29T10:00:00Z', ended: false, ...over });
const session = async (user: string, run: string): Promise<Record<string, any> | undefined> =>
  (await db.query<Record<string, any>>('select * from public.spectate_sessions where user_id = $1 and run_id = $2', [user, run])).rows[0];
/** Move a user's last beat back in time (PGlite's now() is the transaction's: time is simulated by ageing the presence). */
const age = (user: string, seconds: number) => db.query(`update public.spectate_presence set at = now() - ($2 || ' seconds')::interval where user_id = $1`, [user, String(seconds)]);

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(STUB);
  await db.exec(FILES.map(mig).join('\n'));
  await db.exec(SPECTATE_TABLES);
  await db.exec(NEW);
  await db.exec(NEW);
  await db.query('insert into public.versus_cf_writer_keys (key_hash, note) values ($1, $2)', [createHash('sha256').update(SECRET).digest('hex'), 'test']);
  for (const [id, name, div] of [[ANN, 'Ann', 7], [BOB, 'Bob', 2], [CAT, 'Cat', 1]] as const) {
    await db.query('insert into auth.users (id) values ($1)', [id]);
    await db.query('insert into public.profiles (user_id, author, rank_division, rank_points, rating) values ($1, $2, $3, 40, 1500)', [id, name, div]);
  }
}, 120_000);
afterAll(async () => { await db?.close(); });

describe('the switch', () => {
  it('has lobby_live, on Supabase until the owner flips it', async () => {
    const [r] = await as<{ v: Record<string, string> }>(null, 'select public.versus_host_config() as v');
    expect(r!.v).toMatchObject({ lobby_live: 'supabase', duel: 'supabase' });
  });
});

describe('lobby_live_cf: a live lobby game\'s row from the Worker', () => {
  it('refuses without the writer key', async () => {
    expect(await err(cfRow(null, GAME, row()))).toContain('not_authorized');
    expect(await err(cfRow('wrong', GAME, row()))).toContain('not_authorized');
    expect(await listed()).toHaveLength(0);
  });

  it('lists the game with its host, the rank from SQL, visible past the 60 s rule (4 minutes)', async () => {
    await cfRow(SECRET, GAME, row({ mode: 'practice' }));
    const [g] = await listed();
    expect(g).toMatchObject({ user_id: ANN, display_name: 'Ann', hero_id: 'hero_x', round: 3, phase: 'shop', division_index: 7, live_host: 'cf:abc123', mode: 'practice' });
    await db.query(`update public.lobby_live_games set last_seen_at = now() - interval '3 minutes' where game_id = '${GAME}'`);
    expect(await listed()).toHaveLength(1);
    await cfRow(SECRET, GAME, row({ round: 4, phase: 'combat' }));
    expect((await listed())[0]).toMatchObject({ round: 4, phase: 'combat', mode: null });
  });

  it('never takes another account\'s game, and refuses a bad phase / host', async () => {
    expect(await err(cfRow(SECRET, GAME, row({ user: BOB })))).toContain('not_owner');
    expect(await err(cfRow(SECRET, GAME, row({ phase: 'end' })))).toContain('bad_phase');
    expect(await err(cfRow(SECRET, GAME, row({ host: 'https://evil' })))).toContain('bad_row');
    expect((await listed())[0]).toMatchObject({ user_id: ANN });
  });

  it('the Supabase watch refuses it (an older client would wait on a channel nobody publishes to)', async () => {
    expect(await err(as(BOB, `select public.lobby_live_watch_as($1, 'Bob', '{}'::jsonb)`, [GAME]))).toContain('other_host');
    expect(await err(as(BOB, `select public.lobby_live_watch($1)`, [GAME]))).toContain('other_host');
  });

  it('the heartbeat takes the row back to Supabase (a fallback mid-game); removal then leaves it alone', async () => {
    await as(ANN, `select public.lobby_live_heartbeat($1, 'Ann', 'hero_x', null, 5, 'shop', null)`, [GAME]);
    expect((await listed())[0]).toMatchObject({ live_host: null, live_until: null, round: 5 });
    await cfRow(SECRET, GAME, null);
    expect(await listed()).toHaveLength(1); // a Supabase-hosted row is never removed by the Worker
    await cfRow(SECRET, GAME, row({ round: 6 }));
    expect((await listed())[0]).toMatchObject({ live_host: 'cf:abc123', round: 6 });
    await cfRow(SECRET, GAME, null);
    expect(await listed()).toHaveLength(0);
  });
});

describe('spectate_cf_beat: the watch record for a Cloudflare watch', () => {
  const RUN = `watch:lobby:${GAME}`;

  it('refuses without the writer key', async () => {
    expect(await err(beat(null, [lobbyBeat(BOB)]))).toContain('not_authorized');
    expect(await session(BOB, RUN)).toBeUndefined();
  });

  it('accrues exactly as spectate_beat: only between beats <= 45 s apart on the same game', async () => {
    await beat(SECRET, [lobbyBeat(BOB)]);
    expect(await session(BOB, RUN)).toMatchObject({ watched_ms: 0, kind: 'lobby', watched_user: ANN });
    await age(BOB, 30);
    await beat(SECRET, [lobbyBeat(BOB)]);
    const s1 = Number((await session(BOB, RUN))!.watched_ms);
    expect(s1).toBeGreaterThanOrEqual(29_900);
    expect(s1).toBeLessThanOrEqual(30_100);
    // A gap past 45 s (the socket dropped and came back late) accrues nothing for the gap.
    await age(BOB, 50);
    await beat(SECRET, [lobbyBeat(BOB)]);
    expect(Number((await session(BOB, RUN))!.watched_ms)).toBe(s1);
  });

  it('one game at a time, across both writers: a beat elsewhere moves the presence, so the next one here accrues nothing', async () => {
    const before = Number((await session(BOB, RUN))!.watched_ms);
    await age(BOB, 10);
    await beat(SECRET, [{ user: BOB, kind: 'versus', target: MATCH, watched_user: null, started_at: null, ended: false }]);
    await age(BOB, 10);
    await beat(SECRET, [lobbyBeat(BOB)]);
    expect(Number((await session(BOB, RUN))!.watched_ms)).toBe(before);
    expect(await session(BOB, `watch:versus:${MATCH}`)).toMatchObject({ kind: 'versus', watched_user: null });
  });

  it('stamps a lobby game\'s end; never records the player as their own spectator; skips a bad beat, not the batch', async () => {
    const [r] = await beat(SECRET, [lobbyBeat(BOB, { ended: true }), lobbyBeat(ANN), { user: 'nope', kind: 'lobby', target: GAME }, { user: CAT, kind: 'bogus', target: GAME }, lobbyBeat(CAT)]);
    expect(r!.v).toMatchObject({ ok: true, recorded: 2 });
    expect((await session(BOB, RUN))!.saw_end_at).not.toBeNull();
    expect(await session(ANN, RUN)).toBeUndefined();
    expect(await session(CAT, RUN)).toMatchObject({ watched_user: ANN });
    expect((await session(CAT, RUN))!.game_started_at).not.toBeNull();
  });
});
