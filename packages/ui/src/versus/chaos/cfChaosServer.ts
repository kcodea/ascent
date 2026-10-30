/**
 * VERSUS CHAOS HARNESS: THE CLOUDFLARE SERVER (the real room rules in a Node mirror of the Durable Object shell).
 *
 * WHY NOT MINIFLARE. A full match is 15-45 minutes of game clock (every shop is a 45-90 s timer, every fight up to its
 * view cap), and the scenarios inject faults at exact moments of that clock. workerd runs on the wall clock: its alarms,
 * `Date.now()` and socket timers cannot be driven by the harness's fake clock, so a matrix there would take hours of real
 * time per run and still not be deterministic. Instead this file runs the room's REAL rules (`workers/versus`
 * `RoomCore` + the group engine + the storage split, imported unchanged) on the fake clock, inside a line-by-line mirror
 * of the object's shell (`workers/versus/src/room.ts`) and the Worker's routes (`index.ts`, `directory.ts`). The
 * workerd round trip of that shell is already covered by `npm run versus:cf:test` (Node 22); what this adds is the rules
 * + the real client under chaos for whole matches. The same split the Supabase harness makes: real SQL + real handlers,
 * the Edge Function's reads mirrored.
 *
 * What the mirror keeps from the shell (each is load-bearing for a chaos scenario):
 *  - ONE event at a time per room (a Durable Object is single-threaded; the resolve is synchronous CPU), so a slow
 *    resolve or a busy object holds every message, close and alarm behind it;
 *  - every change written to storage before its pushes go out, and a RESTART (eviction, deploy, a resolve that dies)
 *    drops the in-memory room and every socket; the next event re-reads the room from storage (`stateFromEntries`) and
 *    re-counts the sockets (`restoreSockets`); an alarm that died is retried with backoff, as the runtime does;
 *  - one alarm per room, re-armed exactly as `rearm()` does (deadlines, and each live socket's stale moment while a match
 *    runs);
 *  - presence is the socket: the runtime answers keep-alive pings (`setWebSocketAutoResponse`) and stamps them; the alarm
 *    closes a socket whose last ping is older than `VERSUS_CF_STALE_MS`; one live socket per account (newest wins);
 *  - the per-socket rate limit, the hello version check, the join's one-room-per-account directory claim.
 * Not mirrored: the Supabase persistence writer (an always-healthy sink; the jobs are kept for inspection), CORS / auth
 * (the dev token names the user), hibernation as such (covered by the restart, which is the harder case).
 * RANKED DUOS reads (the pair's team, the recorded solo / duo samples) are stubbed as the Supabase harness stubs them and
 * as the Worker's own `LocalRankedService` answers with no Supabase: no team (unrated), empty samples, so the seating
 * handler fills the table with generated teams. They run as their own event after the one that asked, as `rankedIo` does.
 *
 * THE NETWORK. Each client has its own `ChaosNet` (latency, offline, hang, background throttling). A socket's frames ride
 * it in both directions, in order. Going OFFLINE closes the socket on the client at once (the browser sees the network
 * change) while the object hears nothing (a half-open socket, gone only when its pings go stale); a HANG holds every
 * frame both ways until it ends (TCP keeps them); a HIDDEN tab's frames wait for its throttle slot (1 s; 60 s past 5
 * minutes), so its pings starve and the object drops it. HTTP (room creation, the lists) goes through `ChaosNet.send`.
 *
 * RESOLVER FAULTS, in the room: `delayMs` = the resolve takes that long and holds the object; `fail` = the object dies
 * mid-resolve (a CPU / memory limit or a deploy; restarted from storage, the round not committed, the trigger retried);
 * `conflict` = the resolver answers a 409 (the room voids the match: R-VERSUS-RESOLVE-TIMEOUT-01). `holdMatch` = the
 * object is busy for that long.
 */
import {
  CoreError, newRoomState, RoomCore, type CoreDeps, type CoreEffects, type CoreState, type CreateRoomInput, type PersistJob,
} from '@game/versus-cf/core';
import { stateFromEntries, valueOfKey } from '@game/versus-cf/core/storage';
import {
  parseClientMessage, VERSUS_CF_BEARER_PREFIX, VERSUS_CF_CLOSE, VERSUS_CF_PING, VERSUS_CF_PONG, VERSUS_CF_PROTOCOL, VERSUS_CF_STALE_MS,
  type VersusCfHello, type VersusCfPush, type VersusCfRequest,
} from '@game/versus-cf/protocol';
import type { WebSocketLike } from '@game/versus-cf/client';
import {
  engineContentRevision, handleRankedDuosFinalize, handleVersusDuosFinalize, handleVersusFinalize, handleVersusGroupFinalize, VERSUS_PROTOCOL,
} from '@game/sim/versus/server';
import type { ChaosBackend, ResolverAction, ResolverCall, ResolverChaos, ServerSnap, Vitals } from './chaosBackend';
import type { ChaosMode } from './chaosMatch';
import { throttleSlot, type ChaosNet } from './chaosNet';

export const CF_CHAOS_URL = 'http://cf-chaos.invalid';

/** `room.ts`: the per-socket token bucket. */
const RATE = { req: { per: 20, burst: 40 }, bc: { per: 60, burst: 120 } } as const;
const MAX_FRAME_CHARS = 1_500_000;
const FLOOD_CLOSE_AFTER = 200;
/** The runtime's alarm retry after a throw (it backs off from 2 s). */
const ALARM_RETRY_MS = 2_000;
/** The close code a socket gets when its object restarts (1012 "service restart"; never fatal to the client). */
const RESTART_CLOSE = 1012;

