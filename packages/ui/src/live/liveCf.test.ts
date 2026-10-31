// @vitest-environment jsdom
/**
 * LIVE GAMES ON CLOUDFLARE, the client (R-LIVE-CF-01, R-LIVE-CF-XP-01, R-LIVE-CF-ONLY-01). Pinned against an in-memory
 * stand-in for the game's Durable Object (`liveFakeObject.ts`: the same relay rules as `workers/versus/src/liveGame.ts`,
 * whose real round trip is `workers/versus/test/it/live.it.ts`):
 *  - THE PLAYER: listed over the socket, publishes only once someone watches (pushed, not polled), the keyframe kept by
 *    the object, the end with the placement.
 *  - NO FALLBACK (R-LIVE-CF-ONLY-01): a Worker that cannot be reached is retried in the background with backoff; nothing
 *    goes anywhere else, and the game is listed the moment the Worker answers.
 *  - PARITY: what a watcher reconstructs from the object (its cached keyframe + the relayed stream) equals the player's
 *    own projection, for a watcher there from the start AND one joining late.
 *  - THE WATCHER: the watch screen opens on the object's keyframe, the stands come pushed, the end opens the menu with
 *    the placement, and no beat or Supabase call is made (the object writes the watch record).
 *  - A FRIEND'S WATCH (no row in hand) finds the Worker from the listing row, or this build's own; never a Supabase join.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLobbyRun, reduce, type RunState } from '@game/sim';
import type { LiveRemote } from './liveRemote';
import { fakeLiveObject as fakeObject, hangingSocket, wire } from './liveFakeObject';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const { useGame } = await import('../store');
const identity = await import('../identity');
const pubMod = await import('./livePublisher');
const watchMod = await import('./liveWatch');
const endMod = await import('./spectatorEnd');
const cfMod = await import('./liveCf');
const { useSpectate } = await import('../versus/spectate');
const { useWatchers } = await import('../versus/watchers');
const { applySpectatorMessage, newReceiver, projectSpectatorView } = await import('../versus/spectatorView');

const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

/** Every Supabase read the watcher makes (none are expected with the row in hand). */
function countingRemote() {
  const calls: string[] = [];
  const r: Pick<LiveRemote, 'game' | 'seatRecordings'> = {
    game: async () => { calls.push('game'); return null; },
    seatRecordings: async () => { calls.push('seatRecordings'); return []; },
  };
  return { r, calls };
}

const rankedRun = (): RunState => {
  const run = createLobbyRun(4321, 'warden');
  return { ...run, lobby: { ...run.lobby!, unrated: undefined, seats: run.lobby!.seats.map((s, i) => (i === 1 ? { ...s, kind: 'snapshot' } : s)) } } as RunState;
};

