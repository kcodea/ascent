/**
 * THE LIVE DIRECTORY's rules in plain Node (R-LIVE-DIR-01): what the SQL listing did, now on the hub. Cross-revision
 * registration (two content revisions' games in one list), the rank order, the one-game-per-player rule, the 4-minute
 * listing window, friends-only rooms (host + the host's friends only), the glow count, the Ranked Duos team name and
 * medal, and the Versus Worker's row mapping (rooms and lobby games) with both writers (hub + Supabase) in the cutover.
 */
import { describe, expect, it } from 'vitest';
import { cleanPut, compareRows, LiveDirCore, LiveDirError } from '../src/core/liveDirCore';
import { LIVE_DIR_PAGE, LIVE_DIR_TTL_MS, type LiveDirPut } from '../src/liveDirProtocol';
import { HubLobbySink, HubRoomSink, lobbyDirPut, roomDirPut, roomGameIds, TeeLiveSink, type LiveDirBinding } from '../src/liveDirSink';
import { isRetired, LocalLiveSink } from '../src/live';
import type { LiveListing } from '../src/core/liveListing';
import type { LobbyListing } from '../src/core/liveCore';

const ANN = '00000000-0000-4000-8000-000000000001';
const BOB = '00000000-0000-4000-8000-000000000002';
const CAT = '00000000-0000-4000-8000-000000000003';
const DAN = '00000000-0000-4000-8000-000000000004';
const TEAM = '00000000-0000-4000-8000-0000000000aa';
const ROOM = '11111111-1111-4111-8111-111111111111';

const lobby = (user: string, game: string, rev: string, over: Partial<LiveDirPut> = {}): LiveDirPut => cleanPut({
  game_id: game, user_id: user, display_name: 'P', hero_id: 'warden', cosmetics: null, round: 3, phase: 'shop', spectators: 0,
  mode: null, players: null, live_host: `cf:${rev}`, status: null, private_host: null, team: null, ...over,
});
const rank = (division: number, points: number, rating: number) => ({ division, points, rating });

describe('registration (R-LIVE-DIR-01)', () => {
  it('two content revisions register into ONE list (the directory is version-independent)', () => {
    const d = new LiveDirCore();
    d.put(lobby(ANN, 'lobby:a', 'rev-old'), rank(2, 10, 1500), 0);
    d.put(lobby(BOB, 'lobby:b', 'rev-new'), rank(3, 0, 1400), 0);
    const rows = d.list({ userId: null }, 0, 1);
    expect(rows.map((r) => [r.game_id, r.live_host])).toEqual([['lobby:b', 'cf:rev-new'], ['lobby:a', 'cf:rev-old']]);
  });

  it('cleans and clamps like the SQL writer; refuses a bad id, phase, mode or host', () => {
    const p = lobby(ANN, 'g', 'r', { display_name: 'x'.repeat(80), round: 999, spectators: -3 });
    expect([p.display_name.length, p.round, p.spectators]).toEqual([40, 200, 0]);
    const code = (f: () => unknown) => { try { f(); return 'ok'; } catch (e) { return (e as LiveDirError).code; } };
    expect(code(() => lobby(ANN, 'has space', 'r'))).toBe('bad_game');
    expect(code(() => lobby(ANN, 'g', 'r', { phase: 'end' as never }))).toBe('bad_phase');
    expect(code(() => lobby(ANN, 'g', 'r', { mode: 'chess' as never }))).toBe('bad_mode');
    expect(code(() => cleanPut({ ...lobby(ANN, 'g', 'r'), live_host: 'https://evil' }))).toBe('bad_row');
    expect(code(() => cleanPut({ ...lobby(ANN, 'g', 'r'), user_id: 'nope' }))).toBe('bad_row');
  });

  it('one live game per player: a new game of mine replaces my old row; a room that changes mode replaces its other id', () => {
    const d = new LiveDirCore();
    d.put(lobby(ANN, 'lobby:1', 'r'), null, 0);
    expect(d.put(lobby(ANN, 'lobby:2', 'r'), null, 10)).toEqual(['lobby:1']);
    expect([...d.entries.keys()]).toEqual(['lobby:2']);
    const [versus, duos] = roomGameIds(ROOM);
    d.put(cleanPut({ ...lobby(BOB, versus, 'r'), live_host: null, mode: 'group' }), null, 0);
    d.put(cleanPut({ ...lobby(CAT, duos, 'r'), live_host: null, mode: 'ranked_duos', team: TEAM, replaces: [versus] }), null, 0);
    expect(d.game(versus, { userId: null }, 1)).toBeNull();
    expect(d.game(duos, { userId: null }, 1)).not.toBeNull();
  });

  it('a row is listed 4 minutes past its last write (the writers keep it alive every 2); a removal takes it at once', () => {
    const d = new LiveDirCore();
    d.put(lobby(ANN, 'g', 'r'), null, 0);
    expect(d.count({ userId: null }, LIVE_DIR_TTL_MS - 1)).toBe(1);
    expect(d.count({ userId: null }, LIVE_DIR_TTL_MS)).toBe(0);
    d.put(lobby(ANN, 'g', 'r'), null, 120_000);
    expect(d.count({ userId: null }, LIVE_DIR_TTL_MS + 1)).toBe(1);
    expect(d.nextExpiry()).toBe(120_000 + LIVE_DIR_TTL_MS);
    expect(d.purge(120_000 + LIVE_DIR_TTL_MS)).toEqual(['g']);
    d.put(lobby(ANN, 'g', 'r'), null, 0);
    expect(d.remove('g')).toBe(true);
    expect(d.count({ userId: null }, 1)).toBe(0);
  });

  it('keeps the first start time across refreshes', () => {
    const d = new LiveDirCore();
    d.put(lobby(ANN, 'g', 'r'), null, 1_000);
    d.put(lobby(ANN, 'g', 'r', { round: 4 }), null, 60_000);
    expect(d.game('g', { userId: null }, 61_000)).toMatchObject({ round: 4, started_at: new Date(1_000).toISOString() });
  });
});

