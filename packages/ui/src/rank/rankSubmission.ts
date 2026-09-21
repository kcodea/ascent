/**
 * MEDAL RANK — the DURABLE pending-result queue (blueprint §6 "Offline policy", owner 2026-09-20).
 *
 * A rated lobby's result must never be lost to a dropped connection, a reload, or Continue. So a finished
 * rated run is written here FIRST (localStorage, bound to the account it was played under), then submitted;
 * the entry is removed only when the server has confirmed OR permanently rejected it. Retries fire at boot
 * (after identity restores), when the network returns (`online`), when identity (re)establishes, and on the
 * store's `retryRankSubmission()`. Each retry resends the SAME `{ runId, placement, seasonId, rulesVersion }`
 * — the server's ledger dedupes, so a timeout after commit followed by a retry yields the original result
 * exactly once.
 *
 * Deliberately NOT the generic `ascent.uploadqueue` (`remoteBoards.flushUploadQueue`): that queue marks
 * everything it replays UNRATED, drops items on failure, and takes ownership of the whole queue at once. Rank
 * needs the opposite on all three counts.
 *
 * ACCOUNT BINDING. An item carries the `userId` it was played under and is only ever submitted while THAT
 * account's session is live. Signing out or switching accounts leaves the other account's items parked (never
 * dropped, never cross-submitted) until it signs back in.
 *
 * ORDER. Items flush oldest-first and one at a time, so the server settles results in accepted order; the
 * store's revision compare then makes sure a late, older answer never rolls a newer profile back.
 */
import { RANK_RULES, RANK_SEASON } from '@game/sim';
import { currentUserId } from '../identity';
import { remoteEnabled, submitRating } from '../remoteBoards';
import type { RankSubmitOutcome, RankSubmitRequest } from './types';

const QUEUE_KEY = 'ascent.rankqueue';
const QUEUE_MAX = 50;

export interface PendingRank extends RankSubmitRequest {
  /** The account the run was played under. The item is submitted ONLY while this account is live. */
  userId: string;
  /** ISO time the run finished. */
  at: string;
  attempts: number;
  lastError?: string;
}

/** The store's hook: one callback per settled (or failed) attempt. */
export type RankSettleListener = (item: PendingRank, outcome: RankSubmitOutcome) => void;

function loadQueue(): PendingRank[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const a: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? (a as PendingRank[]).filter(isPendingRank) : [];
  } catch {
    return [];
  }
}
function saveQueue(q: PendingRank[]): void {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX))); } catch { /* ignore */ }
}
function isPendingRank(x: unknown): x is PendingRank {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.userId === 'string' && typeof o.runId === 'string' && Number.isInteger(o.placement)
    && Number.isInteger(o.seasonId) && Number.isInteger(o.rulesVersion);
}

/** Build the request a finished rated run submits — season + rules pinned NOW, retried verbatim later. */
export function rankRequestFor(runId: string, placement: number, seed?: number): RankSubmitRequest {
  return { runId, placement, seasonId: RANK_SEASON, rulesVersion: RANK_RULES.rulesVersion, ...(seed != null ? { seed } : {}) };
}

/** Persist a finished rated run's request under the CURRENT account. Returns the queued item, or null when
 *  there is nothing to bind it to (no backend configured / no account at finish → the run is `unrated`). */
export function enqueuePendingRank(req: RankSubmitRequest): PendingRank | null {
  const userId = currentUserId();
  if (!remoteEnabled() || !userId || typeof localStorage === 'undefined') return null;
  const q = loadQueue();
  const existing = q.find((i) => i.userId === userId && i.runId === req.runId);
  if (existing) return existing; // a reload mid-submit: keep the ORIGINAL request, never a fresh one
  const item: PendingRank = { ...req, userId, at: new Date().toISOString(), attempts: 0 };
  q.push(item);
  saveQueue(q);
  return item;
}

/** The pending item for a run under the current account, if any (the screen's "resume on reload" read). */
export function pendingRankFor(runId: string): PendingRank | null {
  const userId = currentUserId();
  if (!userId) return null;
  return loadQueue().find((i) => i.userId === userId && i.runId === runId) ?? null;
}

/** Every item still pending for the CURRENT account, oldest first. */
export function pendingRanks(): PendingRank[] {
  const userId = currentUserId();
  if (!userId) return [];
  return loadQueue().filter((i) => i.userId === userId);
}

function removeItem(item: PendingRank): void {
  saveQueue(loadQueue().filter((i) => !(i.userId === item.userId && i.runId === item.runId)));
}
function recordAttempt(item: PendingRank, error: string): void {
  const q = loadQueue();
  const cur = q.find((i) => i.userId === item.userId && i.runId === item.runId);
  if (cur) { cur.attempts += 1; cur.lastError = error; saveQueue(q); }
}

let flushing: Promise<void> | null = null;

/**
 * Submit every pending item for the CURRENT account, oldest first, one at a time. Confirmed and rejected items
 * leave the queue; retryable ones stay (with the attempt recorded) and the flush STOPS at the first retryable
 * failure — if the network is down, hammering the rest gains nothing and would reorder settlements.
 * Concurrent calls share one in-flight flush.
 */
export function flushPendingRanks(onSettled: RankSettleListener): Promise<void> {
  if (flushing) return flushing;
  const run = async (): Promise<void> => {
    for (const item of pendingRanks()) {
      if (currentUserId() !== item.userId) return; // the account changed under us — never cross-submit
      const outcome = await submitRating(item);
      if (outcome.status === 'retryable') { recordAttempt(item, outcome.reason); onSettled(item, outcome); return; }
      removeItem(item);
      onSettled(item, outcome);
    }
  };
  // The reset rides `.finally` (a microtask), never the body: an empty queue runs the body synchronously to
  // completion BEFORE the assignment below, and a `flushing = null` inside it would then be overwritten by
  // the settled promise — every later flush would short-circuit forever.
  const p = run().finally(() => { if (flushing === p) flushing = null; });
  flushing = p;
  return p;
}

/** Wire the environment triggers once: network return → flush. (Boot + identity triggers ride the store's
 *  identity boot, where `currentUserId()` is known to be fresh.) */
let listenersInstalled = false;
export function installRankRetryTriggers(onSettled: RankSettleListener): void {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;
  window.addEventListener('online', () => { void flushPendingRanks(onSettled); });
}

/** Test seam: wipe the queue. */
export function clearPendingRanks(): void {
  try { localStorage.removeItem(QUEUE_KEY); } catch { /* ignore */ }
}
