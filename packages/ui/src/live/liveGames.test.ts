// @vitest-environment jsdom
/**
 * LIVE RANKED LOBBY GAMES (owner-approved 2026-10-15). Pinned against a fake network:
 *  - PRESENCE: a ranked lobby game is listed (heartbeat), followed on every round / phase change, ended with its
 *    placement, and removed on abandon; Practice, an unrated table, a sandbox or a replay is never listed.
 *  - PUBLISH ONLY WHEN WATCHED: with nobody watching no channel opens and nothing is sent; a watcher opens the channel
 *    and a keyframe goes out (carrying the fight while one plays).
 *  - THE VIEWER: joining mid-game lands on the player's current screen, view only (no action reaches the run), and the
 *    game's end shows the placement, then returns to the Live games list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLobbyRun, reduce, type RunState } from '@game/sim';
import type { LiveGameRow, LiveRemote } from './liveRemote';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const identity = await import('../identity');
const pubMod = await import('./livePublisher');
const watchMod = await import('./liveWatch');
const endMod = await import('./spectatorEnd');
const { useSpectate } = await import('../versus/spectate');
const { newPublisher, nextSpectatorMessage } = await import('../versus/spectatorView');

function fakeRemote(watchers: () => number) {
  const sent: { event: string; payload: any }[] = [];
  let onBroadcast: ((e: string, p: unknown) => void) | null = null;
  const r = {
    heartbeat: vi.fn(async () => watchers()),
    end: vi.fn(async () => undefined),
    publishFrame: vi.fn(async () => undefined),
    latestFrame: vi.fn(async () => null as unknown),
    watch: vi.fn(async (id: string) => row(id)),
    // With the watcher's identity (R-SPECTATE-WATCHERS-01): the same answer as `watch`, whatever it is set to.
    watchAs: vi.fn(async (id: string) => r.watch(id)),
    watchers: vi.fn(async () => [] as { user_id: string; display_name: string; profile: Record<string, unknown> | null }[] | null),
    unwatch: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    game: vi.fn(async () => null),
    channel: vi.fn((_: string, cb: (e: string, p: unknown) => void) => { onBroadcast = cb; return { channel: null as never, send: (event: string, payload: unknown) => sent.push({ event, payload }), close: vi.fn() }; }),
  };
  return { r: r as unknown as LiveRemote & typeof r, sent, push: (e: string, p: unknown) => onBroadcast?.(e, p) };
}
const row = (id: string, p: Partial<LiveGameRow> = {}): LiveGameRow => ({ game_id: id, display_name: 'Watched Wanda', hero_id: 'warden', cosmetics: null, division_index: 9, rank_points: 50, rating: 1600, round: 3, phase: 'shop', placement: null, spectators: 1, started_at: '', ...p });
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

const rankedRun = (): RunState => {
  const run = createLobbyRun(1234, 'warden');
  return { ...run, lobby: { ...run.lobby!, unrated: undefined, seats: run.lobby!.seats.map((s, i) => (i === 1 ? { ...s, kind: 'snapshot' } : s)) } } as RunState;
};

beforeEach(() => {
  // These cases pin the Supabase listing path, which a game still takes when its Worker cannot be reached (R-LIVE-CF-01);
  // the Worker path is `liveCf.test.ts`.
  pubMod.setLivePublishUrlForTests(() => null);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  identity.setIdentity({ userId: 'u-player', isAnonymous: true } as never);
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); identity.setIdentity(null); });

describe('the player side: presence and publishing', () => {
  it('lists a ranked lobby game, follows it, publishes only while watched, and ends with the placement', async () => {
    let watching = 0;
    const net = fakeRemote(() => watching);
    pubMod.setLiveRemoteForTests(net.r);
    const off = pubMod.installLivePublisher();
    const run = rankedRun();
    expect(pubMod.liveEligible(run, { replaying: false })).toBe(true); // recorded seats: a rated table
    useGame.setState({ run, replaying: false, showTitle: false, playerName: 'Wanda' });
    await flush();
    expect(net.r.heartbeat).toHaveBeenCalledTimes(1);
    expect(pubMod.liveState()?.publishing).toBe(false);
    expect(net.sent).toEqual([]); // nobody watching: the channel only listens, nothing is sent
    // a watcher arrives: the next heartbeat opens the channel and a keyframe goes out
    watching = 1;
    vi.advanceTimersByTime(pubMod.LIVE_HEARTBEAT_MS);
    await flush();
    expect(pubMod.liveState()?.publishing).toBe(true);
    useGame.setState({ run: reduce(useGame.getState().run, { type: 'freeze' }) });
    await vi.advanceTimersByTimeAsync(400);
    const spect = net.sent.filter((s) => s.event === 'spectate');
    expect(spect.length).toBeGreaterThan(0);
    expect(spect[0]!.payload.kind).toBe('key');
    expect(spect[0]!.payload.m).toBe(pubMod.liveState()!.gameId);
    // the game ends: the placement is reported, publishing stops
    const lobby = useGame.getState().run.lobby!;
    useGame.setState({ run: { ...useGame.getState().run, phase: 'gameover', lobby: { ...lobby, seats: lobby.seats.map((s) => (s.id === 's0' ? { ...s, placement: 3 } : s)) } } });
    await flush();
    expect(net.r.end).toHaveBeenCalledWith(expect.any(String), 3);
    expect(pubMod.liveState()).toBeNull();
    off();
  });

  it('a joining watcher is heard at once: its key request starts publishing without waiting for the heartbeat', async () => {
    let watching = 0;
    const net = fakeRemote(() => watching);
    pubMod.setLiveRemoteForTests(net.r);
    const off = pubMod.installLivePublisher();
    useGame.setState({ run: rankedRun(), replaying: false, showTitle: false });
    await flush();
    expect(pubMod.liveState()?.publishing).toBe(false);
    // a watcher joins (the watch RPC counted it) and asks for a keyframe on the game's channel
    watching = 1;
    net.push('spectate_key', {});
    await flush();
    expect(net.r.heartbeat).toHaveBeenCalledTimes(2); // the registration + the immediate answer, no 15 s wait
    expect(pubMod.liveState()?.publishing).toBe(true);
    off();
  });

  it('the stands: who watches is read on a join, dropped at once on a leave, and a fight keyframe carries the beat (R-SPECTATE-WATCHERS-01, R-SPECTATE-JOIN-01)', async () => {
    const { useWatchers } = await import('../versus/watchers');
    const tap = await import('../versus/spectateTap');
    let watching = 0;
    const net = fakeRemote(() => watching);
    net.r.watchers.mockImplementation(async () => (watching ? [{ user_id: 'w1', display_name: 'Claudebot2', profile: { avatar: 'a1' } }] : []));
    pubMod.setLiveRemoteForTests(net.r);
    const off = pubMod.installLivePublisher();
    useGame.setState({ run: rankedRun(), replaying: false, showTitle: false });
    await flush();
    expect(useWatchers.getState().list).toEqual([]);
    watching = 1;
    net.push('spectate_key', {});
    await flush();
    expect(useWatchers.getState().list).toEqual([{ id: 'w1', name: 'Claudebot2', profile: { avatar: 'a1' } }]);
    // in a fight: a requested keyframe carries where the fight is
    tap.notePlayerBeat(useGame.getState().run.wave, 6);
    useGame.setState({ run: { ...useGame.getState().run, phase: 'combat' } as RunState });
    net.push('spectate_key', {});
    await vi.advanceTimersByTimeAsync(400);
    const keys = net.sent.filter((m) => m.event === 'spectate' && m.payload.kind === 'key');
    expect(keys.at(-1)!.payload.cb).toEqual({ w: useGame.getState().run.wave, b: 6 });
    // the watcher leaves: its goodbye recounts at once (no 15 s heartbeat wait)
    watching = 0;
    net.push('spectate_bye', {});
    await flush();
    expect(useWatchers.getState().list).toEqual([]);
    off();
  });

  it('an older server (no watcher identities) shows a plain "Spectator" per watcher', async () => {
    const { useWatchers } = await import('../versus/watchers');
    const net = fakeRemote(() => 2);
    net.r.watchers.mockResolvedValue(null);
    pubMod.setLiveRemoteForTests(net.r);
    const off = pubMod.installLivePublisher();
    useGame.setState({ run: rankedRun(), replaying: false, showTitle: false });
    await flush();
    expect(useWatchers.getState().list.map((w) => w.name)).toEqual(['', '']);
    off();
  });

  it('lists Practice and casual games too (owner 2026-10-28: all games are live games); never a sandbox or a replay', () => {
    const run = rankedRun();
    expect(pubMod.liveEligible({ ...run, mode: 'practice' } as RunState, { replaying: false })).toBe(true);
    expect(pubMod.liveModeOf({ ...run, mode: 'practice' } as RunState)).toBe('practice');
    expect(pubMod.liveModeOf(run)).toBe('ranked');
    expect(pubMod.liveModeOf({ ...run, mode: 'tutorial' } as RunState)).toBeNull();
    expect(pubMod.liveModeOf({ ...run, lobby: undefined } as RunState)).toBeNull();
    expect(pubMod.liveEligible({ ...run, sandbox: true } as RunState, { replaying: false })).toBe(false);
    expect(pubMod.liveEligible(run, { replaying: true })).toBe(false);
    expect(pubMod.liveEligible(run, { replaying: false, showTitle: true })).toBe(false);
  });

  it('a game parked on the title screen (a saved Continue) is not live; back in the game it is listed again', async () => {
    const net = fakeRemote(() => 0);
    pubMod.setLiveRemoteForTests(net.r);
    const off = pubMod.installLivePublisher();
    // boot: the saved run is loaded under the title screen
    useGame.setState({ run: rankedRun(), replaying: false, showTitle: true });
    await flush();
    expect(net.r.heartbeat).not.toHaveBeenCalled();
    expect(pubMod.liveState()).toBeNull();
    // Continue: in the game, listed
    useGame.setState({ showTitle: false });
    await flush();
    expect(net.r.heartbeat).toHaveBeenCalledTimes(1);
    expect(pubMod.liveState()).not.toBeNull();
    // back to the menu: delisted (an abandon-style end, no placement)
    useGame.setState({ showTitle: true });
    await flush();
    expect(net.r.end).toHaveBeenCalledWith(expect.any(String), null);
    expect(pubMod.liveState()).toBeNull();
    off();
  });
});

describe('the viewer', () => {
  it('joins mid-game on the current screen, view only; the end shows the placement, then the list', async () => {
    const net = fakeRemote(() => 0);
    watchMod.setLiveWatchRemoteForTests(net.r);
    const own = useGame.getState().run;
    useGame.setState({ replaying: false, showTitle: true, showLiveGames: true });
    // the watched player's current screen, as their client publishes it
    const theirs = { ...rankedRun(), wave: 3 } as RunState;
    const pub = newPublisher('p1');
    const key = nextSpectatorMessage(pub, theirs, 3, true)!;
    key.m = 'game-1';
    net.r.latestFrame.mockResolvedValue(key);
    expect(await watchMod.watchLiveGame('game-1')).toBe(true);
    await flush();
    expect(useSpectate.getState().active).toBe(true);
    const g = useGame.getState();
    expect(g.replaying).toBe(true);
    expect(g.run.wave).toBe(3);
    expect(g.run.heroId).toBe('warden');
    expect(g.run.lobby?.seats.find((s) => s.id === 's0')?.label).toBe('Watched Wanda'); // the rail names them, not "You"
    // view only
    const shown = g.run;
    g.dispatch({ type: 'roll' });
    expect(useGame.getState().run).toBe(shown);
    // the game ends (owner 2026-10-24, R-SPECTATE-END-01): the end gate (none mounted here: it swaps at once) opens on
    // the Play menu with the placement and the XP for watching it; the viewer's own run is restored
    const beats: string[] = [];
    endMod.setSpectateBeatForTests(async (kind, target) => { beats.push(`${kind}:${target}`); return true; });
    net.r.watch.mockResolvedValue(row('game-1', { phase: 'end', placement: 2 }));
    await vi.advanceTimersByTimeAsync(watchMod.LIVE_WATCH_POLL_MS + 10);
    expect(watchMod.useLiveWatch.getState().ended).toBeNull(); // the session is gone, behind the doors
    expect(endMod.useSpectatorEnd.getState().notice).toMatchObject({ name: 'Watched Wanda', placement: 2 });
    expect(beats.at(-1)).toBe('lobby:game-1'); // the last beat, so the server sees the spectator at the end
    expect(useSpectate.getState().active).toBe(false);
    expect(useGame.getState().replaying).toBe(false);
    expect(useGame.getState().showLiveGames).toBe(false);
    expect(useGame.getState().titleView).toBe('modes');
    expect(useGame.getState().run).toBe(own);
    expect(net.r.unwatch).toHaveBeenCalledWith('game-1');
    endMod.resetSpectatorEndForTests();
    endMod.setSpectateBeatForTests(null);
  });
});

describe('the fight on a live game', () => {
  it('rides keyframes; the same fight re-sent keeps its object, so the replay never restarts', async () => {
    const net = fakeRemote(() => 0);
    watchMod.setLiveWatchRemoteForTests(net.r);
    useGame.setState({ replaying: false, showTitle: true });
    const fight = { events: [{ kind: 'attack' }], result: 'win', playerDamage: 0, initial: { player: [], enemy: [] } };
    const theirs = { ...rankedRun(), phase: 'combat' } as RunState;
    const pub = newPublisher('p1');
    const key = nextSpectatorMessage(pub, theirs, 1, true)!;
    key.m = 'game-f';
    key.fight = JSON.parse(JSON.stringify(fight));
    net.r.latestFrame.mockResolvedValue(key);
    expect(await watchMod.watchLiveGame('game-f')).toBe(true);
    await flush();
    const shown = useGame.getState().run.lastCombat;
    expect(shown).toBeTruthy();
    // a later keyframe (another watcher joined) carries the same fight as a NEW object
    const again = nextSpectatorMessage(pub, theirs, 1, true)!;
    again.m = 'game-f';
    again.fight = JSON.parse(JSON.stringify(fight));
    net.push('spectate', again);
    await flush();
    expect(useGame.getState().run.lastCombat).toBe(shown);
    watchMod.leaveLiveGame(false);
  });
});
