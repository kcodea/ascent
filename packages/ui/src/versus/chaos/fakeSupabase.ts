/**
 * VERSUS CHAOS HARNESS: ONE CLIENT'S SUPABASE (the network, the RPCs, the table reads, the Edge Function and Realtime).
 *
 * `makeVersusRemote(() => client)` (the REAL adapter the game uses) runs over this object, so every byte the store sends
 * goes through the same code path as in the browser; only the transport is fake:
 *  - rpc / from().select() / functions.invoke() go through `ChaosNet` (per-client latency, offline, hang, background
 *    throttling) to the PGlite server;
 *  - `channel()` subscribes to the `RealtimeBus`, fed by the server's change triggers (with a global kill switch and a
 *    per-client drop), and carries broadcasts between clients.
 */
import type { ChaosServer, RtChange } from './chaosServer';

/** Per-client network conditions (the chaos knobs). */
export interface NetState {
  /** Requests fail at once ("Failed to fetch"); responses in flight are lost. */
  offline: boolean;
  /** Round-trip latency (ms), split evenly before and after the server. */
  latencyMs: number;
  /** Requests made before this time (fake ms) hang until it (a dead socket that comes back). */
  hangUntil: number;
  /** The tab is hidden: requests (and realtime deliveries) wait for the next throttle slot. */
  hiddenSince: number | null;
  /** Realtime to this client is down (its socket died). */
  realtimeDown: boolean;
}

export const freshNet = (): NetState => ({ offline: false, latencyMs: 40, hangUntil: 0, hiddenSince: null, realtimeDown: false });

