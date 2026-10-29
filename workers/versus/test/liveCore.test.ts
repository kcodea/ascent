/**
 * LIVE GAMES ON CLOUDFLARE (R-LIVE-CF-01) and SPECTATOR XP FOR EVERY CLOUDFLARE WATCH (R-LIVE-CF-XP-01): the rules on a
 * fake clock (root vitest, no workerd; the round trip is `test/it/live.it.ts`).
 *
 *  - A live game is owned by its first publisher; a watcher is never its player; the stands hold 20 (a reconnect never
 *    counts twice); the end stands once; the player gone past the grace ends it as abandoned; an idle object forgets
 *    itself; the watch screen's row has the Supabase listing's shape.
 *  - The watch record: an object's beats never leave a gap the server would drop (<= 45 s), so the time the record
 *    accrues equals the time watched, for an arrival, a long watch, a departure and a game's end.
 *  - A Versus room's stands: only spectators with a socket open, on the room's current match, and never past 45 s
 *    after it completed.
 */
import { describe, expect, it } from 'vitest';
import { cleanInfo, LiveCore, lobbyListingKey, newLiveMeta } from '../src/core/liveCore';
import { LIVE_IDLE_MS, LIVE_PUBLISHER_GRACE_MS, LIVE_WATCHER_CAP } from '../src/liveProtocol';
import { accruedMs, SPECTATE_GAP_MS, SPECTATE_REPORT_MS, WatchReporter, type WatchBeat } from '../src/spectate';
import { roomWatchKey, roomWatchOf } from '../src/core/roomWatch';
import { newRoomState, type CoreState } from '../src/core/roomCore';
import { takeToken, RATE, FLOOD_CLOSE_AFTER } from '../src/rate';
import { engineContentRevision, VERSUS_PROTOCOL } from '@game/sim/versus/server';

const T0 = Date.UTC(2026, 9, 29, 12, 0, 0);
const P = '11111111-1111-4111-8111-111111111111';
const W = (n: number): string => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
const info = { name: 'Ann', hero: 'warden', round: 2, phase: 'shop', mode: 'ranked' };

const fresh = (): LiveCore => new LiveCore(newLiveMeta('run-1', 'rev1', T0));
const codeOf = (fn: () => unknown): string => { try { fn(); } catch (e) { return (e as { code: string }).code; } return 'ok'; };

