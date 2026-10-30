/**
 * LIVE GAMES ON CLOUDFLARE — the live game Durable Object (2026-10-29; R-LIVE-CF-01). One object per live lobby or
 * Practice game (named by the game id). The player's client publishes over one WebSocket; up to 20 watchers subscribe
 * over theirs; the object relays the spectator stream, emotes and cursors between them, exactly as the Supabase
 * broadcast channel did, and keeps the latest keyframe IN MEMORY for a late joiner (never in Postgres, never in its
 * own storage: a woken object asks the player for a fresh one, which a joining watcher does anyway).
 *
 * Writes to Supabase, only through the limited key-gated functions (never the service role):
 *   - the Live Games row (`lobby_live_cf`), only when the listing changes (it appears, a round or phase moves, it ends)
 *     plus the 2-minute keep-alive: the same `LiveSlot` the Versus rooms use;
 *   - the watch record for the spectators' XP (`spectate_cf_beat`, `spectate.ts`).
 * Nothing per frame, nothing per watcher poll. Rules: `core/liveCore.ts`. Wire: `liveProtocol.ts`.
 *
 * HIBERNATION: between messages the object may be evicted while sockets stay open. The meta is in storage, every socket
 * carries its account and role in its attachment (`restore`), and keep-alive pings are answered by the runtime.
 */
import { DurableObject } from 'cloudflare:workers';
import { engineContentRevision } from '@game/sim/versus/server';
import { LiveCore, LiveError, lobbyListingKey, newLiveMeta, type LiveMeta, type LobbyListing } from './core/liveCore';
import { LIVE_STORAGE_KEY, LiveSlot, LocalLiveSink, type LiveSink } from './live';
import { LIVE_CF_PROTOCOL, LIVE_MAX_KEY_CHARS, type LiveHello, type LiveHelloAnswer, type LivePush, type LiveRole } from './liveProtocol';
import type { PersistEnv } from './persist';
import { VERSUS_CF_CLOSE, VERSUS_CF_PING, VERSUS_CF_PONG, VERSUS_CF_STALE_MS, VERSUS_CF_SUBPROTOCOL, parseClientMessage } from './protocol';
import { MAX_FRAME_CHARS, takeToken, type Bucket } from './rate';
import { spectateSinkFor, WatchReporter, type SpectateSink } from './spectate';
import { GUEST_HEADER, LOBBY_CHAT_EVENT, LOBBY_CHAT_REFUSED_EVENT, LOBBY_CHAT_STORAGE_KEY, LOBBY_CHAT_SYNC_EVENT, LobbyChat, type LobbyChatSender } from './lobbyChat';
import { livePingRoom, PING_CLEAR_EVENT, PING_CLEAR_RATE, PING_EVENT, PING_MENTOR_EVENT, PingRateLimiter, routePing, routePingClear, routePingMentor } from './pings';

export const LIVE_GAME_HEADER = 'X-Live-Game';
export const LIVE_USER_HEADER = 'X-Live-User';

export interface LiveEnv extends PersistEnv {
  DEV_AUTH?: string;
}

interface Attachment {
  userId: string;
  role: LiveRole | null;
  at: number;
  /** A guest account (stamped by the Worker): reads the lobby chat, never posts (R-LOBBY-CHAT-01). */
  guest?: boolean;
}

/** Counters for the DEV metrics route and the measurement test. */
interface LiveMetrics {
  msgsIn: number;
  msgsOut: number;
  bytesIn: number;
  bytesOut: number;
  rowWrites: number;
  beatWrites: number;
  beats: number;
}

