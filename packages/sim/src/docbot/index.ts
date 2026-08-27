/**
 * DOC BOT — ASCENT's standing correctness auditor.
 *
 * Not a play bot. Doc Bot never decides what is GOOD; it decides what is WIRED. It re-derives, from live
 * content and live source, the questions that keep producing owner-reported bugs, and fails CI when the
 * answer changed under someone's feet:
 *
 *   1. factoryPhase   — every (trigger, factory) pair implemented wherever its trigger dispatches (silent
 *                       `MAP[do]?.()` no-ops: the Conductor / Funeral-on-Loan / Beefy class).
 *   2. liveText       — every dual-stat scaling card's live text renders BOTH halves (the Kringle class)
 *                       (lives in packages/ui, beside the helpers it audits).
 *   3. tribePredicates— raw `.tribe ===` comparisons frozen behind a ratchet; new code goes through
 *                       isTribe/defIsTribe (the all-types class).
 *   4. derivations    — declared "these two code paths must agree" pairs, fuzzed (the Merchant's-Chorus /
 *                       snapshot-drift class). `snapshotFidelity.test.ts` (pre-existing) is the third pair.
 *
 * Four more, mined from ~480 historical fix commits (see historyRegistry.ts for the citations):
 *
 *   5. refIntegrity   — every id-suffixed param in cards/runes/quests resolves (#719 crash class).
 *   6. turnScopedReset— every `*ThisTurn` state field is actually reset in the reducer (#1f6c/#517 class).
 *   7. runeRewardDifferential — every rune's reward changes state, once and again (#900's 41-of-72 class);
 *                       second-copy swallows are a ratcheted duplicate-policy backlog.
 *   8. spellPowerFolding — every stat-spell factory folds spell power or says why not (#817/#731 class).
 *
 * `npm run docbot` prints the full report, including the needs-triage backlog the tests tolerate but track.
 * Doctrine and the ledger of what each tripwire has caught: docs/docbot.md.
 */
export { TRIGGER_PHASES, PHASE_EXCUSED, COMBAT_CASTING_FACTORIES, type PhaseExcuse } from './phaseRegistry';
export { TRIBE_RATCHET, PREDICATE_FILES, RAW_TRIBE_COMPARE_SOURCE } from './tribeRatchet';
export { RUNE_DIFF_EXCUSED, SPELL_POWER_EXCUSED, TURN_RESET_EXCUSED } from './historyRegistry';
export { runeSwallowScan } from './runeSwallowScan';
export { playScan, playFixture, VANILLA_CONTROL_ID, CONTROL_KEY_WHITELIST } from './playScan';
export { combatScan, combatWorklist } from './combatScan';
export { combatModScan } from './combatModScan';
export { heroScan } from './heroScan';
export { PLAY_EXCUSED, WATCHER_EXCUSED } from './historyRegistry';
// ── PR 8: coverage-guided corpus + nightly lifecycle lane ──────────────────────────────────────────────────
export { coverageKeysFor, type CoverageObservation } from './coverageKeys';
export { buildCoverageCorpus, corpusDigest, CORPUS_CONFIG, type CorpusConfig, type CorpusEntry, type CorpusBuildResult } from './corpusBuilder';
export { driveTrajectory, nextFuzzAction, invariantViolations, pinCurrentWave, DEFAULT_COMBAT_BUDGET, type DriveOptions, type DriveOutcome, type DriveViolation, type CombatBudget } from './trajectory';
export { minimizeFailure, specToScenario, scenarioRepro, violationPredicate, type TrajectorySpec, type FailurePredicate, type MinimizeResult } from './seedMinimize';
export { makeFinding, fingerprintFinding, emitFindingsJson, type DocbotFinding, type FindingDraft, type FindingIdentity } from './findings';
export { runNightly, runLifecycle, runLobbySweep, buildFailureArtifact, nightlyReportJson, DEFAULT_NIGHTLY, type NightlyConfig, type NightlyReport, type NightlyRunReport, type NightlyFailure } from './nightlyLane';
// ── Doc Bot 2.0 WP B: the knowledge foundation ───────────────────────────────────────────────────────────
export { extractAllContracts, activeContentIds, EXTRACTOR_ID, type ExtractionResult } from './contractExtract';
export { corroborateContracts, CORROBORATION_ASPECTS, type CorroborationReport, type CorroborationSources, type ContractCorroborationRow, type CorroborationDisagreement, type CorroborationAspect } from './contractCorroboration';
export { buildConventionQuestions, CONVENTION_QUEUE } from './conventionQuestions';
// ── Doc Bot 2.0 WP D: contract verification at scale ─────────────────────────────────────────────────────
export { planCases, CASE_TEMPLATES, SLICE_COVERED_IDS, type CasePlan, type CaseTemplateId, type SkipReason, type DriverId } from './isolatedCases';
export { runVariantDiff, checkMetamorphic, type VariantDiffResult, type MetamorphicCheck, type MetamorphicLawId } from './variantDiff';
export {
  runContractSweep, releaseBlockerFindings, laneCitations, sampleRotation, inSample, CONTRACT_LANE,
  type ContractSweepOptions, type ContractSweepReport, type ContractSweepRow, type ExecutedCase, type TemplateTotals,
} from './contractOracle';