describe('a live game (R-LIVE-CF-01)', () => {
  it('is owned by its first publisher; nobody else may publish, list or end it', () => {
    const c = fresh();
    expect(codeOf(() => c.watch(W(1), 'x', null, T0))).toBe('no_game'); // nothing listed yet
    c.publish(P, T0 + 5);
    expect(c.meta.owner).toBe(P);
    expect(c.meta.startedAt).toBe(T0 + 5);
    expect(codeOf(() => c.publish(W(1), T0))).toBe('not_owner');
    expect(codeOf(() => c.listing(W(1), info, T0))).toBe('not_owner');
    expect(codeOf(() => c.end(W(1), 1, T0))).toBe('not_owner');
    c.listing(P, info, T0);
    expect(c.row()).toMatchObject({ game_id: 'run-1', display_name: 'Ann', phase: 'shop', round: 2, mode: null, live_host: 'cf:rev1', placement: null });
  });

  it('a watcher is never the player; the stands hold 20 and a reconnect never counts twice', () => {
    const c = fresh();
    c.publish(P, T0);
    c.listing(P, info, T0);
    expect(codeOf(() => c.watch(P, 'me', null, T0))).toBe('own_game');
    for (let i = 0; i < LIVE_WATCHER_CAP; i++) c.watch(W(i), `w${i}`, { avatar: 'a' }, T0);
    expect(codeOf(() => c.watch(W(99), 'late', null, T0))).toBe('spectators_full');
    expect(codeOf(() => c.watch(W(3), 'again', null, T0))).toBe('ok');
    expect(c.watcherList()).toHaveLength(LIVE_WATCHER_CAP);
    expect(c.gone(W(3), T0)).toBe('watch');
    expect(codeOf(() => c.watch(W(99), 'late', null, T0))).toBe('ok');
  });

  it('the end stands once (a placement, or abandoned); a finished game takes no watcher, listing or publish', () => {
    const c = fresh();
    c.publish(P, T0);
    c.listing(P, info, T0);
    expect(c.end(P, 3, T0 + 1)).toBe(true);
    expect(c.end(P, 1, T0 + 2)).toBe(false);
    expect(c.meta.end).toMatchObject({ placement: 3, abandoned: false });
    expect(c.row()).toMatchObject({ phase: 'end', placement: 3 });
    expect(c.listingRow()).toBeNull(); // the Live Games row is removed
    expect(codeOf(() => c.watch(W(1), 'x', null, T0))).toBe('no_game');
    expect(codeOf(() => c.listing(P, info, T0))).toBe('game_ended');
    expect(codeOf(() => c.publish(P, T0))).toBe('game_ended');
  });

  it('the player gone past the grace ends it as abandoned; a reload inside the grace resumes', () => {
    const c = fresh();
    c.publish(P, T0);
    c.listing(P, info, T0);
    expect(c.gone(P, T0)).toBe('publish');
    expect(c.nextAt(0)).toBe(T0 + LIVE_PUBLISHER_GRACE_MS);
    expect(c.publisherExpired(T0 + LIVE_PUBLISHER_GRACE_MS - 1)).toBe(false);
    c.publish(P, T0 + 10_000); // the reload
    expect(c.publisherExpired(T0 + LIVE_PUBLISHER_GRACE_MS * 2)).toBe(false);
    c.gone(P, T0 + 20_000);
    expect(c.publisherExpired(T0 + 20_000 + LIVE_PUBLISHER_GRACE_MS)).toBe(true);
    expect(c.end(null, null, T0)).toBe(true);
    expect(c.meta.end).toMatchObject({ placement: null, abandoned: true });
  });

  it('forgets itself when nobody is here (idle), at once when ended, never while a row write is owed', () => {
    const c = fresh();
    expect(c.idle(T0 + LIVE_IDLE_MS - 1, 0, false)).toBe(false);
    expect(c.idle(T0 + LIVE_IDLE_MS, 0, false)).toBe(true);
    expect(c.idle(T0 + LIVE_IDLE_MS, 1, false)).toBe(false);
    c.publish(P, T0);
    c.end(P, 2, T0);
    expect(c.idle(T0, 0, true)).toBe(false);
    expect(c.idle(T0, 0, false)).toBe(true);
  });

  it('cleans a publisher\'s listing; the row key ignores the stands', () => {
    expect(cleanInfo({ name: '  ', hero: '', round: 999, phase: 'nope', mode: 'x', cosmetics: [1] })).toMatchObject({ name: 'Player', hero: 'warden', round: 200, phase: 'shop', mode: 'ranked', cosmetics: null });
    const c = fresh();
    c.publish(P, T0);
    c.listing(P, { ...info, mode: 'practice' }, T0);
    const k = lobbyListingKey(c.listingRow());
    c.watch(W(1), 'w', null, T0);
    expect(lobbyListingKey(c.listingRow())).toBe(k);
    expect(c.listingRow()).toMatchObject({ mode: 'practice', spectators: 1, user: P, host: 'cf:rev1' });
  });

  it('passes the game at a glance through to the row and the watchers (R-LIVE-STATUS-01); a new status is a write', () => {
    const status = { v: 1, mode: 'ranked', round: 2, phase: 'shop', health: 30, armor: 5, tier: 3, place: { rank: 1, left: 8 } };
    expect(cleanInfo({ ...info, status }).status).toEqual(status);
    expect(cleanInfo({ ...info, status: [1] }).status).toBeNull();
    expect(cleanInfo({ ...info, status: { pad: 'x'.repeat(2000) } }).status).toBeNull(); // the SQL column's 1 KB bound
    expect(cleanInfo(info).status).toBeNull(); // an older client
    const c = fresh();
    c.publish(P, T0);
    c.listing(P, { ...info, status }, T0);
    expect(c.listingRow()?.status).toEqual(status);
    expect(c.row()?.status).toEqual(status);
    const k = lobbyListingKey(c.listingRow());
    c.listing(P, { ...info, status: { ...status, health: 24 } }, T0);
    expect(lobbyListingKey(c.listingRow())).not.toBe(k);
  });
});

