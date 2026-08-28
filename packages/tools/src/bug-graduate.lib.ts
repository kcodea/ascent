/**
 * DOC BOT 2.0 WP G — PLAYER REPORT GRADUATION (blueprint §14), the pure half.
 *
 * §14's pipeline ends: "permanent regression is written → CI protects the behavior forever". This module is
 * the decision procedure for that last hop, kept pure and injectable so every REFUSAL path is testable
 * without a Supabase account, a real report, or the filesystem (`bug-graduate.test.ts` sabotage-proves the
 * two that matter: a flaky repro and an unresolved expectation).
 *
 * THE CHECKLIST, in order — each step refuses LOUDLY and stops; nothing partial is ever written:
 *  1. **Deterministic reproduction.** The repro runs TWICE and the two semantic results must be identical
 *     (§4.4 — determinism before verification, §12.1 — "deterministically reproduced twice"). A report that
 *     reproduces differently on two consecutive runs is not a bug report yet, it is a flake investigation.
 *  2. **The reproduction must actually reproduce.** `drifted` / `insufficient-evidence` / `menu-no-evidence`
 *     are all refusals: a drifted capsule proves the game CHANGED, which is a different finding.
 *  3. **Expected behaviour must be RESOLVED** — an approved rule id, an approved contract id, or a recorded
 *     owner decision. Absent all three the command refuses with "needs ruling first" (§14's last bullet).
 *     Approval is checked through injected predicates against the real registries: an `extracted` contract
 *     or a `needs-ruling` rule does NOT count (§4.2 — the oracle may never be the thing under test).
 *  4. **The assertion must be concrete.** The bug scenario's single `needs-ruling` expectation (the player's
 *     untrusted claim) is REPLACED, never kept: either by explicit `--expect` expectations, or — when the
 *     ruling says the observed behaviour is correct (`--verdict correct`) — by expectations DERIVED from the
 *     observed run (one `event-count` per distinct emitted event type). A graduated fixture never ships
 *     carrying an open question.
 *  5. **Provenance is recorded**: report id, finding fingerprint, semantic revision, parent scenario, PR.
 *  6. **Taxonomy.** The class is looked up, never invented; a `single-pin` class emits its outstanding
 *     sibling TODO verbatim. §14's "generate sibling scenarios" is honoured by NAMING the gap, because
 *     fabricating sibling fixtures nobody derived would be precisely the silent uncertainty §4.3 bans.
 *
 * Curated vs generated (§4.6): the fixture is written to `scenarios/regressions/` — curated space, its own
 * retention, never touched by any generator. `qa-corpus-build` and the case generators write elsewhere.
 */
import type {
  BugReportEnvelope, GraduationRecord, QaExpectation, QaScenarioResult, QaScenarioV1,
} from '@game/sim';
import { stableStringify } from '@game/sim';
import type { QaReproOutcome } from './bug-qa-scenario.lib';

/** Where curated regressions live — SEPARATE from the generated corpus (§4.6). */
export const REGRESSION_DIR = 'packages/sim/src/docbot/scenarios/regressions';

export interface GraduationOptions {
  envelope: BugReportEnvelope;
  /** Runs the whole repro walk. Called TWICE — the determinism gate. Injected for testability. */
  runRepro: () => QaReproOutcome;
  /** Approved rule ids the ruling rests on. */
  ruleIds: readonly string[];
  /** Approved contract ids the ruling rests on. */
  contractIds: readonly string[];
  /** A rule id with a recorded owner decision (decisions.json) — the board's answer. */
  ownerDecision?: string;
  /** Is this rule id APPROVED (not merely pending/needs-ruling)? Injected from @game/rules. */
  isApprovedRule: (id: string) => boolean;
  /** Is this contract id APPROVED (not 'extracted' / 'corroborated')? Injected from @game/rules/contracts. */
  isApprovedContract: (id: string) => boolean;
  /** Does decisions.json carry a decision for this id? */
  hasDecision: (id: string) => boolean;
  /** Explicit expectations. When present they win — the owner authored the assertion. */
  expect?: readonly QaExpectation[];
  /** 'correct' = the ruling establishes the OBSERVED behaviour as correct, so it may be pinned as-is. */
  verdict?: 'correct';
  /** Taxonomy class id. Validated against BUG_TAXONOMY by the caller before this runs. */
  classId: string;
  /** The class entry's outstanding sibling work, when it has any. */
  siblingTodo?: string;
  /** Finding fingerprint that classified this report, when the graduation cites one. */
  findingFingerprint?: string;
  semanticRevision?: string;
  pr?: string;
  /** ISO date — injected so the plan is deterministic under test. */
  today: string;
}

