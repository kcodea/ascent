/**
 * DOC BOT — STRUCTURED FINDINGS (handoff §12, PR 8).
 *
 * The normalized machine-readable result model every lane will eventually feed. THIS PR wires only the
 * NIGHTLY lane into it (the PR-gate lanes keep their human-first vitest output; converting them is a later
 * integration pass — deliberately NOT done here, per the delivery order).
 *
 * The load-bearing rule is §12.2: the fingerprint is STRUCTURAL identity, never message prose. Two findings
 * about the same lane + content + rule + expectation shape + normalized mismatch are THE SAME finding no
 * matter how their title/summary is worded — so re-running a scan neither duplicates a known finding when a
 * message is reworded nor merges two genuinely different mismatches. `findings.test.ts` sabotage-proves both
 * directions.
 */
import { stableStringify, type JsonValue } from '../qaScenario';

export type FindingSeverity = 'error' | 'warning' | 'question' | 'info';
export type FindingConfidence = 'proven' | 'strong' | 'uncertain';
export type FindingStatus = 'new' | 'known' | 'resolved' | 'needs-ruling' | 'excused';

/** Blueprint §12.1 five-way classification (canonical-schemas.md §3). OPTIONAL on the finding: absent
 *  means a legacy lane finding, treated as 'questionable-interaction' unless the lane declares a default
 *  (differential lanes default there; ratchet lanes to 'coverage-gap'; text lanes to 'verified-text-defect'). */
export type FindingClass =
  | 'verified-mechanical-bug'
  | 'verified-text-defect'
  | 'wording-recommendation'
  | 'questionable-interaction'
  | 'coverage-gap';

/** §12.1 questionable-interaction evidence: the readings a ruling must choose between. */
export interface CompetingInterpretation {
  interpretation: string;
  evidence: string[];
}

/** Trace-aware first point of divergence (grows real semantic-trace steps with WP C; today `step` is an
 *  index into whatever evidence stream the lane names — e.g. a combat-log event index). */
export interface FirstDivergence {
  step: number;
  expected: JsonValue;
  observed: JsonValue;
}

export type MinimizationStatus = 'not-needed' | 'pending' | 'complete' | 'failed';

/** §12.2 provenance — where this finding came from, machine-usably. */
export interface FindingProvenance {
  lane: string;
  generatedAt?: string;
  reportId?: string;
  scenarioIds?: string[];
}

export interface DocbotFinding {
  /** Stable id: `<lane>-<fingerprint>` — derived, so the same structural finding always gets the same id. */
  id: string;
  lane: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  status: FindingStatus;
  title: string;
  summary: string;
  contentIds: string[];
  ruleIds: string[];
  scenarioId?: string;
  /** Exact deterministic reproduction command (`npm run docbot:scenario -- <id>` / a nightly seed line). */
  reproduction?: string;
  expected?: JsonValue;
  observed?: JsonValue;
  /** Structural fingerprint (§12.2): lane + content ids + rule ids + expectation kind + normalized
   *  expected/observed mismatch. NEVER includes title/summary/reproduction prose. */
  fingerprint: string;

  // ── V2-compatible OPTIONAL fields (blueprint §12.2 via canonical-schemas.md §3). None of these
  // participate in the fingerprint — existing dedup and byte-stable emission are untouched. ──────────────
  /** §12.1 five-way class (see FindingClass for the absent-field default). */
  class?: FindingClass;
  /** §12.1 questionable-interaction: the competing readings, each with its evidence. */
  competingInterpretations?: CompetingInterpretation[];
  /** First point of semantic divergence between expected and observed. */
  firstDivergence?: FirstDivergence;
  minimizationStatus?: MinimizationStatus;
  provenance?: FindingProvenance;
  /** §16 semantic-revision identity this finding was produced under. */
  semanticRevision?: string;
  /** ContentContract ids this finding cites (WP B registry; the vertical slice's hand contracts today). */
  contractIds?: string[];
  /** §11 rewrite advisor: proposed replacement text — NEVER auto-applied (§23). */
  suggestedText?: string;
}