type Handler = (ev: { data?: unknown; code?: number; reason?: string }) => void;

/** The object's end of one socket (the hibernation API's `WebSocket` + its attachment + the runtime's ping stamp). */
interface SrvSock {
  userId: string;
  hello: boolean;
  /** When it opened (the newest socket of an account wins). */
  at: number;
  open: boolean;
  /** `getWebSocketAutoResponseTimestamp`: the last keep-alive the runtime answered. */
  lastAuto: number | null;
  bucket: { req: number; bc: number; at: number; over: number } | null;
  peer: FakeCfWebSocket;
}

/** The client's end: what `VersusCfClient` calls `ws`. Constructed by the game's `new WebSocket(url, protocols)`. */
export class FakeCfWebSocket implements WebSocketLike {
  readyState = 0;
  readonly user: string;
  readonly roomId: string;
  srv: SrvSock | null = null;
  private readonly on: Record<string, Handler[]> = {};
  /** Per-direction order of frames on the wire. */
  readonly up = { last: 0 };
  readonly down = { last: 0 };
  constructor(url: string, protocols: string[], private readonly server: CfChaosServer) {
    const bearer = protocols.find((p) => p.startsWith(VERSUS_CF_BEARER_PREFIX)) ?? '';
    // A dev token: `dev.<uuid>.<name>` (the Worker's DEV_AUTH path).
    this.user = bearer.slice(VERSUS_CF_BEARER_PREFIX.length).split('.')[1] ?? '';
    this.roomId = decodeURIComponent(/\/rooms\/([^/]+)\/ws$/.exec(url)?.[1] ?? '');
    server.connectSocket(this);
  }
  get net(): ChaosNet { return this.server.netOf(this.user); }
  addEventListener(type: 'open' | 'close' | 'error' | 'message', listener: Handler): void { (this.on[type] ??= []).push(listener); }
  fire(type: string, ev: { data?: unknown; code?: number; reason?: string } = {}): void { for (const h of this.on[type] ?? []) h(ev); }
  send(data: string): void {
    if (this.readyState !== 1) return; // a closing socket drops frames (the client resends after its reconnect)
    const srv = this.srv;
    this.server.wire(this.net, this.up, () => { if (srv) this.server.onFrame(srv, data); });
  }
  close(code = 1000, reason = ''): void {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    const srv = this.srv;
    // The close frame reaches the object (if the network carries it), and the close completes on this side.
    if (srv) this.server.wire(this.net, this.up, () => this.server.onPeerClose(srv, code));
    this.server.after(this.net.state.latencyMs, () => this.closed(code, reason));
  }
  /** The socket is closed on this side (fires `close` once). */
  closed(code: number, reason = ''): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.fire('close', { code, reason });
  }
}

/** `room.ts` `staleAt`: the socket's last ping (or its open) + the stale window. */
const staleAt = (ws: SrvSock): number => Math.max(ws.lastAuto ?? ws.at, ws.at) + VERSUS_CF_STALE_MS + 1;

/** The directory object (`directory.ts`), in memory. */
interface RoomSummary { id: string; status: string; protocol: number; contentRevision: string; createdAt: string | null; players: number; maxPlayers: number; fresh: boolean; closed: boolean; [k: string]: unknown }
class Directory {
  rooms: Record<string, RoomSummary> = {};
  members: Record<string, string> = {};
  claim(userId: string, roomId: string): string | null {
    const cur = this.members[userId];
    if (cur && cur !== roomId && this.rooms[cur] && !this.rooms[cur]!.closed) return cur;
    this.members[userId] = roomId;
    return null;
  }
  release(userId: string, roomId: string): void { if (this.members[userId] === roomId) delete this.members[userId]; }
  upsert(s: RoomSummary): void {
    if (s.closed) {
      delete this.rooms[s.id];
      for (const [u, r] of Object.entries(this.members)) if (r === s.id) delete this.members[u];
    } else this.rooms[s.id] = s;
  }
  roomOf(userId: string): string | null { const r = this.members[userId]; return r && this.rooms[r] ? r : null; }
  list(): unknown[] {
    return Object.values(this.rooms).filter((r) => r.fresh && !r.closed).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 100)
      .map(({ members: _m, fresh: _f, closed: _c, ...rest }) => rest);
  }
  openCounts(userId: string, protocol: number, content: string): { open: number; seatOpen: number; duosOpen: number } {
    const mine = this.members[userId];
    const open = Object.values(this.rooms).filter((r) => r.fresh && !r.closed && r.status === 'open' && r.protocol === protocol && r.contentRevision === content && r.id !== mine);
    return { open: open.length, seatOpen: open.filter((r) => r.players < r.maxPlayers).length, duosOpen: 0 };
  }
}

/** One room's Durable Object (the `room.ts` shell, mirrored). */
class RoomShell {
  core: RoomCore | null = null;
  private loaded = false;
  /** Durable storage: survives a restart. Values are stored as copies (structured clone), as the runtime does. */
  readonly storage = new Map<string, unknown>();
  readonly sockets: SrvSock[] = [];
  /** The persistence jobs the shell would write to Supabase (an always-healthy sink here). */
  readonly persisted: PersistJob[] = [];
  private alarmAt: number | null = null;
  private alarmTimer: ReturnType<typeof setTimeout> | null = null;
  private alarmRetry = 0;
  private queue: Promise<void> = Promise.resolve();
  pending = 0;
  /** The current event made the object die (a resolve that was killed): drop it once the event unwinds. */
  private dying = false;
  wakes = 0;
  restarts = 0;
  /** Busy until (the object's event loop is held: a slow resolve, `holdMatch`). */
  busyUntil = 0;

