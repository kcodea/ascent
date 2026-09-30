/**
 * GAUNTLET PROGRESS — which stages the player has cleared, and what the stage-select slots show.
 *
 * TWO STORES behind one API (callers read progress ONLY through these functions):
 *  - LOCAL (a guest or no session): the device list `ascent.gauntlet.local`, exactly as before.
 *  - ACCOUNT (signed in, i.e. a non-anonymous identity, 2026-09-29): a mirror of the account's `gauntlet_progress`
 *    rows (`ascent.gauntlet.acct.<userId>`, refreshed on boot / sign-in / after a clear) PLUS that account's clears
 *    still in the clear queue. A clear is queued for `gauntlet-clear` and marked in the mirror at once; the server
 *    stays the authority for the crate a first clear grants. Signing in never imports the device's clears.
 * Every storage access is guarded: private mode / blocked storage reads as "nothing cleared" and a failed write is
 * dropped, never thrown.
 *
 * Rules (spec §1): stage 1 is always open, clearing N opens N+1. A stage is playable when it exists and is
 * `ready` — or, in a DEV build, when it is a `draft` with at least one non-empty round, so its author can test it.
 */
import { gauntletStage } from '@game/content';
import { currentIdentity } from '../identity';
import { queueNewCrate } from '../progression/newRewards';
import { refreshCrates } from '../progression/progressionStore';
import { enqueueGauntletClear, flushGauntletClears, pendingGauntletClears, type PendingGauntletClear } from './gauntletClearQueue';
import { fetchGauntletProgress, type GauntletSubmitOutcome } from './gauntletRemote';

export const GAUNTLET_LOCAL_KEY = 'ascent.gauntlet.local';

/** The Gauntlet is ten stages long, whether or not each has a file yet — the highest stage number there is. */
export const GAUNTLET_STAGE_COUNT = 10;

const ACCOUNT_KEY_PREFIX = 'ascent.gauntlet.acct.';

/** `'account'` when a real (non-anonymous) account is signed in; `'local'` for a guest or no session. */
export function gauntletAccountMode(): 'account' | 'local' {
  return accountUserId() ? 'account' : 'local';
}

function accountUserId(): string | null {
  const id = currentIdentity();
  return id && !id.anonymous && id.userId ? id.userId : null;
}

/** A stored stage list: sorted, unique, positive integers. [] when missing or unreadable. */
function readStages(key: string): number[] {
  let raw: string | null = null;
  try { raw = localStorage.getItem(key); } catch { return []; }
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const ok = parsed.filter((n): n is number => Number.isInteger(n) && n > 0);
  return [...new Set(ok)].sort((a, b) => a - b);
}
function writeStages(key: string, stages: readonly number[]): void {
  try { localStorage.setItem(key, JSON.stringify(stages)); } catch { /* blocked storage: the clear still counts this session */ }
  bumpProgress();
}

/** A counter bumped on every progress write (a clear, an account refresh), so a mounted stage select re-reads. */
let progressVersion = 0;
const progressListeners = new Set<() => void>();
function bumpProgress(): void {
  progressVersion++;
  for (const l of progressListeners) l();
}
/** `useSyncExternalStore` pair: subscribe to progress writes, and read the current version. */
export function subscribeGauntletProgress(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => { progressListeners.delete(listener); };
}
export const gauntletProgressVersion = (): number => progressVersion;
const sortedUnion = (a: readonly number[], b: readonly number[]): number[] => [...new Set([...a, ...b])].sort((x, y) => x - y);

/** Every stage the player has cleared: sorted, unique, positive integers. Signed in = the account's (mirror ∪ its
 *  queued clears); otherwise this device's. [] when storage is empty or unreadable. */
export function clearedStages(): number[] {
  const userId = accountUserId();
  if (!userId) return readStages(GAUNTLET_LOCAL_KEY);
  return sortedUnion(readStages(ACCOUNT_KEY_PREFIX + userId), pendingGauntletClears(userId).map((i) => i.stage));
}

/** Mark `stage` cleared. `firstClear` is true only the first time it is cleared (on this device, or — signed in —
 *  as far as this client knows; the server decides whether a crate comes with it). `queued` is true only when the
 *  clear is waiting in the clear queue for `gauntlet-clear` (signed in AND a backend), i.e. a server answer will come. */
