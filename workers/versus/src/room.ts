/**
 * VERSUS ON CLOUDFLARE — the Room Durable Object (spike, 2026-10-28; 1v1 only).
 *
 * One object per room (named by the room's uuid). It holds the room, its current match and its rounds in memory, owns
 * every deadline through ONE alarm, and talks to each member over a hibernatable WebSocket. All game rules live in
 * `core/roomCore.ts`; this file is the shell:
 *
 *   socket in  → core.op (synchronous) → write dirty storage keys → push room / match / round / priv → re-arm the alarm
 *   alarm      → core.tick (deadlines, presence, the 0:00 close and its resolve) → same, plus the persistence outbox
 *   close      → core.disconnect (a seat is "gone" after DISCONNECT_GRACE_MS, then the match pauses)
 *
 * HIBERNATION: between messages the object may be evicted while its sockets stay open. Everything that matters is in
 * storage (see core/storage.ts), each socket carries its user in its attachment, and keep-alive pings are answered by
 * the runtime without waking the object (`setWebSocketAutoResponse`). On wake the state is re-read and the open
 * sockets re-counted (`restoreSockets`).
 */
import { DurableObject } from 'cloudflare:workers';
import { engineContentRevision, VERSUS_PROTOCOL } from '@game/sim/versus/server';
import { CoreError, newRoomState, RoomCore, type CoreEffects, type CreateRoomInput, type PersistJob } from './core/roomCore';
import { stateFromEntries, valueOfKey } from './core/storage';
import type { VersusDirectory } from './directory';
import { PERSIST_DEAD_AFTER, persistBackoffMs, sinkFor, type PersistEnv, type PersistSink } from './persist';
import type { RankedService } from './core/rankedMatch';
import { rankedServiceFor } from './rankedService';
import { liveListingOf } from './core/liveListing';
import { LIVE_STORAGE_KEY, liveSinkFor, LiveSlot } from './live';
import { signInviteProof } from './invites';
import { MAX_FRAME_CHARS, takeToken, type Bucket } from './rate';
import { spectateSinkFor, WatchReporter, type SpectateSink } from './spectate';
import { roomWatchKey, roomWatchOf, type RoomWatch } from './core/roomWatch';
import { PING_CLEAR_EVENT, PING_CLEAR_RATE, PING_EVENT, PING_MENTOR_EVENT, PingRateLimiter, routePing, routePingClear, routePingMentor, withMentor, type PingMode, type PingRoomView, type PingSeat } from './pings';
import { GUEST_HEADER, LOBBY_CHAT_EVENT, LOBBY_CHAT_REFUSED_EVENT, LOBBY_CHAT_STORAGE_KEY, LOBBY_CHAT_SYNC_EVENT, LobbyChat, type LobbyChatSender } from './lobbyChat';
import {
  parseClientMessage,
  VERSUS_CF_CLOSE,
  VERSUS_CF_PING,
  VERSUS_CF_PONG,
  VERSUS_CF_PROTOCOL,
  VERSUS_CF_STALE_MS,
  VERSUS_CF_SUBPROTOCOL,
  type VersusCfHello,
  type VersusCfPush,
  type VersusCfRequest,
} from './protocol';

export interface RoomEnv extends PersistEnv {
  DIRECTORY: DurableObjectNamespace<VersusDirectory>;
  DEV_AUTH?: string;
}

interface Attachment {
  userId: string;
  hello: boolean;
  /** When this socket opened (the newest socket of an account wins). */
  at: number;
  /** A guest account (stamped by the Worker): reads the lobby chat, never posts (R-LOBBY-CHAT-01). */
  guest?: boolean;
}

/** Per-room counters (DEV `/rooms/<id>/metrics`; the measurement script reads them). */
interface RoomMetrics {
  msgsIn: number;
  msgsOut: number;
  bytesIn: number;
  bytesOut: number;
  resolveMs: number[];
  alarms: number;
  wakes: number;
}

export const INTERNAL_USER_HEADER = 'X-Versus-User';

/** Per-socket rate limit: `rate.ts` (shared with the live game objects). */

/** Storage key of the current match's mentors (`relayPing`). */
const PING_MENTORS_KEY = 'pingMentors';

const uuid = (): string => crypto.randomUUID();
const random31 = (): number => crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;

