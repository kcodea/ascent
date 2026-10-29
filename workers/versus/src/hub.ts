/**
 * THE FRIENDS HUB — one Durable Object per account (`hub:<userId>`), holding that account's open games' sockets.
 * It runs on its OWN, version-independent Worker (`ascent-hub`, `hubWorker.ts` + `hub.wrangler.toml`; owner 2026-10-29),
 * never on the per-content-revision Versus Worker, so every build's players share one hub
 * (owner 2026-10-29: "start building in game messaging"; R-DM-01..05). Wire: `hubProtocol.ts`. Rules: `core/hubCore.ts`.
 *
 *   - PRESENCE: the first open game says hello with my presence; the hub tells each of my friends' hubs (`peerUpdate`),
 *     and each answers with ITS presence when that friend is connected too, so both sides learn of each other at once.
 *     A change (`presence`) goes to the friends who are connected; the last game closing tells them I went offline.
 *   - DIRECT MESSAGES: `send` is checked here (rate, size), stored in Supabase (`dmStore.ts`, which enforces friends only
 *     and blocks), then pushed to my friend's hub (`deliver`), which pushes it to every game they have open. A friend
 *     with no game open reads it from Supabase the next time they open the conversation (offline delivery).
 *
 * COST: nothing ticks while nobody is connected. While a game is open: keep-alive pings are answered by the runtime
 * without waking the object; one sweep alarm a minute closes dead sockets (a half-open phone connection never sends a
 * close). Supabase sees one write per message sent and one friends read per hello (at most every 2 minutes).
 *
 * HIBERNATION: the account id, my presence and the connected friends are in storage; every socket carries its
 * attachment. The rate limit lives in memory (a wake resets it, which only ever errs generous; Postgres keeps a
 * per-minute backstop).
 */
import { DurableObject } from 'cloudflare:workers';
import { checkSend, DmError, DmRateLimiter, MemoryDmBackend, type DmBackend } from './core/hubCore';
import { dmBackendFor } from './dmStore';
import {
  cleanPresence, HUB_FRIENDS_TTL_MS, HUB_MAX_SOCKETS, HUB_PROTOCOL, HUB_PROTOCOL_MIN, HUB_STALE_MS, HUB_SWEEP_MS, isUuid,
  type DmRow, type HubHelloAnswer, type HubPeer, type HubPresence, type HubPush,
} from './hubProtocol';
import type { HubStoreEnv } from './dmStore';
import { VERSUS_CF_CLOSE, VERSUS_CF_PING, VERSUS_CF_PONG, VERSUS_CF_SUBPROTOCOL, parseClientMessage } from './protocol';
import { takeToken, type Bucket } from './rate';

export const HUB_USER_HEADER = 'X-Hub-User';

export interface HubEnv extends HubStoreEnv {
  HUB: DurableObjectNamespace<FriendHub>;
}

interface Attachment {
  userId: string;
  at: number;
  /** The socket said hello (it counts as an open game). */
  hello: boolean;
}

/** The longest a hello waits for the friends' hubs to answer before it answers with what it has. */
const FANOUT_WAIT_MS = 3_000;
/** A hub's frames are tiny: anything larger is refused outright. */
const HUB_MAX_FRAME_CHARS = 8_000;

export const hubName = (userId: string): string => `hub:${userId.toLowerCase()}`;

export class FriendHub extends DurableObject<HubEnv> {
  private me: string | null = null;
  private presence: HubPresence | null = null;
  private peers = new Map<string, HubPeer>();
  private friends: { ids: string[]; at: number } | null = null;
  private loaded = false;
  private readonly backend: DmBackend;
  private readonly limiter = new DmRateLimiter();
  private readonly buckets = new WeakMap<CfWebSocket, Bucket>();

  constructor(ctx: DurableObjectState, env: HubEnv) {
    super(ctx, env);
    this.backend = dmBackendFor(env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(VERSUS_CF_PING, VERSUS_CF_PONG));
  }

