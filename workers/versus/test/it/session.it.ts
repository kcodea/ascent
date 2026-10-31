/**
 * THE GAME SESSION in real workerd (`npm run versus:cf:test`, local only; R-SESSION-CF-01). The rules are on a fake clock
 * in `test/sessionCore.test.ts` and the SQL writer in `test/sessionCf.db.test.ts`; this proves what only the runtime can,
 * on the friends hub Worker (persistence off: the session's flushes go to its local recorder, which answers as Supabase
 * would):
 *
 *  - SPECTATING ON THE SESSION: the player publishes on `/session/<game>/ws`; a watcher joins (the row says
 *    `live_host: 'session'`), a LATE joiner opens on the cached keyframe, the stream and the lobby chat relay, the hub's own
 *    directory lists the game (one listing, from the session) and drops it at the end; the end reaches the stands.
 *  - THE SESSION: saves are held (no flush during play); the run-end writes are kept once per key; the rate request
 *    settles in ONE flush with every write held so far, and a retried rate gets the same answer with no second flush; the
 *    clear goes with the settled flush; Save & Quit (`park`) writes the held save at once; a watcher reads the table's seat
 *    recordings from the session.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VersusCfClient, type WebSocketLike } from '../../src/client';
import { LIVE_CF_PROTOCOL, type LiveHelloAnswer, type LivePush } from '../../src/liveProtocol';
import { SESSION_PROTOCOL, sessionPath, sessionSocketPath } from '../../src/sessionProtocol';
import { RANK_RULES_VERSION, RANK_SEASON } from '../../../../supabase/functions/_shared/lobbyRating';
import { CONTENT, startHubWorker } from './driver';

const NodeWS = (globalThis as unknown as { WebSocket: new (url: string, protocols: string[]) => WebSocketLike }).WebSocket;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let hub = '';
let dispose: () => Promise<void> = async () => undefined;
beforeAll(async () => {
  const h = await startHubWorker();
  hub = h.url;
  dispose = h.dispose;
}, 120_000);
afterAll(async () => dispose());

class End {
  readonly pushes: LivePush[] = [];
  hello: LiveHelloAnswer | null = null;
  client: VersusCfClient;
  private waiters: { pred: (m: LivePush) => boolean; resolve: (m: LivePush) => void }[] = [];
  constructor(readonly gameId: string, readonly role: 'publish' | 'watch', readonly userId = crypto.randomUUID(), readonly name = 'Claudebot') {
    this.client = new VersusCfClient({
      baseUrl: hub, roomId: gameId, path: sessionSocketPath(gameId), token: async () => `dev.${this.userId}.${this.name}`,
      versusProtocol: 0, contentRevision: CONTENT, ws: (url, protocols) => new NodeWS(url, protocols),
      hello: () => ({ protocol: LIVE_CF_PROTOCOL, role, name: this.name, profile: { avatar: 'a1' }, contentRevision: 'some-other-build' }),
      onHello: (d) => { this.hello = d as LiveHelloAnswer; },
      onPush: (m) => this.push(m as unknown as LivePush),
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

const call = async (gameId: string, op: string, user: string, body?: Record<string, unknown>): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${hub}${sessionPath(gameId, op as never)}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer dev.${user}.Claudebot1`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify({ protocol: SESSION_PROTOCOL, ...body }) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const metrics = async (gameId: string) => (await fetch(`${hub}${sessionPath(gameId, 'metrics')}`)).json() as Promise<Record<string, any>>;
const listing = { name: 'Claudebot1', hero: 'warden', round: 3, phase: 'shop', mode: 'ranked', division: 4, points: 20 };

describe('spectating a session-hosted game (R-SESSION-CF-01)', () => {
  it('publish, watch, a late joiner on the keyframe, relays, the chat, the hub directory, the end', async () => {
    const game = crypto.randomUUID();
    const pub = new End(game, 'publish', undefined, 'Claudebot1');
    await pub.connect();
    expect(pub.hello).toMatchObject({ role: 'publish' });
    expect(await pub.req('listing', listing)).toEqual({ watchers: 0 });
    const frame = { kind: 'key', seq: 1, round: 3, view: { gold: 5 } };
    await pub.req('key', { frame });

    // The hub's own directory lists the game ONCE, from the session, with live_host 'session'.
    let row: any = null;
    for (let i = 0; i < 20 && !row; i++) {
      row = await (await fetch(`${hub}/live/game/${encodeURIComponent(game)}`, { headers: { Authorization: `Bearer dev.${crypto.randomUUID()}.Reader` } })).json();
      if (!row) await sleep(200);
    }
    expect(row).toMatchObject({ game_id: game, live_host: 'session', round: 3 });

    const w = new End(game, 'watch', undefined, 'Claudebot2');
    const heard = pub.next((m) => m.t === 'watchers');
    await w.connect();
    expect(w.hello).toMatchObject({ role: 'watch', key: frame, row: { game_id: game, live_host: 'session', display_name: 'Claudebot1', phase: 'shop' } });
    expect(await heard).toMatchObject({ n: 1 });
    const got = w.next((m) => m.t === 'bc' && m.event === 'spectate');
    pub.client.broadcast('spectate', { kind: 'delta', seq: 2 });
    expect(await got).toMatchObject({ payload: { kind: 'delta', seq: 2 }, from: pub.userId });

    // A LATE joiner: the newest keyframe the player stored.
    const frame2 = { kind: 'key', seq: 9, round: 4, view: { gold: 7 } };
    await pub.req('key', { frame: frame2 });
    const late = new End(game, 'watch', undefined, 'Claudebot3');
    await late.connect();
    expect(late.hello).toMatchObject({ role: 'watch', key: frame2 });

    // The lobby chat: a spectator's line reaches the player and the other watcher.
    const toPub = pub.next((m) => m.t === 'bc' && m.event === 'lobby_chat');
    const toLate = late.next((m) => m.t === 'bc' && m.event === 'lobby_chat');
    w.client.broadcast('lobby_chat', { cid: 'c1', body: 'nice roll' });
    expect(await toPub).toMatchObject({ payload: { body: 'nice roll' } });
    expect(await toLate).toMatchObject({ payload: { body: 'nice roll' } });

    // The end reaches the stands and the row leaves the directory.
    const ended = w.next((m) => m.t === 'end');
    await pub.req('end', { placement: 2 });
    expect(await ended).toMatchObject({ placement: 2, abandoned: false });
    let gone = false;
    for (let i = 0; i < 20 && !gone; i++) {
      gone = (await (await fetch(`${hub}/live/game/${encodeURIComponent(game)}`, { headers: { Authorization: `Bearer dev.${crypto.randomUUID()}.Reader` } })).json()) == null;
      if (!gone) await sleep(200);
    }
    expect(gone).toBe(true);
    for (const e of [pub, w, late]) e.client.close();
  });
});

describe('the session: held during play, flushed once (R-SESSION-CF-01)', () => {
  it('saves held; writes kept once; the rate settles them in ONE flush; a retry gets the same answer; the clear follows', async () => {
    const game = crypto.randomUUID();
    const me = crypto.randomUUID();
    expect((await call(game, 'table', me, { mode: 'ranked', seatKeys: ['p1|warden|1', 'p2|soren|2'], seatRuns: [[{ seed: 1, wave: 1, minions: [] }]], seatHybrids: [] })).status).toBe(200);
    for (let r = 1; r <= 3; r++) {
      const s = await call(game, 'save', me, { runKey: `run:${game}`, expected: 0, deviceId: 'dev1', save: `{"round":${r}}` });
      expect(s).toEqual({ status: 200, body: { status: 'ok', revision: 0, seats: true } });
    }
    expect((await metrics(game)).flushCalls).toEqual([]); // nothing during play
    // Someone else cannot use my session.
    expect((await call(game, 'save', crypto.randomUUID(), { runKey: `run:${game}`, expected: 0, deviceId: 'x', save: '{}' })).status).toBe(403);
    // A watcher reads the table's seat recordings from the session.
    expect((await call(game, 'seats', crypto.randomUUID())).body).toEqual({ boards: [{ seed: 1, wave: 1, minions: [] }] });

    const boards = { key: 'boards:b1:2', kind: 'boards', table: 'boards', conflict: 'user_id,upload_key', rows: [{ wave: 1 }, { wave: 2 }] };
    expect((await call(game, 'write', me, { item: boards })).body).toEqual({ ok: true, held: true });
    expect((await call(game, 'write', me, { item: boards })).body).toEqual({ ok: true, held: false });
    expect((await call(game, 'write', me, { item: { key: 'history:1', kind: 'history', table: 'run_history', rows: [{ entry: { seed: 5 } }] } })).status).toBe(200);
    expect((await call(game, 'write', me, { item: { key: 'x', table: 'profiles', rows: [{}] } })).status).toBe(400);

    const req = { runId: game, placement: 3, seasonId: RANK_SEASON, rulesVersion: RANK_RULES_VERSION, seed: 5, seatKeys: ['bot:hybrid:a'] };
    const rated = await call(game, 'rate', me, { req });
    expect(rated.status).toBe(200);
    expect(rated.body).toMatchObject({ status: 'confirmed', deduped: false, parity: true, via: 'session' });
    let m = await metrics(game);
    expect(m.flushCalls).toHaveLength(1);
    // The pinned table settles, never the keys sent with the request.
    expect(m.flushCalls[0].p_rating).toMatchObject({ run_id: game, placement: 3, seat_keys: ['p1|warden|1', 'p2|soren|2'] });
    expect(m.flushCalls[0].p_writes.map((w: { key: string }) => w.key)).toEqual(['boards:b1:2', 'history:1']);
    expect(m.flushCalls[0].p_user).toBe(me);
    // A retried rate request: the same answer, no second flush.
    const again = await call(game, 'rate', me, { req });
    expect(again.body).toEqual(rated.body);
    expect((await metrics(game)).flushCalls).toHaveLength(1);

    // The end's clear (and a late write) settle together once the writes go quiet.
    expect((await call(game, 'write', me, { item: { key: 'telemetry:1', kind: 'telemetry', table: 'run_telemetry', rows: [{ telemetry: {} }] } })).status).toBe(200);
    expect((await call(game, 'clear', me, { runKey: `run:${game}`, expected: 0 })).body).toEqual({ status: 'ok' });
    for (let i = 0; i < 40 && (await metrics(game)).flushCalls.length < 2; i++) await sleep(500);
    m = await metrics(game);
    expect(m.flushCalls).toHaveLength(2);
    expect(m.flushCalls[1]).toMatchObject({ p_clear: { run_key: `run:${game}`, expected: 0 }, p_rating: null });
    expect(m.flushCalls[1].p_writes.map((w: { key: string }) => w.key)).toEqual(['telemetry:1']);
    expect(m.pendingFlush).toBe(false);
  }, 60_000);

  it('Save & Quit (park) writes the held save at once; the next save carries the row revision', async () => {
    const game = crypto.randomUUID();
    const me = crypto.randomUUID();
    await call(game, 'save', me, { runKey: `run:${game}`, expected: 0, deviceId: 'dev1', save: '{"round":4}', seatRuns: [[{ seed: 3, wave: 1 }]] });
    const parked = await call(game, 'park', me, {});
    expect(parked.body).toEqual({ ok: true, saved: true });
    const m = await metrics(game);
    expect(m.flushCalls).toHaveLength(1);
    expect(m.flushCalls[0].p_save).toMatchObject({ run_key: `run:${game}`, expected: 0, device: 'dev1', payload: { v: 1, save: '{"round":4}', seatRuns: [[{ seed: 3, wave: 1 }]] } });
    expect(m.savedRow).toEqual({ run_key: `run:${game}`, revision: 1 });
    expect((await call(game, 'save', me, { runKey: `run:${game}`, expected: 0, deviceId: 'dev1', save: '{"round":5}', seatsSame: true })).body).toMatchObject({ status: 'ok', revision: 1 });
  });

  it('the switch is read at /session/config; an old protocol is refused', async () => {
    const cfg = await (await fetch(`${hub}/session/config`)).json();
    expect(cfg).toEqual({ enabled: false, protocol: SESSION_PROTOCOL });
    const res = await fetch(`${hub}${sessionPath(crypto.randomUUID(), 'save')}`, {
      method: 'POST', headers: { Authorization: `Bearer dev.${crypto.randomUUID()}.x`, 'Content-Type': 'application/json' }, body: JSON.stringify({ protocol: 0 }),
    });
    expect(res.status).toBe(409);
  });
});
