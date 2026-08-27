/**
 * BUG REPORTER — the shared report types (envelope + incident capsule + inbox shapes).
 *
 * These began life in `packages/ui/src/bug-report/bugReportTypes.ts` (PR 1). They live HERE because the
 * developer inbox (`packages/tools` — bugs:pull/list/repro/close, PR 3) needs the exact same envelope and
 * capsule shapes, and `tools` cannot depend on `@game/ui` (presentation). `@game/sim` is the natural home:
 * every field the capsule carries is a sim type already (`Action`, `Phase`, `ReplayFrame`, `RunMode`,
 * `CombatResult`). The UI file re-exports from here, so PR 1's import sites are untouched.
 *
 * The capsule is a **player-authored claim attached to a deterministic incident capsule**: captured ONCE,
 * synchronously, when Ctrl+B opens the reporter (`openBugReport`), and deep-frozen — it must never update
 * while the player types, and it stays OUT of `RunState`, `replayActions`, save data, and replay frames
 * (UI diagnostics only; owner decision 2026-08-26).
 *
 * Adaptations from the blueprint's sketch, so no parallel types are invented:
 *  - `actions` are the store's real `Action[]`, `currentWaveFrames`/`previousWaveFrames` are real
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
import type { Action, Phase, RunMode } from './state';
import type { ReplayFrame } from './replayV2';
import type { RecordedActionWindow } from './qaScenario';

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

/**
 * MENU REPORTS (owner ask 2026-08-27): the reporter also opens from the MAIN MENU, with no live run — "so I
 * can log them without being in a game … and explain it". A menu capsule carries NO run evidence (the
 * player's description is the payload) and stamps SENTINELS that satisfy the deployed intake as-is (the Edge
 * Function requires heroId/seed/wave/phase/patch and must not change): `heroId: 'none'`, `seed: 0`,
 * `wave: 0`, `phase: 'menu'`, `mode: 'menu'`, `serializedRun: null`, empty actions/frames, `combat: null`.
 * Every consumer of run evidence (bugs:repro, the Scene Builder bridge) must treat `phase: 'menu'` as
 * "menu report — no run evidence" and decline gracefully, never as a corrupt run.
 */
export const BUG_MENU_PHASE = 'menu' as const;

export interface BugIncidentCapsule {
  runId: string;
  seed: number;
  heroId: string;
  mode: RunMode | typeof BUG_MENU_PHASE;
  setId: string;
  wave: number;
  phase: Phase | typeof BUG_MENU_PHASE;
  shopTier: number;
  /** The recruit clock's displayed value at report-open (read from `turnClock`, never written); null outside
   *  the recruit phase. */
  timerSecondsRemaining: number | null;

  /** Exact state at report-open time — `serialize(run)`, the game's supported serialization. The primary
   *  reproduction fixture: `deserialize` this. NULL for a menu report (`phase: 'menu'`) — there is no run. */
  serializedRun: string | null;

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

  /** WP C (§8.2) — the ALWAYS-ON rolling action window: the ring buffer's last-N accepted actions, each with
   *  its observational reproduction rails (rng cursor before + state hash before/after), copied into the
   *  capsule at Ctrl+B exactly like frames are. OPTIONAL (canonical-schemas' optional-extension rule): every
   *  pre-WP-C capsule stays valid, the deployed Edge Function needs no change, and every consumer treats an
   *  absent field as "whole-history path applies" (`exactWindowReplay`'s applicable:false). Ring entries are
   *  memory-only until this copy — NEVER in RunState, saves, or replays (same exclusion discipline as the
   *  capsule itself). Trimmed under the 4 MB ladder as section 'recentActions' when the payload demands it. */
  recentActions?: RecordedActionWindow[];
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

// ── Developer-inbox shapes (PR 3 — bugs:pull / bugs:list / bugs:repro / bugs:close) ────────────────────────

export type BugReportStatus =
  | 'new'
  | 'triaged'
  | 'reproduced'
  | 'needs_info'
  | 'fixed'
  | 'closed'
  | 'duplicate';

/** One `bug_reports` row as the backend stores it (schema.sql BUG REPORTS block, PR 2a). `report` is the
 *  whole submitted envelope — the capsule rides inside it verbatim. */
export interface BugReportRow {
  id: string;
  user_id: string | null;
  client_report_id: string;
  created_at: string;
  player_created_at: string;
  status: BugReportStatus;
  severity: 'critical' | 'high' | 'medium' | 'low' | null;
  /** Owner Bug Board ordering: lower = fix first; null = unranked. */
  priority: number | null;
  issue_type: string;
  description: string;
  patch: string;
  content_revision: string;
  mode: string;
  set_id: string;
  hero_id: string;
  seed: number;
  wave: number;
  phase: string;
  report: BugReportEnvelope;
  fingerprint: string | null;
  duplicate_of: string | null;
  triage: unknown;
  resolution: unknown;
}

/** `.local/bug-reports/work-order.json` — written by the in-game Bug Board: the owner's fix-first ordering.
 *  bugs:pull/list surface it; ids missing from the pulled set are ignored, pulled ids missing from the order
 *  sort after the ordered ones. */
export interface BugWorkOrder {
  generatedAt: string;
  orderedReportIds: string[];
  notes?: string;
}

/** `scenario.json` — the Scene Builder bridge's exact input (PR 4 consumes this shape verbatim). The capsule
 *  is embedded whole: the bridge deserializes `capsule.serializedRun` and reads the combat context from it. */
export interface BugScenarioFile {
  schemaVersion: 1;
  kind: 'bug-scenario';
  reportId: string;
  description: string;
  issueType: BugIssueType;
  capsule: BugIncidentCapsule;
}

/** Claude's structured triage verdict for one report (blueprint §8.5) — stored in the row's `triage` jsonb.
 *  Never silently decide ambiguous design: when actual behaviour is deterministic but EXPECTED behaviour is
 *  undefined, set `needsOwnerRuling` and leave mechanics unchanged. */
export interface BugTriageResult {
  reportId: string;
  classification:
    | 'confirmed_mechanics'
    | 'confirmed_presentation'
    | 'confirmed_text_mismatch'
    | 'not_reproduced'
    | 'works_as_designed'
    | 'insufficient_context'
    | 'duplicate';
  confidence: number;
  suspectedSystems: string[];
  reproduction: {
    succeeded: boolean;
    testFile?: string;
    scenarioFile?: string;
    notes: string;
  };
  expectedSource: 'rulebook' | 'card_text' | 'existing_test' | 'owner_ruling' | 'unknown';
  proposedFix?: string;
  needsOwnerRuling?: string;
}
