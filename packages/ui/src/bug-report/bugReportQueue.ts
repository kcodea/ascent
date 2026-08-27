/**
 * BUG REPORTER (PR 2) — the durable local queue (blueprint §6).
 *
 * A bug report is more valuable than ordinary telemetry: it must survive a crash immediately after submission,
 * an offline session, and a reload. So queued envelopes live in **IndexedDB** — their OWN database, NOT the
 * existing localStorage upload queue (`ascent.uploadqueue`) — because incident capsules can be hundreds of KB
 * and a large report must never evict board/career uploads (or vice versa) (§6.1). Patterns copied from
 * `../replay/replayDraft.ts`: lazy shared open, resolve-never-reject, per-operation try/catch.
 *
 * The one place this module is STRICTER than replayDraft: a storage failure is not silently swallowed — it
 * degrades to an in-session MEMORY mirror and REPORTS the degradation (`'memory'`), because §13 requires the
 * submit path to know ("IndexedDB unavailable → keep in memory + attempt immediate upload + non-blocking
 * warning"). Play is still never blocked and nothing here ever throws into a caller.
 *
 * Retention (§6.2): at most `BUG_QUEUE_MAX` (25) reports are retained — inserting past the cap drops the
 * OLDEST queued report. A report is NEVER discarded merely because upload attempts failed.
 */
import type { BugReportEnvelope } from './bugReportTypes';

export const BUG_QUEUE_MAX = 25;

const DB_NAME = 'ascent.bugreports';
const DB_VERSION = 1;
const STORE = 'reports';

/** §6.1 queue contract, verbatim, plus `queuedAtMs` (the retention-cap ordering key — envelope `createdAt`
 *  is player-clock ISO text; the cap wants a monotonic-enough local ordering). */
export interface QueuedBugReport {
  envelope: BugReportEnvelope;
  status: 'queued' | 'uploading' | 'failed';
  attempts: number;
  /** Epoch ms before which the retry loop must not touch this item (exponential backoff / long park). */
  nextAttemptAt: number;
  lastError?: string;
  queuedAtMs: number;
}

/** How the write landed: 'durable' = IndexedDB has it (survives reload/crash); 'memory' = this session only
 *  (§13 IndexedDB-unavailable row — caller should attempt immediate upload + warn if that fails). */
export type BugQueueDurability = 'durable' | 'memory';

export interface BugReportQueueStore {
  /** Persist (or replace, by reportId). Resolves only after the write settled — the modal must not close as
   *  "successful" before this resolves (§6.2 step 2 before step 3). Never rejects. */
  put(item: QueuedBugReport): Promise<BugQueueDurability>;
  /** Every retained report, oldest first. Never rejects; [] on storage failure. */
  all(): Promise<QueuedBugReport[]>;
  /** Patch one queued report's retry bookkeeping (status/attempts/nextAttemptAt/lastError). No-op if absent. */
  update(reportId: string, patch: Partial<Pick<QueuedBugReport, 'status' | 'attempts' | 'nextAttemptAt' | 'lastError'>>): Promise<void>;
  /** Delete one report — called ONLY after the server returned its id (§6.2 step 5), or by the retention cap. */
  remove(reportId: string): Promise<void>;
}

// ── Pure helpers (the testable core — no storage, no clock) ───────────────────────────────────────────────

/** Which reports the retention cap evicts so at most `max` remain: the OLDEST first (by queuedAtMs, then id
 *  for stability). Failed attempts don't factor in — age is the only eviction reason (§6.2). */
export function capOverflow(items: readonly QueuedBugReport[], max = BUG_QUEUE_MAX): string[] {
  if (items.length <= max) return [];
  const sorted = [...items].sort((a, b) => a.queuedAtMs - b.queuedAtMs || a.envelope.reportId.localeCompare(b.envelope.reportId));
  return sorted.slice(0, items.length - max).map((i) => i.envelope.reportId);
}

/** In-session exponential backoff (§6.2): 30s · 2^(attempts−1), capped at 15 minutes. */
export function backoffMs(attempts: number): number {
  const base = 30_000;
  const cap = 15 * 60_000;
  return Math.min(cap, base * Math.pow(2, Math.max(0, attempts - 1)));
}

/** How long a server-REJECTED report (413/422 — §13 "server rejects schema") parks before the next try:
 *  long enough not to hammer a server that has already said no, short enough that a fixed build/redeploy
 *  picks it up on a later boot. The report itself is RETAINED either way. */
export const REJECTED_RETRY_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Fresh queue entry for an envelope — status 'queued', immediately eligible for upload. */
export function toQueued(envelope: BugReportEnvelope, nowMs = Date.now()): QueuedBugReport {
  return { envelope, status: 'queued', attempts: 0, nextAttemptAt: 0, queuedAtMs: nowMs };
}

/** Structural gate over a value read back from storage (a possibly-older build wrote it). */
export function isQueuedBugReport(v: unknown): v is QueuedBugReport {
  if (!v || typeof v !== 'object') return false;
  const o = v as Partial<QueuedBugReport>;
  if (!o.envelope || typeof o.envelope !== 'object') return false;
  if (typeof o.envelope.reportId !== 'string' || o.envelope.reportId.length === 0) return false;
  if (o.status !== 'queued' && o.status !== 'uploading' && o.status !== 'failed') return false;
  return typeof o.attempts === 'number' && typeof o.nextAttemptAt === 'number' && typeof o.queuedAtMs === 'number';
}