/** A background tab's timers: about once a second; past 5 minutes hidden, Chrome's intensive throttling (once a minute). */
export function throttleSlot(now: number, hiddenSince: number | null): number {
  if (hiddenSince == null) return 0;
  const period = now - hiddenSince >= 5 * 60_000 ? 60_000 : 1_000;
  const next = Math.ceil(now / period) * period;
  return next - now;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** The transport for one client. */
export class ChaosNet {
  readonly state: NetState = freshNet();
  /** Calls made, by kind (the egress view; also proves a dead client sent nothing). */
  readonly sent: Record<string, number> = {};
  constructor(readonly name: string) {}

  async send<T>(kind: string, op: () => Promise<T>): Promise<T> {
    this.sent[kind] = (this.sent[kind] ?? 0) + 1;
    const s = this.state;
    const wait = throttleSlot(Date.now(), s.hiddenSince);
    if (wait > 0) await sleep(wait);
    if (s.offline) { await sleep(5); throw new NetFailure(); }
    if (Date.now() < s.hangUntil) await sleep(s.hangUntil - Date.now());
    await sleep(s.latencyMs / 2);
    if (s.offline) throw new NetFailure();
    const out = await op();
    await sleep(s.latencyMs / 2);
    if (s.offline) throw new NetFailure(); // the answer was lost on the way back
    return out;
  }
}

export class NetFailure extends Error {
  constructor() { super('TypeError: Failed to fetch'); }
}

// ── realtime ────────────────────────────────────────────────────────────────────────────────────────────────

interface PgFilter { event: string; table: string; filter?: string }
interface Sub { channel: FakeChannel; pg: { f: PgFilter; cb: (p: { new?: Record<string, unknown> }) => void }[]; bc: ((m: { event: string; payload: unknown }) => void)[] }

/** The realtime service: row changes from the server's triggers, broadcasts between channels of the same name. */
export class RealtimeBus {
  /** The global kill switch (Realtime down for everyone). */
  enabled = true;
  /** Delivery latency (ms). */
  latencyMs = 30;
  private subs = new Set<Sub>();
  /** Channels opened, by topic (a "channel reuse" check reads it). */
  readonly opened: Record<string, number> = {};

  register(sub: Sub): void { this.subs.add(sub); this.opened[sub.channel.topic] = (this.opened[sub.channel.topic] ?? 0) + 1; }
  unregister(ch: FakeChannel): void { for (const s of this.subs) if (s.channel === ch) this.subs.delete(s); }
  /** Is a channel of `owner` joined AND listening to this match's row (it would hear the match change)? */
  listening(owner: string, matchId: string): boolean {
    return [...this.subs].some((s) => s.channel.owner === owner && s.channel.joined
      && s.pg.some(({ f }) => (f.table === 'versus_matches' || f.table === 'versus_group_matches') && f.filter === `id=eq.${matchId}`));
  }

  /** Row changes from one server statement. */
  changes(rows: RtChange[]): void {
    if (!this.enabled) return;
    for (const sub of this.subs) {
      if (!sub.channel.joined) continue;
      for (const c of rows) {
        for (const { f, cb } of sub.pg) {
          if (f.table !== c.tbl) continue;
          if (f.event !== '*' && f.event !== c.op) continue;
          if (f.filter) {
            const m = /^([a-z_]+)=eq\.(.+)$/.exec(f.filter);
            if (m && m[2] !== c.key) continue;
          }
          this.deliver(sub.channel, () => cb({ new: c.row ?? undefined }));
        }
      }
    }
  }

  broadcast(from: FakeChannel, event: string, payload: unknown): void {
    if (!this.enabled || from.net.state.offline || from.net.state.realtimeDown) return;
    for (const sub of this.subs) {
      if (sub.channel === from || !sub.channel.joined || sub.channel.topic !== from.topic) continue;
      for (const cb of sub.bc) this.deliver(sub.channel, () => cb({ event, payload }));
    }
  }

  private deliver(ch: FakeChannel, fn: () => void): void {
    const net = ch.net.state;
    if (net.offline || net.realtimeDown) return; // lost: realtime never replays a missed event
    // A hidden tab's socket keeps receiving, but the page runs the handler on its throttled clock; past 5 minutes the
    // socket's own heartbeat timer starves and the server drops it: events are lost until it is back.
    if (net.hiddenSince != null && Date.now() - net.hiddenSince >= 5 * 60_000) return;
    const wait = this.latencyMs + throttleSlot(Date.now() + this.latencyMs, net.hiddenSince);
    setTimeout(() => {
      if (!ch.joined || ch.net.state.offline || ch.net.state.realtimeDown || !this.enabled) return;
      fn();
    }, wait);
  }
}

/**
 * One client's channel, with realtime-js 2.x semantics where they matter (node_modules/@supabase/realtime-js):
 *  - `client.channel(topic)` returns the EXISTING channel object while one with that topic is still registered
 *    (RealtimeClient.channel), including one that is still LEAVING after `removeChannel` (removal waits for the server's
 *    leave ack, a round trip);
 *  - `.on('postgres_changes')` THROWS on a channel that is joined or joining (RealtimeChannel.on);
 *  - `.subscribe()` only (re)joins a CLOSED channel; the join takes a round trip, events before it are missed.
 */
export class FakeChannel {
  state: 'closed' | 'joining' | 'joined' | 'leaving' = 'closed';
  private sub: Sub;
  constructor(readonly topic: string, readonly owner: string, readonly net: ChaosNet, private readonly bus: RealtimeBus,
    private readonly onRemoved: (ch: FakeChannel) => void) {
    this.sub = { channel: this, pg: [], bc: [] };
  }
  get joined(): boolean { return this.state === 'joined'; }
  on(type: string, filter: Record<string, unknown>, cb: (p: any) => void): this {
    if ((this.state === 'joined' || this.state === 'joining') && type === 'postgres_changes') {
      throw new Error(`cannot add \`${type}\` callbacks for realtime:${this.topic} after \`subscribe()\`.`);
    }
    if (type === 'postgres_changes') this.sub.pg.push({ f: filter as unknown as PgFilter, cb });
    else if (type === 'broadcast') this.sub.bc.push(cb);
    return this;
  }
  subscribe(): this {
    if (this.state !== 'closed') return this;
    this.state = 'joining';
    this.bus.register(this.sub);
    setTimeout(() => { if (this.state === 'joining') this.state = 'joined'; }, this.bus.latencyMs * 2);
    return this;
  }
  send(msg: { type: string; event: string; payload: unknown }): Promise<'ok'> {
    if (this.joined) this.bus.broadcast(this, msg.event, msg.payload);
    return Promise.resolve('ok');
  }
  /** `removeChannel`: leave now (no more events), gone from the client's registry once the server acks. */
  unsubscribe(): Promise<'ok'> {
    if (this.state === 'closed') { this.onRemoved(this); return Promise.resolve('ok'); }
    this.state = 'leaving';
    return new Promise((resolve) => {
      setTimeout(() => {
        this.state = 'closed';
        this.bus.unregister(this);
        this.onRemoved(this);
        resolve('ok');
      }, this.bus.latencyMs * 2);
    });
  }
}

// ── the client facade ───────────────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/** A PostgREST-ish read builder: the subset `versusRemote` uses. Awaited, it reads as the user (RLS applies). */
class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private cols = '*';
  private where: { sql: string; v?: unknown }[] = [];
  private orders: string[] = [];
  private lim: number | null = null;
  private single = false;
  constructor(private readonly c: FakeSupabase, private readonly table: string) {}
  select(cols = '*'): this { this.cols = cols; return this; }
  eq(col: string, v: unknown): this { this.where.push({ sql: `${col} = $`, v }); return this; }
  gte(col: string, v: unknown): this { this.where.push({ sql: `${col} >= $`, v }); return this; }
  in(col: string, vs: unknown[]): this { this.where.push({ sql: `${col} = any($)`, v: vs }); return this; }
  not(col: string, op: string, v: unknown): this {
    if (op === 'is' && v === null) this.where.push({ sql: `${col} is not null` });
    else this.where.push({ sql: `${col} <> $`, v });
    return this;
  }
  order(col: string, o?: { ascending?: boolean }): this { this.orders.push(`${col} ${o?.ascending === false ? 'desc' : 'asc'}`); return this; }
  limit(n: number): this { this.lim = n; return this; }
  maybeSingle(): this { this.single = true; return this; }
  then<A, B>(ok?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.run().then(ok, bad);
  }
  private async run(): Promise<{ data: unknown; error: unknown }> {
    const params: unknown[] = [];
    const conds = this.where.map((w) => (w.sql.includes('$') ? w.sql.replace('$', `$${params.push(w.v)}`) : w.sql));
    const sql = `select ${this.cols} from public.${this.table}${conds.length ? ` where ${conds.join(' and ')}` : ''}${this.orders.length ? ` order by ${this.orders.join(', ')}` : ''}${this.lim != null ? ` limit ${this.lim}` : ''}`;
    try {
      const rows = await this.c.net.send('read', () => this.c.server.query<Row>(this.c.user, sql, params));
      return { data: this.single ? rows[0] ?? null : rows, error: null };
    } catch (e) {
      return { data: null, error: errorOf(e) };
    }
  }
}

