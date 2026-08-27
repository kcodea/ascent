/**
 * BUG REPORTER — the envelope/capsule types now LIVE in `@game/sim` (`packages/sim/src/bugReport.ts`).
 *
 * They moved in PR 3 because the developer inbox (`packages/tools` — bugs:pull/list/repro/close) needs the
 * exact same shapes and `tools` cannot depend on `@game/ui`. This file re-exports them so every PR 1 import
 * site (`./bugReportTypes`) keeps working unchanged. Add new report types THERE, not here.
 */
export {
  BUG_MENU_PHASE,
  BUG_REPORT_SCHEMA_VERSION,
  BUG_ISSUE_TYPE_LABELS,
  BUG_DESCRIPTION_MIN,
  BUG_DESCRIPTION_MAX,
} from '@game/sim';
export type {
  BugIssueType,
  BugReportEnvelope,
  BugIncidentCapsule,
  BugCombatContext,
  BugUiContext,
  BugClientContext,
  BugReportDraft,
} from '@game/sim';
