/**
 * ACCOUNT PROGRESSION: the client slice (2026-09-27). A small store of its OWN rather than more fields on the
 * game store (`store.ts` is a hot file): the game store only calls the four entry points below at its seams.
 *
 *   capability  `unknown` until the probe answers, then `on` (migration run + epoch set) or `off`. While not
 *               `on`, NOTHING is shown; while `off`, nothing is queued either. This is the feature flag that
 *               makes shipping the client before the owner runs the SQL safe.
 *   mirror      the account's authoritative progression (XP, level, revision, equipped title, titles), adopted
 *               from the server by HIGHEST revision (a late, older answer never rolls it back); persisted per
 *               account so the Career paints at once.
 *   current     the run that just finished, keyed by a LOCAL key (its seed) so the end screen can find it before
 *               the server run id exists (a practice run's id is its uploaded row id).
 *
 * Entry points (called from store.ts): `probeProgression` (identity boot / change), `expectRunProgression` +
 * `beginRunProgression` (run end), `flushProgression` (a rank answer landed).
 */
import { create } from 'zustand';
import {
  titleName, type ProgressionMode, type ProgressionProfile, type ProgressionResult, type ProgressionRunFactsV1,
} from '@game/progression';
import { currentUserId } from '../identity';
import { remoteEnabled } from '../remoteBoards';
import {
  enqueuePendingProgression, flushPendingProgressions, installProgressionRetryTriggers, type PendingProgression,
} from './progressionQueue';
import { fetchOwnProgression, fetchProgressionEnabled, progressionRequestFor, type ProgressionSubmitOutcome } from './progressionRemote';

export type ProgressionCapability = 'unknown' | 'on' | 'off';
/** `none`: this run earns nothing we can settle (no session, no source row). */
export type ProgressionRunState = 'pending' | 'confirmed' | 'retryable' | 'rejected' | 'none';

export interface ProgressionMirror extends ProgressionProfile { userId: string }

export interface CurrentRunProgression {
  localKey: string;
  mode: ProgressionMode;
  runId: string | null;
  state: ProgressionRunState;
  result: ProgressionResult | null;
  deduped: boolean;
  error: string | null;
}

interface ProgressionStore {
  capability: ProgressionCapability;
  mirror: ProgressionMirror | null;
  current: CurrentRunProgression | null;
}

const MIRROR_KEY = 'ascent.progression';

function loadMirror(): ProgressionMirror | null {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    const o = raw ? (JSON.parse(raw) as ProgressionMirror) : null;
    return o && typeof o.userId === 'string' && typeof o.accountXp === 'number' && typeof o.revision === 'number' ? o : null;
  } catch {
    return null;
  }
}
function saveMirror(m: ProgressionMirror | null): void {
  try { if (m) localStorage.setItem(MIRROR_KEY, JSON.stringify(m)); else localStorage.removeItem(MIRROR_KEY); } catch { /* ignore */ }
}

export const useProgression = create<ProgressionStore>(() => ({
  capability: 'unknown',
  mirror: typeof localStorage === 'undefined' ? null : loadMirror(),
  current: null,
}));

/** The mirror, only when it belongs to the account that is live right now. */
export function mirrorFor(userId: string | null | undefined, mirror: ProgressionMirror | null): ProgressionMirror | null {
  return userId && mirror && mirror.userId === userId ? mirror : null;
}

/**
 * Adopt a server profile for `userId` unless the mirror already holds a NEWER revision of the same account.
 * Returns whether it was adopted.
 */
export function adoptProgressionProfile(userId: string, profile: ProgressionProfile): boolean {
  const cur = useProgression.getState().mirror;
  if (cur && cur.userId === userId && profile.revision < cur.revision) return false;
  const next: ProgressionMirror = { ...profile, userId };
  saveMirror(next);
  useProgression.setState({ mirror: next });
  return true;
}

/** One queue answer lands: adopt the profile, and update the end screen when it is the run it shows. */
export function applyProgressionOutcome(item: Pick<PendingProgression, 'userId' | 'runId' | 'mode'>, outcome: ProgressionSubmitOutcome): void {
  if (outcome.status === 'confirmed') adoptProgressionProfile(item.userId, outcome.profile);
  const cur = useProgression.getState().current;
  if (!cur || cur.runId !== item.runId || cur.mode !== item.mode) return;
  if (outcome.status === 'confirmed') {
    useProgression.setState({ current: { ...cur, state: 'confirmed', result: outcome.result, deduped: outcome.deduped, error: null } });
  } else {
    useProgression.setState({ current: { ...cur, state: outcome.status, error: outcome.reason } });
  }
}

let probing: Promise<void> | null = null;

/**
 * The capability probe + mirror refresh + queue flush, run when identity lands or changes. Safe to call often:
 * concurrent calls share one probe. An unanswerable probe (offline) leaves the capability as it was.
 */