function errorOf(e: unknown): { message: string; code?: string } {
  if (e instanceof NetFailure) return { message: e.message };
  const err = e as { message?: string; code?: string };
  return { message: err.message ?? 'unknown', ...(err.code ? { code: err.code } : {}) };
}

/** What `makeVersusRemote` needs of a `SupabaseClient`. */
export class FakeSupabase {
  constructor(readonly user: string, readonly server: ChaosServer, readonly net: ChaosNet, readonly bus: RealtimeBus) {}

  async rpc(fn: string, args: Record<string, unknown> = {}): Promise<{ data: unknown; error: unknown }> {
    try {
      // rows: test harness, in-process PGlite; every Versus RPC returns one jsonb value (R-NET-01).
      const data = await this.net.send(`rpc:${fn}`, () => this.server.rpc(this.user, fn, args));
      return { data, error: null };
    } catch (e) {
      return { data: null, error: errorOf(e) };
    }
  }

  from(table: string): Query { return new Query(this, table); }

  readonly functions = {
    invoke: async (name: string, opts: { body: Record<string, unknown> }): Promise<{ data: unknown; error: unknown }> => {
      if (name !== 'versus-resolve') return { data: null, error: new Error('unknown function') };
      try {
        const res = await this.net.send(`fn:${String(opts.body.action)}`, () => this.server.resolve(this.user, opts.body));
        if (res.status >= 200 && res.status < 300) return { data: res.body, error: null };
        return { data: null, error: new Error(`Edge Function returned a non-2xx status code (${res.status})`) };
      } catch (e) {
        return { data: null, error: new Error((e as Error).message) };
      }
    },
  };

  /** The client's channels by topic (realtime-js keeps one per topic until it is removed). */
  private readonly channels = new Map<string, FakeChannel>();
  channel(topic: string): FakeChannel {
    const have = this.channels.get(topic);
    if (have) return have;
    const ch = new FakeChannel(topic, this.user, this.net, this.bus, (c) => { if (this.channels.get(topic) === c) this.channels.delete(topic); });
    this.channels.set(topic, ch);
    return ch;
  }
  removeChannel(ch: FakeChannel): Promise<'ok'> { return ch.unsubscribe(); }
}