// ── The in-memory store (tests + the §13 fallback inside the IDB store) ───────────────────────────────────

export function memoryBugReportStore(durability: BugQueueDurability = 'memory'): BugReportQueueStore {
  const items = new Map<string, QueuedBugReport>();
  const enforceCap = (): void => {
    for (const id of capOverflow([...items.values()])) items.delete(id);
  };
  return {
    async put(item) {
      // structuredClone: the envelope's capsule is deep-frozen by capture; store an unfrozen private copy so
      // the queue's copy behaves exactly like the IDB store's (which structured-clones by nature).
      items.set(item.envelope.reportId, structuredClone(item));
      enforceCap();
      return durability;
    },
    async all() {
      return [...items.values()].sort((a, b) => a.queuedAtMs - b.queuedAtMs).map((i) => structuredClone(i));
    },
    async update(reportId, patch) {
      const cur = items.get(reportId);
      if (cur) items.set(reportId, { ...cur, ...patch });
    },
    async remove(reportId) {
      items.delete(reportId);
    },
  };
}

// ── IndexedDB (patterns from replayDraft.ts: lazy shared open, resolve-never-reject) ──────────────────────

function idbAvailable(): boolean {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch { return false; }
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!idbAvailable()) { resolve(null); return; }
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      // Keyed by the envelope's reportId — the same id the server dedupes on (client_report_id), so one
      // report is one row no matter how many times submit/retry touches it.
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'envelope.reportId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null); // a permission prompt must not hang the submit path
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

function txDone(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

/**
 * The shipped store: IndexedDB first, with a session-lifetime memory MIRROR as the §13 fallback. Every
 * operation that cannot reach IDB lands on the mirror instead, and `put` reports which one took the write —
 * so a private-mode browser still gets an immediate-upload attempt rather than a lost report.
 */
export function indexedDbBugReportStore(): BugReportQueueStore {
  let dbp: Promise<IDBDatabase | null> | null = null;
  const db = (): Promise<IDBDatabase | null> => (dbp ??= openDb());
  const fallback = memoryBugReportStore('memory');

  const enforceCap = async (d: IDBDatabase): Promise<void> => {
    try {
      const tx = d.transaction([STORE], 'readwrite');
      const store = tx.objectStore(STORE);
      const raw = await reqToPromise(store.getAll() as IDBRequest<unknown[]>);
      const items = (raw ?? []).filter(isQueuedBugReport);
      for (const id of capOverflow(items)) store.delete(id);
      await txDone(tx);
    } catch { /* cap enforcement is best-effort; the next put tries again */ }
  };

  return {
    async put(item) {
      try {
        const d = await db();
        if (!d) return fallback.put(item);
        const tx = d.transaction([STORE], 'readwrite');
        tx.objectStore(STORE).put(structuredClone(item));
        const ok = await txDone(tx);
        if (!ok) return fallback.put(item);
        await enforceCap(d);
        return 'durable';
      } catch {
        return fallback.put(item);
      }
    },
    async all() {
      let durable: QueuedBugReport[] = [];
      try {
        const d = await db();
        if (d) {
          const tx = d.transaction([STORE], 'readonly');
          const raw = await reqToPromise(tx.objectStore(STORE).getAll() as IDBRequest<unknown[]>);
          durable = (raw ?? []).filter(isQueuedBugReport);
        }
      } catch { /* fall through to the mirror */ }
      const mem = await fallback.all();
      // A report only ever lives in ONE of the two (put lands it in exactly one), but merge defensively.
      const seen = new Set(durable.map((i) => i.envelope.reportId));
      return [...durable, ...mem.filter((i) => !seen.has(i.envelope.reportId))]
        .sort((a, b) => a.queuedAtMs - b.queuedAtMs);
    },
    async update(reportId, patch) {
      try {
        const d = await db();
        if (d) {
          const tx = d.transaction([STORE], 'readwrite');
          const store = tx.objectStore(STORE);
          const cur = await reqToPromise(store.get(reportId) as IDBRequest<unknown>);
          if (isQueuedBugReport(cur)) {
            store.put({ ...cur, ...patch });
            await txDone(tx);
            return;
          }
        }
      } catch { /* fall through to the mirror */ }
      await fallback.update(reportId, patch);
    },
    async remove(reportId) {
      try {
        const d = await db();
        if (d) {
          const tx = d.transaction([STORE], 'readwrite');
          tx.objectStore(STORE).delete(reportId);
          await txDone(tx);
        }
      } catch { /* fall through */ }
      await fallback.remove(reportId);
    },
  };
}

/** The process-wide queue. IndexedDB (with its internal memory fallback) in a browser; pure memory in node
 *  tests — the calling code never branches on which (same seam shape as `replayDrafts`). */
export const bugReportQueue: BugReportQueueStore = idbAvailable() ? indexedDbBugReportStore() : memoryBugReportStore();
