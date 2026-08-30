export * from './config';
export * from './heroes';
export * from './heroTips';
export * from './threats';
export * from './shop';
export * from './state';
export { alignmentAt, alignmentsOf, alignmentOf, boardHasCelestial } from './alignment';
export { poolOf, setIdOf } from './cardPool';
export * from './quests';
export * from './buildTags';
export * from './contribution';
export * from './reducer';
export * from './preparedAction';
export * from './beatProbe';
export { currentCollector, withActiveCollector } from './activeCollector';
export * from './odds';
export * from './snapshot';
export * from './boardSide';
export * from './boardElo';
export * from './boardFeatures';
export * from './boardModel';
export * from './runModel';
export * from './lobby';
export * from './tutorial';
export * from './productionBots';
export * from './opponents';
export * from './rating';
export * from './playerRating';
export * from './synthesize';
export * from './balanceReport';
export { BOTS, BOT_BY_ID, DEFAULT_BOT, type BotPolicy, type BotWeights } from './bots';
export * from './replayV2';
export * from './bugReport'; // shared bug-reporter envelope/capsule + inbox shapes — ui AND tools read these
export * from './qaScenario'; // QaScenarioV1 — the ONE shared QA scenario envelope + pure runner (Scene Builder, Docbot, bug repro, regressions)
export * from './windowReplay'; // WP C — exact per-action report replay from the capsule's rolling window (tools + the dev report panel share one verdict)
export * from './semanticTrace'; // WP C — the unified recruit+combat semantic trace + first-divergence locator

