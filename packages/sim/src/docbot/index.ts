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
 * Two more, from the 2026-08-29 owner reports — both encode a MISS rather than a bug, which is what makes
 * them lanes instead of regression tests:
 *
 *   9. combatEmitAgreement — every trigger combat actually emits is classified as combat/both in
 *                       `TRIGGER_PHASES`, or waived with a reason. Born because `onGainCard` was written
 *                       down as recruit-only, which switched OFF lane 1's combat half for it: the lane that
 *                       exists to find missing combat factories could not see one. A registry that gates
 *                       another check has to be derivable from the thing it describes.
 *  10. uidSurvivesTriple — no run state points at a body a triple destroyed (Sable's Soulbind held two
 *                       run-board uids and a triple minted a fresh one). A deep walk, not a field list: the
 *                       bond's fields are `a`/`b`, so no naming convention would ever have found it.
 *
 * `npm run docbot` prints the full report, including the needs-triage backlog the tests tolerate but track.
 * Doctrine and the ledger of what each lane has caught: docs/docbot.md.
 */
export { TRIGGER_PHASES, PHASE_EXCUSED, COMBAT_CASTING_FACTORIES, COMBAT_EMIT_WAIVED, type PhaseExcuse } from './phaseRegistry';
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
export { extractAllContracts, activeContentIds, archivedInventory, ARCHIVED_CONTENT_TYPES, EXTRACTOR_ID, type ExtractionResult } from './contractExtract';
export { corroborateContracts, CORROBORATION_ASPECTS, type CorroborationReport, type CorroborationSources, type ContractCorroborationRow, type CorroborationDisagreement, type CorroborationAspect } from './contractCorroboration';
export {
  buildConventionQuestions, conventionClusters, triggerGroupOf, CONVENTION_QUEUE,
  type ConventionCluster, type ParkedSuppression,
} from './conventionQuestions';
// ── Doc Bot 2.0 WP D: contract verification at scale ─────────────────────────────────────────────────────
export { planCases, CASE_TEMPLATES, SLICE_COVERED_IDS, type CasePlan, type CaseTemplateId, type SkipReason, type DriverId } from './isolatedCases';
export { runVariantDiff, checkMetamorphic, type VariantDiffResult, type MetamorphicCheck, type MetamorphicLawId } from './variantDiff';
export {
  runContractSweep, releaseBlockerFindings, laneCitations, sampleRotation, inSample, CONTRACT_LANE,
  type ContractSweepOptions, type ContractSweepReport, type ContractSweepRow, type ExecutedCase, type TemplateTotals,
} from './contractOracle';
// ── Doc Bot 2.0 WP E: text intelligence ──────────────────────────────────────────────────────────────────
export { parseObjectText } from './textParse/parser';
export { KEYWORD_LEXICON, TERM_VARIANTS, TRIGGER_LEXICON } from './textParse/lexicon';
export { textObjectOf, type TextObject } from './textParse/corpus';
export {
  runTextSweep, TEXT_LANE, TEXT_EXCEPTIONS, KNOWN_TEXT_MISMATCH,
  type TextSweepOptions, type TextSweepReport, type TextObjectRow, type KnownTextMismatch,
} from './textParse/classify';
export { runRewriteAdvisor, ADVISOR_LANE, FRAME_CHAR_BOUND, type AdvisorOptions } from './textParse/rewriteAdvisor';
export { buildWordingQuestions, estimatedSittingMinutes, wordingCorpus, WORDING_QUEUE } from './textParse/wordingQuestions';
export {
  IMPLEMENTED_TAXONOMY,
  type ParsedTextContract, type TextBucket, type TextMismatch, type MismatchTaxonomyId, type TextSpan,
} from './textParse/types';
// ── Doc Bot 2.0 WP F: interaction intelligence ───────────────────────────────────────────────────────────
export {
  buildInteractionGraph, candidatePairs, graphErrors, graphStats, CHANNEL_OF_TRIGGER, MULTIPLIER_FAMILY_TRIGGERS,
  type InteractionGraph, type InteractionNode, type InteractionEdge, type InteractionNodeKind,
  type InteractionEdgeKind, type CandidatePair, type CandidateReport,
} from './interactionGraph';
export {
  runInteractionSweep, verifyInteractionTable, PAIR_FAMILIES, TRIPLE_FAMILIES, INTERACTION_LANE,
  type InteractionRun, type InteractionSweepOptions, type InteractionSweepReport, type InteractionVerdict,
  type PairFamilyId, type TripleFamilyId, type BlockedReason,
} from './interactionSweep';
export { combinationKey, combinationParts } from './coverageKeys';
export {
  runAnomalyOracle, RULED_MULTIPLIER_FAMILIES, ANOMALY_LANE,
  type AnomalyOracleOptions, type AnomalyOracleReport, type AnomalyDetectorId, type AnomalyFinding,
} from './anomalyOracle';
export { RETRO_INTERACTION_MAP, retroMapErrors, type RetroMapEntry } from './retroInteractionMap';
export { buildInteractionQuestions, INTERACTION_QUEUE } from './interactionQuestions';
// ── Doc Bot 2.0 WP G: the learning loop (graduation taxonomy + findings ledger) ──
export {
  BUG_TAXONOMY, BUG_CLASS_IDS, bugClass, bugTaxonomyErrors, mergeGraduation, emitGraduationLedger,
  type BugClassEntry, type GraduationRecord, type GraduationLedger,
} from './bugTaxonomy';
export {
  foldLedger, emptyLedger, emitLedgerJson, parseLedger, summarizeFold, bucketOf, LEDGER_SCHEMA_VERSION,
  type LedgerFile, type LedgerEntry, type LedgerBatch, type LedgerSighting, type LedgerStatusChange,
  type LedgerBucket, type LedgerFoldSummary, type FoldLedgerOptions,
} from './ledger';
// The V2 finding vocabulary — the workbench + ledger consumers need these names outside `@game/sim`'s internals.
export type {
  FindingClass, FindingSeverity, FindingConfidence, FindingStatus, FirstDivergence, FindingProvenance,
} from './findings';
