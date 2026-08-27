/**
 * BUG REPORTER (PR 2) — async upload to the `submit-bug-report` Edge Function (blueprint §6.2, §13).
 *
 * Rides the SAME Supabase client/session as every other write (`remoteBoards.ts` — the function invoke
 * carries the session's access token automatically), so bug-report/ never builds a second client. The server
 * contract (supabase/functions/submit-bug-report/index.ts):
 *   POST the BugReportEnvelope JSON → 201 `{id, duplicateOf?}` on insert, 200 `{id, duplicateOf?}` on an
 *   idempotent retry (it dedupes by client_report_id = our envelope.reportId — a retried upload returns the
 *   SAME id, so 200 and 201 are BOTH success); 401 unauthenticated, 413 too large, 422 schema, 429 rate limit.
 *
 * Queue discipline (§6.2): an envelope is deleted from the local queue ONLY after the server returned an id.
 * Failures never discard — they increment attempts and park the item (exponential backoff for transient
 * failures; a long park for a server REJECTION, retaining the report + recording the code per §13).
 *
 * Retry triggers: app boot + the browser `online` event (both wired by `initBugReportUploads`), auth
 * restoration (the store calls `flushBugReportQueue` beside `flushUploadQueue` at both identity sites), and
 * an in-session exponential-backoff timer that this module reschedules after every flush.
 */
import { supabaseClient } from '../remoteBoards';
import { currentUserId } from '../identity';
import type { BugIncidentCapsule, BugReportEnvelope } from './bugReportTypes';
import {
  backoffMs,
  bugReportQueue,
  REJECTED_RETRY_MS,
  toQueued,
  type BugQueueDurability,
  type BugReportQueueStore,
} from './bugReportQueue';

/** The blueprint's hard client limit (§3.5), mirrored server-side as the 413 gate. */
export const BUG_MAX_BODY_BYTES = 4 * 1024 * 1024;

export type BugUploadOutcome =
  | { kind: 'success'; id: string; duplicateOf?: string }
  /** Transient — offline, no session yet, rate limit, 5xx. Retry on the §6.2 triggers. */
  | { kind: 'retryable'; error: string }
  /** The server actively rejected the payload (413/422). Retain locally, record the code, park long (§13). */
  | { kind: 'rejected'; error: string };

// ── §3.5 deterministic trim ladder ────────────────────────────────────────────────────────────────────────

/** Serialized size of an envelope (what the 4 MB limit measures — the POST body). */
export function envelopeBytes(envelope: BugReportEnvelope): number {
  try { return JSON.stringify(envelope).length; } catch { return Number.MAX_SAFE_INTEGER; }
}

/**
 * Apply the §3.5 trimming rules to an over-limit envelope: keep serialized run, current combat,
 * current-wave frames, and actions; drop previous-wave frames, then optional UI details; record every
 * dropped section in `contextTruncated`. Never touches the authoritative combat events. Returns a NEW
 * envelope (the capture module deep-freezes capsules); null when even a fully trimmed envelope is over
 * the limit (then upload is attempted anyway and the server's 413 parks it — never silently dropped).
 */
export function trimEnvelope(envelope: BugReportEnvelope, maxBytes = BUG_MAX_BODY_BYTES): BugReportEnvelope | null {
  if (envelopeBytes(envelope) <= maxBytes) return envelope;
  const capsule = structuredClone(envelope.context) as BugIncidentCapsule;
  const truncated = [...capsule.contextTruncated];
  if (capsule.previousWaveFrames.length > 0) {
    capsule.previousWaveFrames = [];
    truncated.push('previousWaveFrames');
  }
  capsule.contextTruncated = truncated;
  let next: BugReportEnvelope = { ...envelope, context: capsule };
  if (envelopeBytes(next) <= maxBytes) return next;
  const bareUi = structuredClone(capsule);
  bareUi.ui = {
    selectedCardUid: null, selectedCardId: null, pendingTargetCardId: null,
    modalKind: null, draggingCardUid: null,
    viewport: capsule.ui.viewport,
  };
  bareUi.contextTruncated = [...truncated, 'ui'];
  next = { ...envelope, context: bareUi };
  return envelopeBytes(next) <= maxBytes ? next : null;
}

// ── The sender (the seam a test replaces) ─────────────────────────────────────────────────────────────────

export type BugReportSender = (envelope: BugReportEnvelope) => Promise<BugUploadOutcome>;

/** Read an HTTP status off a supabase-js FunctionsHttpError without depending on its class shape. */
function statusOf(error: unknown): number | null {
  const ctx = (error as { context?: { status?: unknown } } | null)?.context;
  return typeof ctx?.status === 'number' ? ctx.status : null;
}

/** The real sender: invoke the Edge Function through the shared client. Never throws. */
export const sendBugReport: BugReportSender = async (envelope) => {
  const c = supabaseClient();
  if (!c) return { kind: 'retryable', error: 'no_backend' };
  // §13 "auth unavailable": no session yet → retain and retry after identity restoration. Attempting the
  // invoke without a session would just burn a 401 round-trip.
  if (!currentUserId()) return { kind: 'retryable', error: 'no_session' };
  try {
    const { data, error } = await c.functions.invoke('submit-bug-report', { body: envelope });
    if (!error) {
      const id = (data as { id?: unknown } | null)?.id;
      if (typeof id === 'string' && id.length > 0) {
        const dup = (data as { duplicateOf?: unknown }).duplicateOf;
        return { kind: 'success', id, duplicateOf: typeof dup === 'string' ? dup : undefined };
      }
      return { kind: 'retryable', error: 'malformed_response' };
    }
    const status = statusOf(error);
    // 413 payload / 422 schema — the server said NO to this payload as-is: retain + record the code (§13).
    if (status === 413 || status === 422) {
      let code = `http_${status}`;
      try {
        const body = await (error as { context: Response }).context.json() as { error?: string };
        if (body?.error) code = `${code}:${body.error}`;
      } catch { /* body unreadable — the status alone is the record */ }
      return { kind: 'rejected', error: code };
    }
    // 401 (session expired mid-flight), 429 (rate limit), 5xx, relay/network errors — all transient.
    return { kind: 'retryable', error: status !== null ? `http_${status}` : String((error as Error).message ?? 'invoke_failed') };
  } catch (e) {
    return { kind: 'retryable', error: e instanceof Error ? e.message : 'network_error' };
  }
};

