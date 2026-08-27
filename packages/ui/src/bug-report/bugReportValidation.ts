/**
 * BUG REPORTER (PR 1) — draft + envelope validation (blueprint §1.2 bounds).
 *
 * Hand-rolled on purpose: the envelope is a UI-side diagnostic payload, not engine content — no zod schema,
 * no new dependency. PR 2's queue/upload reuses `validateBugReportEnvelope` before persisting.
 */
import {
  BUG_DESCRIPTION_MAX,
  BUG_DESCRIPTION_MIN,
  BUG_ISSUE_TYPE_LABELS,
  BUG_REPORT_SCHEMA_VERSION,
  type BugIssueType,
  type BugReportEnvelope,
} from './bugReportTypes';

export interface BugValidation {
  ok: boolean;
  errors: string[];
}

const ISSUE_TYPES = new Set<string>(Object.keys(BUG_ISSUE_TYPE_LABELS));

export function isBugIssueType(v: string): v is BugIssueType {
  return ISSUE_TYPES.has(v);
}

/** Is the player's typed report submittable? (trimmed 10–2000 chars, a known issue type). */
export function validateBugReportDraft(draft: { description: string; issueType: string }): BugValidation {
  const errors: string[] = [];
  const desc = draft.description.trim();
  if (desc.length < BUG_DESCRIPTION_MIN) errors.push(`Description must be at least ${BUG_DESCRIPTION_MIN} characters.`);
  if (desc.length > BUG_DESCRIPTION_MAX) errors.push(`Description must be at most ${BUG_DESCRIPTION_MAX} characters.`);
  if (!isBugIssueType(draft.issueType)) errors.push(`Unknown issue type: ${draft.issueType}`);
  return { ok: errors.length === 0, errors };
}

/** Structural check on a finished envelope — what PR 2 runs before persisting/uploading. */
export function validateBugReportEnvelope(envelope: BugReportEnvelope): BugValidation {
  const errors: string[] = [];
  if (envelope.schemaVersion !== BUG_REPORT_SCHEMA_VERSION) errors.push(`Unsupported schemaVersion: ${String(envelope.schemaVersion)}`);
  if (!envelope.reportId) errors.push('Missing reportId.');
  if (!envelope.createdAt || Number.isNaN(Date.parse(envelope.createdAt))) errors.push('Missing/invalid createdAt.');
  const draftCheck = validateBugReportDraft(envelope);
  errors.push(...draftCheck.errors);
  const c = envelope.context;
  if (!c) errors.push('Missing context capsule.');
  else {
    if (typeof c.seed !== 'number') errors.push('Capsule missing seed.');
    if (!c.heroId) errors.push('Capsule missing heroId.');
    if (!c.setId) errors.push('Capsule missing setId.');
    if (typeof c.wave !== 'number') errors.push('Capsule missing wave.');
    if (!c.phase) errors.push('Capsule missing phase.');
    if (typeof c.serializedRun !== 'string' || c.serializedRun.length === 0) errors.push('Capsule missing serializedRun.');
    if (!Array.isArray(c.actions)) errors.push('Capsule missing actions.');
    if (!Array.isArray(c.currentWaveFrames) || !Array.isArray(c.previousWaveFrames)) errors.push('Capsule missing wave frames.');
  }
  const cl = envelope.client;
  if (!cl) errors.push('Missing client context.');
  else {
    if (!cl.appVersion) errors.push('Client missing appVersion.');
    if (!cl.buildSha) errors.push('Client missing buildSha.');
    if (!cl.contentRevision) errors.push('Client missing contentRevision.');
  }
  return { ok: errors.length === 0, errors };
}