  constructor(readonly id: string, private readonly srv: CfChaosServer) {}

  // ── the event loop (one event at a time) ──────────────────────────────────────────────────────────────────────
  run(fn: () => Promise<void>): Promise<void> {
    this.pending++;
    const p = this.queue.then(fn).catch((e) => { this.srv.note(`cf room: event failed: ${(e as Error).message}`); });
    this.queue = p.finally(() => { this.pending--; });
    return p;
  }

  private deps(): CoreDeps {
    const srv = this.srv;
    const wrap = <F extends (user: string | null, body: Record<string, unknown>, rev: string, store: never) => Promise<{ status: number; body: Record<string, unknown> }>>(action: ResolverAction, real: F): F =>
      (async (user: string | null, body: Record<string, unknown>, rev: string, store: never) => {
        const rc = srv.resolverChaos;
        const entry: ResolverCall = {
          at: Date.now(), user: user ?? '', action, matchId: String(body.matchId ?? ''), round: Number.isInteger(body.round) ? (body.round as number) : null,
          status: 0, handled: false, committed: false, body: null,
        };
        srv.resolverLog.push(entry);
        const finish = (status: number, b: Record<string, unknown>) => { entry.status = status; entry.body = b; srv.onResolve(entry); return { status, body: b }; };
        if (rc.delayMs > 0) {
          // A slow resolve is CPU in the object: nothing else runs until it is done.
          this.busyUntil = Date.now() + rc.delayMs;
          await srv.fakeSleep(rc.delayMs);
        }
        if (rc.conflict > 0) {
          rc.conflict--;
          return finish(409, { error: 'content_mismatch' });
        }
        if (rc.fail > 0) {
          rc.fail--;
          this.dying = true;
          finish(500, { error: 'object_reset' });
          throw new Error('chaos: the room object died mid-resolve');
        }
        entry.handled = true;
        const res = await real(user, body, rev, store);
        entry.committed = res.status === 200;
        return finish(res.status, res.body);
      }) as F;
    return {
      random31: () => srv.random31(),
      uuid: () => srv.uuid(),
      perfNow: () => 0,
      resolve: wrap('finalize', handleVersusFinalize as never),
      resolveGroup: wrap('finalize_group', handleVersusGroupFinalize as never),
      resolveDuos: wrap('finalize_duos', handleVersusDuosFinalize as never),
      resolveRanked: wrap('finalize_ranked_duos', handleRankedDuosFinalize as never),
    };
  }

  /** `load()`: the room from storage after a wake / restart (null when it was never created or is gone). */
  load(): RoomCore | null {
    if (this.loaded) return this.core;
    const state = stateFromEntries(new Map([...this.storage].map(([k, v]) => [k, structuredClone(v)])));
    this.loaded = true;
    this.wakes += 1;
    if (!state) return null;
    this.core = new RoomCore(state, this.deps());
    this.core.restoreSockets(this.live().map((s) => s.userId), Date.now());
    return this.core;
  }

  /** The truth for the harness's reads (no wake: storage when the object is down). */
  peek(): CoreState | null {
    if (this.core) return this.core.state;
    return stateFromEntries(new Map([...this.storage].map(([k, v]) => [k, structuredClone(v)])));
  }

  live(): SrvSock[] { return this.sockets.filter((s) => s.open); }

  /** The object restarts: memory gone, every socket closed (the clients reconnect; the next event re-reads storage). */
  restart(why: string, inAlarm = false): void {
    this.restarts += 1;
    this.core = null;
    this.loaded = false;
    this.dying = false;
    this.busyUntil = 0;
    this.srv.note(`cf room: object restarted (${why}); ${this.live().length} sockets dropped`);
    for (const s of this.live()) this.serverClose(s, RESTART_CLOSE, 'restart');
    // An alarm that died is retried by the runtime, backing off.
    if (inAlarm || this.alarmAt == null) this.setAlarm(Date.now() + ALARM_RETRY_MS * 2 ** Math.min(this.alarmRetry++, 5));
  }

  // ── create (the Worker's POST /rooms → stub.init) ─────────────────────────────────────────────────────────────
  async init(input: CreateRoomInput): Promise<{ ok: true; room: Record<string, unknown> } | { ok: false; error: string }> {
    let out: { ok: true; room: Record<string, unknown> } | { ok: false; error: string } = { ok: false, error: 'init_failed' };
    await this.run(async () => {
      if (this.load()) { out = { ok: false, error: 'room_exists' }; return; }
      try {
        const state = newRoomState(input, Date.now());
        this.core = new RoomCore(state, this.deps());
        this.storage.set('meta', structuredClone(valueOfKey(state, 'meta')));
        this.srv.dir.upsert(this.core.summary() as RoomSummary);
        this.rearm();
        out = { ok: true, room: this.core.roomJson() };
      } catch (e) {
        out = { ok: false, error: e instanceof CoreError ? e.code : 'init_failed' };
      }
    });
    return out;
  }

