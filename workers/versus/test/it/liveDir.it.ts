/**
 * LIVE GAMES ON THE HUB in real workerd (`npm run versus:cf:test`, local only; R-LIVE-DIR-01, R-FRIENDS-HUB-LIVE-01). The
 * rules are unit-tested in `test/liveDirCore.test.ts`; this proves what only the runtime can:
 *  - TWO Versus Workers (two deployments, as two content revisions are) register their games into the ONE hub
 *    directory through the `LIVE_DIR` service binding (the hub's `LiveDirectoryWriter` entrypoint), and players read the
 *    whole list, the count and one row from the hub over HTTP;
 *  - a live lobby game appears when it lists and goes when it ends; a running Versus match is listed as `versus:cf:<id>`;
 *  - the directory has no public write route; a read needs a token;
 *  - the hub's inbox nudge (protocol 3): my nudge reaches my friend's open game as an `inbox` push, and a `friends` nudge
 *    makes a new friend appear online at once.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unstable_startWorker } from 'wrangler';
import { VersusCfClient, type WebSocketLike } from '../../src/client';
import { HUB_PROTOCOL, HUB_SOCKET_PATH, type HubPush } from '../../src/hubProtocol';
import { LIVE_CF_PROTOCOL, liveCfSocketPath } from '../../src/liveProtocol';
import { CONTENT, IT_WRITER_SECRET, startHubWorker, toRoundOne } from './driver';

const NodeWS = (globalThis as unknown as { WebSocket: new (url: string, protocols: string[]) => WebSocketLike }).WebSocket;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One dev registry for the three Workers, so the Versus Workers' `LIVE_DIR` service binding reaches the hub. */
const REGISTRY = mkdtempSync(join(tmpdir(), 'ascent-live-dir-'));

/** A Versus Worker under its own name (two of them stand for two deployed content revisions). */
async function startVersusWorker(name: string): Promise<{ url: string; dispose: () => Promise<void> }> {
  const worker = await unstable_startWorker({
    name,
    config: fileURLToPath(new URL('../../wrangler.toml', import.meta.url)),
    bindings: { DEV_AUTH: { type: 'plain_text', value: '1' }, VERSUS_WRITER_SECRET: { type: 'plain_text', value: IT_WRITER_SECRET } },
    dev: { server: { port: 0 }, inspector: false, persist: false, registry: REGISTRY, logLevel: (process.env.VERSUS_CF_LOG as never) ?? 'error' } as never,
  } as never);
  await worker.ready;
  return { url: String(await worker.url).replace(/\/$/, ''), dispose: () => worker.dispose() };
}

let hub = '';
let a = '';
let b = '';
const stops: (() => Promise<void>)[] = [];
beforeAll(async () => {
  const h = await startHubWorker(REGISTRY);
  hub = h.url;
  stops.push(h.dispose);
  const wa = await startVersusWorker('ascent-versus-it-a');
  const wb = await startVersusWorker('ascent-versus-it-b');
  a = wa.url; b = wb.url;
  stops.push(wa.dispose, wb.dispose);
}, 120_000);
afterAll(async () => { for (const s of stops.reverse()) await s(); });

const reader = `dev.${crypto.randomUUID()}.Claudebot9`;
const get = async (path: string, token: string | null = reader): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${hub}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: await res.json().catch(() => null) };
};
/** Wait until the hub's list satisfies `pred` (the writes are off the request path). */
async function listUntil(pred: (rows: any[]) => boolean, ms = 15_000): Promise<any[]> {
  const until = Date.now() + ms;
  for (;;) {
    const rows = (await get('/live/games')).body as any[];
    if (pred(rows)) return rows;
    if (Date.now() > until) throw new Error(`the list never got there: ${JSON.stringify(rows)}`);
    await sleep(200);
  }
}

/** A live lobby game's publisher on one Versus Worker. */
async function publish(base: string, gameId: string, name: string): Promise<VersusCfClient> {
  const userId = crypto.randomUUID();
  const c = new VersusCfClient({
    baseUrl: base, roomId: gameId, path: liveCfSocketPath(gameId), token: async () => `dev.${userId}.${name}`,
    versusProtocol: 0, contentRevision: CONTENT, ws: (url, protocols) => new NodeWS(url, protocols),
    hello: () => ({ protocol: LIVE_CF_PROTOCOL, role: 'publish', name, profile: {}, contentRevision: CONTENT }),
  });
  await c.connect();
  await c.request('listing' as never, { name, hero: 'warden', round: 2, phase: 'shop', mode: 'practice', division: 3, points: 10, rating: 1200 });
  return c;
}

