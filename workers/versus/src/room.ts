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
import { persistBackoffMs, sinkFor, type PersistEnv, type PersistSink } from './persist';
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

const uuid = (): string => crypto.randomUUID();
const random31 = (): number => crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;

export class VersusRoom extends DurableObject<RoomEnv> {
  private core: RoomCore | null = null;
  private loaded = false;
  private readonly sink: PersistSink;
  private outboxSeq = 0;
  private outboxAttempt = 0;
  private outboxRetryAt: number | null = null;
  private readonly metrics: RoomMetrics = { msgsIn: 0, msgsOut: 0, bytesIn: 0, bytesOut: 0, resolveMs: [], alarms: 0, wakes: 0 };

  constructor(ctx: DurableObjectState, env: RoomEnv) {
    super(ctx, env);
    this.sink = sinkFor(env);
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
        await this.rearm();
        return { ok: true as const, room: this.core.roomJson() };
      } catch (e) {
        return { ok: false as const, error: e instanceof CoreError ? e.code : 'init_failed' };
      }
    }
  }

  async metricsSnapshot(): Promise<RoomMetrics & { persistLive: boolean; persisted: number }> {
    const ob = await this.ctx.storage.list({ prefix: 'ob:' });
    return { ...this.metrics, persistLive: this.sink.live, persisted: (this.sink as { written?: unknown[] }).written?.length ?? 0, ...{ outbox: ob.size } };
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
      server.serializeAttachment({ userId, hello: false, at } satisfies Attachment);
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
    const msg = parseClientMessage(text);
    if (!msg) return;
    const a = this.att(ws);
    if (msg.t === 'bc') {
      if (!a.hello) return;
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
        const last = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? this.att(ws).at;
        if (now - Math.max(last, this.att(ws).at) > VERSUS_CF_STALE_MS) {
          try { ws.close(1001, 'stale'); } catch { /* gone */ }
          const userId = this.att(ws).userId;
          if (!this.liveSockets().some((o) => o !== ws && this.att(o).userId === userId)) await this.apply(core.disconnect(userId, now));
        }
      }
      await this.apply(await core.tick(now));
      await this.drainOutbox();
      await this.rearm();
    }
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
      const seat = core.seatOf(a.userId);
      answer(true, { room: core.roomJson(), match: core.matchJson(), priv: seat ? core.privJson(seat) : null, userId: a.userId });
      return;
    }
    if (!a.hello) { answer(false, 'hello_first'); return; }
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
    if (fx.persist.length) await this.enqueue(fx.persist);
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
      const row = core.state.rounds[n];
      if (row) toAll({ t: 'round', row: row as unknown as Record<string, unknown>, now });
    }
    if (fx.match) { const m = core.matchJson(); if (m) toAll({ t: 'match', match: m, now }); }
    for (const seat of fx.priv) {
      const p = core.privJson(seat);
      if (!p) continue;
      const s = JSON.stringify({ t: 'priv', priv: p, now } satisfies VersusCfPush);
      for (const ws of all) if (this.att(ws).userId === p.user_id) this.send(ws, s);
    }
    // 4. The directory (listing + one-room-per-account).
    if (fx.summary) await this.directory().upsert(core.summary() as never).catch((e) => console.warn('versus cf: directory upsert', e));
    for (const u of fx.left) await this.directory().release(u, core.state.room.id).catch(() => undefined);
    if (core.state.room.closed) {
      const bye = JSON.stringify({ t: 'closed', reason: 'room_closed' } satisfies VersusCfPush);
      for (const ws of this.liveSockets()) { this.send(ws, bye); try { ws.close(VERSUS_CF_CLOSE.roomClosed, 'room_closed'); } catch { /* gone */ } }
    }
  }

  /** One structured log line (Workers Logs / `wrangler tail` index the JSON). */
  private log(fields: Record<string, unknown>): void {
    console.log(JSON.stringify({ room: this.core?.state.room.id, ...fields }));
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
        this.outboxRetryAt = Date.now() + persistBackoffMs(this.outboxAttempt++);
        return;
      }
    }
    const left = await this.ctx.storage.list({ prefix: 'ob:', limit: 1 });
    this.outboxRetryAt = left.size ? Date.now() : null;
    // A closed room with nothing left to write forgets itself.
    if (!left.size && this.core?.state.room.closed) {
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      this.core = null;
    }
  }

  private async rearm(): Promise<void> {
    const core = this.core;
    if (!core) return;
    const due: number[] = [];
    const next = core.nextAlarm(Date.now());
    if (next != null) due.push(next);
    if (this.outboxRetryAt != null) due.push(this.outboxRetryAt);
    if (core.state.room.closed) due.push(Date.now());
    // Stale-socket sweep while a match runs (a half-open phone socket must still pause the match).
    const m = core.state.match;
    if (m && m.phase !== 'complete' && this.liveSockets().length) due.push(Date.now() + VERSUS_CF_STALE_MS);
    if (!due.length) return;
    const at = Math.max(Date.now(), Math.min(...due));
    const cur = await this.ctx.storage.getAlarm();
    if (cur == null || cur > at || cur < Date.now()) await this.ctx.storage.setAlarm(at);
  }
}