  // ── the socket upgrade (`fetch`) ──────────────────────────────────────────────────────────────────────────────
  accept(peer: FakeCfWebSocket): void {
    void this.run(async () => {
      const core = this.load();
      if (!core || core.state.room.closed) {
        // A refused upgrade: the browser fires error then close 1006.
        this.srv.wire(peer.net, peer.down, () => { peer.fire('error'); peer.closed(1006, 'no_room'); });
        return;
      }
      const at = Date.now();
      const sock: SrvSock = { userId: peer.user, hello: false, at, open: true, lastAuto: null, bucket: null, peer };
      peer.srv = sock;
      this.sockets.push(sock);
      for (const o of this.live()) if (o !== sock && o.userId === peer.user && o.at <= at) this.serverClose(o, VERSUS_CF_CLOSE.replaced, 'replaced');
      this.apply(core.connect(peer.user, at));
      this.rearm();
      this.srv.wire(peer.net, peer.down, () => {
        if (peer.readyState !== 0) return;
        peer.readyState = 1;
        peer.fire('open');
      });
    });
  }

  /** The object closes a socket (`ws.close`): the client hears it; the peer's close echo comes back to the object. */
  serverClose(s: SrvSock, code: number, reason: string): void {
    if (!s.open) return;
    s.open = false;
    this.srv.wire(s.peer.net, s.peer.down, () => s.peer.closed(code, reason));
  }

  // ── socket events ─────────────────────────────────────────────────────────────────────────────────────────────
  message(ws: SrvSock, text: string): void {
    void this.run(async () => {
      if (!ws.open) return;
      if (text.length > MAX_FRAME_CHARS) { this.serverClose(ws, 1009, 'too_big'); return; }
      const msg = parseClientMessage(text);
      if (!msg) return;
      if (!this.allow(ws, msg.t === 'bc' ? 'bc' : 'req')) {
        if (msg.t === 'req') this.send(ws, JSON.stringify({ t: 'res', id: msg.id, ok: false, error: 'rate_limited', now: new Date().toISOString() }));
        return;
      }
      if (msg.t === 'bc') {
        if (!ws.hello) return;
        const out = JSON.stringify({ t: 'bc', event: msg.event, payload: msg.payload, from: ws.userId } satisfies VersusCfPush);
        for (const o of this.live()) if (o !== ws && o.hello) this.send(o, out);
        return;
      }
      await this.request(ws, msg);
    });
  }

  close(ws: SrvSock, code?: number): void {
    void this.run(async () => {
      ws.open = false;
      const core = this.load();
      if (!core) return;
      const others = this.live().filter((o) => o !== ws && o.userId === ws.userId).length;
      if (others > 0) return;
      this.apply(core.disconnect(ws.userId, Date.now()));
      const fx = await core.tick(Date.now());
      if (this.dying) { this.restart('the resolve died (socket close)'); return; }
      this.apply(fx);
      this.rearm();
      void code;
    });
  }

  private alarm(): void {
    void this.run(async () => {
      this.alarmAt = null;
      const core = this.load();
      if (!core) return;
      const now = Date.now();
      for (const ws of this.live()) {
        if (now >= staleAt(ws)) {
          this.srv.note(`cf room: stale socket closed (${this.srv.nameOf(ws.userId)})`);
          this.serverClose(ws, 1001, 'stale');
          if (!this.live().some((o) => o.userId === ws.userId)) this.apply(core.disconnect(ws.userId, now));
        }
      }
      const fx = await core.tick(now);
      if (this.dying) { this.restart('the resolve died (alarm)', true); return; }
      this.alarmRetry = 0;
      this.apply(fx);
      if (core.state.room.closed) {
        this.storage.clear();
        this.core = null;
        return;
      }
      this.rearm();
    });
  }

  private allow(ws: SrvSock, kind: 'req' | 'bc'): boolean {
    const now = Date.now();
    const b = ws.bucket ?? { req: RATE.req.burst, bc: RATE.bc.burst, at: now, over: 0 };
    const dt = (now - b.at) / 1000;
    b.req = Math.min(RATE.req.burst, b.req + dt * RATE.req.per);
    b.bc = Math.min(RATE.bc.burst, b.bc + dt * RATE.bc.per);
    b.at = now;
    ws.bucket = b;
    if (b[kind] >= 1) { b[kind] -= 1; return true; }
    if (++b.over >= FLOOD_CLOSE_AFTER) this.serverClose(ws, 1008, 'rate_limited');
    this.srv.note(`cf room: rate limited ${this.srv.nameOf(ws.userId)} (${kind}, ${b.over})`);
    return false;
  }

  private async request(ws: SrvSock, msg: VersusCfRequest): Promise<void> {
    const core = this.load();
    const nowIso = new Date().toISOString();
    const answer = (ok: boolean, body: unknown): void =>
      this.send(ws, JSON.stringify(ok ? { t: 'res', id: msg.id, ok: true, data: body, now: nowIso } : { t: 'res', id: msg.id, ok: false, error: String(body), now: nowIso }));
    if (!core) { answer(false, 'no_room'); return; }
    if (msg.op === 'hello') {
      const h = (msg.args ?? {}) as Partial<VersusCfHello>;
      if (h.protocol !== VERSUS_CF_PROTOCOL || h.versusProtocol !== VERSUS_PROTOCOL || h.contentRevision !== engineContentRevision()) {
        answer(false, 'version_mismatch');
        this.serverClose(ws, VERSUS_CF_CLOSE.versionMismatch, 'version_mismatch');
        return;
      }
      ws.hello = true;
      answer(true, { room: core.roomJson(), match: core.currentMatchJson(), priv: core.privFor(ws.userId), userId: ws.userId });
      return;
    }
    if (!ws.hello) { answer(false, 'hello_first'); return; }
    try {
      if (msg.op === 'join' && !core.member(ws.userId)) {
        const elsewhere = this.srv.dir.claim(ws.userId, core.state.room.id);
        if (elsewhere) { answer(false, 'already_in_room'); return; }
      }
      const { data, effects } = await core.op(ws.userId, msg.op, msg.args ?? {}, Date.now());
      // The object died inside this event: no answer, nothing written or pushed (the client resends after its reconnect).
      if (this.dying) { this.restart(`the resolve died (${msg.op})`); return; }
      answer(true, data);
      this.apply(effects);
      this.rearm();
    } catch (e) {
      if (this.dying) { this.restart(`the resolve died (${msg.op})`); return; }
      if (msg.op === 'join' && !core.member(ws.userId)) this.srv.dir.release(ws.userId, core.state.room.id);
      if (e instanceof CoreError) answer(false, e.code);
      else {
        this.srv.note(`cf room: op ${msg.op} failed: ${(e as Error).message}`);
        answer(false, 'server_error');
      }
    }
  }

