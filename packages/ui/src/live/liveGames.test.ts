// @vitest-environment jsdom
/**
 * LIVE LOBBY GAMES (owner-approved 2026-10-15), on the game's Cloudflare object (R-LIVE-CF-ONLY-01: there is no other
 * host). Pinned against the in-memory object (`liveFakeObject.ts`):
 *  - PRESENCE: a lobby game is listed, followed on every round / phase change, ended with its placement, and removed on
 *    abandon; a sandbox or a replay is never listed.
 *  - PUBLISH ONLY WHEN WATCHED: with nobody watching nothing is sent; a watcher's arrival (pushed) starts the stream, and
 *    a keyframe goes out (carrying the fight while one plays).
 *  - THE VIEWER: joining mid-game lands on the player's current screen, view only (no action reaches the run), and the
 *    game's end shows the placement, then returns to the menu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLobbyRun, reduce, type RunState } from '@game/sim';
import { fakeLiveObject } from './liveFakeObject';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const identity = await import('../identity');
const pubMod = await import('./livePublisher');
const watchMod = await import('./liveWatch');
const endMod = await import('./spectatorEnd');
const cfMod = await import('./liveCf');
const { useSpectate } = await import('../versus/spectate');
const { newPublisher, nextSpectatorMessage } = await import('../versus/spectatorView');

const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

const rankedRun = (): RunState => {
  const run = createLobbyRun(1234, 'warden');
  return { ...run, lobby: { ...run.lobby!, unrated: undefined, seats: run.lobby!.seats.map((s, i) => (i === 1 ? { ...s, kind: 'snapshot' } : s)) } } as RunState;
};

/** A watcher on the object that records what the player sends. */
function watcherOn(obj: ReturnType<typeof fakeLiveObject>, name = 'Claudebot2') {
  const got: { event: string; payload: any }[] = [];
  const sock = obj.raw('watch', { name, profile: { avatar: 'a1' } }, (m) => { if (m.t === 'bc') got.push({ event: m.event, payload: m.payload }); });
  return { sock, got, spect: () => got.filter((g) => g.event === 'spectate') };
}

beforeEach(() => {
  pubMod.setLivePublishUrlForTests(() => 'http://worker');
  watchMod.setLiveWatchUrlForTests(() => 'http://worker');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  identity.setIdentity({ userId: 'u-player', isAnonymous: true } as never);
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 0; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); identity.setIdentity(null);
  cfMod.setCfLiveSocketForTests(null);
  pubMod.setLivePublishUrlForTests(null);
  watchMod.setLiveWatchUrlForTests(null);
  watchMod.setLiveWatchRemoteForTests(null);
});

describe('the player side: presence and publishing', () => {
  it('lists a ranked lobby game, follows it, publishes only while watched, and ends with the placement', async () => {
    const obj = fakeLiveObject('g');
    cfMod.setCfLiveSocketForTests(obj.make);
    const off = pubMod.installLivePublisher();
    const run = rankedRun();
    expect(pubMod.liveEligible(run, { replaying: false })).toBe(true); // recorded seats: a rated table
    useGame.setState({ run, replaying: false, showTitle: false, playerName: 'Wanda' });
    await flush();
    expect(obj.ops('listing')).toHaveLength(1);
    expect(pubMod.liveState()?.publishing).toBe(false);
    // a round change: one more listing
    useGame.setState({ run: { ...useGame.getState().run, wave: useGame.getState().run.wave + 1 } });
    await flush();
    expect(obj.ops('listing')).toHaveLength(2);
    // a watcher arrives: the pushed stands start publishing and a keyframe goes out
    const w = watcherOn(obj);
    await w.sock.connect();
    await flush();
    expect(pubMod.liveState()?.publishing).toBe(true);
    useGame.setState({ run: reduce(useGame.getState().run, { type: 'freeze' }) });
    await vi.advanceTimersByTimeAsync(400);
    expect(w.spect().length).toBeGreaterThan(0);
    expect(w.spect()[0]!.payload.kind).toBe('key');
    expect(w.spect()[0]!.payload.m).toBe(pubMod.liveState()!.gameId);
    // the game ends: the placement is reported, publishing stops
    const lobby = useGame.getState().run.lobby!;
    useGame.setState({ run: { ...useGame.getState().run, phase: 'gameover', lobby: { ...lobby, seats: lobby.seats.map((s) => (s.id === 's0' ? { ...s, placement: 3 } : s)) } } });
    await flush();
    expect(obj.requests.at(-1)).toMatchObject({ op: 'end', args: { placement: 3 } });
    expect(pubMod.liveState()).toBeNull();
    off();
  });

  it('the stands: who watches is pushed on a join, dropped at once on a leave, and a fight keyframe carries the beat (R-SPECTATE-WATCHERS-01, R-SPECTATE-JOIN-01)', async () => {
    const { useWatchers } = await import('../versus/watchers');
    const tap = await import('../versus/spectateTap');
    const obj = fakeLiveObject('g');
    cfMod.setCfLiveSocketForTests(obj.make);
    const off = pubMod.installLivePublisher();
    useGame.setState({ run: rankedRun(), replaying: false, showTitle: false });
    await flush();
    expect(useWatchers.getState().list).toEqual([]);
    const w = watcherOn(obj);
    await w.sock.connect();
    await flush();
    expect(useWatchers.getState().list).toEqual([{ id: 'w-1', name: 'Claudebot2', profile: { avatar: 'a1' } }]);
    // in a fight: a requested keyframe carries where the fight is
    tap.notePlayerBeat(useGame.getState().run.wave, 6);
    useGame.setState({ run: { ...useGame.getState().run, phase: 'combat' } as RunState });
    w.sock.broadcast('spectate_key', {});
    await vi.advanceTimersByTimeAsync(400);
    const keys = w.spect().filter((m) => m.payload.kind === 'key');
    expect(keys.at(-1)!.payload.cb).toEqual({ w: useGame.getState().run.wave, b: 6 });
    // the watcher leaves: the object pushes the new stands at once
    w.sock.close();
    await flush();
    expect(useWatchers.getState().list).toEqual([]);
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
    const obj = fakeLiveObject('g');
    let opens = 0;
    cfMod.setCfLiveSocketForTests((o) => { opens++; return obj.make(o); });
    const off = pubMod.installLivePublisher();
    // boot: the saved run is loaded under the title screen
    useGame.setState({ run: rankedRun(), replaying: false, showTitle: true });
    await flush();
    expect(opens).toBe(0);
    expect(pubMod.liveState()).toBeNull();
    // Continue: in the game, listed
    useGame.setState({ showTitle: false });
    await flush();
    expect(obj.ops('listing')).toHaveLength(1);
    expect(pubMod.liveState()).not.toBeNull();
    // back to the menu: delisted (an abandon-style end, no placement)
    useGame.setState({ showTitle: true });
    await flush();
    expect(obj.requests.at(-1)).toMatchObject({ op: 'end', args: { placement: null } });
    expect(pubMod.liveState()).toBeNull();
    off();
  });
});