export function probeProgression(): Promise<void> {
  if (probing) return probing;
  const run = async (): Promise<void> => {
    if (!remoteEnabled()) { useProgression.setState({ capability: 'off' }); return; }
    const enabled = await fetchProgressionEnabled();
    if (enabled === undefined) return;
    useProgression.setState({ capability: enabled ? 'on' : 'off' });
    if (!enabled) return;
    const userId = currentUserId();
    if (!userId) return;
    const profile = await fetchOwnProgression();
    if (profile) adoptProgressionProfile(userId, profile);
    await flushPendingProgressions(applyProgressionOutcome, { force: true });
  };
  const p = run().catch(() => { /* never throws */ }).finally(() => { if (probing === p) probing = null; });
  probing = p;
  return p;
}

/** Flush the queue now (a rank answer landed, or the player pressed Retry). No-op until the feature is on. */
export function flushProgression(force = false): Promise<void> {
  if (useProgression.getState().capability !== 'on') return Promise.resolve();
  return flushPendingProgressions(applyProgressionOutcome, { force });
}

/**
 * A run just ended that WILL settle once its source exists (a practice run waits for its uploaded row id). The
 * end screen shows "pending" from this moment. No-op when the feature is off or there is no session.
 */
export function expectRunProgression(localKey: string, mode: ProgressionMode): void {
  if (useProgression.getState().capability === 'off' || !remoteEnabled() || !currentUserId()) {
    useProgression.setState({ current: { localKey, mode, runId: null, state: 'none', result: null, deduped: false, error: null } });
    return;
  }
  useProgression.setState({ current: { localKey, mode, runId: null, state: 'pending', result: null, deduped: false, error: null } });
}

/**
 * Queue and submit one finished run's facts. Durable first (the queue), then a flush. Returns whether it was
 * queued. `sourceId` is the practice row id.
 */
export function beginRunProgression(localKey: string, facts: ProgressionRunFactsV1, sourceId?: number): boolean {
  const st = useProgression.getState();
  const none = (): false => {
    useProgression.setState({ current: { localKey, mode: facts.mode, runId: facts.runId, state: 'none', result: null, deduped: false, error: null } });
    return false;
  };
  if (st.capability === 'off' || !facts.terminal) return none();
  const item = enqueuePendingProgression(progressionRequestFor(facts, sourceId));
  if (!item) return none();
  useProgression.setState({ current: { localKey, mode: facts.mode, runId: facts.runId, state: 'pending', result: null, deduped: false, error: null } });
  void flushProgression();
  return true;
}

/** A run that was expected to settle cannot (its practice row never uploaded): the end screen stops waiting. */
export function markRunProgressionUnavailable(localKey: string): void {
  const cur = useProgression.getState().current;
  if (cur && cur.localKey === localKey && cur.state === 'pending') useProgression.setState({ current: { ...cur, state: 'none' } });
}

/** Wire the network-return trigger once. */
export function installProgression(): void {
  installProgressionRetryTriggers(applyProgressionOutcome);
}

/** The equipped title's display name for a mirror/profile, or null. */
export const equippedTitleName = (p: Pick<ProgressionProfile, 'equippedTitleId'> | null | undefined): string | null => titleName(p?.equippedTitleId ?? null);

// ── The presentation-consumed marker (the ceremony plays once per settled run) ─────────────────────────────

const PRESENTED_KEY = 'ascent.progression.presented';
const PRESENTED_KEEP = 40;
let presented: string[] | null = null;
function loadPresented(): string[] {
  if (presented) return presented;
  try {
    const parsed = JSON.parse(localStorage.getItem(PRESENTED_KEY) ?? '[]') as unknown;
    presented = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    presented = [];
  }
  return presented;
}
const presentedKey = (mode: ProgressionMode, runId: string): string => `${mode}:${runId}`;
export function wasProgressionPresented(mode: ProgressionMode, runId: string): boolean {
  return loadPresented().includes(presentedKey(mode, runId));
}
export function markProgressionPresented(mode: ProgressionMode, runId: string): void {
  const list = loadPresented();
  const k = presentedKey(mode, runId);
  if (list.includes(k)) return;
  list.push(k);
  while (list.length > PRESENTED_KEEP) list.shift();
  try { localStorage.setItem(PRESENTED_KEY, JSON.stringify(list)); } catch { /* best-effort */ }
}
/** Tests: forget the markers, the current run and the mirror. */
export function resetProgressionForTests(): void {
  presented = [];
  try { localStorage.removeItem(PRESENTED_KEY); localStorage.removeItem(MIRROR_KEY); } catch { /* ignore */ }
  useProgression.setState({ capability: 'unknown', mirror: null, current: null });
}