beforeEach(() => {
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

/** A watcher's reconstruction from what the object hands it (hello keyframe, then the relayed stream). */
function reconstruct(obj: ReturnType<typeof fakeObject>) {
  let rx = newReceiver();
  const watcher = obj.make({
    baseUrl: 'x', gameId: 'g', hello: { role: 'watch', name: 'Claudebot2' },
    onHello: (a) => { if (a.key) rx = applySpectatorMessage(rx, a.key as never).rx; },
    onPush: (m) => { if (m.t === 'bc' && m.event === 'spectate') rx = applySpectatorMessage(rx, m.payload as never).rx; },
    onDead: () => undefined,
  });
  return { connect: () => watcher.connect(), view: () => rx.view, close: () => watcher.close(), ask: () => watcher.broadcast('spectate_key', {}) };
}

describe('the player on Cloudflare (R-LIVE-CF-01)', () => {
  it('listed over the socket, publishes once watched (pushed), keyframe to the object, end with the placement', async () => {
    const obj = fakeObject('g');
    cfMod.setCfLiveSocketForTests(obj.make);
    pubMod.setLivePublishUrlForTests(() => 'http://worker');
    const off = pubMod.installLivePublisher();
    useGame.setState({ run: rankedRun(), replaying: false, showTitle: false, playerName: 'Wanda' });
    await flush();
    expect(pubMod.liveState()).toMatchObject({ host: 'cf', publishing: false });
    expect(obj.ops('listing')).toHaveLength(1);
    expect(obj.requests[0]!.args).toMatchObject({ name: 'Wanda', hero: 'warden', phase: 'shop', mode: 'ranked' });
    // nobody watching: nothing published
    await vi.advanceTimersByTimeAsync(pubMod.LIVE_HEARTBEAT_MS);
    expect(obj.ops('key')).toHaveLength(0);
    // a watcher arrives: the object PUSHES the stands; publishing starts, the keyframe goes to the object
    const w = reconstruct(obj);
    await w.connect();
    await flush();
    expect(pubMod.liveState()?.publishing).toBe(true);
    expect(useWatchers.getState().list.map((x) => x.name)).toEqual(['Claudebot2']);
    await vi.advanceTimersByTimeAsync(400);
    expect(obj.ops('key').length).toBeGreaterThan(0);
    // the watcher leaves: the pushed stands drop them at once and publishing stops
    w.close();
    await flush();
    expect(useWatchers.getState().list).toEqual([]);
    expect(pubMod.liveState()?.publishing).toBe(false);
    // the end: the placement goes up the socket
    const lobby = useGame.getState().run.lobby!;
    useGame.setState({ run: { ...useGame.getState().run, phase: 'gameover', lobby: { ...lobby, seats: lobby.seats.map((s) => (s.id === 's0' ? { ...s, placement: 2 } : s)) } } });
    await flush();
    expect(obj.requests.at(-1)).toMatchObject({ op: 'end', args: { placement: 2 } });
    expect(pubMod.liveState()).toBeNull();
    off();
  });

  it('a Worker that cannot be reached: no fallback; retried in the background with backoff, listed once it answers (R-LIVE-CF-ONLY-01)', async () => {
    const obj = fakeObject('g');
    let up = false;
    let opens = 0;
    cfMod.setCfLiveSocketForTests((o) => { opens++; return up ? obj.make(o) : hangingSocket(); });
    pubMod.setLivePublishUrlForTests(() => 'http://worker');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const off = pubMod.installLivePublisher();
    useGame.setState({ run: rankedRun(), replaying: false, showTitle: false });
    await flush();
    expect(pubMod.liveState()?.host).toBe('connecting');
    // the first open times out: still connecting, a retry waits, nothing went anywhere else
    await vi.advanceTimersByTimeAsync(cfMod.CF_OPEN_TIMEOUT_MS + 10);
    expect(pubMod.liveState()).toMatchObject({ host: 'connecting', fails: 1, publishing: false });
    expect(opens).toBe(1);
    // the backoff doubles: 5, 10, 20, 40 s, then every 60 s
    expect([1, 2, 3, 4, 5, 6].map((n) => pubMod.liveRetryDelay(n))).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
    await vi.advanceTimersByTimeAsync(pubMod.liveRetryDelay(1) + cfMod.CF_OPEN_TIMEOUT_MS + 10);
    expect(opens).toBe(2);
    expect(pubMod.liveState()?.fails).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1); // one line in the console, not one per retry
    // the Worker answers again: the next retry opens, and the listing goes up at once
    up = true;
    await vi.advanceTimersByTimeAsync(pubMod.liveRetryDelay(2) + 10);
    await flush();
    expect(opens).toBe(3);
    expect(pubMod.liveState()).toMatchObject({ host: 'cf', fails: 0 });
    expect(obj.ops('listing')).toHaveLength(1);
    off();
    warn.mockRestore();
  });

  it('a game that ends before the Worker answered sends nothing and stops retrying', async () => {
    let opens = 0;
    cfMod.setCfLiveSocketForTests(() => { opens++; return hangingSocket(); });
    pubMod.setLivePublishUrlForTests(() => 'http://worker');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const off = pubMod.installLivePublisher();
    useGame.setState({ run: rankedRun(), replaying: false, showTitle: false });
    await vi.advanceTimersByTimeAsync(cfMod.CF_OPEN_TIMEOUT_MS + 10);
    useGame.setState({ showTitle: true }); // back to the menu
    await flush();
    expect(pubMod.liveState()).toBeNull();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(opens).toBe(1);
    off();
    warn.mockRestore();
  });
});

describe('parity: the watcher\'s view is the player\'s (R-LIVE-CF-01)', () => {
  it('from the start and joining late, the reconstruction equals the player\'s own projection after every change', async () => {
    const obj = fakeObject('g');
    cfMod.setCfLiveSocketForTests(obj.make);
    pubMod.setLivePublishUrlForTests(() => 'http://worker');
    const off = pubMod.installLivePublisher();
    useGame.setState({ run: rankedRun(), replaying: false, showTitle: false });
    await flush();
    const early = reconstruct(obj);
    await early.connect();
    await vi.advanceTimersByTimeAsync(400);
    const steps: ((r: RunState) => RunState)[] = [
      (r) => reduce(r, { type: 'roll' }),
      (r) => reduce(r, { type: 'freeze' }),
      (r) => reduce(r, { type: 'roll' }),
      (r) => ({ ...r, armor: r.armor + 3 }),
      (r) => reduce(r, { type: 'freeze' }),
    ];
    let late: ReturnType<typeof reconstruct> | null = null;
    for (const [i, step] of steps.entries()) {
      useGame.setState({ run: step(useGame.getState().run) });
      await vi.advanceTimersByTimeAsync(400);
      if (i === 2) {
        // A late joiner: the object's cached keyframe, then a fresh one on its request, then the stream.
        late = reconstruct(obj);
        await late.connect();
        late.ask();
        await vi.advanceTimersByTimeAsync(400);
      }
      const want = wire(projectSpectatorView(useGame.getState().run));
      expect(early.view()).toEqual(want);
      if (late) expect(late.view()).toEqual(want);
    }
    off();
  });
});

describe('the watcher on Cloudflare (R-LIVE-CF-01, R-LIVE-CF-XP-01)', () => {
  it('opens on the object\'s keyframe; stands pushed; the end opens the menu with the placement; no beat, no Supabase call', async () => {
    // The player's side first (the object keeps its listing and keyframe), then the player's tab goes quiet.
    const obj = fakeObject('game-cf');
    cfMod.setCfLiveSocketForTests(obj.make);
    pubMod.setLivePublishUrlForTests(() => 'http://worker');
    const off = pubMod.installLivePublisher();
    const theirs = { ...rankedRun(), runId: 'game-cf', wave: 3 } as RunState;
    useGame.setState({ run: theirs, replaying: false, showTitle: false, playerName: 'Watched Wanda' });
    await flush();
    const opener = reconstruct(obj);
    await opener.connect();
    await vi.advanceTimersByTimeAsync(400);
    expect(obj.key).toBeTruthy();
    off(); // (sends an abandon end to nobody: the opener is the only watcher and is discarded)
    opener.close();
    const publisherSock = obj.socks.find((s) => s.role === 'publish')!;
    publisherSock.open = true; // the player's game goes on (the object still holds it)

    // Now this tab watches it.
    identity.setIdentity({ userId: 'u-watcher', isAnonymous: true } as never);
    useGame.setState({ replaying: false, showTitle: true, showLiveGames: true });
    const sb = countingRemote();
    watchMod.setLiveWatchRemoteForTests(sb.r);
    watchMod.setLiveWatchUrlForTests(() => 'http://worker');
    const beats: string[] = [];
    endMod.setSpectateBeatForTests(async (kind, target) => { beats.push(`${kind}:${target}`); return true; });
    expect(await watchMod.watchLiveGame('game-cf', { live_host: 'cf:rev' })).toBe(true);
    await flush();
    expect(useSpectate.getState().active).toBe(true);
    expect(useGame.getState().run.wave).toBe(3);
    expect(watchMod.useLiveWatch.getState().game).toMatchObject({ display_name: 'Watched Wanda', live_host: 'cf:rev' });
    await vi.advanceTimersByTimeAsync(30_000); // no polls, no beats over time
    expect(beats).toEqual([]);
    // the end, pushed by the object
    await obj.raw('publish').request('end', { placement: 1 });
    await vi.advanceTimersByTimeAsync(10);
    await flush();
    expect(endMod.useSpectatorEnd.getState().notice).toMatchObject({ name: 'Watched Wanda', placement: 1 });
    expect(useSpectate.getState().active).toBe(false);
    expect(beats).toEqual([]); // the object wrote the watch record; the settlement is queued on it
    expect(sb.calls.filter((c) => c !== 'seatRecordings')).toEqual([]); // no listing read with the row in hand
    endMod.resetSpectatorEndForTests();
    endMod.setSpectateBeatForTests(null);
  });

  it('a refused join says why (the stands are full)', async () => {
    cfMod.setCfLiveSocketForTests(() => ({ connect: async () => { throw new (await import('@game/versus-cf/client')).VersusCfError('spectators_full'); }, request: async () => null as never, broadcast: () => undefined, close: () => undefined }));
    watchMod.setLiveWatchRemoteForTests(countingRemote().r);
    watchMod.setLiveWatchUrlForTests(() => 'http://worker');
    expect(await watchMod.watchLiveGame('g-full', { live_host: 'cf:rev' })).toBe(false);
    expect(watchMod.useLiveWatch.getState().error).toBe('That game has 20 watchers already.');
  });

  // R-LIVE-WATCH-REACH-01 (owner 2026-10-30: "i keep getting this error trying to spectate. why?").
  it('a socket that times out once is tried again: the second try opens the watch', async () => {
    const obj = fakeObject('g-blip');
    const pub = obj.raw('publish');
    await pub.connect();
    await pub.request('listing', { name: 'Blip Bea', hero: 'warden', round: 2, phase: 'shop' });
    let tries = 0;
    cfMod.setCfLiveSocketForTests((o) => {
      tries += 1;
      if (o.hello.role === 'watch' && tries === 1) return hangingSocket();
      return obj.make(o);
    });
    watchMod.setLiveWatchRemoteForTests(countingRemote().r);
    watchMod.setLiveWatchUrlForTests(() => 'http://worker');
    const diag = vi.fn(async () => 'server_down' as const);
    watchMod.setLiveWatchDiagnoseForTests(diag);
    identity.setIdentity({ userId: 'u-watcher', isAnonymous: true } as never);
    const p = watchMod.watchLiveGame('g-blip', { live_host: 'cf:rev' });
    await vi.advanceTimersByTimeAsync(cfMod.CF_OPEN_TIMEOUT_MS + 10);
    expect(await p).toBe(true);
    expect(tries).toBe(2);
    expect(diag).not.toHaveBeenCalled();
    expect(watchMod.useLiveWatch.getState().error).toBeNull();
    watchMod.leaveLiveGame(false);
    watchMod.setLiveWatchDiagnoseForTests(null);
  });

  it('a socket that never opens says WHY after the retry (offline / server down / signed out), never one catch-all', async () => {
    watchMod.setLiveWatchRemoteForTests(countingRemote().r);
    watchMod.setLiveWatchUrlForTests(() => 'http://worker');
    const cases = [
      ['server_down', 'The game server did not answer. Try again in a moment.'],
      ['signed_out', 'Sign in again to watch. Reload the game and try again.'],
      ['offline', 'You are offline. Check your connection and try again.'],
      ['unreachable', 'Could not reach that game. Try again.'],
    ] as const;
    for (const [why, text] of cases) {
      let tries = 0;
      cfMod.setCfLiveSocketForTests(() => { tries += 1; return hangingSocket(); });
      const asked: string[] = [];
      watchMod.setLiveWatchDiagnoseForTests(async (url) => { asked.push(url); return why; });
      const p = watchMod.watchLiveGame('g-gone', { live_host: 'cf:rev' });
      await vi.advanceTimersByTimeAsync(2 * cfMod.CF_OPEN_TIMEOUT_MS + 10);
      expect(await p).toBe(false);
      expect(tries, why).toBe(2);
      expect(asked).toEqual(['http://worker']);
      expect(watchMod.useLiveWatch.getState().error).toBe(text);
    }
    watchMod.setLiveWatchDiagnoseForTests(null);
  });

  it('a refusal is final at once (no retry, no diagnosis); a protocol mismatch says reload', async () => {
    const { VersusCfError } = await import('@game/versus-cf/client');
    let tries = 0;
    cfMod.setCfLiveSocketForTests(() => { tries += 1; return { connect: async () => { throw new VersusCfError('version_mismatch'); }, request: async () => null as never, broadcast: () => undefined, close: () => undefined }; });
    watchMod.setLiveWatchRemoteForTests(countingRemote().r);
    watchMod.setLiveWatchUrlForTests(() => 'http://worker');
    const diag = vi.fn(async () => 'server_down' as const);
    watchMod.setLiveWatchDiagnoseForTests(diag);
    expect(await watchMod.watchLiveGame('g-old', { live_host: 'cf:rev' })).toBe(false);
    expect(tries).toBe(1);
    expect(diag).not.toHaveBeenCalled();
    expect(watchMod.useLiveWatch.getState().error).toBe('This game is on a different version. Reload to update.');
    watchMod.setLiveWatchDiagnoseForTests(null);
  });

  it('the diagnosis reads the Worker: no /health = server down; /me/room 401 = signed out; both fine = unreachable', async () => {
    const answer = (health: number | null, me: number) => vi.fn(async (url: string) => {
      if (String(url).endsWith('/health')) { if (health == null) throw new TypeError('Failed to fetch'); return new Response('{}', { status: health }); }
      return new Response('{}', { status: me });
    });
    vi.stubGlobal('fetch', answer(null, 200));
    expect(await cfMod.diagnoseCfOpen('https://w.example/')).toBe('server_down');
    vi.stubGlobal('fetch', answer(503, 200));
    expect(await cfMod.diagnoseCfOpen('https://w.example')).toBe('server_down');
    const f = answer(200, 401);
    vi.stubGlobal('fetch', f);
    expect(await cfMod.diagnoseCfOpen('https://w.example')).toBe('signed_out');
    expect((f.mock.calls as unknown as [string][]).map(([u]) => u)).toEqual(['https://w.example/health', 'https://w.example/me/room']);
    vi.stubGlobal('fetch', answer(200, 200));
    expect(await cfMod.diagnoseCfOpen('https://w.example')).toBe('unreachable');
    vi.stubGlobal('navigator', { onLine: false });
    expect(await cfMod.diagnoseCfOpen('https://w.example')).toBe('offline');
  });
});

describe('a friend\'s Watch, with no row in hand (R-LIVE-CF-ONLY-01)', () => {
  it('the listing row names the Worker; no row yet: this build\'s own Worker; never a Supabase join', async () => {
    const obj = fakeObject('g2');
    cfMod.setCfLiveSocketForTests(obj.make);
    const urls: string[] = [];
    watchMod.setLiveWatchUrlForTests((h) => { urls.push(h); return 'http://worker'; });
    const reads: string[] = [];
    watchMod.setLiveWatchRemoteForTests({ game: async (id) => { reads.push(id); return { game_id: id, live_host: 'cf:other-rev' } as never; }, seatRecordings: async () => [] });
    // The object refuses (nothing listed on it: no_game); what matters is which Worker was asked.
    await watchMod.watchLiveGame('g2');
    expect(reads).toEqual(['g2']);
    expect(urls).toEqual(['cf:other-rev']);
    // No row yet (its first listing write is on its way): this build's own Worker.
    const { contentRevision } = await import('@game/content');
    watchMod.setLiveWatchRemoteForTests({ game: async () => null, seatRecordings: async () => [] });
    await watchMod.watchLiveGame('g2');
    expect(urls.at(-1)).toBe(`cf:${contentRevision()}`);
  });

  it('a lobby row with no Worker (listed by an older build on the retired Supabase path) cannot be watched, and says so', async () => {
    let opens = 0;
    cfMod.setCfLiveSocketForTests(() => { opens++; return hangingSocket(); });
    watchMod.setLiveWatchRemoteForTests({ game: async (id) => ({ game_id: id, live_host: null }) as never, seatRecordings: async () => [] });
    expect(await watchMod.watchLiveGame('g-old')).toBe(false);
    expect(opens).toBe(0);
    expect(watchMod.useLiveWatch.getState().error).toBe('That game is on an older version. It cannot be watched.');
    // the same with the row in hand (Live Games)
    expect(await watchMod.watchLiveGame('g-old', { live_host: null })).toBe(false);
    expect(opens).toBe(0);
  });
});