  // ── effects (`apply`) ─────────────────────────────────────────────────────────────────────────────────────────
  private apply(fx: CoreEffects): void {
    const core = this.core;
    if (!core) return;
    for (const k of fx.dirty) {
      const v = valueOfKey(core.state, k);
      if (v === undefined) this.storage.delete(k);
      else this.storage.set(k, structuredClone(v));
    }
    this.persisted.push(...fx.persist);
    for (const e of fx.events) if (e.kind !== 'resolve_ok' && e.kind !== 'close') this.srv.note(`cf room: event ${e.kind} r${e.round}${e.detail ? ` ${JSON.stringify(e.detail).slice(0, 120)}` : ''}`);
    const now = new Date().toISOString();
    const all = this.live().filter((s) => s.hello);
    const toAll = (msg: VersusCfPush): void => { const s = JSON.stringify(msg); for (const ws of all) this.send(ws, s); };
    if (fx.room) toAll({ t: 'room', room: core.roomJson(), now });
    for (const n of fx.rounds) { const row = core.roundJson(n); if (row) toAll({ t: 'round', row, now }); }
    if (fx.match) { const m = core.currentMatchJson(); if (m) toAll({ t: 'match', match: m, now }); }
    for (const seat of fx.priv) {
      const p = core.privJson(seat);
      if (!p) continue;
      const s = JSON.stringify({ t: 'priv', priv: p, now } satisfies VersusCfPush);
      for (const ws of all) if (ws.userId === p.user_id) this.send(ws, s);
    }
    for (const p of fx.passes) {
      const to = new Set(core.passAudience(p));
      const s = JSON.stringify({ t: 'pass', row: p as unknown as Record<string, unknown>, now } satisfies VersusCfPush);
      for (const ws of all) if (to.has(ws.userId)) this.send(ws, s);
    }
    // RANKED DUOS: the Supabase reads the core asked for, off the request path (`rankedIo`).
    if (fx.ranked && (fx.ranked.team || fx.ranked.seat)) this.rankedIo(fx.ranked.team, fx.ranked.seat);
    if (fx.summary) this.srv.dir.upsert(core.summary() as RoomSummary);
    for (const u of fx.left) this.srv.dir.release(u, core.state.room.id);
    if (core.state.room.closed) {
      const bye = JSON.stringify({ t: 'closed', reason: 'room_closed' } satisfies VersusCfPush);
      for (const ws of this.live()) { this.send(ws, bye); this.serverClose(ws, VERSUS_CF_CLOSE.roomClosed, 'room_closed'); }
    }
  }

  /** `rankedIo` with the local service (no Supabase): no team identity, empty samples. */
  private rankedIo(team: boolean, seat: boolean): void {
    void this.run(async () => {
      const core = this.core;
      if (!core?.ranked) return;
      try {
        if (team) this.apply(core.rankedSetTeam({ teamId: null, name: null, division: 0 }, Date.now()));
        if (seat) {
          const fx = await core.rankedSeat(LOCAL_RANKED, Date.now());
          if (this.dying) { this.restart('the resolve died (ranked seat)'); return; }
          this.apply(fx);
          this.rearm();
        }
      } catch (e) {
        if (this.dying) { this.restart('the resolve died (ranked seat)'); return; }
        this.srv.note(`cf room: ranked io failed: ${(e as Error).message}`);
        this.rearm();
      }
    });
  }

  send(ws: SrvSock, text: string): void {
    if (!ws.open) return;
    const peer = ws.peer;
    this.srv.wire(peer.net, peer.down, () => { if (peer.readyState === 1) peer.fire('message', { data: text }); });
  }

  // ── the alarm (`rearm`) ───────────────────────────────────────────────────────────────────────────────────────
  private rearm(): void {
    const core = this.core;
    if (!core) return;
    const now = Date.now();
    const due: number[] = [];
    const next = core.nextAlarm(now);
    if (next != null) due.push(next);
    if (core.state.room.closed) due.push(now);
    const m = core.state.match;
    const g = core.state.group?.match;
    // Each live socket's own stale moment while a match runs (R-VERSUS-CF-STALE-01).
    if ((m && m.phase !== 'complete') || (g && g.phase !== 'complete')) for (const ws of this.live()) due.push(staleAt(ws));
    if (!due.length) return;
    const at = Math.max(now, Math.min(...due));
    if (this.alarmAt == null || this.alarmAt > at || this.alarmAt < now) this.setAlarm(at);
  }

  private setAlarm(at: number): void {
    if (this.alarmTimer) clearTimeout(this.alarmTimer);
    this.alarmAt = at;
    this.alarmTimer = setTimeout(() => { this.alarmTimer = null; this.alarm(); }, Math.max(0, at - Date.now()));
  }

  dispose(): void { if (this.alarmTimer) clearTimeout(this.alarmTimer); }
}

