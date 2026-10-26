/**
 * SUPABASE EGRESS METER (DEV / measurement builds only; perf/supabase-egress-audit, 2026-10-26).
 *
 * The owner's project went over the Free plan's 5 GB/month egress with a handful of players. This meter answers
 * "which call is it": it wraps the page's `fetch` and `WebSocket` (globally, so the app client, the dev test bots'
 * clients and the bare anon REST insert are all seen) and counts every byte the BACKEND sends this tab, grouped by:
 *
 *   rest:<table> <METHOD>   PostgREST table reads / writes
 *   rpc:<fn>                PostgREST RPCs
 *   fn:<name>[:<action>]    Edge Functions (the JSON body's `action`, when it has one)
 *   auth:<path>             GoTrue
 *   rt:<topic>:<event>      Realtime frames the server pushed (topic ids folded to `*`; broadcast sub-events and
 *                           postgres_changes tables spelled out)
 *
 * Per key: calls, response bytes (decoded body), wire bytes (Content-Length when the server sent one, else the decoded
 * size), request bytes (ingress, free on Supabase but shown), and error responses (HTTP >= 400, a Realtime
 * `phx_reply` with status error, or a `system` error message).
 *
 * Read it from the console: `__egress.table()` (sorted, KB), `__egress.dump()` (JSON), `__egress.reset()`,
 * `__egress.mark('label')` (the totals since the previous mark, for a scripted session). NOT installed in a player
 * build: `installEgressMeter` is a no-op unless `import.meta.env.DEV` or the build set `VITE_EGRESS_METER=1`.
 *
 * Cost: one extra Response clone per backend request (read off the critical path) and a cheap parse per Realtime
 * frame. Measurement builds only, never the shipped game.
 */

export interface EgressRow {
  key: string;
  calls: number;
  /** Decoded response body bytes (what the page received after any gzip). */
  bytes: number;
  /** Wire bytes when the server declared them (Content-Length), else the decoded size. */
  wire: number;
  /** Request body bytes the page sent (ingress for Supabase). */
  sent: number;
  errors: number;
  /** HTTP status / error code counts (only the non-2xx ones). */
  codes: Record<string, number>;
}

interface Meter {
  rows: Map<string, EgressRow>;
  since: number;
  marks: { label: string; at: number; totals: EgressTotals; top: EgressRow[] }[];
  lastMark: Map<string, EgressRow>;
  lastMarkAt: number;
}

export interface EgressTotals { calls: number; bytes: number; wire: number; sent: number; errors: number; ms: number }

const enabled = (): boolean => {
  try {
    return !!(import.meta.env.DEV || import.meta.env.VITE_EGRESS_METER === '1');
  } catch {
    return false;
  }
};

const UUIDISH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONGID = /[A-Za-z0-9_-]{20,}/g;

/** Fold ids out of a Realtime topic so every room / game shares one key. */
export function foldTopic(topic: string): string {
  return topic.replace(/^realtime:/, '').replace(UUIDISH, '*').replace(LONGID, '*');
}

/** The meter key for a backend URL (null: not the backend). Exported for the tests. */
export function keyForUrl(url: string, method: string, base: string, body?: unknown): string | null {
  if (!base || !url.startsWith(base)) return null;
  const u = new URL(url);
  const p = u.pathname;
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^\/rest\/v1\/rpc\/([^/?]+)/))) return `rpc:${m[1]}`;
  if ((m = p.match(/^\/rest\/v1\/([^/?]+)/))) return `rest:${m[1]} ${method}`;
  if ((m = p.match(/^\/functions\/v1\/([^/?]+)/))) {
    let action = '';
    if (typeof body === 'string' && body.length < 200_000) {
      const a = body.match(/"action"\s*:\s*"([a-z_]+)"/);
      if (a) action = `:${a[1]}`;
    }
    return `fn:${m[1]}${action}`;
  }
  if ((m = p.match(/^\/auth\/v1\/([^?]+)/))) return `auth:${m[1]}`;
  if ((m = p.match(/^\/realtime\/v1\/(.+)/))) return `rt-http:${m[1]}`;
  if ((m = p.match(/^\/storage\/v1\/([^/]+)\/([^/]+)/))) return `storage:${m[1]}/${m[2]}`;
  return `other:${p}`;
}

