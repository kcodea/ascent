/**
 * GAUNTLET: the DURABLE pending-clear queue (2026-09-29; mirrors `progression/progressionQueue.ts`).
 *
 * A signed-in player's stage clear must never be lost to a dropped connection or a reload: it is written here
 * FIRST (localStorage `ascent.gauntlet.clearqueue`, bound to the account it was played under), then sent to
 * `gauntlet-clear`. It leaves the queue only when the server has confirmed it (a replay's `already_cleared` is a
 * confirmation) or permanently refused it. Keys are `userId + stage`: a second clear of a queued stage is the
 * same request. Its own key, never the progression queue's (whose mode enum is fixed).
 *
 * Same retry shape as the progression queue: exponential backoff (5 s … 10 min) with one armed timer, one
 * retryable failure stops the flush, boot / identity / the `online` event flush with `force`. Only ever submitted
 * while THAT account's session is live; another account's items park untouched.
 */
import { currentIdentity, currentUserId } from '../identity';
import { remoteEnabled } from '../remoteBoards';
import { backoffMs } from '../progression/progressionQueue';
import { submitGauntletClear, type GauntletSubmitOutcome } from './gauntletRemote';

export const GAUNTLET_CLEAR_QUEUE_KEY = 'ascent.gauntlet.clearqueue';
const QUEUE_MAX = 50;

export interface PendingGauntletClear {
  userId: string;
  stage: number;
  /** ISO time the stage was cleared. */
  at: string;
  attempts: number;
  /** Epoch ms before which an unforced flush leaves this item alone. */
  nextAttemptAt?: number;
  lastError?: string;
}

export type GauntletClearSettleListener = (item: PendingGauntletClear, outcome: GauntletSubmitOutcome) => void;

const sameItem = (a: Pick<PendingGauntletClear, 'userId' | 'stage'>, b: Pick<PendingGauntletClear, 'userId' | 'stage'>): boolean =>
  a.userId === b.userId && a.stage === b.stage;

function isPending(x: unknown): x is PendingGauntletClear {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.userId === 'string' && Number.isInteger(o.stage) && (o.stage as number) > 0 && typeof o.at === 'string' && Number.isInteger(o.attempts);
}
function loadQueue(): PendingGauntletClear[] {
  try {
    const raw = localStorage.getItem(GAUNTLET_CLEAR_QUEUE_KEY);
    const a: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a.filter(isPending) : [];
  } catch {
    return [];
  }
}
function saveQueue(q: PendingGauntletClear[]): void {
  try { localStorage.setItem(GAUNTLET_CLEAR_QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX))); } catch { /* ignore */ }
}

/** Persist a clear under the CURRENT signed-in account. Null for a guest, no session or no backend (such a clear
 *  stays on the device). A repeat returns the ORIGINAL item. */
export function enqueueGauntletClear(stage: number, now: number = Date.now()): PendingGauntletClear | null {
  const id = currentIdentity();
  if (!remoteEnabled() || !id || id.anonymous || !id.userId || typeof localStorage === 'undefined') return null;
  const q = loadQueue();
  const existing = q.find((i) => sameItem(i, { userId: id.userId, stage }));
  if (existing) return existing;
  const item: PendingGauntletClear = { userId: id.userId, stage, at: new Date(now).toISOString(), attempts: 0 };
  q.push(item);
  saveQueue(q);
  return item;
}

/** Every clear still pending for `userId` (default: the current account), oldest first. */
export function pendingGauntletClears(userId: string | null = currentUserId()): PendingGauntletClear[] {
  if (!userId) return [];
  return loadQueue().filter((i) => i.userId === userId);
}

function removeItem(item: PendingGauntletClear): void {
  saveQueue(loadQueue().filter((i) => !sameItem(i, item)));
}
function recordAttempt(item: PendingGauntletClear, error: string, now: number): number {
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

export interface GauntletFlushOptions {
  /** Ignore the backoff (boot, network return, identity landing, a fresh clear). */
  force?: boolean;
  /** Test seam: the clock. */
  now?: () => number;
}

/**
 * Submit every due clear for the CURRENT account, oldest first, one at a time. Concurrent calls share one flush.
 * A retryable failure records the attempt, arms the backoff timer and STOPS; confirmed and rejected items leave.
 */
export function flushGauntletClears(onSettled: GauntletClearSettleListener, opts: GauntletFlushOptions = {}): Promise<void> {
  if (flushing) return flushing;
  const now = opts.now ?? Date.now;
  const run = async (): Promise<void> => {
    for (const item of pendingGauntletClears()) {
      if (currentUserId() !== item.userId) return; // the account changed under us: never cross-submit
      if (!opts.force && item.nextAttemptAt !== undefined && item.nextAttemptAt > now()) {
        scheduleRetry(item.nextAttemptAt - now(), onSettled, opts);
        return; // oldest-first: a backing-off item holds the line until it is due
      }
      const outcome = await submitGauntletClear(item.stage);
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
  const p = run().finally(() => { if (flushing === p) flushing = null; });
  flushing = p;
  return p;
}

function scheduleRetry(delay: number, onSettled: GauntletClearSettleListener, opts: GauntletFlushOptions): void {
  if (typeof setTimeout === 'undefined') return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushGauntletClears(onSettled, { ...opts, force: false });
  }, Math.max(250, delay));
}

let listenersInstalled = false;
/** Network return → a forced flush. (Boot + identity triggers ride the store's identity boot.) */
export function installGauntletClearRetryTriggers(onSettled: GauntletClearSettleListener): void {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;
  window.addEventListener('online', () => { void flushGauntletClears(onSettled, { force: true }); });
}

/** Test seam: wipe the queue and any armed retry. */
export function clearGauntletClearQueue(): void {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  try { localStorage.removeItem(GAUNTLET_CLEAR_QUEUE_KEY); } catch { /* ignore */ }
}
