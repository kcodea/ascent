// @vitest-environment jsdom
/**
 * VERSUS RELIABILITY, THROUGH THE REAL SESSION LOOP (`versusStore.ts`) over a fake network (every `versusRemote` call
 * spied) and fake timers. The pure rules are in `versusReliability.test.ts`; this pins that the session actually follows
 * them:
 *  R-VERSUS-RELIABLE-02  at 0:00 a client whose call did NOT close the round waits its backstop before asking the
 *                        resolver; the client whose call closed it asks at once; never two resolver calls in flight.
 *  R-VERSUS-RELIABLE-03  a tab that wakes from a freeze sends its heartbeat before any reconcile.
 *  R-VERSUS-RELIABLE-05  after three failed resolver calls in a row the End Turn pill's notice is up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'me' }));

const { versusRemote } = await import('./versusRemote');
const store = await import('./versusStore');
type Match = import('./versusRemote').VersusMatch;
type Room = import('./versusRemote').VersusRoom;

const T0 = Date.parse('2026-10-27T12:00:00Z');
const iso = (ms: number): string => new Date(ms).toISOString();

function matchOf(over: Partial<Match> = {}): Match {
  return {
    id: mid, room_id: 'r1', seed: 1, set_id: 'set2', content_revision: 'x', protocol: 1, phase: 'resolving', revision: 5, round: 2,
    p1_user: 'you', p2_user: 'me', p1_name: 'You', p2_name: 'Me', p1_hero: null, p2_hero: null, heroes_revealed: true,
    hero_deadline: null, shop_starts_at: null, shop_deadline: iso(T0 - 1000), combat_deadline: null,
    p1_locked: true, p2_locked: true, p1_ready: false, p2_ready: false, paused_seat: null, paused_at: null, pause_grace_until: null,
    p1_auto: false, p2_auto: false, p1_missed: 0, p2_missed: 0, winner_seat: null, end_reason: null, completed_at: null,
    ...over,
  } as Match;
}
/** A fresh match id per test: the session's per-round gates are module state, keyed by match. */
let mid = 'm0';
let n = 0;
const roomOf = (): Room => ({
  id: 'r1', name: 'Room', host_user_id: 'you', status: 'in_game', set_id: 'set2', content_revision: 'x', protocol: 1, revision: 1,
  gate_deadline: null, p1_gate: true, p2_gate: true, current_match_id: mid, serverNow: iso(T0),
  members: [{ userId: 'you', role: 'p1', displayName: 'You', profile: {}, lastSeenAt: iso(T0) }, { userId: 'me', role: 'p2', displayName: 'Me', profile: {}, lastSeenAt: iso(T0) }],
});

