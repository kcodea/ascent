/**
 * BUG REPORTER (PR 1) — immutable incident-capsule capture (blueprint §3).
 *
 * `captureIncidentCapsule` is a PURE function over a snapshot of store state: it dispatches NOTHING, appends
 * no replay frame, and never mutates its inputs — everything shared (actions, frames, lastCombat) is
 * `structuredClone`d into the capsule and the whole capsule is deep-frozen. Capture-on-OPEN, not on submit
 * (§3.1): the interesting transient state must not drift while the player types.
 *
 * The capture source is a structural slice of the game store (the store passes `get()` directly) — this
 * module deliberately does not import the store, so the dependency stays one-way (store → capture).
 */
import { serialize, type Action, type ReplayFrame, type RunState } from '@game/sim';
import { turnClock } from '../turnClock';
import {
  BUG_REPORT_SCHEMA_VERSION,
  type BugClientContext,
  type BugIncidentCapsule,
  type BugIssueType,
  type BugReportEnvelope,
} from './bugReportTypes';

/** What capture reads — a structural subset of the game store's state. */
export interface BugCaptureSource {
  run: RunState;
  replayActions: readonly Action[];
  replayFrames: readonly ReplayFrame[];
  inspect: { cardId: string } | null;
  showLeaderboard: boolean;
  showRankings: boolean;
  showRecentGames: boolean;
  showCareer: boolean;
  showBook: boolean;
  showBalance: boolean;
  showPatchNotes: boolean;
  combatSpeed: number;
}

/** Where (and whether) the reporter may open — one authority shared by the store and any future entry point.
 *  'silent' = do nothing (excluded surface); 'toast' = show the §4.3 presentation-transaction toast. */
export type BugReportAvailability = 'ok' | 'silent' | 'toast';

export const BUG_REPORT_TX_TOAST = 'Finish the current effect, then press Ctrl+B again.';

export function bugReportAvailability(s: {
  showTitle: boolean;
  heroChoices: unknown;
  practiceSetupOpen: boolean;
  replaying: boolean;
  presentationTx: unknown;
  run: Pick<RunState, 'mode' | 'sandbox' | 'phase'>;
}): BugReportAvailability {
  // Excluded surfaces (owner decisions 2026-08-26): title, hero select (+ the practice setup screen in front
  // of it), tutorial runs, the replay viewer, Scene Builder, and a finished run. Practice + lobby/live play
  // are ENABLED (`mode: 'practice'` simply stamps the capsule).
  if (s.showTitle || s.heroChoices !== null || s.practiceSetupOpen) return 'silent';
  if (s.replaying) return 'silent';
  if (s.run.sandbox) return 'silent';
  if (s.run.mode === 'tutorial') return 'silent';
  if (s.run.phase === 'gameover' || s.run.phase === 'victory') return 'silent';
  // §4.3: never open mid End-of-Turn choreography — a frozen prepared transaction owns a deferred commit.
  if (s.presentationTx !== null) return 'toast';
  return 'ok';
}

/** Recursively freeze a capsule (data-only trees; cycles impossible in cloned JSON-ish data). */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Which full-screen overlay was up at capture (UI diagnostics — the reporter itself isn't one yet). */
function modalKindOf(s: BugCaptureSource): string | null {
  if (s.showLeaderboard) return 'leaderboard';
  if (s.showRankings) return 'rankings';
  if (s.showRecentGames) return 'recentGames';
  if (s.showCareer) return 'career';
  if (s.showBook) return 'book';
  if (s.showBalance) return 'balance';
  if (s.showPatchNotes) return 'patchNotes';
  return null;
}

export function captureIncidentCapsule(s: BugCaptureSource): BugIncidentCapsule {
  const run = s.run;
  const capsule: BugIncidentCapsule = {
    runId: `${run.seed}:${run.heroId}`,
    seed: run.seed,
    heroId: run.heroId,
    mode: run.mode ?? 'ascent',
    setId: run.setId ?? 'set1',
    wave: run.wave,
    phase: run.phase,
    shopTier: run.tier,
    // READ the recruit clock, never write it (§4.1) — null outside the recruit phase.
    timerSecondsRemaining: run.phase === 'recruit' ? turnClock.get() : null,
    serializedRun: serialize(run),
    actions: structuredClone(s.replayActions) as Action[],
    // §3.4 frame selection: everything the player saw this wave and the previous one.
    currentWaveFrames: structuredClone(s.replayFrames.filter((f) => f.wave === run.wave)) as ReplayFrame[],
    previousWaveFrames: structuredClone(s.replayFrames.filter((f) => f.wave === run.wave - 1)) as ReplayFrame[],
    combat: run.lastCombat
      ? {
          // The full authoritative CombatResult — `.events` is the raw structured log (never narrated text).
          result: structuredClone(run.lastCombat),
          visibleMomentIndex: null, // v1: not exposed by the combat hooks without invasive changes (§4.2)
          visibleEventStep: null,
          replayDone: run.phase !== 'combat',
          playbackSpeed: s.combatSpeed,
        }
      : null,
    ui: {
      selectedCardUid: null, // the inspect view carries no instance uid
      selectedCardId: s.inspect?.cardId ?? null,
      pendingTargetCardId: run.pendingTarget?.cardId ?? null,
      modalKind: modalKindOf(s),
      draggingCardUid: null, // drag state is Recruit-local (and a drag ends when the modal opens)
      viewport: typeof window !== 'undefined'
        ? { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 }
        : { width: 0, height: 0, devicePixelRatio: 1 },
    },
    contextTruncated: [],
  };
  return deepFreeze(capsule);
}

/** One id per app boot — lets PR 2+ group several reports from the same session. UI-layer randomness. */
const SESSION_ID: string = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function newReportId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Client provenance (§3.2). PRIVACY (§12): reads ONLY the account UUID + chosen display name — never the
 * email, auth tokens, or filesystem paths. The capture test asserts none of those strings can appear in the
 * serialized envelope.
 */
export function buildClientContext(src: {
  account: { userId: string | null };
  playerName: string;
  setId: string;
}): BugClientContext {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent ?? '' : '';
  return {
    appVersion: __APP_VERSION__,
    buildSha: __BUILD_SHA__,
    // No dedicated content-revision stamp exists — set id + build SHA pin the card data exactly.
    contentRevision: `${src.setId}+${__BUILD_SHA__}`,
    platform: ua.includes('Electron') ? 'desktop' : 'web',
    userAgent: ua,
    locale: typeof navigator !== 'undefined' ? navigator.language ?? 'unknown' : 'unknown',
    accountUserId: src.account.userId,
    playerName: src.playerName || null,
    sessionId: SESSION_ID,
  };
}

export function buildBugReportEnvelope(
  capsule: BugIncidentCapsule,
  description: string,
  issueType: BugIssueType,
  client: BugClientContext,
): BugReportEnvelope {
  return {
    schemaVersion: BUG_REPORT_SCHEMA_VERSION,
    reportId: newReportId(),
    createdAt: new Date().toISOString(),
    description,
    issueType,
    context: capsule,
    client,
  };
}

/**
 * DEV-build local export (§15 PR 1): download the envelope as a JSON file, so a tester's report is a
 * deserializable artifact today. PR 2 replaces this call site with the IndexedDB queue + async upload.
 * Best-effort — never throws into the submit path.
 */
export function exportBugReportJson(envelope: BugReportEnvelope): void {
  try {
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ascent-bug-${envelope.reportId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch {
    // jsdom / an exotic environment without object URLs — the envelope was still built and validated.
  }
}