  // ── state ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    if (this.loaded) return;
    const got = await this.ctx.storage.get<unknown>(['me', 'presence', 'peers']);
    this.me = (got.get('me') as string | undefined) ?? this.me;
    this.presence = (got.get('presence') as HubPresence | undefined) ?? null;
    const peers = (got.get('peers') as HubPeer[] | undefined) ?? [];
    this.peers = new Map(peers.map((p) => [p.userId, p]));
    this.loaded = true;
  }

  private async savePeers(): Promise<void> {
    await this.ctx.storage.put('peers', [...this.peers.values()]);
  }

  private att(ws: CfWebSocket): Attachment {
    return (ws.deserializeAttachment() as Attachment | null) ?? { userId: '', at: 0, hello: false };
  }

  private openSockets(except?: CfWebSocket): CfWebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws !== except && ws.readyState === 1 && this.att(ws).hello);
  }

  private hub(userId: string): FriendHub {
    return this.env.HUB.get(this.env.HUB.idFromName(hubName(userId))) as unknown as FriendHub;
  }

  /** My friends (cached `HUB_FRIENDS_TTL_MS`; `force` reads again). A failed read keeps the old list. */
  private async friendIds(force = false): Promise<string[]> {
    const now = Date.now();
    if (!force && this.friends && now - this.friends.at < HUB_FRIENDS_TTL_MS) return this.friends.ids;
    try {
      this.friends = { ids: await this.backend.friendsOf(this.me!), at: now };
    } catch {
      if (!this.friends) return [];
    }
    return this.friends!.ids;
  }

  // ── the upgrade ────────────────────────────────────────────────────────────────────────────────────────────────

  async fetch(req: Request): Promise<Response> {
    const userId = req.headers.get(HUB_USER_HEADER)?.toLowerCase() ?? '';
    if (!isUuid(userId) || req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
    await this.load();
    if (this.me !== userId) { this.me = userId; await this.ctx.storage.put('me', userId); }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment({ userId, at: Date.now(), hello: false } satisfies Attachment);
    // At most HUB_MAX_SOCKETS open games per account: the oldest beyond that is closed.
    const all = this.ctx.getWebSockets().filter((ws) => ws.readyState === 1).sort((a, b) => this.att(a).at - this.att(b).at);
    for (const ws of all.slice(0, Math.max(0, all.length - HUB_MAX_SOCKETS))) {
      try { ws.close(VERSUS_CF_CLOSE.replaced, 'replaced'); } catch { /* closing */ }
    }
    await this.arm();
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': VERSUS_CF_SUBPROTOCOL } } as CfResponseInit);
  }

  // ── messages ───────────────────────────────────────────────────────────────────────────────────────────────────

  async webSocketMessage(ws: CfWebSocket, raw: string | ArrayBuffer): Promise<void> {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    if (text === VERSUS_CF_PING) { this.send(ws, VERSUS_CF_PONG); return; }
    if (text.length > HUB_MAX_FRAME_CHARS) { try { ws.close(1009, 'too_big'); } catch { /* gone */ } return; }
    const msg = parseClientMessage(text);
    if (!msg || msg.t !== 'req') return;
    const now = Date.now();
    const answer = (ok: boolean, payload: unknown): void => this.send(ws, JSON.stringify(ok
      ? { t: 'res', id: msg.id, ok: true, data: payload, now: new Date().toISOString() }
      : { t: 'res', id: msg.id, ok: false, error: payload, now: new Date().toISOString() }));
    const { bucket, ok, flood } = takeToken(this.buckets.get(ws), 'req', now);
    this.buckets.set(ws, bucket);
    if (!ok) {
      if (flood) { try { ws.close(1008, 'rate_limited'); } catch { /* gone */ } }
      answer(false, 'rate_limited');
      return;
    }
    await this.load();
    const a = this.att(ws);
    const args = (msg.args ?? {}) as Record<string, unknown>;
    try {
      switch (msg.op as string) {
        case 'hello': answer(true, await this.hello(ws, a, args)); return;
        case 'presence': await this.setPresence(cleanPresence(args.presence)); answer(true, null); return;
        case 'send': {
          if (!a.hello) { answer(false, 'not_ready'); return; }
          answer(true, await this.sendDm(ws, args, now));
          return;
        }
        default: answer(false, 'bad_op');
      }
    } catch (e) {
      answer(false, e instanceof DmError ? e.code : 'unavailable');
    }
  }

  private async hello(ws: CfWebSocket, a: Attachment, args: Record<string, unknown>): Promise<HubHelloAnswer> {
    // Old and new clients share ONE hub: any protocol from the oldest still supported up is accepted (a newer client
    // speaks down to this hub; unknown fields are ignored). Only a client older than HUB_PROTOCOL_MIN is refused.
    const proto = Number(args.protocol);
    if (!Number.isInteger(proto) || proto < HUB_PROTOCOL_MIN) {
      try { ws.close(VERSUS_CF_CLOSE.versionMismatch, 'version_mismatch'); } catch { /* gone */ }
      throw new DmError('unavailable');
    }
    // DEV ONLY (a local `wrangler dev`, nothing stored): a hello may name its friends and blocks, so dev tabs can talk.
    if (this.env.DEV_AUTH === '1' && this.backend instanceof MemoryDmBackend) {
      for (const f of Array.isArray(args.devFriends) ? args.devFriends : []) if (isUuid(f)) this.backend.befriend(this.me!, f.toLowerCase());
      for (const b of Array.isArray(args.devBlocked) ? args.devBlocked : []) if (isUuid(b)) this.backend.block(this.me!, b.toLowerCase());
      this.friends = null;
    }
    const wasOnline = this.openSockets(ws).length > 0;
    ws.serializeAttachment({ ...a, hello: true } satisfies Attachment);
    const presence = cleanPresence(args.presence) ?? this.presence ?? { status: 'online' };
    this.presence = presence;
    await this.ctx.storage.put('presence', presence);
    // The first open game: tell every friend I am here, and hear back from the ones who are too.
    if (!wasOnline) await this.fanOut(await this.friendIds(true), presence, true);
    else await this.fanOut([...this.peers.keys()], presence, false);
    await this.arm();
    return { protocol: HUB_PROTOCOL, me: this.me!, peers: [...this.peers.values()], now: new Date().toISOString() };
  }

  /** Tell `targets` my presence (null: offline). `learn`: keep who answered as connected (my going-online round). */
  private async fanOut(targets: string[], presence: HubPresence | null, learn: boolean): Promise<void> {
    if (!targets.length || !this.me) return;
    const at = Date.now();
    const me = this.me;
    const calls = targets.map(async (id) => {
      const theirs = await this.hub(id).peerUpdate(me, presence, at);
      return { id, theirs };
    });
    const settled = await Promise.race([
      Promise.allSettled(calls),
      new Promise<null>((r) => setTimeout(() => r(null), FANOUT_WAIT_MS)),
    ]);
    if (!learn || !settled) return;
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      if (s.value.theirs) this.peers.set(s.value.id, { userId: s.value.id, presence: s.value.theirs, at });
      else this.peers.delete(s.value.id);
    }
    await this.savePeers();
  }

  private async setPresence(p: HubPresence | null): Promise<void> {
    if (!p || !this.openSockets().length) return;
    const same = JSON.stringify(p) === JSON.stringify(this.presence);
    this.presence = p;
    await this.ctx.storage.put('presence', p);
    if (same) return;
    // Connected friends hear it; a friend added since the last read hears it too (and may answer that they are here).
    const known = new Set(this.friends?.ids ?? []);
    const fresh = (await this.friendIds()).filter((id) => !known.has(id) && !this.peers.has(id));
    await this.fanOut([...this.peers.keys()], p, false);
    if (fresh.length) await this.fanOut(fresh, p, true);
  }

  private async sendDm(ws: CfWebSocket, args: Record<string, unknown>, now: number): Promise<DmRow> {
    const me = this.me!;
    const chk = checkSend(me, args);
    if (!this.limiter.take(now)) throw new DmError('rate_limited');
    const row = await this.backend.send(me, chk).catch((e: unknown) => {
      throw e instanceof DmError ? e : new DmError('unavailable');
    });
    // My other open games show it too; the friend's hub pushes it to theirs (a closed game reads it from Supabase).
    const push = JSON.stringify({ t: 'dm', msg: row } satisfies HubPush);
    for (const o of this.openSockets(ws)) this.send(o, push);
    try { await this.hub(chk.to).deliver(row); } catch { /* stored: they read it on their next open */ }
    return row;
  }

  // ── calls from other hubs ──────────────────────────────────────────────────────────────────────────────────────

  /** A friend's presence changed (null: they went offline). Answers mine when I have a game open. */
  async peerUpdate(from: string, presence: HubPresence | null, at: number): Promise<HubPresence | null> {
    await this.load();
    const open = this.openSockets();
    if (!open.length) return null;
    const id = from.toLowerCase();
    const p = presence ? cleanPresence(presence) : null;
    const peer: HubPeer = { userId: id, presence: p, at };
    if (p) this.peers.set(id, peer); else this.peers.delete(id);
    await this.savePeers();
    const push = JSON.stringify({ t: 'peer', peer } satisfies HubPush);
    for (const ws of open) this.send(ws, push);
    return this.presence ?? { status: 'online' };
  }

  /** A message to me, already stored: pushed to my open games. */
  async deliver(row: DmRow): Promise<boolean> {
    await this.load();
    const open = this.openSockets();
    const push = JSON.stringify({ t: 'dm', msg: row } satisfies HubPush);
    for (const ws of open) this.send(ws, push);
    return open.length > 0;
  }

  // ── closing ────────────────────────────────────────────────────────────────────────────────────────────────────

  async webSocketClose(ws: CfWebSocket, code?: number): Promise<void> {
    try { ws.close(code === 1005 || code === 1006 || code == null ? 1000 : code, 'closed'); } catch { /* closed */ }
    await this.load();
    await this.maybeOffline(ws);
  }

  async webSocketError(ws: CfWebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /** The last open game went away: my friends hear I am offline, and the hub forgets who was connected. */
  private async maybeOffline(gone?: CfWebSocket): Promise<void> {
    if (this.openSockets(gone).length) return;
    const peers = [...this.peers.keys()];
    this.peers.clear();
    await this.savePeers();
    await this.fanOut(peers, null, false);
  }

  /** The sweep: dead sockets are closed (and, when none is left, I go offline). */
  async alarm(): Promise<void> {
    await this.load();
    const now = Date.now();
    let closed = false;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== 1) continue;
      const last = Math.max(this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0, this.att(ws).at);
      if (now - last > HUB_STALE_MS) {
        try { ws.close(4001, 'stale'); } catch { /* gone */ }
        closed = true;
      }
    }
    if (closed) await this.maybeOffline();
    await this.arm();
  }

  private async arm(): Promise<void> {
    if (!this.ctx.getWebSockets().some((ws) => ws.readyState === 1)) return;
    const cur = await this.ctx.storage.getAlarm();
    if (cur == null || cur < Date.now()) await this.ctx.storage.setAlarm(Date.now() + HUB_SWEEP_MS);
  }

  private send(ws: CfWebSocket, text: string): void {
    try { ws.send(text); } catch { /* the close handler follows */ }
  }
}
