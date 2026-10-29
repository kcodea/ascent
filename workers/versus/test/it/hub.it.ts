/**
 * THE FRIENDS HUB in real workerd (`npm run versus:cf:test`, local only; R-DM-01). The rules are unit-tested in
 * `test/hubCore.test.ts` and the store in `test/dm.db.test.ts`; this proves what only the runtime can, over real
 * sockets on a dev Worker (memory store, friends named in the dev hello):
 *  - presence: a friend coming online is pushed to me, and I am in their hello; a status change and going offline too;
 *  - a direct message is delivered live to every open game of the friend, and to my own other game;
 *  - a non-friend and a blocked friend are refused; the 5 / 10 s rate limit; a too-long body;
 *  - a socket with no token is refused (a guest is refused in `index.ts`: dev tokens are always accounts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VersusCfClient, type WebSocketLike } from '../../src/client';
import { DM_MAX_CHARS, HUB_PROTOCOL, HUB_SOCKET_PATH, type HubHelloAnswer, type HubPush } from '../../src/hubProtocol';
import { CONTENT, startLocalWorker } from './driver';

let base = '';
let dispose: () => Promise<void> = async () => undefined;
beforeAll(async () => {
  const w = await startLocalWorker();
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
  constructor(readonly userId: string, opts: { friends?: string[]; blocked?: string[]; status?: 'online' | 'in_game' } = {}) {
    this.client = new VersusCfClient({
      baseUrl: base, roomId: 'hub', path: HUB_SOCKET_PATH, token: async () => `dev.${userId}.Claudebot`,
      versusProtocol: 0, contentRevision: CONTENT, ws: (url, protocols) => new NodeWS(url, protocols),
      hello: () => ({ protocol: HUB_PROTOCOL, presence: { status: opts.status ?? 'online' }, devFriends: opts.friends ?? [], devBlocked: opts.blocked ?? [] }),
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

  it('refuses a socket with no token', async () => {
    const res = await fetch(`${base}${HUB_SOCKET_PATH}`);
    expect(res.status).toBe(401);
  });
});