export * from './runTelemetry';
export * from './runeDup'; // rune duplicate stacking (owner rulings 2026-08-27): stack counts + sweetener/unique/forge-filter sets
export * from './runDerive';
export * from './opponentPool.data';
export { MATCHMAKING, adjustedWinRate, bandWeight, boardRecord, clearBoardRecords, registerBoardRecords, selectionWeight, type BoardRecord } from './matchmaking';
export { RECRUIT_FACTORY_IDS } from './recruit'; // Doc Bot: the recruit dispatch surface, keys only
export { TRIGGER_PHASES, PHASE_EXCUSED, COMBAT_CASTING_FACTORIES, TRIBE_RATCHET, PREDICATE_FILES, RAW_TRIBE_COMPARE_SOURCE, RUNE_DIFF_EXCUSED, SPELL_POWER_EXCUSED, TURN_RESET_EXCUSED, runeSwallowScan, playScan, combatScan, combatModScan, heroScan, PLAY_EXCUSED, WATCHER_EXCUSED, type PhaseExcuse } from './docbot';
// PR 8 — coverage-guided corpus + nightly lifecycle lane (tools consume these through the public entrypoint)
export { coverageKeysFor, buildCoverageCorpus, corpusDigest, CORPUS_CONFIG, driveTrajectory, minimizeFailure, specToScenario, scenarioRepro, violationPredicate, makeFinding, fingerprintFinding, emitFindingsJson, runNightly, nightlyReportJson, DEFAULT_NIGHTLY, type CorpusBuildResult, type CorpusEntry, type NightlyConfig, type NightlyReport, type DocbotFinding } from './docbot';
// Doc Bot 2.0 WP B — contract extraction + triangle screening + convention clustering (tools consumers)
export { extractAllContracts, activeContentIds, archivedInventory, ARCHIVED_CONTENT_TYPES, EXTRACTOR_ID, corroborateContracts, CORROBORATION_ASPECTS, buildConventionQuestions, conventionClusters, triggerGroupOf, CONVENTION_QUEUE, type ConventionCluster, type ParkedSuppression, type ExtractionResult, type CorroborationReport, type CorroborationSources, type CorroborationDisagreement } from './docbot';
// Doc Bot 2.0 WP D — contract verification at scale (tools consumers: docbot-contracts + nightly)
export { runContractSweep, releaseBlockerFindings, planCases, sampleRotation, CONTRACT_LANE, type ContractSweepReport, type ContractSweepOptions, type MetamorphicCheck } from './docbot';
// Doc Bot 2.0 WP E — text intelligence (tools consumers: docbot-text CLI + nightly)
export { parseObjectText, runTextSweep, runRewriteAdvisor, buildWordingQuestions, estimatedSittingMinutes, wordingCorpus, textObjectOf, TEXT_LANE, ADVISOR_LANE, WORDING_QUEUE, TERM_VARIANTS, type TextSweepReport, type TextSweepOptions, type TextObjectRow, type ParsedTextContract, type TextBucket, type TextMismatch } from './docbot';
// Doc Bot 2.0 WP F — interaction intelligence (tools consumers: docbot-interactions + nightly)
export {
  buildInteractionGraph, candidatePairs, graphErrors, graphStats, runInteractionSweep, verifyInteractionTable,
  runAnomalyOracle, buildInteractionQuestions, combinationKey, combinationParts, RETRO_INTERACTION_MAP, retroMapErrors,
  PAIR_FAMILIES, TRIPLE_FAMILIES, INTERACTION_LANE, ANOMALY_LANE, INTERACTION_QUEUE, RULED_MULTIPLIER_FAMILIES,
  type InteractionGraph, type InteractionRun, type InteractionSweepReport, type InteractionVerdict,
  type CandidateReport, type AnomalyOracleReport, type RetroMapEntry,
} from './docbot';
// Doc Bot 2.0 WP G — the learning loop (consumers: bugs:graduate, docbot:ledger, the QA Workbench)
export {
  BUG_TAXONOMY, BUG_CLASS_IDS, bugClass, bugTaxonomyErrors, mergeGraduation, emitGraduationLedger,
  foldLedger, emptyLedger, emitLedgerJson, parseLedger, summarizeFold, bucketOf, LEDGER_SCHEMA_VERSION,
  type BugClassEntry, type GraduationRecord, type GraduationLedger,
  type LedgerFile, type LedgerEntry, type LedgerBatch, type LedgerBucket, type LedgerFoldSummary,
  type FindingClass, type FindingSeverity, type FindingConfidence, type FindingStatus, type FirstDivergence,
} from './docbot';
export { canRallyInShop, ralliersOf, fireShopRally, fireRallies, runeLastingCadenceBeats, instanceEffects } from './recruit'; // the shop-side RALLY dispatcher (Effect Arena Step 4) — a new disruptor is a call, not a wiring project
export { socBoardEffects, fireShopStartOfCombat, fireStartOfCombats, runeCombatProwessBeats } from './recruit'; // the shop-side START-OF-COMBAT dispatcher (Effect Arena Step 4) — Rune of Combat Prowess
export { addBuff, boardManaBonus, cardBuff, conjuredStats, dragonTamerCostOf, roundedSpellbookCostOf, buyoutCostOf, allInPayoutOf, exhibitionGrantOf, tempestGrantOf, bladeMasteryGrantOf, hoardWhelpStatsOf, TEMPEST_KILLS_PER_STEP, BLADE_ATTACKS_PER_STEP, heroPowerText, CIA_SUIT_TEXT, COMMISSION_TEXT, COMMISSION_NAME, COMMISSION_REWARD, commissionOffer, aegisGrantOf, COMMISSION_DELAY, threeDistinctTypes, stampSableBond, heroOfferPrice, endOfTurnRepeats, isTribe, magnetizeTargets, modalOpen, chooseBothActive, chooseOneNeedsChoice, offerBuyStats, projectEndOfTurnSteps, questEndOfTurnBeats, sellValueOf, sellValueWithBonus, spellCasts, rubyCastCount, spellCostReduction, isStatSpell, implosionCasts, dragonflameCasts, spellDisplayText, dominantBoardTribe, gildMinion, effectiveTargetTribe, spellStatBonus, spellAttackBonus, spellHealthBonus, rubyStatBonus, undeadBuyBonus, type EotStepFx } from './recruit';
export * from './heroSurface';

// EQUIPMENT (owner handoff 2026-08-28) — the public read surface. The UI derives its whole slot from these:
// nothing about Equipment lives in a visual component, so moving it to a dedicated button later is a UI
// change only.
export {
  BASE_EQUIPMENT_ACTIVATIONS, equipmentCostOf, equipmentParams, equipmentSourceAlive, equipmentState,
  equipIsNews, equipmentText, equipmentUsesLeft, holdsEquipment, rebuildEquipment, selectedEquipment, selectedEquipmentDef,
  type ReequipCue,
} from './equipment';