/** The Worker's `LocalRankedService` (no Supabase), as the Supabase harness stubs the same reads. */
const LOCAL_RANKED = {
  ensureTeam: async () => ({ teamId: null, name: null, division: 0 }),
  soloSample: async () => [],
  duoSample: async () => ({ rows: [], names: {} }),
};

/** mulberry32 (the server's seeds and ids, per scenario). */
function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CfChaosServer implements ChaosBackend {
  readonly kind = 'cf' as const;
  readonly baseUrl = CF_CHAOS_URL;
  readonly resolverLog: ResolverCall[] = [];
  readonly resolverChaos: ResolverChaos = { delayMs: 0, fail: 0, conflict: 0 };
  onResolve: (c: ResolverCall) => void = () => undefined;
  onNote: (s: string) => void = () => undefined;
  dir = new Directory();
  readonly rooms = new Map<string, RoomShell>();
  private readonly knownRooms = new Set<string>();
  private readonly nets = new Map<string, ChaosNet>();
  private readonly roomOfMatch = new Map<string, string>();
  private rng: () => number = rngOf(1);
  private http = 0;
  private sleeping = 0;
  private readonly sockets = new Set<FakeCfWebSocket>();
  private saved: { WebSocket: unknown; fetch: unknown } | null = null;
  /** The next network drop closes the socket WITH a close the object hears (a closed tab, a reset at the edge) instead
   *  of silently (a lost network: the object only learns from the stale keep-alive). CF-only scenarios set it. */
  finOnDrop = false;
  /** Networks that were offline at the last sweep (their return fires the browser's `online` event). */
  private readonly offlineNets = new Set<ChaosNet>();

  /** A player's network (each client registers its own `ChaosNet`). */
  register(user: string, net: ChaosNet): void { this.nets.set(user, net); }
  netOf(user: string): ChaosNet {
    const n = this.nets.get(user);
    if (!n) throw new Error(`cf chaos: no network for ${user}`);
    return n;
  }
  nameOf(user: string): string { return this.nets.get(user)?.name ?? user.slice(-2); }
  note(s: string): void { this.onNote(s); }

  /** Put this server behind the game's `WebSocket` and `fetch` (the Cloudflare transport calls both by global name). */
  install(): void {
    if (this.saved) return;
    const g = globalThis as unknown as { WebSocket: unknown; fetch: (u: unknown, i?: unknown) => Promise<unknown> };
    this.saved = { WebSocket: g.WebSocket, fetch: g.fetch };
    const make = (url: string, protocols: string[]): FakeCfWebSocket => new FakeCfWebSocket(url, protocols, this);
    g.WebSocket = function ChaosWebSocket(url: string, protocols: string[]) { return make(url, protocols); };
    const realFetch = g.fetch;
    g.fetch = (u: unknown, init?: unknown) => (String(u).startsWith(CF_CHAOS_URL) ? this.fetch(String(u), init as RequestInit) : realFetch(u, init));
  }
  uninstall(): void {
    if (!this.saved) return;
    const g = globalThis as unknown as { WebSocket: unknown; fetch: unknown };
    g.WebSocket = this.saved.WebSocket;
    g.fetch = this.saved.fetch;
    this.saved = null;
  }

  async reset(seed = 0.5): Promise<void> {
    for (const r of this.rooms.values()) r.dispose();
    this.rooms.clear();
    this.dir = new Directory();
    this.nets.clear();
    this.roomOfMatch.clear();
    this.sockets.clear();
    this.resolverLog.length = 0;
    Object.assign(this.resolverChaos, { delayMs: 0, fail: 0, conflict: 0 });
    this.rng = rngOf(Math.floor((seed + 1) * 1e9));
    this.http = 0;
    this.sleeping = 0;
    this.finOnDrop = false;
    this.offlineNets.clear();
    this.knownRooms.clear();
  }

  random31(): number { return Math.floor(this.rng() * 0x7fffffff); }
  uuid(): string {
    const hex = (n: number): string => Array.from({ length: n }, () => Math.floor(this.rng() * 16).toString(16)).join('');
    return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
  }

  /** A wait on the fake clock that does not count as server work (the runner stops settling while only these wait). */
  async fakeSleep(ms: number): Promise<void> {
    this.sleeping++;
    try { await new Promise<void>((r) => setTimeout(r, Math.max(0, ms))); } finally { this.sleeping--; }
  }

  idle(): boolean {
    let busy = this.http;
    for (const r of this.rooms.values()) busy += r.pending;
    return busy - this.sleeping <= 0;
  }

  /** Run `fn` after `ms` on the fake clock. */
  after(ms: number, fn: () => void): void { setTimeout(fn, Math.max(0, ms)); }

  /** One frame on one client's network, in order per direction: lost while offline; held by a hang; a hidden tab's
   *  frames wait for its throttle slot; then half the round trip. */
  wire(net: ChaosNet, chan: { last: number }, fn: () => void): void {
    const s = net.state;
    const now = Date.now();
    if (s.offline) return;
    let at = now + throttleSlot(now, s.hiddenSince);
    if (at < s.hangUntil) at = s.hangUntil;
    at += s.latencyMs / 2;
    at = Math.max(at, chan.last);
    chan.last = at;
    setTimeout(() => { if (!net.state.offline) fn(); }, at - now);
  }

  // ── sockets ───────────────────────────────────────────────────────────────────────────────────────────────────
  connectSocket(ws: FakeCfWebSocket): void {
    this.sockets.add(ws);
    const net = ws.net;
    if (net.state.offline) { this.after(5, () => { ws.fire('error'); ws.closed(1006, 'offline'); }); return; }
    this.wire(net, ws.up, () => {
      const room = this.rooms.get(ws.roomId);
      if (!room || ws.readyState !== 0) {
        // A room this scenario never created is a client left over from an earlier scenario (its module graph lives on):
        // closed for good, so it stops reconnecting. A real room that is gone answers as the Worker does (1006).
        const ghost = !this.knownRooms.has(ws.roomId);
        this.wire(net, ws.down, () => { ws.fire('error'); ws.closed(ghost ? VERSUS_CF_CLOSE.roomClosed : 1006, 'no_room'); });
        return;
      }
      room.accept(ws);
    });
  }

  /** A frame reached the object. Keep-alive pings are answered by the runtime itself (stamped, never queued). */
  onFrame(s: SrvSock, text: string): void {
    if (!s.open) return;
    const room = this.rooms.get(s.peer.roomId);
    if (!room) return;
    if (text === VERSUS_CF_PING) {
      s.lastAuto = Date.now();
      room.send(s, VERSUS_CF_PONG);
      return;
    }
    room.message(s, text);
  }

  /** The client's close frame reached the object. */
  onPeerClose(s: SrvSock, code: number): void {
    const room = this.rooms.get(s.peer.roomId);
    if (!room) return;
    s.open = false;
    room.close(s, code);
  }

  /** Each runner step: a client whose network went away sees its socket close at once (the object does not); a network
   *  that came back fires the browser's `online` event (the window is shared: only a client whose socket is down acts). */
  sweep(): void {
    for (const net of this.nets.values()) {
      if (net.state.offline) this.offlineNets.add(net);
      else if (this.offlineNets.delete(net) && typeof window !== 'undefined') window.dispatchEvent(new Event('online'));
    }
    for (const ws of this.sockets) {
      if (ws.readyState === 3) { this.sockets.delete(ws); continue; }
      if (ws.net.state.offline && ws.readyState <= 1) {
        const srv = ws.srv;
        if (this.finOnDrop && srv?.open) this.rooms.get(ws.roomId)?.close(srv, 1001);
        ws.fire('error');
        ws.closed(1006, 'network');
      }
    }
  }

  // ── HTTP (the Worker's routes) ────────────────────────────────────────────────────────────────────────────────
  private async fetch(url: string, init?: RequestInit): Promise<Response> {
    const auth = new Headers(init?.headers).get('Authorization') ?? '';
    const user = auth.replace(/^Bearer /, '').split('.')[1] ?? '';
    const net = this.netOf(user);
    this.http++;
    try {
      const res = await net.send(`http:${init?.method ?? 'GET'}`, async () => {
        this.http++;
        try { return await this.route(user, new URL(url), init); } finally { this.http--; }
      });
      return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => res.body } as unknown as Response;
    } finally {
      this.http--;
    }
  }

  private async route(user: string, url: URL, init?: RequestInit): Promise<{ status: number; body: unknown }> {
    const method = init?.method ?? 'GET';
    if (url.pathname === '/rooms' && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const id = this.uuid();
      const elsewhere = this.dir.claim(user, id);
      if (elsewhere) return { status: 409, body: { error: 'already_in_room', roomId: elsewhere } };
      const input: CreateRoomInput = {
        id, name: String(body.name ?? ''), hostUserId: user, displayName: String(body.display ?? ''),
        profile: (body.profile && typeof body.profile === 'object' ? body.profile : {}) as Record<string, unknown>,
        setId: String(body.setId ?? ''), contentRevision: String(body.contentRevision ?? ''), protocol: Number(body.protocol), options: body.options ?? null,
      };
      const room = new RoomShell(id, this);
      this.rooms.set(id, room);
      this.knownRooms.add(id);
      const res = await room.init(input);
      if (!res.ok) {
        this.dir.release(user, id);
        this.rooms.delete(id);
        return { status: 400, body: { error: res.error } };
      }
      return { status: 200, body: res.room };
    }
    if (url.pathname === '/rooms' && method === 'GET') return { status: 200, body: this.dir.list() };
    if (url.pathname === '/rooms/open') return { status: 200, body: this.dir.openCounts(user, Number(url.searchParams.get('protocol')), String(url.searchParams.get('content') ?? '')) };
    if (url.pathname === '/me/room') return { status: 200, body: { roomId: this.dir.roomOf(user) } };
    return { status: 404, body: { error: 'not_found' } };
  }

  // ── chaos knobs ───────────────────────────────────────────────────────────────────────────────────────────────
  private roomFor(matchId: string): RoomShell | null {
    const id = this.roomOfMatch.get(matchId);
    if (id) return this.rooms.get(id) ?? null;
    for (const r of this.rooms.values()) if (r.peek()?.room.current_match_id === matchId) return r;
    return null;
  }

  holdMatch(matchId: string, ms: number): void {
    const room = this.roomFor(matchId);
    if (!room) return;
    room.busyUntil = Date.now() + ms;
    void room.run(() => this.fakeSleep(ms));
  }
  holding(matchId: string): boolean { return (this.roomFor(matchId)?.busyUntil ?? 0) > Date.now(); }

  killRealtime(_ms: number): string {
    for (const r of this.rooms.values()) void r.run(async () => r.restart('a deploy / eviction'));
    return 'the room object restarts (Cloudflare: one socket carries pushes and requests; the analogue of Realtime dying is every socket dropping at once)';
  }
  realtimeUp(): boolean { return true; }
  listening(user: string, matchId: string): boolean {
    const room = this.roomFor(matchId);
    if (!room || room.peek()?.room.current_match_id !== matchId) return false;
    return room.live().some((s) => s.userId === user && s.hello && s.peer.readyState === 1);
  }

  // ── reads ─────────────────────────────────────────────────────────────────────────────────────────────────────
  noteRoomMatch(roomId: string, matchId: string): void { this.roomOfMatch.set(matchId, roomId); }
  async currentMatchOf(roomId: string): Promise<string | null> { return this.rooms.get(roomId)?.peek()?.room.current_match_id ?? null; }

  async snapshot(matchId: string, group: boolean): Promise<ServerSnap | null> {
    const st = this.roomFor(matchId)?.peek();
    if (!st) return null;
    const t = Date.now();
    const stamp = (x: number | null | undefined): string | null => (x == null ? null : new Date(x).toISOString());
    if (!group) {
      const m = st.match;
      if (!m || m.id !== matchId) return null;
      return {
        t, phase: m.phase, round: m.round, revision: m.revision, shopDeadline: m.shop_deadline, pausedSeat: m.paused_seat, pausedAt: stamp(m.paused_at), resumeAt: stamp(m.resume_at),
        seats: (['p1', 'p2'] as const).map((p) => ({
          seat: p, user: m[`${p}_user`], name: m[`${p}_name`], locked: !!m[`${p}_locked`], lockedAt: null, health: m[`${p}_health`], armor: m[`${p}_armor`],
          placement: m.phase === 'complete' ? (m.winner_seat === p ? 1 : 2) : null, eliminated: null, team: null, auto: !!m[`${p}_auto`],
        })),
        teams: [],
      };
    }
    const m = st.group?.match;
    if (!m || m.id !== matchId) return null;
    return {
      t, phase: m.phase, round: m.round, revision: m.revision, shopDeadline: m.shop_deadline, pausedSeat: m.paused_seat, pausedAt: stamp(m.paused_at), resumeAt: stamp(m.resume_at),
      seats: [...m.seats].sort((a, b) => a.seat.localeCompare(b.seat)).map((x) => ({
        seat: x.seat, user: x.user_id, name: x.name, locked: !!x.locked, lockedAt: x.locked ? x.locked_at ?? null : null, health: x.health, armor: x.armor, placement: x.placement,
        eliminated: x.eliminated_round, team: x.team ?? null, auto: !!x.auto,
      })),
      teams: (st.group?.ranked?.teams ?? m.teams ?? []).map((x) => ({ team: x.team, health: x.health ?? null, armor: x.armor ?? null, placement: x.placement, eliminated: x.eliminated_round })),
    };
  }

  async committedVitals(matchId: string, r: number, mode: ChaosMode): Promise<Vitals | null> {
    const st = this.roomFor(matchId)?.peek();
    if (!st) return null;
    if (mode === 'duel') {
      const row = st.match?.id === matchId ? st.rounds[r] : undefined;
      const m = st.match;
      if (!row || !m || row.p1_health == null) return null;
      return { [m.p1_name]: { health: row.p1_health, armor: row.p1_armor }, [m.p2_name]: { health: row.p2_health, armor: row.p2_armor } };
    }
    const g = st.group;
    const row = g?.match.id === matchId ? (g.ranked ? g.ranked.rounds[r] : g.rounds[r]) : undefined;
    if (!g || !row?.vitals) return null;
    const out: Vitals = {};
    const vit = row.vitals as Record<string, { health: number; armor: number } | undefined>;
    for (const s of g.match.seats) {
      const v = (mode === 'duos' || mode === 'ranked_duos') ? vit[s.team ?? ''] ?? vit[s.seat] : vit[s.seat];
      if (v) out[s.name] = { health: v.health, armor: v.armor };
    }
    return out;
  }

  async committedRounds(matchId: string | null, group: boolean): Promise<number> {
    if (!matchId) return 0;
    const st = this.roomFor(matchId)?.peek();
    if (!st) return 0;
    if (!group) return st.match?.id === matchId ? Object.keys(st.rounds).length : 0;
    const g = st.group;
    return g?.match.id === matchId ? Object.keys(g.ranked ? g.ranked.rounds : g.rounds).length : 0;
  }

  async serverFights(matchId: string, mode: ChaosMode): Promise<Record<number, string>> {
    const st = this.roomFor(matchId)?.peek();
    const out: Record<number, string> = {};
    if (!st) return out;
    if (mode === 'duel') {
      if (st.match?.id === matchId) for (const r of Object.values(st.rounds)) out[r.round] = `${r.outcome}:${r.digest}`;
      return out;
    }
    if (st.group?.match.id !== matchId) return out;
    if (st.group.ranked) {
      for (const r of Object.values(st.group.ranked.rounds)) {
        const fights = [...r.fights].sort((a, b) => a.fight - b.fight);
        if (fights.length) out[r.round] = fights.map((f) => `${f.a_team}-${f.b_team}:${f.outcome}:${f.damage}`).join(' ');
      }
      return out;
    }
    for (const r of Object.values(st.group.rounds)) {
      const fights = [...r.fights].sort((a, b) => a.fight - b.fight);
      if (fights.length) out[r.round] = fights.map((f) => `${f.a_seat}-${f.b_seat}:${f.outcome}:${f.damage}`).join(' ');
    }
    return out;
  }

  /** How the match ended (the result table notes a void). */
  endReason(matchId: string): string | null {
    const st = this.roomFor(matchId)?.peek();
    if (!st) return null;
    return (st.match?.id === matchId ? st.match.end_reason : st.group?.match.id === matchId ? st.group.match.end_reason : null) ?? null;
  }
}