// ── Queue-driven upload flow ──────────────────────────────────────────────────────────────────────────────

/**
 * Persist an envelope to the durable queue (§6.2 step 2 — the submit path AWAITS this before closing the
 * modal). Over-limit envelopes get the trim ladder BEFORE persisting, so the queued copy is the uploadable
 * one. Returns how the write landed ('memory' = §13 IndexedDB-unavailable — the caller should warn if the
 * follow-up upload also fails).
 */
export async function enqueueBugReport(
  envelope: BugReportEnvelope,
  store: BugReportQueueStore = bugReportQueue,
  nowMs = Date.now(),
): Promise<BugQueueDurability> {
  const fitted = trimEnvelope(envelope) ?? envelope; // even an untrimmable giant is retained — never dropped
  return store.put(toQueued(fitted, nowMs));
}

/**
 * Attempt ONE queued report now (the submit path's immediate attempt). Applies the same bookkeeping as the
 * flush: success deletes; failure increments attempts, records the error, and parks the item for the retry
 * triggers. Never throws.
 */
export async function attemptBugReportUpload(
  reportId: string,
  store: BugReportQueueStore = bugReportQueue,
  send: BugReportSender = sendBugReport,
  nowMs = Date.now(),
): Promise<BugUploadOutcome> {
  const item = (await store.all()).find((i) => i.envelope.reportId === reportId);
  if (!item) return { kind: 'retryable', error: 'not_queued' };
  await store.update(reportId, { status: 'uploading' });
  const outcome = await send(item.envelope);
  if (outcome.kind === 'success') {
    await store.remove(reportId); // §6.2 step 5: delete ONLY once the server returned the id
    return outcome;
  }
  // "Couldn't even try" (no backend configured / no session yet) is not a failed ATTEMPT — the report goes
  // back to 'queued' untouched and waits for the auth-restoration / boot triggers, burning no backoff.
  if (outcome.kind === 'retryable' && (outcome.error === 'no_backend' || outcome.error === 'no_session')) {
    await store.update(reportId, { status: 'queued', lastError: outcome.error });
    return outcome;
  }
  const attempts = item.attempts + 1;
  await store.update(reportId, {
    status: 'failed',
    attempts,
    lastError: outcome.error,
    nextAttemptAt: nowMs + (outcome.kind === 'rejected' ? REJECTED_RETRY_MS : backoffMs(attempts)),
  });
  return outcome;
}

let flushing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Upload every eligible queued report (status not mid-upload, backoff elapsed), oldest first, then schedule
 * the in-session backoff timer for the earliest still-parked item. Stops early on a `no_backend` /
 * `no_session` outcome — every remaining item would fail identically, and the auth-restoration trigger
 * re-runs the flush the moment that changes. Fire-and-forget safe; never throws.
 */
export async function flushBugReportQueue(
  store: BugReportQueueStore = bugReportQueue,
  send: BugReportSender = sendBugReport,
  nowMs = Date.now(),
): Promise<void> {
  if (flushing) return;
  flushing = true;
  let stopped = false; // can't-even-try (no backend / no session) — don't arm a timer; the auth trigger re-runs us
  try {
    const items = await store.all();
    for (const item of items) {
      if (item.nextAttemptAt > nowMs) continue;
      const outcome = await attemptBugReportUpload(item.envelope.reportId, store, send, nowMs);
      if (outcome.kind === 'retryable' && (outcome.error === 'no_backend' || outcome.error === 'no_session')) {
        stopped = true;
        break;
      }
    }
  } catch { /* best-effort throughout — the queue retains everything for the next trigger */ }
  finally {
    flushing = false;
  }
  if (!stopped) scheduleNextRetry(store);
}

/** Arm one in-session timer at the earliest parked `nextAttemptAt` (exponential backoff, §6.2). */
function scheduleNextRetry(store: BugReportQueueStore): void {
  void store.all().then((items) => {
    const pending = items.filter((i) => i.status !== 'uploading');
    if (pending.length === 0) return;
    const earliest = Math.min(...pending.map((i) => i.nextAttemptAt));
    const delay = Math.max(1000, earliest - Date.now());
    // Don't arm absurdly long browser timers for a REJECTED park — the boot trigger covers those.
    if (delay >= REJECTED_RETRY_MS) return;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { retryTimer = null; void flushBugReportQueue(store); }, delay);
  });
}

let initialized = false;
/**
 * Wire the environment retry triggers once (called from the store's boot path): flush at app boot for
 * reports stranded by a previous session, and re-flush whenever the browser comes back online. The auth
 * trigger lives in the store (beside `flushUploadQueue`), and the in-session backoff timer arms itself.
 */
export function initBugReportUploads(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  window.addEventListener('online', () => { void flushBugReportQueue(); });
  void flushBugReportQueue();
}