describe('the order and the page (the SQL .order chain)', () => {
  it('division, then points, then rating, best first; a page is LIVE_DIR_PAGE rows', () => {
    const d = new LiveDirCore();
    const ids = Array.from({ length: LIVE_DIR_PAGE + 5 }, (_, i) => `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`);
    ids.forEach((u, i) => d.put(lobby(u, `g${i}`, 'r'), rank(i % 4, i, 1000 + i), 0));
    const p0 = d.list({ userId: null }, 0, 1);
    const p1 = d.list({ userId: null }, 1, 1);
    expect(p0).toHaveLength(LIVE_DIR_PAGE);
    expect(p1).toHaveLength(5);
    const all = [...p0, ...p1];
    for (let i = 1; i < all.length; i++) expect(compareRows(all[i - 1]!, all[i]!)).toBeLessThanOrEqual(0);
    expect(all[0]!.division_index).toBe(3);
  });

  it('the looked-up rank wins over a writer\'s own (a lobby game\'s self-report is only the fallback)', () => {
    const d = new LiveDirCore();
    d.put(lobby(ANN, 'g', 'r', { division_index: 9, rank_points: 999, rating: 9999 }), rank(1, 5, 1200), 0);
    expect(d.game('g', { userId: null }, 1)).toMatchObject({ division_index: 1, rank_points: 5, rating: 1200 });
    d.put(lobby(BOB, 'h', 'r', { division_index: 2, rank_points: 7, rating: 1300 }), null, 0);
    expect(d.game('h', { userId: null }, 1)).toMatchObject({ division_index: 2, rank_points: 7, rating: 1300 });
  });

  it('Ranked Duos: the team\'s name and medal; rating = 100 x division + points (as the SQL); no team name falls back to the players', () => {
    const d = new LiveDirCore();
    const duo = (team: string | null) => cleanPut({ ...lobby(ANN, 'duos:cf:x', 'r'), live_host: null, mode: 'ranked_duos', team, players: 'Ann & Bob', display_name: 'Ann & Bob' });
    d.put(duo(TEAM), { division: 4, points: 30, rating: 0, name: 'The Hammers' }, 0);
    expect(d.game('duos:cf:x', { userId: null }, 1)).toMatchObject({ display_name: 'The Hammers', division_index: 4, rank_points: 30, rating: 430 });
    d.put(duo(null), null, 0);
    expect(d.game('duos:cf:x', { userId: null }, 1)).toMatchObject({ display_name: 'Ann & Bob', rating: 0 });
  });
});

describe('friends-only rooms (the read policy, lobby_live__may_see)', () => {
  const setup = (): LiveDirCore => {
    const d = new LiveDirCore();
    d.put(cleanPut({ ...lobby(ANN, 'versus:cf:p', 'r'), live_host: null, mode: 'duel', private_host: ANN }), null, 0);
    d.put(lobby(CAT, 'lobby:pub', 'r'), null, 0);
    return d;
  };

  it('listed to its host and the host\'s friends only; never to a guest or a stranger', () => {
    const d = setup();
    const ids = (r: { userId: string | null; friends?: Set<string> | null }) => d.list(r, 0, 1).map((x) => x.game_id).sort();
    expect(ids({ userId: ANN })).toEqual(['lobby:pub', 'versus:cf:p']);
    expect(ids({ userId: BOB, friends: new Set([ANN]) })).toEqual(['lobby:pub', 'versus:cf:p']);
    expect(ids({ userId: DAN, friends: new Set([CAT]) })).toEqual(['lobby:pub']);
    expect(ids({ userId: null })).toEqual(['lobby:pub']);
    expect(d.game('versus:cf:p', { userId: DAN, friends: new Set() }, 1)).toBeNull();
    expect(d.game('versus:cf:p', { userId: BOB, friends: new Set([ANN]) }, 1)).not.toBeNull();
  });

  it('the friends are asked for only when such a row is listed and the reader is not its host', () => {
    const d = setup();
    expect(d.needsFriends(null, 1)).toBe(false);
    expect(d.needsFriends(ANN, 1)).toBe(false);
    expect(d.needsFriends(BOB, 1)).toBe(true);
    d.remove('versus:cf:p');
    expect(d.needsFriends(BOB, 1)).toBe(false);
  });

  it('a Ranked Duos row is never private (a friends-only party is not listed at all)', () => {
    const d = new LiveDirCore();
    d.put(cleanPut({ ...lobby(ANN, 'duos:cf:q', 'r'), live_host: null, mode: 'ranked_duos', private_host: ANN }), null, 0);
    expect(d.list({ userId: null }, 0, 1)).toHaveLength(1);
  });
});

