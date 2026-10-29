/**
 * VERSUS ON CLOUDFLARE — the client side of one room socket (spike, 2026-10-28). Used by the game's dev transport
 * (`packages/ui/src/versus/versusCfRemote.ts`), the measurement script and the integration tests, so all three speak
 * exactly the same protocol.
 *
 * - Requests are answered in order of arrival (`req` → `res` by id); a request sent while the socket is down waits for
 *   the reconnect (up to its timeout) instead of failing, so a short blip never loses a lock.
 * - Pushes (`room`, `match`, `round`, `priv`, `bc`) go to `onPush`. After every (re)connect the `hello` answer carries
 *   the full room, match and private row; they are replayed through `onPush` so the caller's caches converge.
 * - Keep-alive: a `ping` text frame every 5 s (answered by the runtime without waking the room). No `pong` for 15 s =
 *   the socket is dead (a phone that lost its network): it is closed and reopened at once.
 * - Reconnect: 100 ms, then doubling to 3 s. Never after a version mismatch, a refused token or a closed room. When the
 *   device says its network is back (`wake`: the browser's `online` event), a socket that is down reconnects AT ONCE
 *   instead of waiting out its backoff (up to 3 s), so a returning player's pause lifts in the 3-2-1 alone
 *   (R-VERSUS-CF-RECONNECT-01; the chaos matrix's dropFin cells measured 4.1 s before).
 *
 * Dependency-free apart from the protocol: the WebSocket constructor is injected (browser, Node 22+, Miniflare).
 */
import {
  parseServerMessage,
  VERSUS_CF_BEARER_PREFIX,
  VERSUS_CF_CLOSE,
  VERSUS_CF_PING,
  VERSUS_CF_PING_MS,
  VERSUS_CF_PONG,
  VERSUS_CF_PROTOCOL,
  VERSUS_CF_STALE_MS,
  VERSUS_CF_SUBPROTOCOL,
  versusCfSocketPath,
  type VersusCfOp,
  type VersusCfPush,
  type VersusCfServerMessage,
} from './protocol';
import type { LiveOp } from './liveProtocol';

/** The few WebSocket members the client needs (the browser's, undici's and Miniflare's all fit). */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'close' | 'error' | 'message', listener: (ev: { data?: unknown; code?: number; reason?: string }) => void): void;
}
export type WebSocketFactory = (url: string, protocols: string[]) => WebSocketLike;

export class VersusCfError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export interface VersusCfClientOptions {
  /** The Worker's origin, e.g. `http://127.0.0.1:8787`. */
  baseUrl: string;
  roomId: string;
  /** The socket's path (default: the room's, `versusCfSocketPath(roomId)`). A live game passes `liveCfSocketPath`. */
  path?: string;
  /** The hello's arguments (default: the room hello: protocol, Versus protocol, content revision). */
  hello?: () => Record<string, unknown>;
  /** The hello's answer, after every (re)connect. Given, it REPLACES the room's replay of room / match / priv. */
  onHello?: (data: unknown) => void;
  /** The bearer token (a Supabase access token, or `dev.<uuid>.<name>` against a dev Worker). Re-read on reconnect. */
  token: () => Promise<string>;
  versusProtocol: number;
  contentRevision: string;
  ws: WebSocketFactory;
  onPush?: (msg: VersusCfPush) => void;
  /** Socket state changes (`open` after a successful hello, `down` on any drop, `dead` when it will not reconnect). */
  onStatus?: (status: 'open' | 'down' | 'dead', detail?: string) => void;
  requestTimeoutMs?: number;
  /**
   * The longest `connect()` waits for the room's hello (R-VERSUS-CF-CONNECT-01). Past it `connect()` rejects with
   * `timeout` instead of waiting forever: a refused upgrade (a room that is gone answers 404, which a browser only sees as
   * a dropped socket) would otherwise retry for ever and the caller's promise would never settle. Unset: no deadline.
   */
  connectTimeoutMs?: number;
  /** Calls `fn` whenever the device's network comes back (the browser's `online` event); returns an unsubscribe. */
  wake?: (fn: () => void) => () => void;
  /** Timer hooks (tests). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: unknown;
  sent: boolean;
  frame: string;
}

export interface VersusCfClientStats {
  msgsOut: number;
  msgsIn: number;
  bytesOut: number;
  bytesIn: number;
  pings: number;
  reconnects: number;
}

export class VersusCfClient {
  private ws: WebSocketLike | null = null;
  private ready = false;
  private closed = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private attempt = 0;
  private pingTimer: unknown = null;
  private lastPong = 0;
  readonly stats: VersusCfClientStats = { msgsOut: 0, msgsIn: 0, bytesOut: 0, bytesIn: 0, pings: 0, reconnects: 0 };
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private openWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];
  /** Drops the CURRENT socket as if it closed (the stale keep-alive path). */
  private downCurrent: ((code?: number, reason?: string) => void) | null = null;
  /** The pending reconnect (cleared when a wake reconnects first). */
  private retryTimer: unknown = null;
  private unwake: (() => void) | null = null;

