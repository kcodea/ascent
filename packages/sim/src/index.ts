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

export * from './runTelemetry';
export * from './runDerive';
export * from './opponentPool.data';
export { MATCHMAKING, adjustedWinRate, bandWeight, boardRecord, clearBoardRecords, registerBoardRecords, selectionWeight, type BoardRecord } from './matchmaking';
export { RECRUIT_FACTORY_IDS } from './recruit'; // Doc Bot: the recruit dispatch surface, keys only
export { TRIGGER_PHASES, PHASE_EXCUSED, COMBAT_CASTING_FACTORIES, TRIBE_RATCHET, PREDICATE_FILES, RAW_TRIBE_COMPARE_SOURCE, RUNE_DIFF_EXCUSED, SPELL_POWER_EXCUSED, TURN_RESET_EXCUSED, runeSwallowScan, playScan, combatScan, combatModScan, heroScan, PLAY_EXCUSED, WATCHER_EXCUSED, type PhaseExcuse } from './docbot';
export { canRallyInShop, ralliersOf, fireShopRally, fireRallies, runeLastingCadenceBeats, instanceEffects } from './recruit'; // the shop-side RALLY dispatcher (Effect Arena Step 4) — a new disruptor is a call, not a wiring project
export { socBoardEffects, fireShopStartOfCombat, fireStartOfCombats, runeCombatProwessBeats } from './recruit'; // the shop-side START-OF-COMBAT dispatcher (Effect Arena Step 4) — Rune of Combat Prowess
export { addBuff, boardManaBonus, cardBuff, conjuredStats, dragonTamerCostOf, roundedSpellbookCostOf, buyoutCostOf, allInPayoutOf, exhibitionGrantOf, tempestGrantOf, bladeMasteryGrantOf, hoardWhelpStatsOf, TEMPEST_KILLS_PER_STEP, BLADE_ATTACKS_PER_STEP, heroPowerText, CIA_SUIT_TEXT, COMMISSION_TEXT, COMMISSION_NAME, COMMISSION_REWARD, commissionOffer, aegisGrantOf, COMMISSION_DELAY, threeDistinctTypes, stampSableBond, heroOfferPrice, endOfTurnRepeats, isTribe, magnetizeTargets, modalOpen, offerBuyStats, projectEndOfTurnSteps, questEndOfTurnBeats, sellValueOf, sellValueWithBonus, spellCasts, rubyCastCount, spellCostReduction, isStatSpell, implosionCasts, dragonflameCasts, spellDisplayText, dominantBoardTribe, gildMinion, effectiveTargetTribe, spellStatBonus, spellAttackBonus, spellHealthBonus, rubyStatBonus, undeadBuyBonus, type EotStepFx } from './recruit';
export * from './heroSurface';
