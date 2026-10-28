/**
 * THE RUN-END OUTBOX (R-NET-OUTBOX-01, Supabase cleanup 2.4, docs/design/2026-10-28-supabase-cleanup.md section 4).
 *
 * A finished run writes four things: its boards (the opponent pool), its telemetry row (Balance Report, Recent Games,
 * replays), its Career row and its fight-ledger rows. They used to be fire-and-forget: one attempt, the error
 * swallowed, the row lost on a timeout or a dropped connection. Measured 2026-10-12..28: board inserts averaged
 * 1.35 s with a 7.7 s max against an 8 s statement timeout, so the slow ones were exactly the ones that vanished,
 * invisibly (a failed statement never reaches pg_stat_statements).
 *
 * Now each write is an ITEM with a dedupe key, written to the outbox (IndexedDB, its own database; memory when the
 * browser refuses it) and sent at once. It leaves the outbox only when the server took it, or rejected it for a
 * reason a retry cannot fix (then it is reported to `report_write_failure`, never silently dropped). A retryable
 * failure (network, timeout, deadlock, 5xx) keeps it, with a growing delay, and it is retried on the timer, when the
 * network returns and when a session (re)establishes. Every send is idempotent server side (an upsert that ignores a
 * row whose natural key already exists), so a retry after a timeout that DID commit never doubles a row.
 *
 * Modelled on the rank queue (`rank/rankSubmission.ts`): ACCOUNT-BOUND (an item is sent only under the account it was
 * played under), oldest first, and a flush stops at the first retryable failure. An item made with NO session (offline
 * at the finish) is adopted by the next session, exactly as the old `ascent.uploadqueue` did, and its boards are sent
 * UNRATED (C2b: a run finished without a live session never moves the ladder). Nothing else is ever downgraded: the
 * old "retry with fewer columns" ladders (which stored an UNRATED board as rated when any error happened) are gone; a
 * column is dropped only when the server names it as missing, and `user_id` / `unrated` are never dropped.
 *
 * Pure core + injected seams (store, sender, reporter, clock, user), so the policy is unit-tested without a network.
 */

export type OutboxKind = 'boards' | 'telemetry' | 'history' | 'fights';

export interface OutboxItem {
  /** Dedupe key: one item per key (a second submit of the same key keeps the first). */
  key: string;
  kind: OutboxKind;
  table: string;
  /** Rows WITHOUT `user_id` (stamped at send time from the item's account). */
  rows: Record<string, unknown>[];
  /** PostgREST `on_conflict` columns for the idempotent upsert; absent = a plain insert. */
  conflict?: string;
  /** The account it was played under; null = made with no session (adopted by the next one). */
  userId: string | null;
  attempts: number;
  /** Epoch ms before which no retry is tried. */
  nextAt: number;
  queuedAt: number;
  lastError?: string;
  /** Reported to the server's failure log already (once per item). */
  reported?: boolean;
}

export interface SendError { code?: string; message?: string; status?: number }
export type SendResult = { error: SendError | null };

export interface OutboxStore {
  put(item: OutboxItem): Promise<void>;
  all(): Promise<OutboxItem[]>;
  remove(key: string): Promise<void>;
}

export interface OutboxDeps {
  store: OutboxStore;
  /** Send rows to a table: an upsert ignoring duplicates on `conflict`, or a plain insert without it. */
  send(table: string, rows: Record<string, unknown>[], conflict: string | undefined): Promise<SendResult>;
  /** Server failure log (`report_write_failure`); best-effort, must never throw. */
  report(kind: string, key: string, error: string, detail: Record<string, unknown>): Promise<void>;
  currentUserId(): string | null;
  now(): number;
  /** Ask for a flush at this epoch ms (the timer); optional. */
  schedule?(at: number): void;
}

export const OUTBOX_MAX = 60;
/** After this many failed attempts an item is reported (once) and keeps retrying at the longest delay. */
export const REPORT_AFTER_ATTEMPTS = 5;
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 30 * 60_000;
/** Columns a missing-column retry may NEVER drop: the owner stamp, and the rated/unrated tag. */
const PROTECTED = new Set(['user_id', 'unrated']);

export const retryDelay = (attempts: number): number => Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));

/**
 * What to do with a failed send. `retry`: transient (network, timeout, lock, deadlock, server, auth refresh).
 * `reject`: the server will refuse it again (bad data, a constraint, a policy). `missingColumn`: the backend has no
 * such column (a migration not applied there), with the column when the message names it. `noConflictTarget`: the
 * idempotency key's unique index is not there yet (send it as a plain insert, the old behaviour). `done`: a unique
 * violation, i.e. the row is already stored.
 */
export type Verdict =
  | { kind: 'retry' } | { kind: 'reject' } | { kind: 'done' } | { kind: 'noConflictTarget' }
  | { kind: 'missingColumn'; column: string | null };

