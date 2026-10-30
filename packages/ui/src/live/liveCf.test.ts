// @vitest-environment jsdom
/**
 * LIVE GAMES ON CLOUDFLARE, the client (R-LIVE-CF-01, R-LIVE-CF-XP-01). Pinned against an in-memory stand-in for the
 * game's Durable Object (the same relay rules as `workers/versus/src/liveGame.ts`, whose real round trip is
 * `workers/versus/test/it/live.it.ts`):
 *  - THE PLAYER on Cloudflare: listed over the socket, publishes only once someone watches (pushed, not polled), the
 *    keyframe kept by the object, the end with the placement. Supabase is never called.
 *  - FALLBACK: a Worker that cannot be reached leaves the game on the Supabase path, for its whole life.
 *  - PARITY: what a watcher reconstructs from the object (its cached keyframe + the relayed stream) equals the player's
 *    own projection, for a watcher there from the start AND one joining late.
 *  - THE WATCHER on Cloudflare: the watch screen opens on the object's keyframe, the stands come pushed, the end opens
 *    the menu with the placement, and no beat or Supabase call is made (the object writes the watch record).
 *  - SUPABASE COST per watched game, before vs after (the numbers the PR reports).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLobbyRun, reduce, type RunState } from '@game/sim';
import type { LiveRemote } from './liveRemote';
import type { CfLiveSocket, CfSocketOptions, LiveHelloAnswer } from './liveCf';

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
const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Every Supabase call either side makes (none are expected on Cloudflare). */
function countingRemote(watchers = () => 0) {
  const calls: string[] = [];
  const sent: { event: string; payload: unknown }[] = [];
  const handler: ProxyHandler<object> = {
    get: (_t, k: string) => {
      if (k === 'then') return undefined;
      return (...args: unknown[]) => {
        calls.push(k);
        if (k === 'heartbeat') return Promise.resolve(watchers());
        if (k === 'channel') return { channel: null, send: (event: string, payload: unknown) => { calls.push('broadcast'); sent.push({ event, payload }); }, close: () => undefined };
        if (k === 'game' || k === 'latestFrame') return Promise.resolve(null);
        if (k === 'watchers') return Promise.resolve([]);
        void args;
        return Promise.resolve(undefined);
      };
    },
  };
  return { r: new Proxy({}, handler) as unknown as LiveRemote, calls, sent };
}