export interface GraduationPlan {
  ok: boolean;
  /** Every refusal reason, in checklist order. Non-empty ⇒ nothing may be written. */
  refusals: string[];
  /** Human-readable trace of the checks that PASSED — the PR-visible evidence. */
  steps: string[];
  /** Outstanding sibling work for this class, verbatim from the taxonomy. Never fabricated. */
  siblingTodo?: string;
  scenario?: QaScenarioV1;
  record?: GraduationRecord;
}

/**
 * The SEMANTIC result of one repro run — everything two runs must agree on for the reproduction to count as
 * deterministic. Deliberately excludes prose (`lines`, `summary`) and anything clock- or path-derived.
 */
export function semanticSignature(outcome: QaReproOutcome): string {
  const r: QaScenarioResult | null = outcome.result;
  return stableStringify({
    classification: outcome.classification,
    scenarioId: outcome.scenario?.id ?? null,
    after: r?.after ?? null,
    combatOutcome: r?.combatOutcome ?? null,
    combatLog: r?.combatLog ?? null,
    events: r?.events ?? null,
    expectations: r?.expectationResults.map((e) => ({ kind: e.expectation.kind, pass: e.pass })) ?? null,
    firstDivergence: r?.firstDivergence ?? null,
    windowOk: outcome.windowReplay?.ok ?? null,
    drift: outcome.comparison.drifted,
  });
}

/**
 * Derive concrete expectations from an observed run: one `event-count` per distinct emitted event type
 * (combat log + recruit presentation events are pooled by the runner, exactly as `event-count` reads them).
 * Sorted by event name so the fixture is byte-stable. Returns [] when the run emitted nothing — the caller
 * turns that into a refusal rather than writing an assertion-free "regression".
 */
export function derivePinExpectations(result: QaScenarioResult): QaExpectation[] {
  const counts = new Map<string, number>();
  for (const e of result.events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  for (const e of result.combatLog ?? []) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([event, count]): QaExpectation => ({ kind: 'event-count', event, count }));
}

/** The curated regression's stable id. `regression-` prefix is load-bearing: the ledger's §15.1 bucketing
 *  reads it to mark a finding regression-protected. */
export const regressionScenarioId = (reportId: string, classId: string): string =>
  `regression-${reportId.slice(0, 8)}-${classId}`;

