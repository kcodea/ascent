/**
 * BUG REPORTER (PR 1) — the incident-capsule schema (blueprint §3.2, adapted to the repo's real types).
 *
 * The capsule is a **player-authored claim attached to a deterministic incident capsule**: captured ONCE,
 * synchronously, when Ctrl+B opens the reporter (`openBugReport`), and deep-frozen — it must never update
 * while the player types, and it stays OUT of `RunState`, `replayActions`, save data, and replay frames
 * (UI diagnostics only; owner decision 2026-08-26).
 *
 * Adaptations from the blueprint's sketch, so no parallel types are invented:
 *  - `actions` are the store's real `Action[]` (@game/sim), `currentWaveFrames`/`previousWaveFrames` are real
 *    `ReplayFrame[]` (Replay V2), and the combat context carries the run's own `CombatResult`.
 *  - The blueprint's separate `rawEvents: CombatEvent[]` is FOLDED INTO `combat.result.events` — `lastCombat`
 *    IS a `CombatResult` whose `events` array is the authoritative structured log, and duplicating it would
 *    double the payload for nothing. Triage reads `combat.result.events`.
 *  - `contentRevision` is `<setId>+<build sha>` — the repo has no dedicated content-revision stamp, and the
 *    set id + build SHA together pin exactly which card data the client was running.
 *  - `runId` is `<seed>:<heroId>` (the same identity `Game.tsx` keys the run on; `replayDraft` uses the bare
 *    seed — the hero is folded in here because a bug report can outlive this browser's draft store).
 */
import type { CombatResult } from '@game/core';
import type { Action, Phase, ReplayFrame, RunMode } from '@game/sim';

export const BUG_REPORT_SCHEMA_VERSION = 1 as const;

export type BugIssueType =
  | 'mechanics'
  | 'presentation'
  | 'text_mismatch'
  | 'softlock'
  | 'performance'
  | 'ui'
  | 'other';

/** Player-facing labels for the issue-type picker (blueprint §1.2 wording, verbatim). */
export const BUG_ISSUE_TYPE_LABELS: Record<BugIssueType, string> = {
  mechanics: 'Card or effect behaved incorrectly',
  presentation: 'Animation or timing looked wrong',
  text_mismatch: 'Card text did not match the effect',
  softlock: 'Game became stuck',
  performance: 'Performance or slowdown',
  ui: 'UI or controls',
  other: 'Other',
};

export const BUG_DESCRIPTION_MIN = 10;
export const BUG_DESCRIPTION_MAX = 2000;

export interface BugReportEnvelope {
  schemaVersion: typeof BUG_REPORT_SCHEMA_VERSION;
  reportId: string;
  createdAt: string;
  description: string;
  issueType: BugIssueType;
  context: BugIncidentCapsule;
  client: BugClientContext;
}

export interface BugIncidentCapsule {
  runId: string;
  seed: number;
  heroId: string;
  mode: RunMode;
  setId: string;
  wave: number;
  phase: Phase;
  shopTier: number;
  /** The recruit clock's displayed value at report-open (read from `turnClock`, never written); null outside
   *  the recruit phase. */
  timerSecondsRemaining: number | null;

  /** Exact state at report-open time — `serialize(run)`, the game's supported serialization. The primary
   *  reproduction fixture: `deserialize` this. */
  serializedRun: string;

  /** Deterministic history through the incident: the run's full state-changing action log (with the seed this
   *  reconstructs the path to the incident). Full list by design — cap only after real payload measurements
   *  prove it necessary (blueprint §3.2). */
  actions: Action[];

  /** Replay V2 frames for what the player saw — this wave and the previous one (blueprint §3.4). */
  currentWaveFrames: ReplayFrame[];
  previousWaveFrames: ReplayFrame[];

  /** Present during or immediately after combat (from `run.lastCombat`); null before the first fight. */
  combat: BugCombatContext | null;

  /** UI location — diagnostic only, must never influence game replay. */
  ui: BugUiContext;

  /** Sections dropped by the payload-limit trimming rules (blueprint §3.5). Always [] in PR 1 — the field
   *  exists so PR 2's trimming has a stable home and older reports read as "nothing trimmed". */
  contextTruncated: string[];
}

export interface BugCombatContext {
  /** The authoritative resolved combat — `result.events` IS the raw structured event log (see header note). */
  result: CombatResult;
  /** The visible playback moment, when cheaply available. v1 ships null — the combat hooks don't expose it
   *  without invasive changes (blueprint §4.2 sanctions this); the event log remains sufficient. */
  visibleMomentIndex: number | null;
  visibleEventStep: number | null;
  replayDone: boolean;
  playbackSpeed: number;
}

export interface BugUiContext {
  /** The card open in the inspect overlay, if any. The inspect view carries no instance uid — null in v1. */
  selectedCardUid: string | null;
  selectedCardId: string | null;
  pendingTargetCardId: string | null;
  /** Which full-screen overlay was up at capture ('book', 'career', …), or null for none. */
  modalKind: string | null;
  /** Drag state lives in Recruit-local refs, not the store — null in v1 (a drag also ends the moment the
   *  hotkey's modal opens, so it would nearly always be null anyway). */
  draggingCardUid: string | null;
  viewport: { width: number; height: number; devicePixelRatio: number };
}

export interface BugClientContext {
  appVersion: string;
  buildSha: string;
  contentRevision: string;
  platform: 'web' | 'desktop';
  userAgent: string;
  locale: string;
  /** The account UUID (ownership) — NEVER the email (privacy §12). */
  accountUserId: string | null;
  playerName: string | null;
  sessionId: string;
}

/** The store's open draft: the immutable capsule + what the player is typing. */
export interface BugReportDraft {
  issueType: BugIssueType;
  description: string;
  capsule: BugIncidentCapsule;
}