/** FNV-1a 32-bit — deterministic, dependency-free (the explosionGuard hash, same rationale). */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The structural half of a finding — everything the fingerprint hashes, nothing it must not. */
export interface FindingIdentity {
  lane: string;
  contentIds: readonly string[];
  ruleIds: readonly string[];
  /** WHAT KIND of expectation mismatched ('invariant', 'event-count', 'determinism', 'budget', …). */
  expectationKind: string;
  expected?: JsonValue;
  observed?: JsonValue;
}

/** §12.2 — hash the structural identity only. Sorted id lists, stable stringify: order-insensitive. */
export function fingerprintFinding(idn: FindingIdentity): string {
  return fnv1a(stableStringify({
    lane: idn.lane,
    contentIds: [...idn.contentIds].sort(),
    ruleIds: [...idn.ruleIds].sort(),
    expectationKind: idn.expectationKind,
    expected: idn.expected ?? null,
    observed: idn.observed ?? null,
  }));
}

export interface FindingDraft extends FindingIdentity {
  severity: FindingSeverity;
  confidence: FindingConfidence;
  status?: FindingStatus;
  title: string;
  summary: string;
  scenarioId?: string;
  reproduction?: string;
  // V2 optional fields — passed through verbatim, never fingerprinted.
  class?: FindingClass;
  competingInterpretations?: CompetingInterpretation[];
  firstDivergence?: FirstDivergence;
  minimizationStatus?: MinimizationStatus;
  provenance?: FindingProvenance;
  semanticRevision?: string;
  contractIds?: string[];
  suggestedText?: string;
}

/** Build a complete finding — fingerprint + derived id stamped from the structural identity. */
export function makeFinding(draft: FindingDraft): DocbotFinding {
  const fingerprint = fingerprintFinding(draft);
  return {
    id: `${draft.lane}-${fingerprint}`,
    lane: draft.lane,
    severity: draft.severity,
    confidence: draft.confidence,
    status: draft.status ?? 'new',
    title: draft.title,
    summary: draft.summary,
    contentIds: [...draft.contentIds].sort(),
    ruleIds: [...draft.ruleIds].sort(),
    ...(draft.scenarioId !== undefined ? { scenarioId: draft.scenarioId } : {}),
    ...(draft.reproduction !== undefined ? { reproduction: draft.reproduction } : {}),
    ...(draft.expected !== undefined ? { expected: draft.expected } : {}),
    ...(draft.observed !== undefined ? { observed: draft.observed } : {}),
    fingerprint,
    ...(draft.class !== undefined ? { class: draft.class } : {}),
    ...(draft.competingInterpretations !== undefined ? { competingInterpretations: draft.competingInterpretations } : {}),
    ...(draft.firstDivergence !== undefined ? { firstDivergence: draft.firstDivergence } : {}),
    ...(draft.minimizationStatus !== undefined ? { minimizationStatus: draft.minimizationStatus } : {}),
    ...(draft.provenance !== undefined ? { provenance: draft.provenance } : {}),
    ...(draft.semanticRevision !== undefined ? { semanticRevision: draft.semanticRevision } : {}),
    ...(draft.contractIds !== undefined ? { contractIds: draft.contractIds } : {}),
    ...(draft.suggestedText !== undefined ? { suggestedText: draft.suggestedText } : {}),
  };
}

/** Serialize findings for artifact upload — deduplicated by fingerprint (first occurrence wins), sorted by
 *  id so the emitted JSON is byte-stable for identical inputs in any order. */
export function emitFindingsJson(findings: readonly DocbotFinding[]): string {
  const byFp = new Map<string, DocbotFinding>();
  for (const f of findings) if (!byFp.has(f.fingerprint)) byFp.set(f.fingerprint, f);
  const list = [...byFp.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(list, null, 2);
}