export function classify(e: SendError): Verdict {
  const code = e.code ?? '';
  const msg = e.message ?? '';
  if (code === '23505') return { kind: 'done' };
  if (code === '42P10') return { kind: 'noConflictTarget' };
  if (code === 'PGRST204' || code === '42703') {
    const m = /'([a-z_0-9]+)' column|column "?(?:[a-z_0-9]+\.)?([a-z_0-9]+)"? (?:of relation \S+ )?does not exist/i.exec(msg);
    return { kind: 'missingColumn', column: m ? (m[1] ?? m[2] ?? null) : null };
  }
  if (e.status !== undefined && (e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500)) return { kind: 'retry' };
  // Transient Postgres classes: 08 connection, 40 rollback (deadlock / serialization), 53 resources, 55P03 lock,
  // 57 operator intervention (57014 = statement timeout).
  if (/^(08|40|53|57)/.test(code) || code === '55P03') return { kind: 'retry' };
  // Permanent: 22 data, 23 integrity, 42 syntax / privilege (RLS), PostgREST request errors. JWT trouble retries.
  if (code === 'PGRST301' || code === 'PGRST302') return { kind: 'retry' };
  if (/^(22|23|42)/.test(code) || /^PGRST[12]/.test(code)) return { kind: 'reject' };
  return { kind: 'retry' }; // no code: a network failure ("Failed to fetch") or something we cannot read
}

const errText = (e: SendError): string => `${e.code ?? ''}${e.status ? ` (${e.status})` : ''} ${e.message ?? ''}`.trim().slice(0, 500);

export interface Outbox {
  /** Store an item and try it now. Resolves after that first attempt (never rejects). Same key twice = one item. */
  submit(item: Omit<OutboxItem, 'attempts' | 'nextAt' | 'queuedAt' | 'userId'> & { userId?: string | null }): Promise<'sent' | 'queued' | 'rejected'>;
  /** Try every due item of the current account (and adopt session-less ones), oldest first. */
  flush(opts?: { force?: boolean }): Promise<void>;
  /** Items still waiting (tests, diagnostics). */
  pending(): Promise<OutboxItem[]>;
}