describe('the Versus Worker writes rooms and lobby games (both writers in the cutover)', () => {
  const fakeDir = () => {
    const calls: { op: string; arg: unknown }[] = [];
    const dir: LiveDirBinding = { put: async (r) => { calls.push({ op: 'put', arg: r }); }, remove: async (ids) => { calls.push({ op: 'remove', arg: ids }); } };
    return { dir, calls };
  };
  const room: LiveListing = { room: ROOM, mode: 'group', p1: ANN, team: null, players: 'Ann vs Bob vs Cat', hero: 'warden', round: 2, phase: 'combat', spectators: 3, private_host: ANN };

  it('a room: `versus:cf:<id>` named after its first player, replacing its duos id; a Ranked Duos room carries its team', () => {
    expect(roomDirPut(room)).toMatchObject({ game_id: `versus:cf:${ROOM}`, user_id: ANN, display_name: 'Ann', mode: 'group', private_host: ANN, replaces: [`duos:cf:${ROOM}`], live_host: null });
    const duo = roomDirPut({ ...room, mode: 'ranked_duos', team: TEAM, players: 'Ann & Bob', private_host: null, team_name: 'Hammers', division: 3 });
    expect(duo).toMatchObject({ game_id: `duos:cf:${ROOM}`, team: TEAM, display_name: 'Hammers', division_index: 3, private_host: null, replaces: [`versus:cf:${ROOM}`] });
    expect(() => cleanPut(roomDirPut(room))).not.toThrow();
  });

  it('a lobby game: its own id and host, its start and its reported rank as the fallback', () => {
    const l: LobbyListing = { game: 'lobby:abc', user: BOB, name: 'Bob', hero: 'warden', cosmetics: null, round: 5, phase: 'shop', mode: 'practice', spectators: 1, host: 'cf:rev1', status: { v: 1 }, started_at: new Date(5).toISOString(), division: 2, points: 3, rating: 1100 };
    expect(lobbyDirPut(l)).toMatchObject({ game_id: 'lobby:abc', user_id: BOB, live_host: 'cf:rev1', mode: 'practice', division_index: 2, rank_points: 3, rating: 1100, started_at: new Date(5).toISOString() });
    expect(() => cleanPut(lobbyDirPut(l))).not.toThrow();
  });

  it('removals: a room clears both its ids, a lobby game its own', async () => {
    const { dir, calls } = fakeDir();
    await new HubRoomSink(dir).write(ROOM, null);
    await new HubLobbySink(dir).write('lobby:abc', null);
    expect(calls).toEqual([{ op: 'remove', arg: [`versus:cf:${ROOM}`, `duos:cf:${ROOM}`] }, { op: 'remove', arg: ['lobby:abc'] }]);
  });

  it('the tee writes both; either failing fails the write, and the retry goes only to the writer that failed', async () => {
    const { dir, calls } = fakeDir();
    const local = new LocalLiveSink<LiveListing>();
    const tee = new TeeLiveSink(local, new HubRoomSink(dir));
    await tee.write(ROOM, room);
    expect(local.written).toHaveLength(1);
    expect(calls[0]!.op).toBe('put');
    expect(tee.written).toBe(local.written);
    const broken = new TeeLiveSink(local, new HubRoomSink({ put: async () => { throw new Error('down'); }, remove: async () => undefined }));
    await expect(broken.write(ROOM, room)).rejects.toThrow('down');
    expect(local.written).toHaveLength(2);
    await expect(broken.write(ROOM, room)).rejects.toThrow('down');
    expect(local.written).toHaveLength(2); // the Supabase half already holds this row
    await broken.write(ROOM, { ...room, round: 3 }).catch(() => undefined);
    expect(local.written).toHaveLength(3); // a new row goes to both again
  });

  it('a retired Supabase writer is recognised by its answer', () => {
    expect(isRetired('{"ok":true,"retired":true}')).toBe(true);
    expect(isRetired('{"ok":true}')).toBe(false);
    expect(isRetired('not json')).toBe(false);
  });
});
