/**
 * VERSUS ON CLOUDFLARE — a headless player over the real protocol (the integration tests and `npm run versus:cf:measure`
 * both drive the local Worker through this). It is NOT the game client: it sends the same messages the game's dev
 * transport sends, with fixture boards, and records when each push arrived.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_startWorker } from 'wrangler';
import { HEROES, type PreparedCombatSide } from '@game/sim';
import { engineContentRevision, VERSUS_PROTOCOL } from '@game/sim/versus/server';
import { VersusCfClient, versusCfHttp, type WebSocketLike } from '../../src/client';
import type { VersusCfPush } from '../../src/protocol';

export interface Case { name: string; matchSeed: number; round: number; p1: PreparedCombatSide; p2: PreparedCombatSide }
export const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../packages/sim/src/versus/fixtures/parity.v1.json', import.meta.url)), 'utf8')) as { cases: Case[] };
export const HERO_IDS = HEROES.slice(0, 6).map((h) => h.id);
export const CONTENT = engineContentRevision();

export const IT_WRITER_SECRET = 'it-writer-secret-not-real';

export async function startLocalWorker(): Promise<{ url: string; dispose: () => Promise<void> }> {
  const worker = await unstable_startWorker({
    config: fileURLToPath(new URL('../../wrangler.toml', import.meta.url)),
    // A TEST writer secret (persistence stays off: no PERSIST, no Supabase URL), so the room can sign invite proofs.
    // No hub beside it: the directory half is off (`LIVE_DIR_OFF`), and a dev registry of its own lets the `LIVE_DIR`
    // service binding start unconnected instead of failing the runtime. `liveDir.it.ts` runs a hub with a shared registry.
    bindings: { DEV_AUTH: { type: 'plain_text', value: '1' }, VERSUS_WRITER_SECRET: { type: 'plain_text', value: IT_WRITER_SECRET }, LIVE_DIR_OFF: { type: 'plain_text', value: '1' } },
    dev: { server: { port: 0 }, inspector: false, persist: false, registry: mkdtempSync(join(tmpdir(), 'ascent-versus-it-')), logLevel: (process.env.VERSUS_CF_LOG as never) ?? 'error' } as never,
  });
  await worker.ready;
  const url = String(await worker.url).replace(/\/$/, '');
  return { url, dispose: () => worker.dispose() };
}

/** THE FRIENDS HUB's own Worker (`hub.wrangler.toml`), local, dev tokens on, nothing stored. `registry`: a dev registry
 *  folder shared with Versus Workers started alongside, so their `LIVE_DIR` service binding reaches this hub. */
export async function startHubWorker(registry?: string): Promise<{ url: string; dispose: () => Promise<void> }> {
  const worker = await unstable_startWorker({
    config: fileURLToPath(new URL('../../hub.wrangler.toml', import.meta.url)),
    bindings: { DEV_AUTH: { type: 'plain_text', value: '1' } },
    dev: { server: { port: 0 }, inspector: false, persist: false, logLevel: (process.env.VERSUS_CF_LOG as never) ?? 'error', ...(registry ? { registry } : {}) } as never,
  });
  await worker.ready;
  const url = String(await worker.url).replace(/\/$/, '');
  return { url, dispose: () => worker.dispose() };
}

const NodeWS = (globalThis as unknown as { WebSocket: new (url: string, protocols: string[]) => WebSocketLike }).WebSocket;

export interface Arrival { at: number; wall: number; msg: VersusCfPush }

export class Player {
  readonly token: string;
  client: VersusCfClient | null = null;
  readonly arrivals: Arrival[] = [];
  match: Record<string, any> | null = null;
  room: Record<string, any> | null = null;
  priv: Record<string, any> | null = null;
  rounds = new Map<number, Record<string, any>>();
  private waiters: { pred: (a: Arrival) => boolean; resolve: (a: Arrival) => void }[] = [];

  constructor(readonly base: string, readonly userId: string, readonly name: string) {
    this.token = `dev.${userId}.${name}`;
  }

  async createRoom(): Promise<string> {
    const room = await versusCfHttp<Record<string, any>>(this.base, '/rooms', this.token, {
      method: 'POST', body: { name: `${this.name}'s room`, display: this.name, profile: {}, setId: 'set1', contentRevision: CONTENT, protocol: VERSUS_PROTOCOL },
    });
    return room.id as string;
  }