  constructor(private readonly o: VersusCfClientOptions) {
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get isOpen(): boolean {
    return this.ready;
  }

  /** Open the socket (resolves after the hello, rejects when the room refuses for good). */
  connect(): Promise<void> {
    this.closed = false;
    if (!this.unwake && this.o.wake) this.unwake = this.o.wake(() => this.reconnectNow());
    return new Promise<void>((resolve, reject) => {
      let timer: unknown = null;
      const done = (): void => { if (timer != null) this.clearTimer(timer); timer = null; };
      const w = { resolve: () => { done(); resolve(); }, reject: (e: Error) => { done(); reject(e); } };
      this.openWaiters.push(w);
      if (this.o.connectTimeoutMs != null) {
        timer = this.setTimer(() => {
          timer = null;
          if (!this.openWaiters.includes(w)) return;
          this.openWaiters = this.openWaiters.filter((x) => x !== w);
          reject(new VersusCfError('timeout'));
        }, this.o.connectTimeoutMs);
      }
      void this.open().catch((e: Error) => { this.openWaiters = this.openWaiters.filter((x) => x !== w); w.reject(e); });
    });
  }

  /** Every `connect()` still waiting fails with `code` (the socket was closed, or refused for good): never left hanging. */
  private failWaiters(code: string): void {
    for (const w of this.openWaiters.splice(0)) w.reject(new VersusCfError(code));
  }

  /** One request. Rejects with the server's error code (`VersusCfError`). */
  request<T = unknown>(op: VersusCfOp | LiveOp, args: Record<string, unknown> = {}): Promise<T> {
    if (this.closed) return Promise.reject(new VersusCfError('closed'));
    const id = this.nextId++;
    const frame = JSON.stringify({ t: 'req', id, op, args });
    return new Promise<T>((resolve, reject) => {
      const timer = this.setTimer(() => {
        this.pending.delete(id);
        reject(new VersusCfError('timeout'));
      }, this.o.requestTimeoutMs ?? 15_000);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, sent: false, frame });
      if (this.ready) this.flushOne(id);
    });
  }

  /** Relay to every other member (spectator frames, cursors, emotes). Dropped while the socket is down. */
  broadcast(event: string, payload: unknown): void {
    if (this.ready) this.raw(JSON.stringify({ t: 'bc', event, payload }));
  }

  close(): void {
    this.closed = true;
    this.ready = false;
    this.unwake?.();
    this.unwake = null;
    if (this.retryTimer != null) { this.clearTimer(this.retryTimer); this.retryTimer = null; }
    if (this.pingTimer != null) this.clearTimer(this.pingTimer);
    for (const [id, p] of this.pending) { this.clearTimer(p.timer); p.reject(new VersusCfError('closed')); this.pending.delete(id); }
    this.failWaiters('closed');
    try { this.ws?.close(1000, 'bye'); } catch { /* already closed */ }
    this.ws = null;
  }

  // ── internals ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** The network is back: a socket waiting out its backoff reconnects now (a live or connecting socket is left alone). */
  private reconnectNow(): void {
    if (this.closed || this.ws || this.retryTimer == null) return;
    this.clearTimer(this.retryTimer);
    this.retryTimer = null;
    this.attempt = 0;
    void this.open().catch(() => this.retry(1000));
  }

  private retry(ms: number): void {
    if (this.retryTimer != null) this.clearTimer(this.retryTimer);
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      void this.open().catch(() => this.retry(1000));
    }, ms);
  }

  private raw(text: string): void {
    if (!this.ws) return;
    try {
      this.ws.send(text);
      this.stats.msgsOut += 1;
      this.stats.bytesOut += text.length;
    } catch { /* the close handler reconnects */ }
  }

  private flushOne(id: number): void {
    const p = this.pending.get(id);
    if (!p || p.sent) return;
    p.sent = true;
    this.raw(p.frame);
  }

  private async open(): Promise<void> {
    if (this.closed) return;
    const token = await this.o.token();
    const url = this.o.baseUrl.replace(/^http/, 'ws').replace(/\/$/, '') + (this.o.path ?? versusCfSocketPath(this.o.roomId));
    const ws = this.o.ws(url, [VERSUS_CF_SUBPROTOCOL, VERSUS_CF_BEARER_PREFIX + token]);
    this.ws = ws;
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      this.lastPong = Date.now();
      // The hello goes out ahead of anything queued.
      const id = this.nextId++;
      const args = this.o.hello?.() ?? { protocol: VERSUS_CF_PROTOCOL, versusProtocol: this.o.versusProtocol, contentRevision: this.o.contentRevision };
      const frame = JSON.stringify({ t: 'req', id, op: 'hello', args });
      const timer = this.setTimer(() => this.pending.delete(id), this.o.requestTimeoutMs ?? 15_000);
      this.pending.set(id, {
        resolve: (data) => {
          this.ready = true;
          this.attempt = 0;
          if (this.o.onHello) this.o.onHello(data);
          else {
            const d = data as { room?: Record<string, unknown>; match?: Record<string, unknown> | null; priv?: Record<string, unknown> | null };
            const now = new Date().toISOString();
            if (d.room) this.o.onPush?.({ t: 'room', room: d.room, now });
            if (d.match) this.o.onPush?.({ t: 'match', match: d.match, now });
            if (d.priv) this.o.onPush?.({ t: 'priv', priv: d.priv, now });
          }
          this.o.onStatus?.('open');
          for (const w of this.openWaiters.splice(0)) w.resolve();
          // Requests that waited for the socket (or were sent on a socket that died before answering) go now.
          for (const [pid, p] of this.pending) { if (!p.sent) this.flushOne(pid); }
          this.schedulePing();
        },
        // A refused hello (a live game: not yours, full, over) fails the connect; the socket is closed for good.
        // (Live games only: a room's refused hello is followed by its fatal close code, as before.)
        reject: (e) => {
          if (!this.o.onHello) return;
          const waiters = this.openWaiters.splice(0);
          if (!waiters.length) return;
          this.closed = true;
          for (const w of waiters) w.reject(e);
        },
        timer,
        sent: true,
        frame,
      });
      this.raw(frame);
    });
    ws.addEventListener('message', (ev) => {
      if (this.ws !== ws) return;
      const text = typeof ev.data === 'string' ? ev.data : String(ev.data);
      this.stats.msgsIn += 1;
      this.stats.bytesIn += text.length;
      if (text === VERSUS_CF_PONG) { this.lastPong = Date.now(); return; }
      this.lastPong = Date.now();
      const msg = parseServerMessage(text);
      if (msg) this.receive(msg);
    });
    const down = (code?: number, reason?: string): void => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.ready = false;
      if (this.pingTimer != null) { this.clearTimer(this.pingTimer); this.pingTimer = null; }
      // A request that was on the wire may or may not have landed: resend it after the reconnect (every op is
      // idempotent or fenced by seq/round on the server, as the SQL RPCs were).
      for (const p of this.pending.values()) p.sent = false;
      const fatal = code === VERSUS_CF_CLOSE.versionMismatch || code === VERSUS_CF_CLOSE.roomClosed || code === VERSUS_CF_CLOSE.unauthorized
        || code === VERSUS_CF_CLOSE.replaced || code === VERSUS_CF_CLOSE.refused;
      if (this.closed || fatal) {
        this.o.onStatus?.('dead', reason ?? String(code));
        for (const [id, p] of this.pending) { this.clearTimer(p.timer); p.reject(new VersusCfError(reason || 'closed')); this.pending.delete(id); }
        this.failWaiters(reason || 'closed');
        return;
      }
      this.o.onStatus?.('down', reason);
      const wait = Math.min(3000, 100 * 2 ** this.attempt++);
      this.stats.reconnects += 1;
      this.retry(wait);
    };
    this.downCurrent = down;
    ws.addEventListener('close', (ev) => down(ev.code, ev.reason));
    ws.addEventListener('error', () => { try { ws.close(); } catch { /* */ } down(1006, 'error'); });
  }

  private schedulePing(): void {
    if (this.pingTimer != null) this.clearTimer(this.pingTimer);
    this.pingTimer = this.setTimer(() => {
      this.pingTimer = null;
      if (!this.ready || !this.ws) return;
      if (Date.now() - this.lastPong > VERSUS_CF_STALE_MS) {
        // Dead socket (no FIN ever came): drop it and reconnect now.
        const ws = this.ws;
        this.downCurrent?.(4001, 'stale');
        try { ws.close(4001, 'stale'); } catch { /* already gone */ }
        return;
      }
      this.stats.pings += 1;
      this.raw(VERSUS_CF_PING);
      this.schedulePing();
    }, VERSUS_CF_PING_MS);
  }

  private receive(msg: VersusCfServerMessage): void {
    if (msg.t === 'res') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      this.clearTimer(p.timer);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new VersusCfError(msg.error));
      return;
    }
    this.o.onPush?.(msg);
  }
}

/** A JSON call to the Worker's HTTP routes (room creation, the listing, my room). */
export async function versusCfHttp<T>(baseUrl: string, path: string, token: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(baseUrl.replace(/\/$/, '') + path, {
    method: init?.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new VersusCfError(body?.error ?? `http_${res.status}`);
  return body;
}