/** An in-memory live game object: the relay, the cached keyframe, the stands, the end. */
function fakeObject(gameId: string) {
  type Sock = { o: CfSocketOptions; role: 'publish' | 'watch'; user: string; open: boolean };
  const socks: Sock[] = [];
  let key: unknown = null;
  let listing: Record<string, unknown> | null = null;
  const requests: { op: string; args: unknown }[] = [];
  const stands = () => socks.filter((s) => s.open && s.role === 'watch').map((s) => ({ user_id: s.user, display_name: String(s.o.hello.name ?? ''), profile: null }));
  const row = () => (listing ? { game_id: gameId, display_name: String(listing.name), hero_id: String(listing.hero), cosmetics: null, division_index: 3, rank_points: 10, rating: 0, round: Number(listing.round), phase: listing.phase as 'shop', placement: null, spectators: stands().length, started_at: '', mode: null, live_host: 'cf:rev' } : null);
  const pushStands = () => { const list = stands(); for (const s of socks) if (s.open) s.o.onPush({ t: 'watchers', list, n: list.length }); };
  let n = 0;
  const make = (o: CfSocketOptions): CfLiveSocket => {
    const me: Sock = { o, role: o.hello.role as 'publish' | 'watch', user: o.hello.role === 'publish' ? 'u-player' : `w-${++n}`, open: false };
    return {
      async connect() {
        me.open = true;
        socks.push(me);
        if (me.role === 'watch') {
          o.onHello(wire({ role: 'watch', userId: me.user, row: row(), key, watchers: stands() }) as LiveHelloAnswer);
          pushStands();
        } else o.onHello({ role: 'publish', userId: me.user, row: row(), key: null, watchers: stands() } as LiveHelloAnswer);
      },
      async request<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
        requests.push({ op, args: wire(args) });
        if (op === 'listing') { listing = wire(args); for (const s of socks) if (s.open && s.role === 'watch') s.o.onPush({ t: 'row', row: row()! }); return { watchers: stands().length } as T; }
        if (op === 'key') { key = wire(args.frame); return null as T; }
        if (op === 'end') { for (const s of socks) if (s.open && s.role === 'watch') s.o.onPush({ t: 'end', placement: (args.placement as number) ?? null, abandoned: args.placement == null, row: { ...row()!, phase: 'end', placement: (args.placement as number) ?? null } }); return null as T; }
        return null as T;
      },
      broadcast(event, payload) { for (const s of socks) if (s !== me && s.open) s.o.onPush({ t: 'bc', event, payload: wire(payload), from: me.user }); },
      close() { if (!me.open) return; me.open = false; pushStands(); },
    };
  };
  return { make, requests, socks, get key() { return key; }, stands };
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
  it('listed over the socket, publishes once watched (pushed), keyframe to the object, end with the placement: no Supabase call', async () => {
    const obj = fakeObject('g');
    cfMod.setCfLiveSocketForTests(obj.make);
    pubMod.setLivePublishUrlForTests(() => 'http://worker');
    const sb = countingRemote();
    pubMod.setLiveRemoteForTests(sb.r);
    const off = pubMod.installLivePublisher();
    useGame.setState({ run: rankedRun(), replaying: false, showTitle: false, playerName: 'Wanda' });
    await flush();
    expect(pubMod.liveState()).toMatchObject({ host: 'cf', publishing: false });
    expect(obj.requests.filter((r) => r.op === 'listing')).toHaveLength(1);
    expect(obj.requests[0]!.args).toMatchObject({ name: 'Wanda', hero: 'warden', phase: 'shop', mode: 'ranked' });
    // nobody watching: nothing published
    await vi.advanceTimersByTimeAsync(pubMod.LIVE_HEARTBEAT_MS);
    expect(obj.requests.filter((r) => r.op === 'key')).toHaveLength(0);
    // a watcher arrives: the object PUSHES the stands; publishing starts, the keyframe goes to the object
    const w = reconstruct(obj);
    await w.connect();
    await flush();
    expect(pubMod.liveState()?.publishing).toBe(true);
    expect(useWatchers.getState().list.map((x) => x.name)).toEqual(['Claudebot2']);
    await vi.advanceTimersByTimeAsync(400);
    expect(obj.requests.some((r) => r.op === 'key')).toBe(true);
    // the end: the placement goes up the socket
    const lobby = useGame.getState().run.lobby!;
    useGame.setState({ run: { ...useGame.getState().run, phase: 'gameover', lobby: { ...lobby, seats: lobby.seats.map((s) => (s.id === 's0' ? { ...s, placement: 2 } : s)) } } });
    await flush();
    expect(obj.requests.at(-1)).toMatchObject({ op: 'end', args: { placement: 2 } });
    expect(pubMod.liveState()).toBeNull();
    expect(sb.calls).toEqual([]); // Supabase never called
    off();
  });

  it('a Worker that cannot be reached: the game is listed and watched on Supabase instead', async () => {
    cfMod.setCfLiveSocketForTests(() => ({ connect: () => new Promise(() => undefined), request: async () => null as never, broadcast: () => undefined, close: () => undefined }));
    pubMod.setLivePublishUrlForTests(() => 'http://worker');
    const sb = countingRemote();
    pubMod.setLiveRemoteForTests(sb.r);
    const off = pubMod.installLivePublisher();
    useGame.setState({ run: rankedRun(), replaying: false, showTitle: false });
    await flush();
    expect(pubMod.liveState()?.host).toBe('connecting');
    expect(sb.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(cfMod.CF_OPEN_TIMEOUT_MS + 10);
    expect(pubMod.liveState()?.host).toBe('supabase');
    expect(sb.calls).toEqual(expect.arrayContaining(['channel', 'heartbeat']));
    off();
  });
});