export class VersusRoom extends DurableObject<RoomEnv> {
  private core: RoomCore | null = null;
  private loaded = false;
  private readonly sink: PersistSink;
  private readonly rankedSvc: RankedService;
  /** The room's Live Games row (Ranked Duos only; `live.ts`). Rebuilt on every load with the key last published. */
  private liveSlot: LiveSlot | null = null;
  private outboxSeq = 0;
  private outboxAttempt = 0;
  private outboxRetryAt: number | null = null;
  private readonly buckets = new WeakMap<CfWebSocket, Bucket>();
  /** SPECTATOR XP (R-LIVE-CF-XP-01): the room beats its stands' watch record (`spectate.ts`, `core/roomWatch.ts`). */
  private readonly watchSink: SpectateSink;
  private readonly watchReporter = new WatchReporter();
  private watchNow: RoomWatch = { target: null, beats: [] };
  private watchKey = '';
  /** LIVE PINGS (R-PING-01): each seat's promoted mentor for the CURRENT match (a new match forgets them), and the
   *  per-sender ping limit. Stored under `PING_MENTORS_KEY` so a hibernation wake keeps who is mentoring. */
  private pingMentors: { matchId: string | null; mentors: Partial<Record<PingSeat, string>> } = { matchId: null, mentors: {} };
  private readonly pingLimit = new PingRateLimiter();
  private readonly pingClearLimit = new PingRateLimiter(PING_CLEAR_RATE);
  /** LOBBY CHAT (R-LOBBY-CHAT-01): the room's chat (every seat and the stands), read from storage on first use. */
  private chat: LobbyChat | null = null;
  private readonly metrics: RoomMetrics = { msgsIn: 0, msgsOut: 0, bytesIn: 0, bytesOut: 0, resolveMs: [], alarms: 0, wakes: 0 };

