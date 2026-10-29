/**
 * LIVE GAMES ON CLOUDFLARE — the live game Durable Object in real workerd (`npm run versus:cf:test`, local only;
 * R-LIVE-CF-01, R-LIVE-CF-XP-01). The rules are on a fake clock in `test/liveCore.test.ts`; this proves what only the
 * runtime can: the upgrade and auth, publish → watch over real sockets, the cached keyframe, relays both ways, the
 * stands' cap, a reconnect, the end (after the watch record), the rate limit, and a Versus room beating its stands.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VersusCfClient, type WebSocketLike } from '../../src/client';
import { LIVE_CF_PROTOCOL, LIVE_WATCHER_CAP, liveCfSocketPath, type LiveHelloAnswer, type LivePush } from '../../src/liveProtocol';
import { VERSUS_PROTOCOL } from '@game/sim/versus/server';
import { CONTENT, Player, startLocalWorker, toRoundOne } from './driver';

let base = '';
let dispose: () => Promise<void> = async () => undefined;
beforeAll(async () => {
  const w = await startLocalWorker();
  base = w.url;
  dispose = w.dispose;
});
afterAll(async () => dispose());

const NodeWS = (globalThis as unknown as { WebSocket: new (url: string, protocols: string[]) => WebSocketLike }).WebSocket;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One end of a live game over the real protocol. */
class End {
  readonly pushes: LivePush[] = [];
  hello: LiveHelloAnswer | null = null;
  client: VersusCfClient;
  status = '';
  private waiters: { pred: (m: LivePush) => boolean; resolve: (m: LivePush) => void }[] = [];
  constructor(readonly gameId: string, readonly role: 'publish' | 'watch', readonly userId = crypto.randomUUID(), readonly name = 'Claudebot') {
    this.client = new VersusCfClient({
      baseUrl: base, roomId: gameId, path: liveCfSocketPath(gameId), token: async () => `dev.${this.userId}.${this.name}`,
      versusProtocol: 0, contentRevision: CONTENT, ws: (url, protocols) => new NodeWS(url, protocols),
      hello: () => ({ protocol: LIVE_CF_PROTOCOL, role, name: this.name, profile: { avatar: 'a1' }, contentRevision: CONTENT }),
      onHello: (d) => { this.hello = d as LiveHelloAnswer; },
      onPush: (m) => this.push(m as unknown as LivePush),
      onStatus: (s, d) => { this.status = `${s}:${d ?? ''}`; },
    });
  }
  private push(m: LivePush): void {
    this.pushes.push(m);
    this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
  }
  next(pred: (m: LivePush) => boolean, ms = 10_000): Promise<LivePush> {
    const hit = this.pushes.find(pred);
    if (hit) { this.pushes.splice(this.pushes.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.name}: timed out`)), ms);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  }
  connect(): Promise<void> { return this.client.connect(); }
  req<T = unknown>(op: 'listing' | 'key' | 'end', args: Record<string, unknown> = {}): Promise<T> { return this.client.request<T>(op, args); }
}

const metrics = async (gameId: string): Promise<Record<string, any>> => (await fetch(`${base}/live/${encodeURIComponent(gameId)}/metrics`)).json() as never;
const listing = { name: 'Claudebot1', hero: 'warden', round: 2, phase: 'shop', mode: 'practice' };

describe('a live game in workerd (R-LIVE-CF-01)', () => {
  it('publish, then watch: the row, the cached keyframe, the stands, relays both ways; nobody else can publish', async () => {
    const game = `run-${crypto.randomUUID()}`;
    const pub = new End(game, 'publish', undefined, 'Claudebot1');
    await pub.connect();
    expect(await pub.req('listing', listing)).toEqual({ watchers: 0 });
    const frame = { kind: 'key', seq: 1, round: 2, view: { gold: 3 } };
    await pub.req('key', { frame });
    const w = new End(game, 'watch', undefined, 'Claudebot2');
    const heard = pub.next((m) => m.t === 'watchers');
    await w.connect();
    expect(w.hello).toMatchObject({ role: 'watch', key: frame, row: { game_id: game, display_name: 'Claudebot1', round: 2, phase: 'shop', mode: 'practice', live_host: `cf:${CONTENT}` } });
    expect(await heard).toMatchObject({ n: 1, list: [{ user_id: w.userId, display_name: 'Claudebot2', profile: { avatar: 'a1' } }] });
    // The player's stream reaches the stands; a watcher's key request reaches the player.
    const got = w.next((m) => m.t === 'bc' && m.event === 'spectate');
    pub.client.broadcast('spectate', { kind: 'delta', seq: 2 });
    expect(await got).toMatchObject({ payload: { kind: 'delta', seq: 2 }, from: pub.userId });
    const ask = pub.next((m) => m.t === 'bc' && m.event === 'spectate_key');
    w.client.broadcast('spectate_key', {});
    expect(await ask).toMatchObject({ from: w.userId });
    // A listing change reaches the watcher as a row.
    const row = w.next((m) => m.t === 'row');
    await pub.req('listing', { ...listing, round: 3, phase: 'combat' });
    expect(await row).toMatchObject({ row: { round: 3, phase: 'combat' } });
    // Nobody else can publish this game; the player cannot watch its own.
    const thief = new End(game, 'publish');
    await expect(thief.connect()).rejects.toThrow('not_owner');
    const self = new End(game, 'watch', pub.userId);
    await expect(self.connect()).rejects.toThrow();
    for (const e of [pub, w]) e.client.close();
  });

  it('the stands hold 20; a watcher reconnecting never counts twice', async () => {
    const game = `run-${crypto.randomUUID()}`;
    const pub = new End(game, 'publish');
    await pub.connect();
    await pub.req('listing', listing);
    const ws = Array.from({ length: LIVE_WATCHER_CAP }, (_, i) => new End(game, 'watch', undefined, `Claudebot${i + 2}`));
    for (const w of ws) await w.connect();
    const late = new End(game, 'watch', undefined, 'Claudebot99');
    await expect(late.connect()).rejects.toThrow('spectators_full');
    await sleep(200);
    expect(late.status).toMatch(/^dead/); // refused for good: no reconnect loop
    // The same account again (a reload): the old socket is replaced, the count stays 20.
    const again = new End(game, 'watch', ws[0]!.userId, 'Claudebot2');
    await again.connect();
    await sleep(200);
    expect((await metrics(game)).watchers).toBe(LIVE_WATCHER_CAP);
    for (const w of [...ws, again, pub]) w.client.close();
  });

  it('the end: the watch record is written first (ended), then the end reaches the stands, and the row is removed', async () => {
    const game = `run-${crypto.randomUUID()}`;
    const pub = new End(game, 'publish');
    await pub.connect();
    await pub.req('listing', listing);
    const w = new End(game, 'watch', undefined, 'Claudebot2');
    await w.connect();
    await sleep(1500); // the arrival beat (`SPECTATE_SOON_MS`)
    let m = await metrics(game);
    expect(m.beatLog.flatMap((x: any) => x.beats)).toEqual(expect.arrayContaining([expect.objectContaining({ user: w.userId, kind: 'lobby', target: game, watched_user: pub.userId, ended: false })]));
    const end = w.next((x) => x.t === 'end');
    await pub.req('end', { placement: 3 });
    expect(await end).toMatchObject({ placement: 3, abandoned: false, row: { phase: 'end', placement: 3 } });
    m = await metrics(game);
    const last = m.beatLog.at(-1).beats;
    expect(last).toEqual([expect.objectContaining({ user: w.userId, ended: true })]);
    await sleep(300);
    m = await metrics(game);
    expect(m.rows.map((r: any) => r.row?.phase ?? null)).toEqual(['shop', null]); // listed once, removed once
    // An ended game takes no new watcher.
    await expect(new End(game, 'watch').connect()).rejects.toThrow('no_game');
    for (const e of [pub, w]) e.client.close();
  });

  it('a watcher leaving beats once more; a flood is cut off (rate limit)', async () => {
    const game = `run-${crypto.randomUUID()}`;
    const pub = new End(game, 'publish');
    await pub.connect();
    await pub.req('listing', listing);
    const w = new End(game, 'watch', undefined, 'Claudebot2');
    await w.connect();
    await sleep(1300);
    const before = (await metrics(game)).beatLog.length;
    const gone = pub.next((x) => x.t === 'watchers' && x.n === 0);
    w.client.close();
    await gone;
    await sleep(1500);
    const after = (await metrics(game)).beatLog;
    expect(after.length).toBe(before + 1);
    expect(after.at(-1).beats).toEqual([expect.objectContaining({ user: w.userId })]);
    // Flood: far past the burst and the 200 refusals, the socket is closed (1008).
    for (let i = 0; i < 400; i++) pub.client.broadcast('spectate_cursor', { i });
    await sleep(500);
    expect(pub.client.stats.reconnects).toBeGreaterThanOrEqual(1); // closed 1008 (the client then reconnects)
    pub.client.close();
  });
});

describe('a Versus room beats its stands (R-LIVE-CF-XP-01)', () => {
  it('a spectator with the watch screen on is beaten on the current match; a player never', async () => {
    const { a, b, roomId } = await toRoundOne(base);
    const s = new Player(base, crypto.randomUUID(), 'Claudebot3');
    await s.connect(roomId);
    await s.req('join', { as: 'spectator', display: s.name, profile: {}, content: CONTENT, protocol: VERSUS_PROTOCOL });
    await sleep(1500);
    const m = await (await fetch(`${base}/rooms/${roomId}/metrics`)).json() as { watchBeats: { beats: { user: string; kind: string; target: string }[] }[] };
    const beats = m.watchBeats.flatMap((x) => x.beats);
    expect(beats).toEqual(expect.arrayContaining([expect.objectContaining({ user: s.userId, kind: 'versus', target: a.matchId })]));
    expect(beats.some((x) => x.user === a.userId || x.user === b.userId)).toBe(false);
    for (const p of [a, b, s]) p.client!.close();
  });
});

/** A ping on a card the watched player owns (seat `p1`). */
const ping = (id: string) => ({ id, kind: 'check', owner: 'p1', target: { t: 'card', uid: '31', zone: 'board' }, from: 'spoofed', role: 'self' });

describe('LIVE PINGS end to end in workerd: promote, then the mentor pings (R-PING-03, R-PING-06)', () => {
  it('the lobby / Practice live object: the player names a watcher Mentor; the mentor ping reaches the player ONLY, stamped; a plain watcher is dropped', async () => {
    const game = `run-${crypto.randomUUID()}`;
    const pub = new End(game, 'publish', undefined, 'Claudebot1');
    await pub.connect();
    await pub.req('listing', listing);
    const mentor = new End(game, 'watch', undefined, 'Claudebot2');
    const plain = new End(game, 'watch', undefined, 'Claudebot3');
    await mentor.connect();
    await plain.connect();
    // The player promotes: every watcher hears who is mentoring.
    const heardM = mentor.next((m) => m.t === 'bc' && m.event === 'ping_mentor');
    const heardP = plain.next((m) => m.t === 'bc' && m.event === 'ping_mentor');
    pub.client.broadcast('ping_mentor', { seat: 'p1', mentor: mentor.userId, name: 'Claudebot2' });
    expect(await heardM).toMatchObject({ payload: { seat: 'p1', mentor: mentor.userId } });
    await heardP;
    // The mentor pings the player's card: the player gets it as a mentor ping from the mentor; the other watcher never.
    const got = pub.next((m) => m.t === 'bc' && m.event === 'ping');
    mentor.client.broadcast('ping', ping('m.1'));
    expect(await got).toMatchObject({ payload: { id: 'm.1', role: 'mentor', from: mentor.userId, owner: 'p1' }, from: mentor.userId });
    // A plain watcher's ping is dropped; the player's own ping reaches both watchers.
    plain.client.broadcast('ping', ping('p.1'));
    const own = plain.next((m) => m.t === 'bc' && m.event === 'ping');
    pub.client.broadcast('ping', ping('o.1'));
    expect(await own).toMatchObject({ payload: { id: 'o.1', role: 'self', from: pub.userId } });
    await sleep(500);
    expect(pub.pushes.some((m) => m.t === 'bc' && m.event === 'ping' && (m.payload as { id?: string }).id === 'p.1')).toBe(false);
    expect(plain.pushes.some((m) => m.t === 'bc' && m.event === 'ping' && (m.payload as { id?: string }).id === 'm.1')).toBe(false);
    for (const e of [pub, mentor, plain]) e.client.close();
  });

  it('a Versus room: player 1 names a spectator Mentor; the mentor ping reaches player 1 ONLY (never the opponent or the stands)', async () => {
    const { a, b, roomId } = await toRoundOne(base);
    const s = new Player(base, crypto.randomUUID(), 'Claudebot3');
    const t = new Player(base, crypto.randomUUID(), 'Claudebot4');
    for (const p of [s, t]) {
      await p.connect(roomId);
      await p.req('join', { as: 'spectator', display: p.name, profile: {}, content: CONTENT, protocol: VERSUS_PROTOCOL });
    }
    const heard = s.next((m) => m.t === 'bc' && m.event === 'ping_mentor');
    a.client!.broadcast('ping_mentor', { seat: 'p1', mentor: s.userId, name: s.name });
    await heard;
    const got = a.next((m) => m.t === 'bc' && m.event === 'ping');
    s.client!.broadcast('ping', ping('m.1'));
    expect((await got).msg).toMatchObject({ payload: { id: 'm.1', role: 'mentor', from: s.userId }, from: s.userId });
    // A plain spectator's ping is dropped.
    t.client!.broadcast('ping', ping('p.1'));
    await sleep(600);
    expect(a.arrivals.some((x) => x.msg.t === 'bc' && x.msg.event === 'ping' && (x.msg.payload as { id?: string }).id === 'p.1')).toBe(false);
    for (const p of [b, t]) expect(p.arrivals.some((x) => x.msg.t === 'bc' && x.msg.event === 'ping')).toBe(false);
    for (const p of [a, b, s, t]) p.client!.close();
  });
});