const byteLen = (s: string): number => {
  // UTF-8 length without allocating (JSON is mostly ASCII; this is exact for the rest too).
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00) { n += 4; i++; }
    else n += 3;
  }
  return n;
};

const bodyLen = (b: unknown): number => {
  if (b == null) return 0;
  if (typeof b === 'string') return byteLen(b);
  if (b instanceof ArrayBuffer) return b.byteLength;
  if (ArrayBuffer.isView(b)) return b.byteLength;
  if (typeof Blob !== 'undefined' && b instanceof Blob) return b.size;
  return 0;
};

function row(meter: Meter, key: string): EgressRow {
  let r = meter.rows.get(key);
  if (!r) { r = { key, calls: 0, bytes: 0, wire: 0, sent: 0, errors: 0, codes: {} }; meter.rows.set(key, r); }
  return r;
}

const td = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

/** The meter key + error flag of one Realtime frame the server sent. Exported for the tests. */
export function classifyFrame(data: unknown): { key: string; error: string | null } {
  if (typeof data === 'string') {
    try {
      const msg = JSON.parse(data) as unknown;
      // vsn 2.0.0: [join_ref, ref, topic, event, payload]; vsn 1.0.0: { topic, event, payload }.
      const [topic, event, payload] = Array.isArray(msg)
        ? [String(msg[2] ?? ''), String(msg[3] ?? ''), msg[4] as Record<string, unknown> | undefined]
        : [String((msg as { topic?: string }).topic ?? ''), String((msg as { event?: string }).event ?? ''), (msg as { payload?: Record<string, unknown> }).payload];
      const t = foldTopic(topic);
      let sub = '';
      let error: string | null = null;
      if (event === 'postgres_changes') {
        const d = (payload?.data ?? {}) as { table?: string; type?: string };
        sub = `:${d.table ?? '?'}:${d.type ?? '?'}`;
      } else if (event === 'broadcast') {
        sub = `:${String((payload as { event?: string } | undefined)?.event ?? '?')}`;
      } else if (event === 'phx_reply') {
        const st = String((payload as { status?: string } | undefined)?.status ?? '');
        if (st && st !== 'ok') error = `reply_${st}`;
      } else if (event === 'system') {
        const st = String((payload as { status?: string } | undefined)?.status ?? '');
        if (st === 'error') error = 'system_error';
      } else if (event === 'phx_error') {
        error = 'phx_error';
      }
      return { key: `rt:${t}:${event}${sub}`, error };
    } catch {
      return { key: 'rt:unparsed', error: null };
    }
  }
  if (data instanceof ArrayBuffer && data.byteLength > 5 && td) {
    // realtime-js binary user broadcast (kind 4): [kind, topicLen, eventLen, metaLen, encoding, topic, event, ...].
    const v = new DataView(data);
    const kind = v.getUint8(0);
    if (kind === 4) {
      const tl = v.getUint8(1);
      const el = v.getUint8(2);
      const off = 5;
      const topic = td.decode(data.slice(off, off + tl));
      const event = td.decode(data.slice(off + tl, off + tl + el));
      return { key: `rt:${foldTopic(topic)}:broadcast:${event}`, error: null };
    }
    return { key: `rt:binary:${kind}`, error: null };
  }
  return { key: 'rt:other', error: null };
}

let meter: Meter | null = null;

export function egressTotals(rows: Iterable<EgressRow>, ms = 0): EgressTotals {
  const t: EgressTotals = { calls: 0, bytes: 0, wire: 0, sent: 0, errors: 0, ms };
  for (const r of rows) { t.calls += r.calls; t.bytes += r.bytes; t.wire += r.wire; t.sent += r.sent; t.errors += r.errors; }
  return t;
}