  constructor(ctx: DurableObjectState, env: RoomEnv) {
    super(ctx, env);
    this.sink = sinkFor(env);
    this.rankedSvc = rankedServiceFor(env);
    this.watchSink = spectateSinkFor(env);
    // Keep-alive answered by the runtime itself: a ping never wakes a hibernating room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(VERSUS_CF_PING, VERSUS_CF_PONG));
    // The state is read once, before any event is delivered (a wake from hibernation runs the constructor again).
    void ctx.blockConcurrencyWhile(async () => { await this.load(); });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────────────────────────────────────────

  private deps() {
    return {
      random31,
      uuid,
      perfNow: () => performance.now(),
      onResolve: (round: number, ms: number) => {
        this.metrics.resolveMs.push(Math.round(ms * 10) / 10);
        console.log(JSON.stringify({ ev: 'versus_cf_resolve', room: this.core?.state.room.id, round, ms: Math.round(ms) }));
      },
    };
  }

  /** Re-read the state after a wake (hibernation or restart). */
  private async load(): Promise<RoomCore | null> {
    if (this.loaded) return this.core;
    const entries = await this.ctx.storage.list();
    const state = stateFromEntries(entries);
    for (const k of entries.keys()) if (k.startsWith('ob:')) this.outboxSeq = Math.max(this.outboxSeq, Number(k.slice(3)) + 1);
    this.loaded = true;
    this.metrics.wakes += 1;
    this.liveSlot = this.makeLiveSlot((entries.get(LIVE_STORAGE_KEY) as string | undefined) ?? null);
    const pm = entries.get(PING_MENTORS_KEY) as typeof this.pingMentors | undefined;
    if (pm && typeof pm === 'object' && pm.mentors) this.pingMentors = pm;
    if (!state) return null;
    this.core = new RoomCore(state, this.deps());
    this.core.restoreSockets(this.liveSockets().map((ws) => this.att(ws).userId), Date.now());
    return this.core;
  }

  /*
   * NO MUTEX. Every rule runs synchronously inside RoomCore (the resolve awaits only in-memory promises), so two events
   * can never interleave inside an op, and storage writes hold the runtime's input gate. The only real I/O (the
   * directory, the persistence writer) happens before an op or after its effects are written and sent. (A promise-chain
   * mutex would also be fragile here: the runtime may cancel a running alarm handler when another event moves the alarm,
   * and a cancelled job would never settle for the jobs queued behind it.)
   */

  private att(ws: CfWebSocket): Attachment {
    return (ws.deserializeAttachment() as Attachment | null) ?? { userId: '', hello: false, at: 0 };
  }

  private liveSockets(): CfWebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === 1);
  }

  private makeLiveSlot(published: string | null): LiveSlot {
    return new LiveSlot(
      liveSinkFor(this.env),
      () => this.core?.state.room.id ?? null,
      async (key) => { if (key == null) await this.ctx.storage.delete(LIVE_STORAGE_KEY); else await this.ctx.storage.put(LIVE_STORAGE_KEY, key); },
      published,
      Date.now(),
    );
  }

  /** LIVE GAMES (R-VERSUS-CF-LIVE-01): bring the room's listing row up to date, off the request path. A write happens
   *  only when the listing's key changed (start, round, phase, end) or the keep-alive is due; see `live.ts`. */
  private syncLive(): void {
    const core = this.core;
    const slot = this.liveSlot;
    if (!core || !slot) return;
    slot.want(liveListingOf(core.state));
    if (!slot.due(Date.now())) return;
    void slot.flush(Date.now()).then(() => this.rearm()).catch(() => undefined);
  }

  /**
   * SPECTATOR XP (R-LIVE-CF-XP-01): who in the stands watches the current match, beaten for the watch record. A change
   * (someone arrives or leaves, the match ends) beats soon; otherwise every `SPECTATE_REPORT_MS` while anyone watches.
   * Off the request path; a failed beat is dropped (as the client's was).
   */
  private syncWatch(now: number): void {
    const core = this.core;
    if (!core) return;
    const connected = new Set(this.liveSockets().filter((ws) => this.att(ws).hello).map((ws) => this.att(ws).userId));
    const w = roomWatchOf(core.state, connected, now);
    const key = roomWatchKey(w);
    if (key !== this.watchKey) {
      const here = new Set(w.target === this.watchNow.target ? w.beats.map((b) => b.user) : []);
      for (const b of this.watchNow.beats) if (!here.has(b.user)) this.watchReporter.left(b, now);
      this.watchReporter.poke(now);
      this.watchKey = key;
    }
    this.watchNow = w;
    if (!this.watchReporter.due(now, w.beats.length > 0)) return;
    const beats = this.watchReporter.take(now, w.beats);
    if (beats.length) void this.watchSink.write(beats).catch((e) => this.log({ ev: 'versus_cf_watch_beat_failed', n: beats.length, error: String(e) }));
  }

  // ── RPC from the Worker ────────────────────────────────────────────────────────────────────────────────────────

  /** Create the room (the Worker calls this once, with a fresh id). Answers the room json. */
  async init(input: CreateRoomInput): Promise<{ ok: true; room: Record<string, unknown> } | { ok: false; error: string }> {
    {
      const existing = await this.load();
      if (existing) return { ok: false as const, error: 'room_exists' };
      try {
        const state = newRoomState(input, Date.now());
        this.core = new RoomCore(state, this.deps());
        await this.ctx.storage.put('meta', valueOfKey(state, 'meta'));
        await this.directory().upsert(this.core.summary() as never);
        this.liveSlot ??= this.makeLiveSlot(null);
        await this.rearm();
        return { ok: true as const, room: this.core.roomJson() };
      } catch (e) {
        return { ok: false as const, error: e instanceof CoreError ? e.code : 'init_failed' };
      }
    }
  }

  async metricsSnapshot(): Promise<RoomMetrics & { persistLive: boolean; persisted: number; watchBeats: unknown[] }> {
    const ob = await this.ctx.storage.list({ prefix: 'ob:' });
    return {
      ...this.metrics, persistLive: this.sink.live, persisted: (this.sink as { written?: unknown[] }).written?.length ?? 0, ...{ outbox: ob.size },
      watchBeats: (this.watchSink as { written?: unknown[] }).written ?? [],
    };
  }

  // ── HTTP (the WebSocket upgrade) ───────────────────────────────────────────────────────────────────────────────

  async fetch(req: Request): Promise<Response> {
    const userId = req.headers.get(INTERNAL_USER_HEADER);
    if (!userId || req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
    {
      const core = await this.load();
      if (!core || core.state.room.closed) return new Response('no_room', { status: 404 });
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server, [userId]);
      const at = Date.now();
      server.serializeAttachment({ userId, hello: false, at, guest: req.headers.get(GUEST_HEADER) === '1' } satisfies Attachment);
      // One live socket per account per room: an older one (a reload, a second tab) is closed as replaced.
      for (const ws of this.ctx.getWebSockets(userId)) {
        if (ws !== server && this.att(ws).at <= at) {
          try { ws.close(VERSUS_CF_CLOSE.replaced, 'replaced'); } catch { /* already closing */ }
        }
      }
      this.log({ ev: 'versus_cf_socket', op: 'open', user: userId, sockets: this.ctx.getWebSockets(userId).length });
      await this.apply(core.connect(userId, at));
      await this.rearm();
      return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': VERSUS_CF_SUBPROTOCOL } } as CfResponseInit);
    }
  }

  // ── WebSocket handlers (hibernation API) ───────────────────────────────────────────────────────────────────────

  async webSocketMessage(ws: CfWebSocket, raw: string | ArrayBuffer): Promise<void> {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    this.metrics.msgsIn += 1;
    this.metrics.bytesIn += text.length;
    if (text === VERSUS_CF_PING) { this.send(ws, VERSUS_CF_PONG); return; } // (only when awake; asleep, the runtime answers)
    if (text.length > MAX_FRAME_CHARS) { try { ws.close(1009, 'too_big'); } catch { /* gone */ } return; }
    const msg = parseClientMessage(text);
    if (!msg) return;
    if (!this.allow(ws, msg.t === 'bc' ? 'bc' : 'req')) {
      if (msg.t === 'req') this.send(ws, JSON.stringify({ t: 'res', id: msg.id, ok: false, error: 'rate_limited', now: new Date().toISOString() }));
      return;
    }
    const a = this.att(ws);
    if (msg.t === 'bc') {
      if (!a.hello) return;
      if (msg.event === PING_EVENT || msg.event === PING_MENTOR_EVENT || msg.event === PING_CLEAR_EVENT) { await this.relayPing(ws, a.userId, msg.event, msg.payload); return; }
      if (msg.event === LOBBY_CHAT_EVENT || msg.event === LOBBY_CHAT_SYNC_EVENT) { await this.lobbyChat(ws, a, msg.event, msg.payload); return; }
      // Relay (spectator frames, cursors, emotes): to every other member's sockets, never back to the sender.
      const out = JSON.stringify({ t: 'bc', event: msg.event, payload: msg.payload, from: a.userId } satisfies VersusCfPush);
      for (const other of this.liveSockets()) if (other !== ws && this.att(other).hello) this.send(other, out);
      return;
    }
    await this.request(ws, a, msg);
  }

  async webSocketClose(ws: CfWebSocket, code?: number): Promise<void> {
    // Complete the closing handshake at once: the peer is not left waiting for our close frame (a client blocks ~5 s on
    // it otherwise), and the socket stops reading as OPEN to `liveSockets` (a reload's new socket is the live one).
    try { ws.close(code === 1005 || code === 1006 || code == null ? 1000 : code, 'closed'); } catch { /* already closed */ }
    {
      const core = await this.load();
      if (!core) return;
      // Gone only when this was the account's LAST open socket (a reload's new socket may already be open).
      const userId = this.att(ws).userId;
      const others = this.liveSockets().filter((o) => o !== ws && this.att(o).userId === userId).length;
      this.log({ ev: 'versus_cf_socket', op: 'close', user: userId, code, others });
      if (others > 0) return;
      await this.apply(core.disconnect(userId, Date.now()));
      await this.apply(await core.tick(Date.now()));
      this.syncWatch(Date.now());
      await this.rearm();
    }
  }

  async webSocketError(ws: CfWebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  async alarm(): Promise<void> {
    this.metrics.alarms += 1;
    {
      const core = await this.load();
      if (!core) return;
      const now = Date.now();
      // A socket whose keep-alive went stale is a phone that lost its network without a FIN: treat it as closed.
      for (const ws of this.liveSockets()) {
        if (now >= this.staleAt(ws)) {
          try { ws.close(1001, 'stale'); } catch { /* gone */ }
          const userId = this.att(ws).userId;
          if (!this.liveSockets().some((o) => o !== ws && this.att(o).userId === userId)) await this.apply(core.disconnect(userId, now));
        }
      }
      await this.apply(await core.tick(now));
      await this.drainOutbox();
      this.syncLive();
      this.syncWatch(now);
      await this.rearm();
    }
  }

  /** The room as the ping rules see it (`pings.ts`), with the mentors of the CURRENT match only. */
  private pingRoom(): PingRoomView | null {
    const core = this.core;
    if (!core) return null;
    const r = core.state.room;
    const mode = (['duel', 'group', 'duos', 'ranked_duos'].includes(String(r.options.mode)) ? r.options.mode : 'duel') as PingMode;
    const mentors = this.pingMentors.matchId === r.current_match_id ? this.pingMentors.mentors : {};
    return { mode, members: r.members.map((m) => ({ userId: m.userId, role: m.role })), mentors };
  }

  /**
   * LIVE PINGS (owner 2026-10-29; R-PING-01). A ping is relayed ONLY to its audience (`routePing`: a mentor's to the
   * player alone; a player's own or a teammate's to the owner, the teammate and the stands; never an opponent), with
   * `from` and `role` stamped from the authenticated socket. A plain spectator's, a demoted mentor's or an opponent's
   * ping is dropped here, as is anything over `PING_RATE` per sender. A mentor change is accepted only from the seated
   * player it names, for a spectator in the room, and is relayed to everyone (every screen shows who is mentoring).
   */
  private async relayPing(ws: CfWebSocket, userId: string, event: string, payload: unknown): Promise<void> {
    const room = this.pingRoom();
    if (!room) return;
    if (event === PING_MENTOR_EVENT) {
      const m = routePingMentor(room, userId, payload);
      if (!m) { this.log({ ev: 'versus_cf_ping_dropped', user: userId, why: 'mentor_refused' }); return; }
      this.pingMentors = { matchId: this.core?.state.room.current_match_id ?? null, mentors: withMentor(room.mentors, m) };
      await this.ctx.storage.put(PING_MENTORS_KEY, this.pingMentors);
      const out = JSON.stringify({ t: 'bc', event, payload: m, from: userId } satisfies VersusCfPush);
      for (const other of this.liveSockets()) if (other !== ws && this.att(other).hello) this.send(other, out);
      return;
    }
    if (event === PING_CLEAR_EVENT) {
      if (!this.pingClearLimit.allow(userId, Date.now())) return;
      const c = routePingClear(room, userId, payload);
      if (!c) return;
      const to = new Set(c.to);
      const out = JSON.stringify({ t: 'bc', event, payload: c.msg, from: userId } satisfies VersusCfPush);
      for (const other of this.liveSockets()) { const o = this.att(other); if (other !== ws && o.hello && to.has(o.userId)) this.send(other, out); }
      return;
    }
    if (!this.pingLimit.allow(userId, Date.now())) { this.log({ ev: 'versus_cf_ping_dropped', user: userId, why: 'rate' }); return; }
    const route = routePing(room, userId, payload);
    if (!route.ok) { this.log({ ev: 'versus_cf_ping_dropped', user: userId, why: route.reason }); return; }
    const to = new Set(route.to);
    const out = JSON.stringify({ t: 'bc', event, payload: route.ping, from: userId } satisfies VersusCfPush);
    for (const other of this.liveSockets()) {
      const o = this.att(other);
      if (other !== ws && o.hello && to.has(o.userId)) this.send(other, out);
    }
  }

  /**
   * LOBBY CHAT (owner 2026-10-30: "should include everyone in the game ... including the player"; R-LOBBY-CHAT-01): one
   * chat per room, for every seated player and the stands. A post is stamped (`LobbyChat.post`: members only, never a
   * guest, rate limited) and goes to every member's socket, the sender's too (its confirmation). A sync answers the
   * backlog to the asking socket only. The backlog is mirrored to storage without holding any outgoing game frame for
   * the write (`allowUnconfirmed`); the room's storage goes when it closes.
   */
  private async lobbyChat(ws: CfWebSocket, a: Attachment, event: string, payload: unknown): Promise<void> {
    const core = await this.load();
    if (!core) return;
    if (!this.chat) {
      const chat = new LobbyChat();
      chat.load(await this.ctx.storage.get(LOBBY_CHAT_STORAGE_KEY));
      this.chat ??= chat;
    }
    const mem = core.state.room.members.find((m) => m.userId === a.userId);
    const sender: LobbyChatSender = {
      userId: a.userId, role: !mem ? null : mem.role === 'spectator' ? 'spectator' : 'player', name: mem?.displayName ?? 'Player', guest: !!a.guest,
    };
    if (event === LOBBY_CHAT_SYNC_EVENT) {
      this.send(ws, JSON.stringify({ t: 'bc', event, payload: this.chat.sync(sender, payload), from: a.userId } satisfies VersusCfPush));
      return;
    }
    const r = this.chat.post(sender, payload, Date.now());
    if (!r.ok) {
      this.send(ws, JSON.stringify({ t: 'bc', event: LOBBY_CHAT_REFUSED_EVENT, payload: { cid: r.cid ?? null, reason: r.reason }, from: a.userId } satisfies VersusCfPush));
      return;
    }
    void this.ctx.storage.put(LOBBY_CHAT_STORAGE_KEY, this.chat.backlog(), { allowUnconfirmed: true }).catch(() => undefined);
    const out = JSON.stringify({ t: 'bc', event, payload: r.msg, from: a.userId } satisfies VersusCfPush);
    for (const other of this.liveSockets()) if (this.att(other).hello) this.send(other, out);
  }

  /** When this socket's keep-alive goes stale: its last ping (the runtime's auto-response stamp) or its open, + 15 s. */
  private staleAt(ws: CfWebSocket): number {
    const last = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? this.att(ws).at;
    return Math.max(last, this.att(ws).at) + VERSUS_CF_STALE_MS + 1;
  }

  /** Take one token of `kind` from this socket's bucket. */
  private allow(ws: CfWebSocket, kind: 'req' | 'bc'): boolean {
    const { bucket, ok, flood } = takeToken(this.buckets.get(ws), kind, Date.now());
    this.buckets.set(ws, bucket);
    if (ok) return true;
    if (flood) { try { ws.close(1008, 'rate_limited'); } catch { /* gone */ } }
    this.log({ ev: 'versus_cf_rate_limited', user: this.att(ws).userId, kind, over: bucket.over });
    return false;
  }

  // ── Requests ───────────────────────────────────────────────────────────────────────────────────────────────────

  private async request(ws: CfWebSocket, a: Attachment, msg: VersusCfRequest): Promise<void> {
    const core = await this.load();
    const nowIso = new Date().toISOString();
    const answer = (ok: boolean, body: unknown): void =>
      this.send(ws, JSON.stringify(ok ? { t: 'res', id: msg.id, ok: true, data: body, now: nowIso } : { t: 'res', id: msg.id, ok: false, error: String(body), now: nowIso }));
    if (!core) { answer(false, 'no_room'); return; }
    if (msg.op === 'hello') {
      const h = (msg.args ?? {}) as Partial<VersusCfHello>;
      if (h.protocol !== VERSUS_CF_PROTOCOL || h.versusProtocol !== VERSUS_PROTOCOL || h.contentRevision !== engineContentRevision()) {
        answer(false, 'version_mismatch');
        ws.close(VERSUS_CF_CLOSE.versionMismatch, 'version_mismatch');
        return;
      }
      ws.serializeAttachment({ ...a, hello: true } satisfies Attachment);
      answer(true, { room: core.roomJson(), match: core.currentMatchJson(), priv: core.privFor(a.userId), userId: a.userId });
      this.syncWatch(Date.now()); // a spectator's watch screen is on: their watch record starts
      await this.rearm();
      return;
    }
    if (!a.hello) { answer(false, 'hello_first'); return; }
    if (msg.op === 'invite_proof') {
      // FRIEND INVITES (R-VERSUS-CF-INVITE-01): the room's own checks, signed; `friends_invite` verifies the proof.
      const args = (msg.args ?? {}) as { to?: unknown; kind?: unknown };
      const to = String(args.to ?? '').toLowerCase();
      const kind = String(args.kind ?? '');
      try {
        core.inviteCheck(a.userId, to, kind);
        if (!this.env.VERSUS_WRITER_SECRET) { answer(false, 'invites_unavailable'); return; }
        answer(true, { proof: await signInviteProof(this.env.VERSUS_WRITER_SECRET, { room: core.state.room.id, from: a.userId, to, kind }, Date.now()) });
      } catch (e) {
        answer(false, e instanceof CoreError ? e.code : 'server_error');
      }
      return;
    }
    try {
      // One room per account: the directory is asked before a join (the SQL's unique index on versus_members.user_id).
      if (msg.op === 'join' && !core.member(a.userId)) {
        const elsewhere = await this.directory().claim(a.userId, core.state.room.id);
        if (elsewhere) { answer(false, 'already_in_room'); return; }
      }
      const { data, effects } = await core.op(a.userId, msg.op, msg.args ?? {}, Date.now());
      answer(true, data);
      await this.apply(effects);
      await this.rearm();
    } catch (e) {
      if (msg.op === 'join' && !core.member(a.userId)) await this.directory().release(a.userId, core.state.room.id).catch(() => undefined);
      if (e instanceof CoreError) answer(false, e.code);
      else {
        console.error('versus cf: op failed', msg.op, e);
        answer(false, 'server_error');
      }
    }
  }

  // ── Effects ────────────────────────────────────────────────────────────────────────────────────────────────────

  private async apply(fx: CoreEffects): Promise<void> {
    const core = this.core;
    if (!core) return;
    // 1. Storage first (the output gate holds every message below until these writes are durable).
    if (fx.dirty.size) {
      const puts: Record<string, unknown> = {};
      const dels: string[] = [];
      for (const k of fx.dirty) {
        const v = valueOfKey(core.state, k);
        if (v === undefined) dels.push(k);
        else puts[k] = v;
      }
      if (Object.keys(puts).length) await this.ctx.storage.put(puts);
      if (dels.length) await this.ctx.storage.delete(dels);
    }
    // 2. Persistence jobs into the outbox (drained by the alarm, in order).
    //    A job the outbox cannot store (a value over the storage limit) is logged and dropped: the game's pushes below
    //    must still go out, or every player is left on a stale screen (R-VERSUS-CF-PERSIST-01: a Ranked Duos result too
    //    big to store once held back the final match push, so the end never reached anyone).
    if (fx.persist.length) {
      await this.enqueue(fx.persist).catch((e) => this.log({ ev: 'versus_cf_persist_enqueue_failed', kinds: fx.persist.map((j) => j.kind), error: String(e) }));
    }
    // The match event log (Workers Logs; the same kinds `versus_events` records on Supabase).
    for (const e of fx.events) this.log({ ev: 'versus_cf_event', match: this.core?.state.match?.id, ...e });
    // 3. Pushes. A committed round goes out BEFORE the match row that moved to combat, in one burst, so a client that
    //    sees "combat" already holds the fight (no read between the commit and the fight on screen).
    const now = new Date().toISOString();
    const all = this.liveSockets().filter((ws) => this.att(ws).hello);
    const toAll = (msg: VersusCfPush): void => {
      const s = JSON.stringify(msg);
      for (const ws of all) this.send(ws, s);
    };
    if (fx.room) toAll({ t: 'room', room: core.roomJson(), now });
    for (const n of fx.rounds) {
      const row = core.roundJson(n);
      if (row) toAll({ t: 'round', row, now });
    }
    if (fx.match) { const m = core.currentMatchJson(); if (m) toAll({ t: 'match', match: m, now }); }
    for (const seat of fx.priv) {
      const p = core.privJson(seat);
      if (!p) continue;
      const s = JSON.stringify({ t: 'priv', priv: p, now } satisfies VersusCfPush);
      for (const ws of all) if (this.att(ws).userId === p.user_id) this.send(ws, s);
    }
    // VERSUS DUOS: a pass goes to its team's two seats only (the table's RLS rule).
    for (const p of fx.passes) {
      const to = new Set(core.passAudience(p));
      const s = JSON.stringify({ t: 'pass', row: p as unknown as Record<string, unknown>, now } satisfies VersusCfPush);
      for (const ws of all) if (to.has(this.att(ws).userId)) this.send(ws, s);
    }
    // RANKED DUOS: the Supabase reads the core asked for run here, off the request path; their result is applied as a
    // new set of effects (a failed seat is retried by the alarm, see RankedEngine.reconcile).
    if (fx.ranked.team || fx.ranked.seat) void this.rankedIo(fx.ranked.team, fx.ranked.seat);
    // 4. The directory (listing + one-room-per-account).
    if (fx.summary) await this.directory().upsert(core.summary() as never).catch((e) => console.warn('versus cf: directory upsert', e));
    for (const u of fx.left) await this.directory().release(u, core.state.room.id).catch(() => undefined);
    // 5. Live Games (Ranked Duos): only when the listing changed; never on a plain request.
    this.syncLive();
    // 6. The stands' watch record (spectator XP).
    this.syncWatch(Date.now());
    if (core.state.room.closed) {
      const bye = JSON.stringify({ t: 'closed', reason: 'room_closed' } satisfies VersusCfPush);
      for (const ws of this.liveSockets()) { this.send(ws, bye); try { ws.close(VERSUS_CF_CLOSE.roomClosed, 'room_closed'); } catch { /* gone */ } }
    }
  }

  /** One structured log line (Workers Logs / `wrangler tail` index the JSON). */
  private log(fields: Record<string, unknown>): void {
    console.log(JSON.stringify({ room: this.core?.state.room.id, ...fields }));
  }

  private async rankedIo(team: boolean, seat: boolean): Promise<void> {
    const core = this.core;
    const g = core?.ranked;
    if (!core || !g) return;
    try {
      if (team) {
        const live = g.m.seats.filter((x) => x.seat === 'p1' || x.seat === 'p2').map((x) => x.user_id);
        const info = await this.rankedSvc.ensureTeam(live[0]!, live[1]!);
        await this.apply(core.rankedSetTeam(info, Date.now()));
      }
      if (seat) {
        await this.apply(await core.rankedSeat(this.rankedSvc, Date.now()));
        await this.rearm();
      }
    } catch (e) {
      this.log({ ev: 'versus_cf_ranked_io_failed', team, seat, error: String(e) });
      await this.rearm();
    }
  }

  private send(ws: CfWebSocket, text: string): void {
    try {
      ws.send(text);
      this.metrics.msgsOut += 1;
      this.metrics.bytesOut += text.length;
    } catch { /* the close handler will follow */ }
  }

  private directory() {
    return this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('global'));
  }

  // ── Persistence outbox ─────────────────────────────────────────────────────────────────────────────────────────

  private async enqueue(jobs: PersistJob[]): Promise<void> {
    const puts: Record<string, unknown> = {};
    for (const j of jobs) puts[`ob:${String(this.outboxSeq++).padStart(10, '0')}`] = j;
    await this.ctx.storage.put(puts);
    if (this.outboxRetryAt == null) this.outboxRetryAt = Date.now();
  }

  private async drainOutbox(): Promise<void> {
    if (this.outboxRetryAt == null || Date.now() < this.outboxRetryAt) return;
    const jobs = await this.ctx.storage.list<PersistJob>({ prefix: 'ob:', limit: 20 });
    for (const [key, job] of jobs) {
      try {
        await this.sink.write(job);
        await this.ctx.storage.delete(key);
        this.outboxAttempt = 0;
      } catch (e) {
        console.warn(JSON.stringify({ ev: 'versus_cf_persist_retry', key, attempt: this.outboxAttempt, error: String(e) }));
        // A job that keeps failing is set aside (kept under `dead:` for a look), so one bad row never holds every
        // write behind it for the life of the room (R-VERSUS-CF-PERSIST-01).
        if (this.outboxAttempt >= PERSIST_DEAD_AFTER) {
          await this.ctx.storage.put(`dead:${key}`, job).catch(() => undefined);
          await this.ctx.storage.delete(key);
          console.error(JSON.stringify({ ev: 'versus_cf_persist_dead', key, kind: job.kind, error: String(e) }));
          this.outboxAttempt = 0;
          continue;
        }
        this.outboxRetryAt = Date.now() + persistBackoffMs(this.outboxAttempt++);
        return;
      }
    }
    const left = await this.ctx.storage.list({ prefix: 'ob:', limit: 1 });
    this.outboxRetryAt = left.size ? Date.now() : null;
    // A closed room with nothing left to write forgets itself.
    if (!left.size && this.core?.state.room.closed && !this.liveSlot?.pending()) {
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      this.core = null;
      this.chat = null;
    }
  }

  private async rearm(): Promise<void> {
    const core = this.core;
    if (!core) return;
    const due: number[] = [];
    const next = core.nextAlarm(Date.now());
    if (next != null) due.push(next);
    if (this.outboxRetryAt != null) due.push(this.outboxRetryAt);
    const live = this.liveSlot?.nextAt(Date.now());
    if (live != null) due.push(live);
    const watch = this.watchReporter.nextAt(this.watchNow.beats.length > 0);
    if (watch != null) due.push(watch);
    // (A closed room still owing its Live Games removal waits for that write: the slot's own time above, then this.)
    if (core.state.room.closed && !this.liveSlot?.pending()) due.push(Date.now());
    // Stale sockets while a match runs (1v1 or Group / Duos / Ranked Duos): wake exactly when the quietest socket's keep-alive
    // goes stale, so a half-open phone socket is found 15 s after its last ping, not up to 30 s (R-VERSUS-CF-STALE-01).
    const m = core.state.match;
    const g = core.state.group?.match;
    if ((m && m.phase !== 'complete') || (g && g.phase !== 'complete')) for (const ws of this.liveSockets()) due.push(this.staleAt(ws));
    if (!due.length) return;
    const at = Math.max(Date.now(), Math.min(...due));
    const cur = await this.ctx.storage.getAlarm();
    if (cur == null || cur > at || cur < Date.now()) await this.ctx.storage.setAlarm(at);
  }
}