export function recordClear(stage: number): { firstClear: boolean; queued: boolean } {
  const cleared = clearedStages();
  const firstClear = !cleared.includes(stage);
  const userId = accountUserId();
  if (userId) {
    // Queued even when already known: a replay costs the server one no-op, and a clear the mirror only guessed at
    // (an earlier optimistic mark) still reaches it.
    const queued = enqueueGauntletClear(stage) !== null;
    if (firstClear) writeStages(ACCOUNT_KEY_PREFIX + userId, sortedUnion(readStages(ACCOUNT_KEY_PREFIX + userId), [stage]));
    return { firstClear, queued };
  }
  if (firstClear) writeStages(GAUNTLET_LOCAL_KEY, sortedUnion(cleared, [stage]));
  return { firstClear, queued: false };
}

/** Re-read the signed-in account's cleared stages into its mirror. No-op for a guest; an unanswerable read or a
 *  server without the table keeps the mirror as it was. Only the LATEST refresh writes: an older read answering
 *  after a newer one (a slow boot read behind a post-clear read) would roll the mirror back. */
let refreshSeq = 0;
export async function refreshGauntletAccount(): Promise<void> {
  const userId = accountUserId();
  if (!userId) return;
  const seq = ++refreshSeq;
  const stages = await fetchGauntletProgress(userId).catch(() => undefined);
  if (seq !== refreshSeq) return;
  if (Array.isArray(stages) && accountUserId() === userId) writeStages(ACCOUNT_KEY_PREFIX + userId, stages);
}

/** What a confirmed FIRST clear hands the store: the crate it granted, for the win screen. */
export interface GauntletReward { stage: number; crateId: string }

/**
 * One clear's server answer. A first clear with a crate queues that crate in New Rewards (idempotent: an answer
 * seen twice queues it once), re-reads the crate list and reports the reward; a replay grants nothing. Any
 * definite answer then re-reads the account's stages.
 */
export function settleGauntletClear(item: PendingGauntletClear, outcome: GauntletSubmitOutcome, onReward: (r: GauntletReward) => void): Promise<void> {
  if (outcome.status === 'retryable') return Promise.resolve();
  if (outcome.status === 'confirmed' && outcome.result.status === 'first_clear' && outcome.result.crate) {
    const crate = outcome.result.crate;
    queueNewCrate(item.userId, crate);
    void refreshCrates();
    onReward({ stage: item.stage, crateId: crate.crateId });
  }
  return refreshGauntletAccount();
}

/** Send every queued clear for the current account (boot, sign-in, run end), resolving once each answer has been
 *  settled through `settle` (normally a wrapper over `settleGauntletClear`). */
export async function flushGauntletAccount(settle: (item: PendingGauntletClear, outcome: GauntletSubmitOutcome) => Promise<void>, force = true): Promise<void> {
  const settled: Array<Promise<void>> = [];
  await flushGauntletClears((item, outcome) => { settled.push(settle(item, outcome)); }, { force });
  await Promise.all(settled);
}

/** Stage 1 is always open; any other stage opens once the stage before it is cleared. */
export function isStageUnlocked(stage: number, cleared: readonly number[] = clearedStages()): boolean {
  return stage === 1 || cleared.includes(stage - 1);
}

export type StageSlotState = 'locked' | 'available' | 'cleared' | 'soon' | 'draft';

/** Whether a run can start on `stage`: it exists and is `ready`, or (DEV only) a draft with a non-empty round. */
export function isStagePlayable(stage: number, dev: boolean): boolean {
  const s = gauntletStage(stage);
  if (!s) return false;
  if (s.status === 'ready') return true;
  return dev && s.rounds.some((r) => r.board.length > 0);
}

/** How the stage-select slot for `stage` reads. No playable data → `soon` (players never see a draft); then a
 *  DEV-playable draft reads `draft` REGARDLESS of unlock order, so its author can test stage 3 without clearing
 *  1–2; then `locked` unless unlocked; else `cleared` / `available`. */
export function stageSlotState(stage: number, opts: { dev: boolean; cleared: readonly number[] }): StageSlotState {
  if (!isStagePlayable(stage, opts.dev)) return 'soon';
  if (gauntletStage(stage)?.status === 'draft') return 'draft';
  if (!isStageUnlocked(stage, opts.cleared)) return 'locked';
  return opts.cleared.includes(stage) ? 'cleared' : 'available';
}