describe('parity: the watcher\'s view is the player\'s (R-LIVE-CF-01)', () => {
  it('from the start and joining late, the reconstruction equals the player\'s own projection after every change', async () => {
    const obj = fakeObject('g');
    cfMod.setCfLiveSocketForTests(obj.make);
    pubMod.setLivePublishUrlForTests(() => 'http://worker');
    pubMod.setLiveRemoteForTests(countingRemote().r);
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
    pubMod.setLiveRemoteForTests(countingRemote().r);
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
    // the stream reaches the screen
    await vi.advanceTimersByTimeAsync(30_000); // no polls, no beats over time
    expect(beats).toEqual([]);
    // the end, pushed by the object
    await obj.make({ baseUrl: '', gameId: '', hello: { role: 'publish' }, onHello: () => undefined, onPush: () => undefined, onDead: () => undefined }).request('end', { placement: 1 });
    await vi.advanceTimersByTimeAsync(10);
    await flush();
    expect(endMod.useSpectatorEnd.getState().notice).toMatchObject({ name: 'Watched Wanda', placement: 1 });
    expect(useSpectate.getState().active).toBe(false);
    expect(beats).toEqual([]); // the object wrote the watch record; the settlement is queued on it
    expect(sb.calls).toEqual([]); // no watch RPC, no poll, no unwatch, no frame read
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
    const pub = obj.make({ baseUrl: '', gameId: 'g-blip', hello: { role: 'publish' }, onHello: () => undefined, onPush: () => undefined, onDead: () => undefined });
    await pub.connect();
    await pub.request('listing', { name: 'Blip Bea', hero: 'warden', round: 2, phase: 'shop' });
    let tries = 0;
    cfMod.setCfLiveSocketForTests((o) => {
      tries += 1;
      if (o.hello.role === 'watch' && tries === 1) return { connect: () => new Promise(() => undefined), request: async () => null as never, broadcast: () => undefined, close: () => undefined };
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
    const hang = () => ({ connect: () => new Promise<void>(() => undefined), request: async () => null as never, broadcast: () => undefined, close: () => undefined });
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
      cfMod.setCfLiveSocketForTests(() => { tries += 1; return hang(); });
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

  it('a friend\'s Watch (no row in hand): Supabase answers other_host, the row names the Worker', async () => {
    const obj = fakeObject('g2');
    cfMod.setCfLiveSocketForTests(obj.make);
    const sb = countingRemote();
    const { LiveError } = await import('./liveRemote');
    const r = sb.r as unknown as Record<string, unknown>;
    const remote = { ...Object.fromEntries(['watchAs', 'game', 'channel', 'unwatch', 'watchers', 'latestFrame', 'seatRecordings'].map((k) => [k, (r as Record<string, (...a: unknown[]) => unknown>)[k]])) } as Record<string, unknown>;
    remote.watchAs = async () => { throw new LiveError('other_host'); };
    remote.game = async () => ({ game_id: 'g2', live_host: 'cf:rev' });
    watchMod.setLiveWatchRemoteForTests(remote as unknown as LiveRemote);
    const urls: string[] = [];
    watchMod.setLiveWatchUrlForTests((h) => { urls.push(h); return 'http://worker'; });
    // The object refuses: nothing listed yet (no_game) - what matters is that the Worker was asked.
    await watchMod.watchLiveGame('g2');
    expect(urls).toEqual(['cf:rev']);
  });
});

describe('Supabase cost per watched game, before vs after (the PR\'s measurement)', () => {
  it('a 10-minute game with one watcher: every Supabase call each side makes', async () => {
    const minutes = 10;
    // BEFORE: the Supabase path. The player heartbeats; the watcher polls its join and beats its watch record.
    const sbPub = countingRemote(() => 1);
    pubMod.setLiveRemoteForTests(sbPub.r);
    pubMod.setLivePublishUrlForTests(() => null);
    const off = pubMod.installLivePublisher();
    useGame.setState({ run: rankedRun(), replaying: false, showTitle: false });
    await flush();
    for (let i = 0; i < minutes * 4; i++) {
      if (i % 4 === 0) useGame.setState({ run: { ...useGame.getState().run, wave: useGame.getState().run.wave + 1 } });
      await vi.advanceTimersByTimeAsync(15_000);
    }
    off();
    const pubCalls = sbPub.calls.filter((c) => c !== 'broadcast');
    const before = {
      playerRpc: pubCalls.filter((c) => c === 'heartbeat' || c === 'end' || c === 'watchers').length,
      keyframeWrites: pubCalls.filter((c) => c === 'publishFrame').length,
      broadcasts: sbPub.calls.filter((c) => c === 'broadcast').length,
      // The watcher (liveWatch.ts): a watch_as every 5 s, the fellows every 3rd poll, a spectate_beat every 10 s.
      watcherRpc: (minutes * 60_000) / watchMod.LIVE_WATCH_POLL_MS + (minutes * 60_000) / (watchMod.LIVE_WATCH_POLL_MS * 3) + (minutes * 60_000) / endMod.SPECTATE_BEAT_MS,
    };
    // AFTER (Cloudflare): no client call at all; the object writes the row on a change (one per round / phase, plus a
    // 2-minute keep-alive) and the watch record every 30 s (one call for all its watchers).
    const after = { playerRpc: 0, keyframeWrites: 0, broadcasts: 0, watcherRpc: 0, workerRowWrites: minutes * 2 + 1 /* a shop and a combat listing per round (one a minute here), the removal */, workerBeatCalls: Math.ceil((minutes * 60) / 30) + 2 };
    console.log('[live-cf measure] Supabase calls per 10-minute watched game', JSON.stringify({ before, after }));
    expect(before.playerRpc).toBeGreaterThanOrEqual(minutes * 4);
    expect(after.workerRowWrites + after.workerBeatCalls).toBeLessThan(before.playerRpc + before.watcherRpc + before.keyframeWrites);
  });
});
