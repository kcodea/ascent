/**
 * THE FRIENDS HUB in real workerd, on its OWN Worker (`hub.wrangler.toml`; `npm run versus:cf:test`, local only; R-DM-01). The rules are unit-tested in
 * `test/hubCore.test.ts` and the store in `test/dm.db.test.ts`; this proves what only the runtime can, over real
 * sockets on a dev Worker (memory store, friends named in the dev hello):
 *  - presence: a friend coming online is pushed to me, and I am in their hello; a status change and going offline too;
 *  - a direct message is delivered live to every open game of the friend, and to my own other game;
 *  - a non-friend and a blocked friend are refused; the 5 / 10 s rate limit; a too-long body;
 *  - ONE hub for every build: clients on different content revisions, and an older and a newer hub protocol (with
 *    fields this hub does not know), see each other's presence and messages at once;
 *  - a client older than the oldest supported protocol is refused; /health answers the protocol range;
 *  - the Versus Worker no longer serves the hub;
 *  - a socket with no token is refused (a guest is refused in `index.ts`: dev tokens are always accounts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VersusCfClient, type WebSocketLike } from '../../src/client';
import { DM_MAX_CHARS, HUB_PROTOCOL, HUB_PROTOCOL_MIN, HUB_SOCKET_PATH, type HubHelloAnswer, type HubPush } from '../../src/hubProtocol';
import { CONTENT, startHubWorker, startLocalWorker } from './driver';

let base = '';
let dispose: () => Promise<void> = async () => undefined;
beforeAll(async () => {
  const w = await startHubWorker();
  base = w.url;
  dispose = w.dispose;
});
afterAll(async () => dispose());

const NodeWS = (globalThis as unknown as { WebSocket: new (url: string, protocols: string[]) => WebSocketLike }).WebSocket;

class Game {
  readonly pushes: HubPush[] = [];
  hello: HubHelloAnswer | null = null;
  client: VersusCfClient;
  private waiters: { pred: (m: HubPush) => boolean; resolve: (m: HubPush) => void }[] = [];
  constructor(readonly userId: string, opts: { friends?: string[]; blocked?: string[]; status?: 'online' | 'in_game'; build?: string; protocol?: number; extra?: Record<string, unknown> } = {}) {
    this.client = new VersusCfClient({
      baseUrl: base, roomId: 'hub', path: HUB_SOCKET_PATH, token: async () => `dev.${userId}.Claudebot`,
      versusProtocol: 0, contentRevision: opts.build ?? CONTENT, ws: (url, protocols) => new NodeWS(url, protocols),
      hello: () => ({
        protocol: opts.protocol ?? HUB_PROTOCOL, build: opts.build ?? CONTENT, presence: { status: opts.status ?? 'online' },
        devFriends: opts.friends ?? [], devBlocked: opts.blocked ?? [], ...(opts.extra ?? {}),
      }),
      onHello: (d) => { this.hello = d as HubHelloAnswer; },
      onPush: (m) => this.push(m as unknown as HubPush),
    });
  }
  private push(m: HubPush): void {
    this.pushes.push(m);
    this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
  }
  next(pred: (m: HubPush) => boolean, ms = 10_000): Promise<HubPush> {
    const had = this.pushes.find(pred);
    if (had) return Promise.resolve(had);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timed out waiting for a push')), ms);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  }
  send(to: string, body: string, cid: string = crypto.randomUUID()): Promise<any> {
    return this.client.request('send' as never, { to, body, cid });
  }
}

const fails = async (p: Promise<unknown>): Promise<string> => {
  try { await p; } catch (e) { return (e as Error).message; }
  return 'did not fail';
};

describe('the friends hub (R-DM-01)', () => {
  it('pushes presence both ways, delivers messages live, and says when a friend goes offline', async () => {
    const ann = crypto.randomUUID();
    const bob = crypto.randomUUID();
    const a = new Game(ann, { friends: [bob] });
    await a.client.connect();
    expect(a.hello?.peers).toEqual([]);
    const b = new Game(bob, { friends: [ann], status: 'in_game' });
    await b.client.connect();
    // Bob's hello names Ann (she was here first), and Ann is told Bob arrived.
    expect(b.hello?.peers.map((p) => p.userId)).toEqual([ann]);
    const arrived = await a.next((m) => m.t === 'peer' && m.peer.userId === bob);
    expect(arrived.t === 'peer' && arrived.peer.presence?.status).toBe('in_game');

    // A message reaches both of Bob's open games, and Ann's second game.
    const b2 = new Game(bob, { friends: [ann] });
    await b2.client.connect();
    const a2 = new Game(ann, { friends: [bob] });
    await a2.client.connect();
    const row = await a.send(bob, '  good   game!  ');
    expect(row).toMatchObject({ from: ann, to: bob, body: 'good game!' });
    for (const g of [b, b2, a2]) {
      const m = await g.next((x) => x.t === 'dm' && x.msg.id === row.id);
      expect(m.t === 'dm' && m.msg.body).toBe('good game!');
    }

    // A status change, then Bob closing every game: Ann hears both.
    await b.client.request('presence' as never, { presence: { status: 'online', mode: null } });
    await a.next((m) => m.t === 'peer' && m.peer.userId === bob && m.peer.presence?.status === 'online');
    b.client.close();
    b2.client.close();
    await a.next((m) => m.t === 'peer' && m.peer.userId === bob && m.peer.presence === null);
    a.client.close();
    a2.client.close();
  });

  it('refuses non-friends, blocked friends, floods and long bodies', async () => {
    const ann = crypto.randomUUID();
    const bob = crypto.randomUUID();
    const cat = crypto.randomUUID();
    const a = new Game(ann, { friends: [bob, cat], blocked: [cat] });
    await a.client.connect();
    expect(await fails(a.send(crypto.randomUUID(), 'hi'))).toBe('not_friends');
    expect(await fails(a.send(cat, 'hi'))).toBe('blocked');
    expect(await fails(a.send(bob, 'x'.repeat(DM_MAX_CHARS + 1)))).toBe('bad_body');
    a.client.close();
    // 5 per 10 s, per account (a fresh account: every send above that reached the store used a slot).
    const dan = crypto.randomUUID();
    const d = new Game(dan, { friends: [bob] });
    await d.client.connect();
    let sent = 0;
    let refused = '';
    for (let i = 0; i < 6 && !refused; i++) {
      try { await d.send(bob, `m${i}`); sent++; } catch (e) { refused = (e as Error).message; }
    }
    expect(refused).toBe('rate_limited');
    expect(sent).toBe(5);
    d.client.close();
  });

  it('one hub for every build: different content revisions and protocols see each other and talk at once', async () => {
    const ann = crypto.randomUUID();
    const bob = crypto.randomUUID();
    // Ann on an older build speaking the oldest protocol; Bob on a newer build, a newer protocol, with fields this hub
    // has never heard of (they are ignored, never refused).
    const a = new Game(ann, { friends: [bob], build: 'aaaaaaaaaaaa', protocol: HUB_PROTOCOL_MIN });
    await a.client.connect();
    const b = new Game(bob, { friends: [ann], build: 'bbbbbbbbbbbb', protocol: HUB_PROTOCOL + 1, status: 'in_game', extra: { futureField: { x: 1 } } });
    await b.client.connect();
    expect(b.hello?.protocol).toBe(HUB_PROTOCOL);
    expect(b.hello?.peers.map((p) => p.userId)).toEqual([ann]);
    await a.next((m) => m.t === 'peer' && m.peer.userId === bob && m.peer.presence?.status === 'in_game');
    const row = await b.send(ann, 'same hub, different builds', crypto.randomUUID());
    const got = await a.next((m) => m.t === 'dm' && m.msg.id === row.id);
    expect(got.t === 'dm' && got.msg.body).toBe('same hub, different builds');
    a.client.close();
    b.client.close();
  });

  it('refuses a client older than the oldest supported protocol; /health names the range', async () => {
    const health = await (await fetch(`${base}/health`)).json() as { hub: number; min: number; code: string };
    expect(health).toMatchObject({ hub: HUB_PROTOCOL, min: HUB_PROTOCOL_MIN });
    const old = new Game(crypto.randomUUID(), { protocol: HUB_PROTOCOL_MIN - 1 });
    expect(await fails(old.client.connect())).not.toBe('did not fail');
    old.client.close();
  });

  it('the Versus Worker no longer serves the hub', async () => {
    const v = await startLocalWorker();
    try {
      const res = await fetch(`${v.url}${HUB_SOCKET_PATH}`, { headers: { Authorization: `Bearer dev.${crypto.randomUUID()}.Claudebot` } });
      expect(res.status).toBe(404);
    } finally { await v.dispose(); }
  });

  it('refuses a socket with no token', async () => {
    const res = await fetch(`${base}${HUB_SOCKET_PATH}`);
    expect(res.status).toBe(401);
  });
});