  async connect(roomId: string): Promise<void> {
    this.client = new VersusCfClient({
      baseUrl: this.base, roomId, token: async () => this.token, versusProtocol: VERSUS_PROTOCOL, contentRevision: CONTENT,
      ws: (url, protocols) => new NodeWS(url, protocols),
      onPush: (msg) => this.push(msg),
    });
    await this.client.connect();
  }

  private push(msg: VersusCfPush): void {
    const a = { at: performance.now(), wall: Date.now(), msg };
    this.arrivals.push(a);
    if (msg.t === 'match') this.match = msg.match;
    if (msg.t === 'room') this.room = msg.room;
    if (msg.t === 'priv') this.priv = msg.priv;
    if (msg.t === 'round') this.rounds.set(Number(msg.row.round), msg.row);
    this.waiters = this.waiters.filter((w) => (w.pred(a) ? (w.resolve(a), false) : true));
  }

  /** The next push (from now) matching `pred`. */
  next(pred: (msg: VersusCfPush) => boolean, timeoutMs = 20_000): Promise<Arrival> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.name}: timed out waiting`)), timeoutMs);
      this.waiters.push({ pred: (a) => pred(a.msg), resolve: (a) => { clearTimeout(t); resolve(a); } });
    });
  }

  req<T = any>(op: Parameters<VersusCfClient['request']>[0], args: Record<string, unknown> = {}): Promise<T> {
    return this.client!.request<T>(op, args);
  }

  get matchId(): string {
    return this.match!.id as string;
  }
}

/** Two players from an empty room to round 1's running shop. */
export async function toRoundOne(base: string): Promise<{ a: Player; b: Player; roomId: string }> {
  const a = new Player(base, crypto.randomUUID(), 'Claudebot1');
  const b = new Player(base, crypto.randomUUID(), 'Claudebot2');
  const roomId = await a.createRoom();
  await a.connect(roomId);
  await b.connect(roomId);
  await b.req('join', { as: 'player', display: b.name, profile: {}, content: CONTENT, protocol: VERSUS_PROTOCOL });
  await a.req('start');
  await a.req('gate');
  await b.req('gate');
  const mid = (await a.req('sync')).match.id as string;
  await a.req('register_offer', { matchId: mid, offer: HERO_IDS.slice(0, 3) });
  await b.req('register_offer', { matchId: mid, offer: HERO_IDS.slice(3, 6) });
  await a.req('pick_hero', { matchId: mid, index: 0 });
  await b.req('pick_hero', { matchId: mid, index: 0 });
  await a.req('intro_done', { matchId: mid });
  await b.req('intro_done', { matchId: mid });
  return { a, b, roomId };
}

export const sideOf = (round: number, seat: 'p1' | 'p2'): PreparedCombatSide =>
  structuredClone(FIXTURE.cases[(round - 1) % FIXTURE.cases.length]![seat]);

/** n Group players (3-4) from an empty room to round 1's running shop. */
export async function toGroupShop(base: string, n: 3 | 4, mode: 'group' | 'duos' = 'group'): Promise<{ players: Player[]; roomId: string; matchId: string }> {
  const players = Array.from({ length: n }, (_, i) => new Player(base, crypto.randomUUID(), `Claudebot${i + 1}`));
  const host = players[0]!;
  const roomId = await host.createRoom();
  for (const p of players) await p.connect(roomId);
  await host.req('set_options', { options: { v: 1, mode, modifiers: [] } });
  for (const p of players.slice(1)) await p.req('join', { as: 'player', display: p.name, profile: {}, content: CONTENT, protocol: VERSUS_PROTOCOL });
  await host.req('start');
  for (const p of players) await p.req('gate');
  const matchId = (await host.req('sync')).match.id as string;
  for (let i = 0; i < n; i++) await players[i]!.req('register_offer', { matchId, offer: HERO_IDS.slice((i * 3) % 6, (i * 3) % 6 + 3) });
  for (const p of players) await p.req('pick_hero', { matchId, index: 0 });
  for (const p of players) await p.req('intro_done', { matchId });
  return { players, roomId, matchId };
}