function diffRows(now: Map<string, EgressRow>, then: Map<string, EgressRow>): EgressRow[] {
  const out: EgressRow[] = [];
  for (const [k, r] of now) {
    const p = then.get(k);
    const d: EgressRow = {
      key: k, calls: r.calls - (p?.calls ?? 0), bytes: r.bytes - (p?.bytes ?? 0), wire: r.wire - (p?.wire ?? 0),
      sent: r.sent - (p?.sent ?? 0), errors: r.errors - (p?.errors ?? 0), codes: {},
    };
    for (const [c, n] of Object.entries(r.codes)) { const dn = n - (p?.codes[c] ?? 0); if (dn) d.codes[c] = dn; }
    if (d.calls || d.bytes) out.push(d);
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

const cloneRows = (rows: Map<string, EgressRow>): Map<string, EgressRow> =>
  new Map([...rows].map(([k, r]) => [k, { ...r, codes: { ...r.codes } }]));

/** Install once at boot, before any Supabase client connects. A no-op outside DEV / measurement builds. */
export function installEgressMeter(): void {
  if (meter || typeof window === 'undefined' || !enabled()) return;
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
  if (!base) return;
  const m: Meter = { rows: new Map(), since: performance.now(), marks: [], lastMark: new Map(), lastMarkAt: performance.now() };
  meter = m;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    const key = keyForUrl(url, method, base, init?.body);
    if (!key) return nativeFetch(input, init);
    const r = row(m, key);
    r.calls++;
    r.sent += bodyLen(init?.body);
    let res: Response;
    try {
      res = await nativeFetch(input, init);
    } catch (e) {
      r.errors++;
      r.codes.network = (r.codes.network ?? 0) + 1;
      throw e;
    }
    if (res.status >= 400) { r.errors++; r.codes[String(res.status)] = (r.codes[String(res.status)] ?? 0) + 1; }
    const declared = Number(res.headers.get('content-length') ?? NaN);
    // Read a clone off the caller's path: the caller gets the original Response untouched.
    void res.clone().arrayBuffer().then((b) => {
      r.bytes += b.byteLength;
      r.wire += Number.isFinite(declared) ? declared : b.byteLength;
    }).catch(() => undefined);
    return res;
  };

  const NativeWS = window.WebSocket;
  class MeteredWebSocket extends NativeWS {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const href = typeof url === 'string' ? url : url.href;
      const wsBase = base.replace(/^http/, 'ws');
      if (!href.startsWith(wsBase)) return;
      this.addEventListener('message', (ev: MessageEvent) => {
        const { key, error } = classifyFrame(ev.data);
        const r = row(m, key);
        r.calls++;
        const n = typeof ev.data === 'string' ? byteLen(ev.data) : bodyLen(ev.data);
        r.bytes += n;
        r.wire += n;
        if (error) { r.errors++; r.codes[error] = (r.codes[error] ?? 0) + 1; }
      });
      const send = this.send.bind(this);
      this.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView): void => {
        const { key } = classifyFrame(data);
        row(m, `${key} (sent)`).sent += typeof data === 'string' ? byteLen(data) : bodyLen(data);
        send(data);
      };
    }
  }
  window.WebSocket = MeteredWebSocket as unknown as typeof WebSocket;

  const top = (rows: EgressRow[], n = 40): EgressRow[] => rows.slice().sort((a, b) => b.bytes - a.bytes).slice(0, n);
  const api = {
    rows: (): EgressRow[] => top([...m.rows.values()], 1000),
    totals: (): EgressTotals => egressTotals(m.rows.values(), performance.now() - m.since),
    reset(): void { m.rows.clear(); m.since = performance.now(); m.marks = []; m.lastMark = new Map(); m.lastMarkAt = m.since; },
    /** Close a scripted phase: the rows since the previous mark, recorded under `label` (and returned). */
    mark(label: string) {
      const now = performance.now();
      const d = diffRows(m.rows, m.lastMark);
      const entry = { label, at: Math.round(now - m.since), totals: egressTotals(d, now - m.lastMarkAt), top: d };
      m.marks.push(entry);
      m.lastMark = cloneRows(m.rows);
      m.lastMarkAt = now;
      return entry;
    },
    marks: () => m.marks,
    dump: (): string => JSON.stringify({ totals: api.totals(), rows: api.rows(), marks: m.marks }, null, 1),
    table(): void {
      // eslint-disable-next-line no-console
      console.table(api.rows().map((r) => ({ key: r.key, calls: r.calls, KB: +(r.bytes / 1024).toFixed(1), wireKB: +(r.wire / 1024).toFixed(1), sentKB: +(r.sent / 1024).toFixed(1), errors: r.errors })));
    },
  };
  (window as unknown as { __egress: typeof api }).__egress = api;
}