describe('the watch record from an object (R-LIVE-CF-XP-01)', () => {
  /** Drive a reporter the way an object does (its alarm fires when `nextAt` says), recording each sent beat's time. */
  function simulate(events: { at: number; join?: string; leave?: string; end?: boolean }[], until: number): Map<string, { at: number; target: string }[]> {
    const r = new WatchReporter();
    const here = new Set<string>();
    const sent = new Map<string, { at: number; target: string }[]>();
    const beatOf = (u: string): WatchBeat => ({ user: u, kind: 'lobby', target: 'g', watched_user: P, started_at: null, ended: false });
    const queue = [...events].sort((a, b) => a.at - b.at);
    let now = T0;
    while (now <= until) {
      while (queue.length && queue[0]!.at <= now) {
        const e = queue.shift()!;
        if (e.join) { here.add(e.join); r.poke(e.at); }
        if (e.leave) { here.delete(e.leave); r.left(beatOf(e.leave), e.at); }
      }
      if (r.due(now, here.size > 0)) for (const b of r.take(now, [...here].map(beatOf))) sent.set(b.user, [...(sent.get(b.user) ?? []), { at: now, target: b.target }]);
      const next = Math.min(r.nextAt(here.size > 0) ?? Infinity, queue[0]?.at ?? Infinity);
      now = Number.isFinite(next) ? Math.max(now + 1, next) : until + 1;
    }
    return sent;
  }

  it('never leaves a gap the server drops: a watched span accrues in full (within the arrival beat\'s second)', () => {
    const sent = simulate([{ at: T0, join: W(1) }, { at: T0 + 7 * 60_000 + 1234, leave: W(1) }], T0 + 10 * 60_000);
    const beats = sent.get(W(1))!;
    for (let i = 1; i < beats.length; i++) expect(beats[i]!.at - beats[i - 1]!.at).toBeLessThanOrEqual(SPECTATE_GAP_MS);
    const ms = accruedMs(beats).get('g')!;
    expect(ms).toBeGreaterThanOrEqual(7 * 60_000 + 1234 - 1000);
    expect(ms).toBeLessThanOrEqual(7 * 60_000 + 1234);
    // One call per regular period for every watcher, not one per 10 s per watcher (the client beat).
    expect(beats.length).toBeLessThanOrEqual(Math.ceil((7 * 60_000) / SPECTATE_REPORT_MS) + 3);
  });

  it('a departure beats once more (its time counts) and then nothing; a return starts again', () => {
    const sent = simulate([{ at: T0, join: W(1) }, { at: T0 + 40_000, leave: W(1) }, { at: T0 + 200_000, join: W(1) }, { at: T0 + 260_000, leave: W(1) }], T0 + 400_000);
    const beats = sent.get(W(1))!;
    expect(beats.filter((b) => b.at > T0 + 42_000 && b.at < T0 + 200_000)).toHaveLength(0);
    const ms = accruedMs(beats).get('g')!;
    expect(ms).toBeGreaterThanOrEqual(100_000 - 2000);
    expect(ms).toBeLessThanOrEqual(100_000);
  });

  it('several watchers share one call', () => {
    const r = new WatchReporter();
    r.poke(T0);
    const b = (u: string): WatchBeat => ({ user: u, kind: 'versus', target: 'm', watched_user: null, started_at: null, ended: false });
    expect(r.due(T0 + 1000, true)).toBe(true);
    expect(r.take(T0 + 1000, [b(W(1)), b(W(2)), b(W(3))])).toHaveLength(3);
    expect(r.nextAt(true)).toBe(T0 + 1000 + SPECTATE_REPORT_MS);
    expect(r.nextAt(false)).toBeNull();
  });
});

describe('a Versus room\'s stands (R-LIVE-CF-XP-01)', () => {
  const ROOM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const MATCH = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  function state(phase: string, completedAt: number | null = null): CoreState {
    const s = newRoomState({ id: ROOM, name: 'R', hostUserId: P, displayName: 'Ann', profile: {}, setId: 'set1', contentRevision: engineContentRevision(), protocol: VERSUS_PROTOCOL }, T0);
    s.room.members.push({ userId: W(1), role: 'p2', displayName: 'Bob', profile: {}, joinedAt: T0, disconnectedAt: null });
    s.room.members.push({ userId: W(2), role: 'spectator', displayName: 'Cat', profile: {}, joinedAt: T0, disconnectedAt: null });
    s.room.members.push({ userId: W(3), role: 'spectator', displayName: 'Dan', profile: {}, joinedAt: T0, disconnectedAt: null });
    s.room.current_match_id = MATCH;
    s.match = { id: MATCH, phase, completed_at: completedAt } as never;
    return s;
  }

  it('beats spectators with a socket open on the current match, never a player', () => {
    const w = roomWatchOf(state('shop'), new Set([P, W(1), W(2)]), T0);
    expect(w.target).toBe(`versus:${MATCH}`);
    expect(w.beats.map((b) => b.user)).toEqual([W(2)]);
    expect(w.beats[0]).toMatchObject({ kind: 'versus', target: MATCH, ended: false, watched_user: null });
  });

  it('a finished match: beaten (ended) for 45 s after it completed, then not at all', () => {
    const s = state('complete', T0);
    const at = roomWatchOf(s, new Set([W(2)]), T0 + 1000);
    expect(at.beats[0]).toMatchObject({ ended: true });
    expect(roomWatchKey(at)).not.toBe(roomWatchKey(roomWatchOf(state('combat'), new Set([W(2)]), T0)));
    expect(roomWatchOf(s, new Set([W(2)]), T0 + SPECTATE_GAP_MS + 1).beats).toHaveLength(0);
  });

  it('no current match: nothing', () => {
    const s = state('shop');
    s.room.current_match_id = null;
    expect(roomWatchOf(s, new Set([W(2)]), T0)).toEqual({ target: null, beats: [] });
  });
});

describe('the shared rate limit', () => {
  it('bursts then refuses; a flood is flagged after 200 refusals; tokens refill over time', () => {
    let b = undefined as ReturnType<typeof takeToken>['bucket'] | undefined;
    let ok = 0;
    for (let i = 0; i < RATE.bc.burst + 10; i++) { const r = takeToken(b, 'bc', T0); b = r.bucket; if (r.ok) ok++; }
    expect(ok).toBe(RATE.bc.burst);
    let flood = false;
    for (let i = 0; i < FLOOD_CLOSE_AFTER; i++) flood = takeToken(b, 'bc', T0).flood;
    expect(flood).toBe(true);
    expect(takeToken(b, 'bc', T0 + 1000).ok).toBe(true);
  });
});