export function planGraduation(opts: GraduationOptions): GraduationPlan {
  const refusals: string[] = [];
  const steps: string[] = [];

  // ── 1 + 2. deterministic reproduction, twice ──────────────────────────────────────────────────────────
  const first = opts.runRepro();
  const second = opts.runRepro();
  const sigA = semanticSignature(first);
  const sigB = semanticSignature(second);
  if (sigA !== sigB) {
    refusals.push(
      'NON-DETERMINISTIC REPRODUCTION — the repro produced two different semantic results on two consecutive '
      + 'runs. §12.1 requires "deterministically reproduced twice" before anything may be called verified. '
      + 'Investigate the flake (a seeded run that differs twice is itself a bug) before graduating.',
    );
    return { ok: false, refusals, steps };
  }
  steps.push(`deterministic reproduction: two runs produced identical semantic results (classification '${first.classification}')`);

  if (first.classification !== 'reproduced') {
    refusals.push(
      `REPRODUCTION CLASSIFIED '${first.classification}' — only 'reproduced' may graduate. `
      + (first.classification === 'drifted'
        ? 'A drifted capsule proves the GAME changed since capture; that is a different finding, and pinning it would enshrine post-change behaviour under a pre-change report.'
        : 'There is not enough captured evidence to build a permanent regression from.'),
    );
    return { ok: false, refusals, steps };
  }
  const base = first.scenario;
  const result = first.result;
  if (!base || !result) {
    refusals.push('the repro produced no runnable scenario — nothing to graduate');
    return { ok: false, refusals, steps };
  }
  steps.push('reproduction classified: reproduced (the captured state executes through the real engine)');

  // ── 3. expected behaviour must be RESOLVED ────────────────────────────────────────────────────────────
  const approvedRules = opts.ruleIds.filter((id) => opts.isApprovedRule(id));
  const rejectedRules = opts.ruleIds.filter((id) => !opts.isApprovedRule(id));
  const approvedContracts = opts.contractIds.filter((id) => opts.isApprovedContract(id));
  const rejectedContracts = opts.contractIds.filter((id) => !opts.isApprovedContract(id));
  const decision = opts.ownerDecision && opts.hasDecision(opts.ownerDecision) ? opts.ownerDecision : undefined;

  for (const id of rejectedRules) {
    refusals.push(`rule '${id}' is not APPROVED in this checkout — an extracted/pending rule cannot establish expected behaviour (§4.2)`);
  }
  for (const id of rejectedContracts) {
    refusals.push(`contract '${id}' is not APPROVED in this checkout — 'extracted'/'corroborated' is a machine verdict, not a ruling (owner-review-pipeline.md §2)`);
  }
  if (opts.ownerDecision && !decision) {
    refusals.push(`no owner decision recorded for '${opts.ownerDecision}' in decisions.json`);
  }
  if (approvedRules.length === 0 && approvedContracts.length === 0 && !decision) {
    refusals.push(
      'NEEDS RULING FIRST — expected behaviour is unresolved. Graduation requires at least one APPROVED rule '
      + '(--rule), one APPROVED contract (--contract), or a recorded owner decision (--decision). Take the '
      + 'question to the RulebookTriage fly-through board; the report stays open until it is answered.',
    );
  }
  if (refusals.length > 0) return { ok: false, refusals, steps };
  steps.push(
    `expected behaviour resolved by ${[
      approvedRules.length ? `approved rule(s) ${approvedRules.join(', ')}` : '',
      approvedContracts.length ? `approved contract(s) ${approvedContracts.join(', ')}` : '',
      decision ? `owner decision '${decision}'` : '',
    ].filter(Boolean).join(' + ')}`,
  );

  // ── 4. the needs-ruling expectation becomes a concrete assertion ───────────────────────────────────────
  let expectations: QaExpectation[];
  if (opts.expect && opts.expect.length > 0) {
    expectations = [...opts.expect];
    steps.push(`assertion: ${expectations.length} explicit expectation(s) supplied by the ruling (--expect)`);
  } else if (opts.verdict === 'correct') {
    expectations = derivePinExpectations(result);
    if (expectations.length === 0) {
      refusals.push(
        'nothing observable to pin — the reproduction emitted no events, so a derived pin would assert nothing. '
        + 'Supply explicit expectations with --expect.',
      );
      return { ok: false, refusals, steps };
    }
    steps.push(`assertion: ${expectations.length} expectation(s) DERIVED from the observed run (--verdict correct pins the ruled-correct behaviour)`);
  } else {
    refusals.push(
      'NO CONCRETE ASSERTION — the bug scenario carries only the player\'s untrusted claim as a needs-ruling '
      + 'question, and a graduated regression may never ship one. Pass --expect \'<QaExpectation[] JSON>\' to '
      + 'author the assertion, or --verdict correct to pin the observed behaviour when the ruling says it is right.',
    );
    return { ok: false, refusals, steps };
  }

  // ── 5. the curated fixture + provenance ───────────────────────────────────────────────────────────────
  const id = regressionScenarioId(opts.envelope.reportId, opts.classId);
  const scenario: QaScenarioV1 = {
    ...base,
    id,
    title: `Regression — ${base.title} [${opts.classId}]`,
    source: 'regression',
    expectations,
    ...(approvedRules.length ? { ruleIds: approvedRules } : {}),
    ...(opts.semanticRevision !== undefined ? { semanticRevision: opts.semanticRevision } : {}),
    provenance: {
      kind: 'bug-report',
      reportId: opts.envelope.reportId,
      parentScenarioId: base.id,
      ...(opts.findingFingerprint !== undefined ? { findingFingerprint: opts.findingFingerprint } : {}),
    },
    metadata: {
      ...base.metadata,
      notes: `graduated ${opts.today} from bug report ${opts.envelope.reportId} · class ${opts.classId}`
        + (opts.pr ? ` · PR #${opts.pr}` : ''),
    },
  };
  steps.push(`curated regression fixture: ${REGRESSION_DIR}/${id}.json (source 'regression' — curated space, never regenerated)`);

  const record: GraduationRecord = {
    scenarioId: id,
    classId: opts.classId,
    reportId: opts.envelope.reportId,
    ...(opts.findingFingerprint !== undefined ? { findingFingerprint: opts.findingFingerprint } : {}),
    ...(opts.semanticRevision !== undefined ? { semanticRevision: opts.semanticRevision } : {}),
    ruleIds: [...approvedRules].sort(),
    contractIds: [...approvedContracts].sort(),
    ...(decision !== undefined ? { ownerDecision: decision } : {}),
    graduatedAt: opts.today,
    ...(opts.pr !== undefined ? { pr: opts.pr } : {}),
  };
  steps.push(`taxonomy: class '${opts.classId}' recorded in bugTaxonomy.graduated.json`);

  return {
    ok: true,
    refusals: [],
    steps,
    ...(opts.siblingTodo !== undefined ? { siblingTodo: opts.siblingTodo } : {}),
    scenario,
    record,
  };
}
