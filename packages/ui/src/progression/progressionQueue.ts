/**
 * ACCOUNT PROGRESSION: the DURABLE pending-settlement queue (2026-09-27; mirrors the rank queue,
 * `rank/rankSubmission.ts`).
 *
 * A finished run's XP must never be lost to a dropped connection, a reload or Continue. The request is written
 * here FIRST (localStorage, bound to the account it was played under), then submitted; it leaves the queue only
 * when the server has confirmed it (a DUPLICATE is a confirmation: the server returns the original result) or
 * permanently refused it. Keys are `userId + runId + mode`.
 *
 * What differs from the rank queue:
 *  - EXPONENTIAL BACKOFF. A retryable failure stamps `nextAttemptAt` (5 s, 10 s, 20 s … capped at 10 min) and
 *    arms one in-session timer; boot, the `online` event and identity landing flush with `force` (backoff
 *    ignored), because those are exactly the moments a retry is likely to work.
 *  - RANKED WAITS FOR ITS RANK. Ranked XP is read server-side from the ACCEPTED `rank_results` row, so a ranked
 *    item is skipped (not dropped) while the same run's rank settlement is still in the rank queue. The store
 *    flushes again when the rank answer lands.
 *  - One retryable failure stops the flush (the network is down; hammering the rest gains nothing).
 *
 * ACCOUNT BINDING. An item is only ever submitted while THAT account's session is live; signing out or switching
 * accounts parks it (never dropped, never cross-submitted) until that account is back.
 */
import { currentUserId } from '../identity';
import { remoteEnabled } from '../remoteBoards';
import { pendingRankFor } from '../rank/rankSubmission';
import { submitProgression, type ProgressionSubmitOutcome, type ProgressionSubmitRequest } from './progressionRemote';

const QUEUE_KEY = 'ascent.progressionqueue';
const QUEUE_MAX = 50;
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 10 * 60_000;

export interface PendingProgression extends ProgressionSubmitRequest {
  userId: string;
  /** ISO time the run finished. */
  at: string;
  attempts: number;
  /** Epoch ms before which an unforced flush leaves this item alone. */
  nextAttemptAt?: number;
  lastError?: string;
}

export type ProgressionSettleListener = (item: PendingProgression, outcome: ProgressionSubmitOutcome) => void;

const sameItem = (a: Pick<PendingProgression, 'userId' | 'runId' | 'mode'>, b: Pick<PendingProgression, 'userId' | 'runId' | 'mode'>): boolean =>
  a.userId === b.userId && a.runId === b.runId && a.mode === b.mode;

function loadQueue(): PendingProgression[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const a: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? (a as PendingProgression[]).filter(isPending) : [];
  } catch {
    return [];
  }
}
function saveQueue(q: PendingProgression[]): void {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX))); } catch { /* ignore */ }
}
function isPending(x: unknown): x is PendingProgression {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.userId === 'string' && typeof o.runId === 'string' && (o.mode === 'ranked' || o.mode === 'practice' || o.mode === 'tutorial')
    && Number.isInteger(o.rulesVersion) && Number.isInteger(o.attempts);
}

/** The retry delay after the `attempts`-th failure: 5 s, 10 s, 20 s, … capped at 10 minutes. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

/** Persist a finished run's request under the CURRENT account. Null when there is nothing to bind it to (no
 *  backend configured, or no session at finish: such a run earns no XP). A repeat returns the ORIGINAL item. */
export function enqueuePendingProgression(req: ProgressionSubmitRequest, now: number = Date.now()): PendingProgression | null {
  const userId = currentUserId();
  if (!remoteEnabled() || !userId || typeof localStorage === 'undefined') return null;
  const q = loadQueue();
  const existing = q.find((i) => sameItem(i, { userId, runId: req.runId, mode: req.mode }));
  if (existing) return existing;
  const item: PendingProgression = { ...req, userId, at: new Date(now).toISOString(), attempts: 0 };
  q.push(item);
  saveQueue(q);
  return item;
}

/** Every item still pending for the CURRENT account, oldest first. */
export function pendingProgressions(): PendingProgression[] {
  const userId = currentUserId();
  if (!userId) return [];
  return loadQueue().filter((i) => i.userId === userId);
}

/** The pending item for a run under the current account, if any. */
export function pendingProgressionFor(runId: string, mode: PendingProgression['mode']): PendingProgression | null {
  return pendingProgressions().find((i) => i.runId === runId && i.mode === mode) ?? null;
}

function removeItem(item: PendingProgression): void {
  saveQueue(loadQueue().filter((i) => !sameItem(i, item)));
}
function recordAttempt(item: PendingProgression, error: string, now: number): number {
  const q = loadQueue();
  const cur = q.find((i) => sameItem(i, item));
  if (!cur) return backoffMs(1);
  cur.attempts += 1;
  cur.lastError = error;
  const delay = backoffMs(cur.attempts);
  cur.nextAttemptAt = now + delay;
  saveQueue(q);
  return delay;
}

let flushing: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export interface FlushOptions {
  /** Ignore the backoff (boot, network return, identity landing, an explicit Retry). */
  force?: boolean;
  /** Test seam: the clock. */
  now?: () => number;
  /** Test seam: is this ranked run still waiting on its rank settlement? Defaults to the rank queue. */
  rankPending?: (runId: string) => boolean;
}

/**
 * Submit every due item for the CURRENT account, oldest first, one at a time. Concurrent calls share one flush.
 * A retryable failure records the attempt, arms the backoff timer and STOPS; confirmed and rejected items leave.
 */
export function flushPendingProgressions(onSettled: ProgressionSettleListener, opts: FlushOptions = {}): Promise<void> {
  if (flushing) return flushing;
  const now = opts.now ?? Date.now;
  const rankPending = opts.rankPending ?? ((runId: string) => pendingRankFor(runId) !== null);
  const run = async (): Promise<void> => {
    for (const item of pendingProgressions()) {
      if (currentUserId() !== item.userId) return; // the account changed under us: never cross-submit
      if (item.mode === 'ranked' && rankPending(item.runId)) continue; // its rank is still settling
      if (!opts.force && item.nextAttemptAt !== undefined && item.nextAttemptAt > now()) {
        scheduleRetry(item.nextAttemptAt - now(), onSettled, opts);
        return; // oldest-first: a backing-off item holds the line until it is due
      }
      const outcome = await submitProgression(item);
      if (outcome.status === 'retryable') {
        const delay = recordAttempt(item, outcome.reason, now());
        onSettled(item, outcome);
        scheduleRetry(delay, onSettled, opts);
        return;
      }
      removeItem(item);
      onSettled(item, outcome);
    }
  };
  // The reset rides `.finally` (see the rank queue for why it must not live in the body).
  const p = run().finally(() => { if (flushing === p) flushing = null; });
  flushing = p;
  return p;
}

function scheduleRetry(delay: number, onSettled: ProgressionSettleListener, opts: FlushOptions): void {
  if (typeof setTimeout === 'undefined') return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushPendingProgressions(onSettled, { ...opts, force: false });
  }, Math.max(250, delay));
}

let listenersInstalled = false;
/** Network return → a forced flush. (Boot + identity triggers ride the store's identity boot.) */
export function installProgressionRetryTriggers(onSettled: ProgressionSettleListener): void {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;
  window.addEventListener('online', () => { void flushPendingProgressions(onSettled, { force: true }); });
}

/** Test seam: wipe the queue and any armed retry. */
export function clearPendingProgressions(): void {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  try { localStorage.removeItem(QUEUE_KEY); } catch { /* ignore */ }
}