let answer: Match;
let calls: string[];
let finalize: ReturnType<typeof vi.fn>;
let heartbeat: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  calls = [];
  mid = `m${++n}`;
  answer = matchOf();
  const room = roomOf();
  vi.spyOn(versusRemote, 'subscribeRoom').mockImplementation(() => ({ send: () => undefined, close: () => Promise.resolve() }));
  vi.spyOn(versusRemote, 'joinRoom').mockImplementation(async () => ({ ...room, serverNow: iso(Date.now()) }));
  vi.spyOn(versusRemote, 'room').mockImplementation(async () => room);
  vi.spyOn(versusRemote, 'listRooms').mockImplementation(async () => []);
  vi.spyOn(versusRemote, 'leaveRoom').mockImplementation(async () => ({ left: true }));
  vi.spyOn(versusRemote, 'myPrivate').mockImplementation(async () => null as never);
  vi.spyOn(versusRemote, 'rounds').mockImplementation(async () => []);
  vi.spyOn(versusRemote, 'match').mockImplementation(async () => answer);
  heartbeat = vi.fn(async () => { calls.push('heartbeat'); return { serverNow: iso(Date.now()), match: answer }; });
  vi.spyOn(versusRemote, 'heartbeat').mockImplementation(heartbeat as never);
  vi.spyOn(versusRemote, 'reconcile').mockImplementation(async () => { calls.push('reconcile'); return answer; });
  finalize = vi.fn(async () => { calls.push('finalize'); });
  vi.spyOn(versusRemote, 'finalize').mockImplementation(finalize as never);
});
afterEach(async () => {
  await store.leaveRoom();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function enter(): Promise<void> {
  await store.joinRoom('r1', 'spectator');
  await vi.advanceTimersByTimeAsync(0);
}

describe('R-VERSUS-RELIABLE-02: the thundering resolver, through the session', () => {
  it('my reconcile answers `resolving` but another client closed the round: I wait my backstop, then ask once', async () => {
    answer = matchOf({ closed_by_me: false });
    await enter();
    expect(calls).toContain('reconcile');
    expect(finalize).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3500);
    expect(finalize, 'inside the 4 s backstop: still waiting').not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2500);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it('the server bumps `resolve_retry` for the closed round: I ask once more at once (no backstop wait)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // my backstop: about 5.5 s
    answer = matchOf({ closed_by_me: false, resolve_retry: 0 });
    await enter();
    await vi.advanceTimersByTimeAsync(1000);
    expect(finalize).not.toHaveBeenCalled();
    answer = matchOf({ closed_by_me: false, resolve_retry: 1, revision: 6 });
    await vi.advanceTimersByTimeAsync(3100); // the next heartbeat (4 s) carries the bump, well before my backstop
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it('my call closed the round: I ask at once', async () => {
    answer = matchOf({ closed_by_me: true });
    await enter();
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it('an older server (no flag): seat p1 asks at once, and I (p2) wait', async () => {
    answer = matchOf();
    await enter();
    expect(finalize).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6000);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it('never two resolver calls in flight: a hung call is never doubled', async () => {
    answer = matchOf({ closed_by_me: true });
    finalize.mockImplementation(() => new Promise(() => undefined)); // never answers (the real call is aborted at 20 s)
    await enter();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it('three failed resolver calls in a row put up the neutral notice; the round moving on takes it down', async () => {
    answer = matchOf({ closed_by_me: true });
    finalize.mockImplementation(async () => { throw new Error('boom'); });
    await enter();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(finalize.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(store.useVersus.getState().resolveSlow).toBe(`${mid}|2`);
    answer = matchOf({ phase: 'combat', revision: 6 });
    await vi.advanceTimersByTimeAsync(4100); // the next heartbeat brings the fight
    expect(store.useVersus.getState().resolveSlow).toBeNull();
  });
});

describe('R-VERSUS-RELIABLE-03: a waking tab never pauses the match on itself', () => {
  it('after a freeze the heartbeat goes first; no reconcile leaves until it answers', async () => {
    // A running shop whose deadline has passed: the tick wants to reconcile it.
    answer = matchOf({ phase: 'shop', revision: 3, round: 3, p1_locked: false, p2_locked: false, shop_deadline: iso(T0 - 5000) });
    await enter();
    await vi.advanceTimersByTimeAsync(600);
    // Frozen for a minute (a phone in a pocket): no timer ran, the clock moved on.
    let release: () => void = () => undefined;
    heartbeat.mockImplementation(() => { calls.push('heartbeat'); return new Promise((r) => { release = () => r({ serverNow: iso(Date.now()), match: answer }); }); });
    vi.setSystemTime(Date.now() + 60_000);
    calls = [];
    await vi.advanceTimersByTimeAsync(500); // the first tick after the freeze
    await vi.advanceTimersByTimeAsync(2000); // more ticks while the heartbeat is out
    expect(calls[0]).toBe('heartbeat');
    expect(calls).not.toContain('reconcile');
    release();
    await vi.advanceTimersByTimeAsync(600);
    expect(calls.indexOf('reconcile')).toBeGreaterThan(0);
  });

  it('coming back visible does the same (visibilitychange)', async () => {
    answer = matchOf({ phase: 'shop', revision: 3, round: 3, p1_locked: false, p2_locked: false, shop_deadline: iso(T0 - 5000) });
    await enter();
    let release: () => void = () => undefined;
    heartbeat.mockImplementation(() => { calls.push('heartbeat'); return new Promise((r) => { release = () => r({ serverNow: iso(Date.now()), match: answer }); }); });
    calls = [];
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1500);
    expect(calls).toEqual(['heartbeat']);
    release();
    await vi.advanceTimersByTimeAsync(600);
    expect(calls).toContain('reconcile');
  });
});