export function createOutbox(deps: OutboxDeps): Outbox {
  /** Keys whose send is in flight in THIS session (a flush never sends one twice at once). */
  const inFlight = new Set<string>();
  /** Backends found without the idempotency index / a column: remembered for the session per table. */
  const keyless = new Set<string>();
  const missing = new Map<string, Set<string>>();
  let flushing: Promise<void> | null = null;

  const rowsFor = (item: OutboxItem, userId: string): Record<string, unknown>[] => {
    const gone = missing.get(item.table);
    return item.rows.map((r) => {
      const row: Record<string, unknown> = { ...r, user_id: userId };
      // C2b: boards finished with no live session never move the ladder.
      if (item.kind === 'boards' && item.userId === null) row.unrated = true;
      if (gone) for (const c of gone) delete row[c];
      return row;
    });
  };

  /** One attempt. Returns what happened; updates / removes the stored item. */
  async function attempt(item: OutboxItem, userId: string): Promise<'sent' | 'queued' | 'rejected'> {
    inFlight.add(item.key);
    try {
      for (let guard = 0; guard < 8; guard++) {
        const conflict = item.conflict && !keyless.has(item.table) ? item.conflict : undefined;
        const rows = rowsFor(item, userId);
        let res: SendResult;
        try { res = await deps.send(item.table, rows, conflict); } catch (e) { res = { error: { message: String(e) } }; }
        if (!res.error) { await deps.store.remove(item.key); return 'sent'; }
        const v = classify(res.error);
        if (v.kind === 'done') { await deps.store.remove(item.key); return 'sent'; }
        if (v.kind === 'noConflictTarget' && conflict) { keyless.add(item.table); continue; }
        if (v.kind === 'missingColumn') {
          // The idempotency column itself is missing: send without the key (a plain insert), as before this change.
          if (v.column === 'upload_key' || (conflict && v.column && conflict.split(',').includes(v.column))) {
            keyless.add(item.table);
            if (v.column === 'upload_key') (missing.get(item.table) ?? missing.set(item.table, new Set()).get(item.table)!).add('upload_key');
            continue;
          }
          if (v.column && !PROTECTED.has(v.column) && rows.some((r) => v.column! in r)) {
            (missing.get(item.table) ?? missing.set(item.table, new Set()).get(item.table)!).add(v.column);
            continue;
          }
          return reject(item, res.error);
        }
        if (v.kind === 'reject' || v.kind === 'noConflictTarget') return reject(item, res.error);
        // Retryable: keep it, later.
        const next: OutboxItem = { ...item, userId: item.userId, attempts: item.attempts + 1, lastError: errText(res.error) };
        next.nextAt = deps.now() + retryDelay(next.attempts);
        if (next.attempts >= REPORT_AFTER_ATTEMPTS && !next.reported) {
          next.reported = true;
          void deps.report(item.kind, item.key, next.lastError ?? '', { attempts: next.attempts, table: item.table, stillRetrying: true });
        }
        await deps.store.put(next);
        deps.schedule?.(next.nextAt);
        return 'queued';
      }
      return 'queued';
    } finally {
      inFlight.delete(item.key);
    }
  }

  async function reject(item: OutboxItem, e: SendError): Promise<'rejected'> {
    await deps.store.remove(item.key);
    void deps.report(item.kind, item.key, errText(e), { attempts: item.attempts + 1, table: item.table, rows: item.rows.length, rejected: true });
    return 'rejected';
  }

  async function evictOverflow(): Promise<void> {
    const all = (await deps.store.all()).sort((a, b) => a.queuedAt - b.queuedAt);
    for (const old of all.slice(0, Math.max(0, all.length - OUTBOX_MAX))) {
      await deps.store.remove(old.key);
      void deps.report(old.kind, old.key, 'evicted: outbox full', { attempts: old.attempts, table: old.table, lastError: old.lastError ?? null });
    }
  }

  const outbox: Outbox = {
    async submit(input) {
      const userId = deps.currentUserId();
      const item: OutboxItem = { ...input, userId: input.userId !== undefined ? input.userId : userId, attempts: 0, nextAt: 0, queuedAt: deps.now() };
      // Send and persist in the SAME tick: the request is issued synchronously, before any storage await, so a write
      // whose ordering matters (the Career row ahead of the rank request) leaves exactly when it did before. A
      // re-submit of a key already queued is harmless: the server ignores a row whose key it holds.
      const sending = userId && (item.userId === null || item.userId === userId) && !inFlight.has(item.key) ? attempt(item, userId) : null;
      await deps.store.put(item);
      await evictOverflow();
      if (!sending) return 'queued';
      const r = await sending;
      // The send may have finished before the put landed: make sure a sent item is not left stored.
      if (r !== 'queued') await deps.store.remove(item.key);
      return r;
    },
    flush(opts) {
      if (flushing) return flushing;
      const run = async (): Promise<void> => {
        const userId = deps.currentUserId();
        if (!userId) return;
        const now = deps.now();
        const items = (await deps.store.all()).sort((a, b) => a.queuedAt - b.queuedAt);
        let nextDue = Infinity;
        for (const item of items) {
          if (item.userId !== null && item.userId !== userId) continue; // another account's: parked, never cross-sent
          if (inFlight.has(item.key)) continue;
          if (!opts?.force && item.nextAt > now) { nextDue = Math.min(nextDue, item.nextAt); continue; }
          if (deps.currentUserId() !== userId) return; // the account changed under us
          const r = await attempt(item, userId);
          if (r === 'queued') return; // the network is down or the server is struggling: stop, keep the order
        }
        if (nextDue < Infinity) deps.schedule?.(nextDue);
      };
      const p = run().finally(() => { if (flushing === p) flushing = null; });
      flushing = p;
      return p;
    },
    pending: () => deps.store.all(),
  };
  return outbox;
}

// ── Stores ────────────────────────────────────────────────────────────────────────────────────────────────

export function memoryOutboxStore(): OutboxStore {
  const m = new Map<string, OutboxItem>();
  return {
    put: async (i) => { m.set(i.key, structuredCloneSafe(i)); },
    all: async () => [...m.values()].map(structuredCloneSafe),
    remove: async (k) => { m.delete(k); },
  };
}
const structuredCloneSafe = <T>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)) as T);

/**
 * IndexedDB, its own database (a telemetry item carries the run's replay: hundreds of KB, far past what
 * localStorage should hold). Every call resolves; a browser that refuses IndexedDB falls back to memory for the
 * session (the old behaviour's durability, no worse). Same pattern as `bug-report/bugReportQueue.ts`.
 */
export function idbOutboxStore(): OutboxStore {
  const DB_NAME = 'ascent.runoutbox';
  const STORE = 'items';
  const mem = memoryOutboxStore();
  let dbp: Promise<IDBDatabase | null> | null = null;
  const open = (): Promise<IDBDatabase | null> => (dbp ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'key' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  }));
  const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
    const d = await open();
    if (!d) return undefined;
    return new Promise((resolve) => {
      try {
        const t = d.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => resolve(undefined);
        t.onabort = () => resolve(undefined);
      } catch { resolve(undefined); }
    });
  };
  return {
    async put(i) { if (!(await open())) return mem.put(i); await tx('readwrite', (s) => { s.put(i); }); },
    async all() { if (!(await open())) return mem.all(); return ((await tx<OutboxItem[]>('readonly', (s) => s.getAll() as IDBRequest<OutboxItem[]>)) ?? []); },
    async remove(k) { if (!(await open())) return mem.remove(k); await tx('readwrite', (s) => { s.delete(k); }); },
  };
}
