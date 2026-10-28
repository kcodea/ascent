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
 * - Reconnect: 100 ms, then doubling to 3 s. Never after a version mismatch, a refused token or a closed room.
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
  /** The bearer token (a Supabase access token, or `dev.<uuid>.<name>` against a dev Worker). Re-read on reconnect. */
  token: () => Promise<string>;
  versusProtocol: number;
  contentRevision: string;
  ws: WebSocketFactory;
  onPush?: (msg: VersusCfPush) => void;
  /** Socket state changes (`open` after a successful hello, `down` on any drop, `dead` when it will not reconnect). */
  onStatus?: (status: 'open' | 'down' | 'dead', detail?: string) => void;
  requestTimeoutMs?: number;
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
  private openWaiters: (() => void)[] = [];
  /** Drops the CURRENT socket as if it closed (the stale keep-alive path). */
  private downCurrent: ((code?: number, reason?: string) => void) | null = null;

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
    return new Promise<void>((resolve, reject) => {
      this.openWaiters.push(resolve);
      void this.open().catch(reject);
    });
  }

  /** One request. Rejects with the server's error code (`VersusCfError`). */
  request<T = unknown>(op: VersusCfOp, args: Record<string, unknown> = {}): Promise<T> {
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
    if (this.pingTimer != null) this.clearTimer(this.pingTimer);
    for (const [id, p] of this.pending) { this.clearTimer(p.timer); p.reject(new VersusCfError('closed')); this.pending.delete(id); }
    try { this.ws?.close(1000, 'bye'); } catch { /* already closed */ }
    this.ws = null;
  }

  // ── internals ──────────────────────────────────────────────────────────────────────────────────────────────────

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
    const url = this.o.baseUrl.replace(/^http/, 'ws').replace(/\/$/, '') + versusCfSocketPath(this.o.roomId);
    const ws = this.o.ws(url, [VERSUS_CF_SUBPROTOCOL, VERSUS_CF_BEARER_PREFIX + token]);
    this.ws = ws;
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      this.lastPong = Date.now();
      // The hello goes out ahead of anything queued.
      const id = this.nextId++;
      const frame = JSON.stringify({ t: 'req', id, op: 'hello', args: { protocol: VERSUS_CF_PROTOCOL, versusProtocol: this.o.versusProtocol, contentRevision: this.o.contentRevision } });
      const timer = this.setTimer(() => this.pending.delete(id), this.o.requestTimeoutMs ?? 15_000);
      this.pending.set(id, {
        resolve: (data) => {
          this.ready = true;
          this.attempt = 0;
          const d = data as { room?: Record<string, unknown>; match?: Record<string, unknown> | null; priv?: Record<string, unknown> | null };
          const now = new Date().toISOString();
          if (d.room) this.o.onPush?.({ t: 'room', room: d.room, now });
          if (d.match) this.o.onPush?.({ t: 'match', match: d.match, now });
          if (d.priv) this.o.onPush?.({ t: 'priv', priv: d.priv, now });
          this.o.onStatus?.('open');
          for (const w of this.openWaiters.splice(0)) w();
          // Requests that waited for the socket (or were sent on a socket that died before answering) go now.
          for (const [pid, p] of this.pending) { if (!p.sent) this.flushOne(pid); }
          this.schedulePing();
        },
        reject: () => undefined,
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
        || code === VERSUS_CF_CLOSE.replaced;
      if (this.closed || fatal) {
        this.o.onStatus?.('dead', reason ?? String(code));
        for (const [id, p] of this.pending) { this.clearTimer(p.timer); p.reject(new VersusCfError(reason || 'closed')); this.pending.delete(id); }
        return;
      }
      this.o.onStatus?.('down', reason);
      const wait = Math.min(3000, 100 * 2 ** this.attempt++);
      this.stats.reconnects += 1;
      this.setTimer(() => void this.open().catch(() => this.setTimer(() => void this.open(), 1000)), wait);
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