/** The Live Games row through `lobby_live_cf` (supabase/migrations/2026-11-10-lobby-live-cf.sql). */
class LobbyLiveSink implements LiveSink<LobbyListing> {
  readonly live = true;
  constructor(private readonly url: string, private readonly anonKey: string, private readonly secret: string) {}
  async write(gameId: string, row: LobbyListing | null): Promise<void> {
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/rpc/lobby_live_cf`, {
      method: 'POST',
      headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: this.secret, p_game: gameId, p_row: row }),
    });
    if (!res.ok) throw new Error(`lobby live ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

const lobbySinkFor = (env: PersistEnv): LiveSink<LobbyListing> =>
  env.PERSIST === '1' && env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.VERSUS_WRITER_SECRET
    ? new LobbyLiveSink(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, env.VERSUS_WRITER_SECRET)
    : new LocalLiveSink<LobbyListing>();

/** Storage key of the player's promoted mentor (LIVE PINGS, `relayPing`). */
const PING_MENTOR_KEY = 'pingMentor';

/** An `end` push waits at most this long for the final watch beat to land (the spectator's settlement follows it). */
const END_BEAT_WAIT_MS = 4_000;

export class VersusLiveGame extends DurableObject<LiveEnv> {
  private core: LiveCore | null = null;
  private loaded = false;
  private slot: LiveSlot<LobbyListing> | null = null;
  private readonly rowSink: LiveSink<LobbyListing>;
  private readonly beatSink: SpectateSink;
  private readonly reporter = new WatchReporter();
  /** The latest keyframe the player sent (memory only). */
  private key: unknown = null;
  private readonly buckets = new WeakMap<CfWebSocket, Bucket>();
  /** LIVE PINGS (R-PING-01..03): the spectator the player named Mentor (stored: a wake keeps it), and the ping limit. */
  private pingMentor: string | null = null;
  private readonly pingLimit = new PingRateLimiter();
  private readonly pingClearLimit = new PingRateLimiter(PING_CLEAR_RATE);
  /** LOBBY CHAT (R-LOBBY-CHAT-01): the game's chat, read from storage on its first use after a wake. */
  private chat: LobbyChat | null = null;
  private readonly metrics: LiveMetrics = { msgsIn: 0, msgsOut: 0, bytesIn: 0, bytesOut: 0, rowWrites: 0, beatWrites: 0, beats: 0 };

  constructor(ctx: DurableObjectState, env: LiveEnv) {
    super(ctx, env);
    this.rowSink = lobbySinkFor(env);
    this.beatSink = spectateSinkFor(env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(VERSUS_CF_PING, VERSUS_CF_PONG));
    void ctx.blockConcurrencyWhile(async () => { await this.load(null); });
  }

  // ── State ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private async load(gameId: string | null): Promise<LiveCore | null> {
    if (this.loaded && this.core) return this.core;
    const entries = await this.ctx.storage.get<unknown>(['meta', LIVE_STORAGE_KEY, PING_MENTOR_KEY]);
    const meta = entries.get('meta') as LiveMeta | undefined;
    this.pingMentor = (entries.get(PING_MENTOR_KEY) as string | undefined) ?? null;
    this.loaded = true;
    if (!meta && !gameId) return null;
    this.core = new LiveCore(meta ?? newLiveMeta(gameId!, engineContentRevision(), Date.now()));
    this.slot = new LiveSlot<LobbyListing>(
      this.counted(this.rowSink),
      () => this.core?.meta.gameId ?? null,
      async (k) => { if (k == null) await this.ctx.storage.delete(LIVE_STORAGE_KEY); else await this.ctx.storage.put(LIVE_STORAGE_KEY, k); },
      (entries.get(LIVE_STORAGE_KEY) as string | undefined) ?? null,
      Date.now(),
      lobbyListingKey,
    );
    // After a wake: who is connected, in which role (the attachments survive hibernation).
    for (const ws of this.liveSockets()) {
      const a = this.att(ws);
      if (a.role === 'publish' && a.userId === this.core.meta.owner) this.core.publisherHere = true;
      if (a.role === 'watch') {
        const w = (ws.deserializeAttachment() as { watcher?: { display_name: string; profile: Record<string, unknown> | null } } | null)?.watcher;
        this.core.watchers.set(a.userId, { user_id: a.userId, display_name: w?.display_name ?? 'Spectator', profile: w?.profile ?? null });
      }
    }
    return this.core;
  }

  private counted(sink: LiveSink<LobbyListing>): LiveSink<LobbyListing> {
    return { live: sink.live, write: async (id, row) => { this.metrics.rowWrites += 1; await sink.write(id, row); } };
  }

  private async saveMeta(): Promise<void> {
    if (this.core) await this.ctx.storage.put('meta', this.core.meta);
  }

  private att(ws: CfWebSocket): Attachment {
    return (ws.deserializeAttachment() as Attachment | null) ?? { userId: '', role: null, at: 0 };
  }

  private liveSockets(): CfWebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === 1);
  }

  private socketsOf(role: LiveRole): CfWebSocket[] {
    return this.liveSockets().filter((ws) => this.att(ws).role === role);
  }

  async metricsSnapshot(): Promise<LiveMetrics & { watchers: number; owner: string | null; ended: boolean; rows: unknown[]; beatLog: unknown[] }> {
    const core = await this.load(null);
    return {
      ...this.metrics, watchers: core?.watchers.size ?? 0, owner: core?.meta.owner ?? null, ended: !!core?.meta.end,
      rows: (this.rowSink as { written?: unknown[] }).written ?? [],
      beatLog: (this.beatSink as { written?: unknown[] }).written ?? [],
    };
  }

  // ── The WebSocket upgrade ──────────────────────────────────────────────────────────────────────────────────────

  async fetch(req: Request): Promise<Response> {
    const userId = req.headers.get(LIVE_USER_HEADER);
    const gameId = req.headers.get(LIVE_GAME_HEADER);
    if (!userId || !gameId || req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
    const core = await this.load(gameId);
    if (!core) return new Response('no_game', { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [userId]);
    const at = Date.now();
    server.serializeAttachment({ userId, role: null, at, guest: req.headers.get(GUEST_HEADER) === '1' } satisfies Attachment);
    // One live socket per account per game: an older one (a reload, a second tab) is closed as replaced.
    for (const ws of this.ctx.getWebSockets(userId)) {
      if (ws !== server && this.att(ws).at <= at) { try { ws.close(VERSUS_CF_CLOSE.replaced, 'replaced'); } catch { /* closing */ } }
    }
    core.meta.activeAt = at;
    await this.rearm();
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': VERSUS_CF_SUBPROTOCOL } } as CfResponseInit);
  }

  // ── Messages ───────────────────────────────────────────────────────────────────────────────────────────────────

  async webSocketMessage(ws: CfWebSocket, raw: string | ArrayBuffer): Promise<void> {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    this.metrics.msgsIn += 1;
    this.metrics.bytesIn += text.length;
    if (text === VERSUS_CF_PING) { this.send(ws, VERSUS_CF_PONG); return; }
    if (text.length > MAX_FRAME_CHARS) { try { ws.close(1009, 'too_big'); } catch { /* gone */ } return; }
    const msg = parseClientMessage(text);
    if (!msg) return;
    const { bucket, ok, flood } = takeToken(this.buckets.get(ws), msg.t === 'bc' ? 'bc' : 'req', Date.now());
    this.buckets.set(ws, bucket);
    if (!ok) {
      if (flood) { try { ws.close(1008, 'rate_limited'); } catch { /* gone */ } }
      if (msg.t === 'req') this.send(ws, JSON.stringify({ t: 'res', id: msg.id, ok: false, error: 'rate_limited', now: new Date().toISOString() }));
      return;
    }
    const core = await this.load(null);
    const a = this.att(ws);
    if (msg.t === 'bc') {
      if (!core || !a.role) return;
      if (msg.event === PING_EVENT || msg.event === PING_MENTOR_EVENT || msg.event === PING_CLEAR_EVENT) { await this.relayPing(core, ws, a.userId, msg.event, msg.payload); return; }
      if (msg.event === LOBBY_CHAT_EVENT || msg.event === LOBBY_CHAT_SYNC_EVENT) { await this.lobbyChat(core, ws, a, msg.event, msg.payload); return; }
      // Relay to everyone else in this game (the player's stream to the stands; a watcher's emote, key request or
      // goodbye to the player and the other watchers), never back to the sender.
      const out = JSON.stringify({ t: 'bc', event: msg.event, payload: msg.payload, from: a.userId } satisfies LivePush);
      for (const other of this.liveSockets()) if (other !== ws && this.att(other).role) this.send(other, out);
      return;
    }
    const nowIso = new Date().toISOString();
    const answer = (good: boolean, body: unknown): void =>
      this.send(ws, JSON.stringify(good ? { t: 'res', id: msg.id, ok: true, data: body, now: nowIso } : { t: 'res', id: msg.id, ok: false, error: String(body), now: nowIso }));
    if (!core) { answer(false, 'no_game'); return; }
    const now = Date.now();
    const op = msg.op as string;
    try {
      if (op === 'hello') { await this.hello(ws, a, core, (msg.args ?? {}) as Partial<LiveHello>, answer, now); await this.rearm(); return; }
      if (!a.role) { answer(false, 'hello_first'); return; }
      if (op === 'listing') {
        if (a.role !== 'publish') throw new LiveError('not_owner');
        const was = JSON.stringify(core.meta.info);
        core.listing(a.userId, msg.args, now);
        answer(true, { watchers: core.watchers.size });
        // The player's 15 s refresh usually changes nothing: no storage write, no push.
        if (JSON.stringify(core.meta.info) !== was) {
          await this.saveMeta();
          const row = core.row();
          if (row) this.toRole('watch', { t: 'row', row });
        }
        this.syncRow(now);
      } else if (op === 'key') {
        if (a.role !== 'publish') throw new LiveError('not_owner');
        const frame = (msg.args as { frame?: unknown } | undefined)?.frame;
        if (frame != null && JSON.stringify(frame).length <= LIVE_MAX_KEY_CHARS) this.key = frame;
        answer(true, null);
      } else if (op === 'end') {
        if (a.role !== 'publish') throw new LiveError('not_owner');
        const changed = core.end(a.userId, (msg.args as { placement?: unknown } | undefined)?.placement ?? null, now);
        answer(true, null);
        if (changed) await this.finish(now);
      } else {
        answer(false, 'bad_op');
      }
    } catch (e) {
      answer(false, e instanceof LiveError ? e.code : 'server_error');
      if (!(e instanceof LiveError)) console.error('live cf: op failed', msg.op, e);
    }
    await this.rearm();
  }

  private async hello(ws: CfWebSocket, a: Attachment, core: LiveCore, h: Partial<LiveHello>, answer: (ok: boolean, body: unknown) => void, now: number): Promise<void> {
    if (h.protocol !== LIVE_CF_PROTOCOL) {
      answer(false, 'version_mismatch');
      ws.close(VERSUS_CF_CLOSE.versionMismatch, 'version_mismatch');
      return;
    }
    if (h.role === 'publish') {
      // The player's build must carry this Worker's engine (its watchers reach the Worker by the row's revision).
      if (h.contentRevision !== core.meta.contentRevision) {
        answer(false, 'version_mismatch');
        ws.close(VERSUS_CF_CLOSE.versionMismatch, 'version_mismatch');
        return;
      }
      core.publish(a.userId, now);
      ws.serializeAttachment({ ...a, role: 'publish' } satisfies Attachment);
      await this.saveMeta();
      answer(true, { role: 'publish', userId: a.userId, row: core.row(), key: null, watchers: core.watcherList() } satisfies LiveHelloAnswer);
      return;
    }
    if (h.role !== 'watch') { answer(false, 'bad_role'); return; }
    let w;
    try { w = core.watch(a.userId, h.name, h.profile, now); } catch (e) {
      answer(false, e instanceof LiveError ? e.code : 'server_error');
      try { ws.close(VERSUS_CF_CLOSE.refused, e instanceof LiveError ? e.code : 'refused'); } catch { /* gone */ }
      return;
    }
    ws.serializeAttachment({ ...a, role: 'watch', watcher: { display_name: w.display_name, profile: w.profile } });
    answer(true, { role: 'watch', userId: a.userId, row: core.row(), key: this.key, watchers: core.watcherList() } satisfies LiveHelloAnswer);
    this.pushWatchers();
    this.reporter.poke(now);
  }

  /** The game is over: last beats for everyone watching (awaited, bounded), then the end, then the row goes. */
  private async finish(now: number): Promise<void> {
    const core = this.core;
    if (!core) return;
    await this.saveMeta();
    let recorded = false;
    const beats = this.reporter.take(now, core.beats());
    if (beats.length) {
      recorded = await Promise.race([
        this.writeBeats(beats).then(() => true, () => false),
        new Promise<boolean>((r) => setTimeout(() => r(false), END_BEAT_WAIT_MS)),
      ]);
    }
    const end = core.meta.end!;
    this.toRole('watch', { t: 'end', placement: end.placement, abandoned: end.abandoned, row: core.row() });
    this.log({ ev: 'live_cf_end', placement: end.placement, abandoned: end.abandoned, watchers: core.watchers.size, recorded });
    this.syncRow(now);
  }

  async webSocketClose(ws: CfWebSocket, code?: number): Promise<void> {
    try { ws.close(code === 1005 || code === 1006 || code == null ? 1000 : code, 'closed'); } catch { /* closed */ }
    const core = await this.load(null);
    if (!core) return;
    const a = this.att(ws);
    if (!a.role) return;
    if (this.liveSockets().some((o) => o !== ws && this.att(o).userId === a.userId && this.att(o).role)) return;
    await this.dropped(core, a.userId, Date.now());
  }

  async webSocketError(ws: CfWebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /**
   * LIVE PINGS (owner 2026-10-29; R-PING-01..03), the same rule as the Versus room (`routePing`): the player (`p1`, the
   * game's publisher) pings their own targets and every watcher sees it; the ONE watcher the player named Mentor pings
   * the player's targets and only the player sees it; any other watcher's ping is dropped. `from` and `role` are stamped
   * from the socket. Only the player may name (or clear) the mentor, and only a watcher in the stands may be named.
   */
  private async relayPing(core: LiveCore, ws: CfWebSocket, userId: string, event: string, payload: unknown): Promise<void> {
    const room = livePingRoom(core.meta.owner, core.watchers.keys(), this.pingMentor);
    if (event === PING_MENTOR_EVENT) {
      const m = routePingMentor(room, userId, payload);
      if (!m) return;
      this.pingMentor = m.mentor;
      if (m.mentor) await this.ctx.storage.put(PING_MENTOR_KEY, m.mentor);
      else await this.ctx.storage.delete(PING_MENTOR_KEY);
      const out = JSON.stringify({ t: 'bc', event, payload: m, from: userId } satisfies LivePush);
      for (const other of this.liveSockets()) if (other !== ws && this.att(other).role) this.send(other, out);
      return;
    }
    if (event === PING_CLEAR_EVENT) {
      if (!this.pingClearLimit.allow(userId, Date.now())) return;
      const c = routePingClear(room, userId, payload);
      if (!c) return;
      const to = new Set(c.to);
      const out = JSON.stringify({ t: 'bc', event, payload: c.msg, from: userId } satisfies LivePush);
      for (const other of this.liveSockets()) { const o = this.att(other); if (other !== ws && o.role && to.has(o.userId)) this.send(other, out); }
      return;
    }
    if (!this.pingLimit.allow(userId, Date.now())) return;
    const route = routePing(room, userId, payload);
    if (!route.ok) return;
    const to = new Set(route.to);
    const out = JSON.stringify({ t: 'bc', event, payload: route.ping, from: userId } satisfies LivePush);
    for (const other of this.liveSockets()) {
      const o = this.att(other);
      if (other !== ws && o.role && to.has(o.userId)) this.send(other, out);
    }
  }

  /**
   * LOBBY CHAT (owner 2026-10-30; R-LOBBY-CHAT-01): the player and everyone in the stands share one chat. A post is
   * stamped (`LobbyChat.post`: members only, never a guest, rate limited) and goes to every socket in the game, the
   * sender's too (its confirmation). A sync answers the backlog to the asking socket only. The backlog is mirrored to
   * this object's storage without holding any outgoing frame for the write (`allowUnconfirmed`).
   */
  private async lobbyChat(core: LiveCore, ws: CfWebSocket, a: Attachment, event: string, payload: unknown): Promise<void> {
    if (!this.chat) {
      const chat = new LobbyChat();
      chat.load(await this.ctx.storage.get(LOBBY_CHAT_STORAGE_KEY));
      this.chat ??= chat;
    }
    const role = a.role === 'publish' && a.userId === core.meta.owner ? 'player' : a.role === 'watch' && core.watchers.has(a.userId) ? 'spectator' : null;
    const name = role === 'player' ? core.meta.info?.name ?? 'Player' : core.watchers.get(a.userId)?.display_name ?? 'Spectator';
    const sender: LobbyChatSender = { userId: a.userId, role, name, guest: !!a.guest };
    if (event === LOBBY_CHAT_SYNC_EVENT) {
      this.send(ws, JSON.stringify({ t: 'bc', event, payload: this.chat.sync(sender), from: a.userId } satisfies LivePush));
      return;
    }
    const r = this.chat.post(sender, payload, Date.now());
    if (!r.ok) {
      this.send(ws, JSON.stringify({ t: 'bc', event: LOBBY_CHAT_REFUSED_EVENT, payload: { cid: r.cid ?? null, reason: r.reason }, from: a.userId } satisfies LivePush));
      return;
    }
    void this.ctx.storage.put(LOBBY_CHAT_STORAGE_KEY, this.chat.backlog(), { allowUnconfirmed: true }).catch(() => undefined);
    const out = JSON.stringify({ t: 'bc', event, payload: r.msg, from: a.userId } satisfies LivePush);
    for (const other of this.liveSockets()) if (this.att(other).role) this.send(other, out);
  }

  /** An account's last socket is gone. */
  private async dropped(core: LiveCore, userId: string, now: number): Promise<void> {
    const beat = core.watchers.has(userId) ? core.beatFor(userId) : null;
    const was = core.gone(userId, now);
    if (was === 'watch') {
      if (beat) this.reporter.left(beat, now);
      this.pushWatchers();
    }
    await this.saveMeta();
    await this.rearm();
  }

  async alarm(): Promise<void> {
    const core = await this.load(null);
    if (!core) return;
    const now = Date.now();
    // A socket whose keep-alive went stale is a phone that lost its network without a FIN: treat it as closed.
    for (const ws of this.liveSockets()) {
      if (now >= this.staleAt(ws)) {
        try { ws.close(1001, 'stale'); } catch { /* gone */ }
        const a = this.att(ws);
        if (a.role && !this.liveSockets().some((o) => o !== ws && this.att(o).userId === a.userId)) await this.dropped(core, a.userId, now);
      }
    }
    if (core.publisherExpired(now) && core.end(null, null, now)) await this.finish(now);
    if (this.reporter.due(now, core.watchers.size > 0)) {
      const beats = this.reporter.take(now, core.beats());
      if (beats.length) await this.writeBeats(beats).catch(() => undefined);
    }
    if (this.slot?.due(now)) await this.slot.flush(now);
    if (core.idle(now, this.liveSockets().length, !!this.slot?.pending())) {
      for (const ws of this.liveSockets()) { try { ws.close(VERSUS_CF_CLOSE.roomClosed, 'game_over'); } catch { /* gone */ } }
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      this.core = null;
      this.loaded = false;
      this.key = null;
      this.chat = null;
      return;
    }
    // An ended game: anyone still connected is let go after the end has had its moment.
    if (core.meta.end && now - core.meta.end.at > 2 * 60_000) {
      for (const ws of this.liveSockets()) { try { ws.close(VERSUS_CF_CLOSE.roomClosed, 'game_over'); } catch { /* gone */ } }
    }
    await this.rearm();
  }

  // ── Writers ────────────────────────────────────────────────────────────────────────────────────────────────────

  private async writeBeats(beats: ReturnType<LiveCore['beats']>): Promise<void> {
    this.metrics.beatWrites += 1;
    this.metrics.beats += beats.length;
    try {
      await this.beatSink.write(beats);
    } catch (e) {
      this.log({ ev: 'live_cf_beat_failed', n: beats.length, error: String(e) });
      throw e;
    }
  }

  /** The Live Games row, off the request path: written only when its key changed or the keep-alive is due. */
  private syncRow(now: number): void {
    const core = this.core;
    const slot = this.slot;
    if (!core || !slot) return;
    slot.want(core.listingRow());
    if (!slot.due(now)) return;
    void slot.flush(now).then(() => this.rearm()).catch(() => undefined);
  }

  // ── Pushes ─────────────────────────────────────────────────────────────────────────────────────────────────────

  private pushWatchers(): void {
    const core = this.core;
    if (!core) return;
    const list = core.watcherList();
    const s = JSON.stringify({ t: 'watchers', list, n: list.length } satisfies LivePush);
    for (const ws of this.liveSockets()) if (this.att(ws).role) this.send(ws, s);
  }

  private toRole(role: LiveRole, msg: LivePush): void {
    const s = JSON.stringify(msg);
    for (const ws of this.socketsOf(role)) this.send(ws, s);
  }

  private send(ws: CfWebSocket, text: string): void {
    try {
      ws.send(text);
      this.metrics.msgsOut += 1;
      this.metrics.bytesOut += text.length;
    } catch { /* the close handler follows */ }
  }

  private log(fields: Record<string, unknown>): void {
    console.log(JSON.stringify({ game: this.core?.meta.gameId, ...fields }));
  }

  private staleAt(ws: CfWebSocket): number {
    const last = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? this.att(ws).at;
    return Math.max(last, this.att(ws).at) + VERSUS_CF_STALE_MS + 1;
  }

  private async rearm(): Promise<void> {
    const core = this.core;
    if (!core) return;
    const now = Date.now();
    const sockets = this.liveSockets();
    const due: number[] = [];
    const c = core.nextAt(sockets.length);
    if (c != null) due.push(c);
    const r = this.reporter.nextAt(core.watchers.size > 0);
    if (r != null) due.push(r);
    const s = this.slot?.nextAt(now);
    if (s != null) due.push(s);
    for (const ws of sockets) due.push(this.staleAt(ws));
    if (core.meta.end) due.push(core.meta.end.at + 2 * 60_000);
    if (!due.length) return;
    const at = Math.max(now, Math.min(...due));
    const cur = await this.ctx.storage.getAlarm();
    if (cur == null || cur > at || cur < now) await this.ctx.storage.setAlarm(at);
  }
}