/** A player's game already on the object: its listing and its current keyframe. */
async function gameOnObject(id: string, frame: unknown) {
  const obj = fakeLiveObject(id);
  const pub = obj.raw('publish');
  await pub.connect();
  await pub.request('listing', { name: 'Watched Wanda', hero: 'warden', round: 3, phase: 'shop' });
  obj.key = frame;
  cfMod.setCfLiveSocketForTests(obj.make);
  return { obj, pub };
}

describe('the viewer', () => {
  it('joins mid-game on the current screen, view only; the end shows the placement, then the menu', async () => {
    const own = useGame.getState().run;
    useGame.setState({ replaying: false, showTitle: true, showLiveGames: true });
    // the watched player's current screen, as their client publishes it
    const theirs = { ...rankedRun(), wave: 3 } as RunState;
    const key = nextSpectatorMessage(newPublisher('p1'), theirs, 3, true)!;
    key.m = 'game-1';
    const { pub } = await gameOnObject('game-1', key);
    identity.setIdentity({ userId: 'u-watcher', isAnonymous: true } as never);
    expect(await watchMod.watchLiveGame('game-1', { live_host: 'cf:rev' })).toBe(true);
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
    await pub.request('end', { placement: 2 });
    await vi.advanceTimersByTimeAsync(10);
    await flush();
    expect(watchMod.useLiveWatch.getState().ended).toBeNull(); // the session is gone, behind the doors
    expect(endMod.useSpectatorEnd.getState().notice).toMatchObject({ name: 'Watched Wanda', placement: 2 });
    expect(useSpectate.getState().active).toBe(false);
    expect(useGame.getState().replaying).toBe(false);
    expect(useGame.getState().showLiveGames).toBe(false);
    expect(useGame.getState().titleView).toBe('modes');
    expect(useGame.getState().run).toBe(own);
    endMod.resetSpectatorEndForTests();
  });
});

describe('the fight on a live game', () => {
  it('rides keyframes; the same fight re-sent keeps its object, so the replay never restarts', async () => {
    useGame.setState({ replaying: false, showTitle: true });
    const fight = { events: [{ kind: 'attack' }], result: 'win', playerDamage: 0, initial: { player: [], enemy: [] } };
    const theirs = { ...rankedRun(), phase: 'combat' } as RunState;
    const p = newPublisher('p1');
    const key = nextSpectatorMessage(p, theirs, 1, true)!;
    key.m = 'game-f';
    key.fight = JSON.parse(JSON.stringify(fight));
    const { pub } = await gameOnObject('game-f', key);
    identity.setIdentity({ userId: 'u-watcher', isAnonymous: true } as never);
    expect(await watchMod.watchLiveGame('game-f', { live_host: 'cf:rev' })).toBe(true);
    await flush();
    const shown = useGame.getState().run.lastCombat;
    expect(shown).toBeTruthy();
    // a later keyframe (another watcher joined) carries the same fight as a NEW object
    const again = nextSpectatorMessage(p, theirs, 1, true)!;
    again.m = 'game-f';
    again.fight = JSON.parse(JSON.stringify(fight));
    pub.broadcast('spectate', again);
    await flush();
    expect(useGame.getState().run.lastCombat).toBe(shown);
    watchMod.leaveLiveGame(false);
  });
});