describe('the live directory spans every Versus Worker (R-LIVE-DIR-01)', () => {
  it('two Workers\' games in one list, the count and one row; a game that ends leaves', async () => {
    const g1 = `it-${crypto.randomUUID()}`;
    const g2 = `it-${crypto.randomUUID()}`;
    const p1 = await publish(a, g1, 'Claudebot1');
    const p2 = await publish(b, g2, 'Claudebot2');
    const rows = await listUntil((r) => [g1, g2].every((g) => r.some((x) => x.game_id === g)));
    const r1 = rows.find((x) => x.game_id === g1);
    expect(r1).toMatchObject({ display_name: 'Claudebot1', mode: 'practice', live_host: `cf:${CONTENT}`, round: 2, phase: 'shop', division_index: 3 });
    expect((await get('/live/count')).body.count).toBeGreaterThanOrEqual(2);
    expect((await get(`/live/game/${encodeURIComponent(g2)}`)).body).toMatchObject({ game_id: g2, display_name: 'Claudebot2' });
    await p1.request('end' as never, { placement: 2 });
    await listUntil((r) => !r.some((x) => x.game_id === g1) && r.some((x) => x.game_id === g2));
    expect((await get(`/live/game/${encodeURIComponent(g1)}`)).body).toBeNull();
    p1.close(); p2.close();
  });

  it('a running Versus match is listed as versus:cf:<room>', async () => {
    const { a: pa, b: pb, roomId } = await toRoundOne(a);
    const rows = await listUntil((r) => r.some((x) => x.game_id === `versus:cf:${roomId}`));
    expect(rows.find((x) => x.game_id === `versus:cf:${roomId}`)).toMatchObject({ mode: 'duel', players: 'Claudebot1 vs Claudebot2', display_name: 'Claudebot1' });
    pa.client?.close(); pb.client?.close();
  });

  it('no public write route; a read without a token is refused; a guest token reads', async () => {
    const put = await fetch(`${hub}/live/games`, { method: 'POST', headers: { Authorization: `Bearer ${reader}` }, body: '{}' });
    expect(put.status).toBe(405);
    expect((await get('/live/games', null)).status).toBe(401);
    expect((await get('/live/count')).status).toBe(200);
  });
});

describe('inbox nudges (hub protocol 3, R-FRIENDS-HUB-LIVE-01)', () => {
  class Game {
    readonly pushes: HubPush[] = [];
    client: VersusCfClient;
    constructor(readonly userId: string, friends: string[]) {
      this.client = new VersusCfClient({
        baseUrl: hub, roomId: 'hub', path: HUB_SOCKET_PATH, token: async () => `dev.${userId}.Claudebot`,
        versusProtocol: 0, contentRevision: CONTENT, ws: (url, protocols) => new NodeWS(url, protocols),
        hello: () => ({ protocol: HUB_PROTOCOL, build: CONTENT, presence: { status: 'online' }, devFriends: friends }),
        onPush: (m) => { this.pushes.push(m as unknown as HubPush); },
      });
    }
    async until(pred: (m: HubPush) => boolean, ms = 10_000): Promise<HubPush> {
      const end = Date.now() + ms;
      for (;;) {
        const hit = this.pushes.find(pred);
        if (hit) return hit;
        if (Date.now() > end) throw new Error('no such push');
        await sleep(50);
      }
    }
  }

  it('an invite nudge reaches my friend\'s open game as an inbox push; a bad target is refused', async () => {
    const ann = crypto.randomUUID();
    const bob = crypto.randomUUID();
    const g1 = new Game(ann, [bob]);
    const g2 = new Game(bob, [ann]);
    await g1.client.connect();
    await g2.client.connect();
    expect(await g1.client.request('nudge' as never, { to: bob, kind: 'invite' })).toBe(true);
    expect(await g2.until((m) => m.t === 'inbox')).toEqual({ t: 'inbox', kind: 'invite' });
    await expect(g1.client.request('nudge' as never, { to: ann, kind: 'invite' })).rejects.toThrow(/bad_target/);
    await expect(g1.client.request('nudge' as never, { to: bob, kind: 'party' })).rejects.toThrow(/bad_target/);
    g1.client.close(); g2.client.close();
  });

  it('a friends nudge makes a new friend appear online at once', async () => {
    const ann = crypto.randomUUID();
    const cat = crypto.randomUUID();
    // Cat is online. Ann's first game knows no friends; the friendship is then stored (a dev hello of Ann's second game
    // names Cat, as an accepted request would), and Cat's accept nudges Ann's hub, which reads her friends again.
    const gc = new Game(cat, [ann]);
    await gc.client.connect();
    const ga = new Game(ann, []);
    await ga.client.connect();
    const ga2 = new Game(ann, [cat]);
    await ga2.client.connect();
    expect(ga.pushes.some((m) => m.t === 'peer' && m.peer.userId === cat)).toBe(false);
    await gc.client.request('nudge' as never, { to: ann, kind: 'friends' });
    const peer = await ga.until((m) => m.t === 'peer' && m.peer.userId === cat);
    expect(peer).toMatchObject({ t: 'peer', peer: { userId: cat, presence: { status: 'online' } } });
    ga.client.close(); ga2.client.close(); gc.client.close();
  });
});
