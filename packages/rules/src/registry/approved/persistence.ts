/**
 * APPROVED RULES — domain `persistence`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';

export const PERSISTENCE_RULES: GameRule[] = [

  // ── "THIS TURN" temporal scope (owner ruling 2026-08-27, decided on q-carry-demand-encore) ─────────────
  {
    id: 'R-TURN-01',
    title: '"This turn" runs from shop through that turn\'s combat',
    statement:
      'A turn is the shop phase PLUS the combat that ends it: an effect or tally scoped to "this turn" '
      + 'remains live and consumable through that turn\'s combat, and expires at the start of the next shop '
      + 'turn. So turn-scoped state a combat trigger can consume (Shout extras, per-turn tallies a '
      + 'Start-of-Combat or combat-triggered effect reads) must reach that combat — evaporating at the '
      + 'shop/combat boundary is a defect. Standing rule, applied retroactively to existing effects.',
    domain: 'persistence',
    status: 'approved',
    evidence: [{
      kind: 'owner-chat',
      ref: 'q-carry-demand-encore (REVISE, 2026-08-27)',
      quote: '\'This turn\' terminology runs from shop through that turn\'s combat, and ends at the start of the next shop turn. so this effect should absolutely carry over into combat. use this language and logic moving forward and to retroactively fix issues.',
    }],
    currentBehaviour:
      'Enforced by the carry-over lane (carryOver.test.ts sweeps every per-turn reducer reset through a real '
      + 'combat; excuses in CARRY_OVER_EXCUSED cite this rule) plus the printed-text sweep '
      + '(thisTurnRule.test.ts classifies every content def whose text says "this turn"). Demand an Encore '
      + 'was the one violation found on 2026-08-27 and now carries via questCombatMods.encoreExtra.',
    enforcement: {
      kind: 'scenario',
      refs: [
        'packages/sim/src/shoutCarryOver.test.ts',
        'packages/sim/src/docbot/carryOver.test.ts',
        'packages/sim/src/docbot/thisTurnRule.test.ts',
      ],
      lastVerifiedAt: '2026-08-27',
    },
  },
  {
    id: 'R-ENGRAVE-01',
    title: 'Every combat stat gain resolves through the one buff chokepoint — Engrave sees all of them',
    statement:
      'Engrave (the EG keyword, and the Transcendant adjacency aura "while alive and adjacent") is resolved at the '
      + 'moment stats are gained, inside the single combat buff path. So EVERY combat stat gain — rune grants at '
      + 'Start of Combat included — must go through that path; a gain applied by direct assignment is invisible to '
      + 'Engrave and evaporates at carry-back. Rune of Warding\'s tripled Health on a warded Dragon beside a '
      + 'Transcendant carries back like any other gain. Ordering is not the question: there is no "before the '
      + 'Engrave" — the aura is read live on each gain.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'fix-pr', ref: '#1377 (Bug Board 7130a89b, 2026-09-09)', quote: 'rune of warding does not work with a dragon and transcendance. i believe "start of combat" occurs before transcendants engrave effect' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts ctx.buff — the Transcendant adjacency read (owner respec 2026-08-17)' },
    ],
    cardText: '**Ward.** Adjacent **Dragons** are **Engraved**.',
    contentIds: ['d2_transcendence', 'rune_warding'],
    currentBehaviour:
      'Conforms — #1377: Warding\'s tripling calls `ctx.buff` once per rune copy (it was the last Start-of-Combat rune '
      + 'grant applying stats by hand). Every other SoC rune grant already went through `ctx.buff`.',
    enforcement: { kind: 'scenario', refs: ['packages/core/src/combat/runeWardingEngrave.test.ts', 'packages/core/src/combat/simulate.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-HAND-02',
    title: 'A card buffed in hand keeps the buff — permanently, in every phase',
    statement:
      'A stat buff that lands on a card IN YOUR HAND is permanent, whatever phase granted it. A combat effect '
      + 'that buffs a hand card mid-fight leaves that card buffed in the next shop and for the rest of the run, '
      + 'exactly as a recruit-phase hand buff does. It is also shown as it happens: the replay grows the hand '
      + 'card on the beat the buff fires, not when the fight settles.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-09 (this ruling)', quote: 'cards buffed in hand are always permanent. so if something buffs a card in hand during combat, that card in hand retains the buff. the buff also needs to show in real time like all of our other effects do.' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts ctx.buffHand → CombatResult.playerHandBuffs; packages/sim/src/reducer.ts settle (addBuff onto the run hand); packages/ui/src/useCombatReplay.ts handBuffsShownThrough' },
    ],
    currentBehaviour:
      'Conforms (built with the ruling, 2026-09-09). Combat reaches the hand through ONE verb, `ctx.buffHand`: it '
      + 'logs a `handBuff` event and accumulates `playerHandBuffs`, which settle applies to the run hand with '
      + '`addBuff` (attributed to the granting body). The arena verbs `handMinions` / `buffHand` give both phases '
      + 'the same body — the shop adapter buffs the hand cards directly. The hand row adds the reached deltas '
      + 'on the beat of each buff and drops them at settle, when the permanent buff is in the run hand itself. '
      + 'No shipped card buffs the hand mid-fight yet; `deathrattleBuffHandTribe` is the first factory on the '
      + 'channel, and the scenario drives it through simulate() with an injected probe card.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/handBuffInCombat.test.ts', 'packages/ui/src/useCombatReplay.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-PROV-01',
    title: 'Every stat names its source — runes included; the shop channel is never anonymous',
    statement:
      'Every stat a minion carries beyond its printed base names the individual source that granted it — the card, '
      + 'the spell, or the specific RUNE ("Rune of Reinvestment: +4/+4"), never a catch-all ("Tavern", "Shop Stats", '
      + '"Staff of Guel" standing in for the whole channel). The run-wide shop channel keeps a per-source ledger that '
      + 'sums to the channel exactly; a bought minion\'s buff breakdown prints one line per source; a rune that feeds '
      + 'the channel can show what it alone has given. Doc Bot holds the ledger to the channel after every action.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-10 (Rune of Reinvestment ask)', quote: 'this should also be part of docbot\'s oracle. we should be extremely specific from where stats and buffs came from, referencing individual runes if necessary. it\'ll help to parse out bugs.' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts creditShopBuffSource / applyRunShopBuff; packages/sim/src/reducer.ts (buy path: one addBuff per ledger source; combat carry-back credits playerTavernBuyGainSources); packages/core/src/combat/simulate.ts tavernBuyGainSources' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-10: the ledger (`tavernBuyBonusSources`) is written by every channel writer; the buy path '
      + 'bakes one line per source; the Reinvestment badge reads its own line (shop) and the live summon count (combat). '
      + 'Before this the channel was one anonymous pair relabelled "Staff of Guel" at buy time.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/docbot/conservationLaws.test.ts', 'packages/ui/src/tallyCoverage.test.ts'], lastVerifiedAt: '2026-09-10' },
  },
  {
    id: 'R-HOLD-01',
    title: 'A displaced minion keeps the Shop buffs it accrues while it sits on an offer',
    statement:
      'A minion stashed on a Shop offer (Darah\'s Displace) is an offer like any other: a Veinstorm Ruby, a Fortify, '
      + 'a targeted spell and a rune\'s shop enchant all stamp it. Every path that hands it back to the player, the '
      + 're-buy, the swap back, a Lasso, a Requisition and Harlan, restores those accrued buffs on top of the body\'s '
      + 'own, each under its own source name, and the shop row displays the total the restore will actually hand back.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-21 (displaced Chimerus report)', quote: 'i swapped chimerus to shop and used veinstorms and it did not buff it' },
      { kind: 'fix-pr', ref: 'PR #1615 — packages/sim/src/recruit.ts restoreHeldOffer (one helper for both restore paths); packages/ui/src/Recruit.tsx shopView held branch + heldOfferLedger' },
    ],
    contentIds: ['chimerus'],
    currentBehaviour:
      'Conforms — 2026-09-21 (PR #1615). Both restore paths used to rebuild the body from the stashed card alone '
      + 'and never read the offer\'s buffs, so every offer-level gain vanished on the way back; only `golden` had '
      + 'been patched (2026-07-29). The row used to render the stashed body alone, so the stamp was invisible too.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/displacedOfferBuffs.test.ts', 'packages/ui/src/heldOfferView.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-SNAP-01',
    title: 'The recorded final board is the POST-SETTLE board',
    statement:
      'The board a finished run records for the Career row, Recent Games and the Hall of Champions is the run board '
      + 'as it stands after the final combat SETTLES, which is exactly what the next shop would have opened with. '
      + 'Everything the settle writes to the run board is in, Engraved growth and permanent buffs among them. '
      + 'Combat-only state is out: temporary Start-of-Combat buffs, shields, and bodies summoned during the fight.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-21 (final snapshot ask)', quote: 'can we make it so that the final snapshot is actually what a fresh board would look like after that final combat, so that it carries the in-combat buffs for boards that carry them' },
      { kind: 'fix-pr', ref: 'PR #1617 — packages/ui/src/store.ts run-end block records `endStateBoard(next)` instead of the start-of-combat board' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-21 (PR #1617). The recorded board used to be the last combat\'s START-OF-COMBAT board '
      + '(`socBoard` merged onto the end-state snapshot), so it showed SoC buffs, shields and summons but none of '
      + 'the gains made during the fight, because those land on the run board only when `settleCombat` runs. The '
      + 'pin covers four cases: an Engraved carry-back present, combat-only buffs, shields and summons absent, the '
      + 'course-victory path settling first, and the lobby path. The general claim rests on `endStateBoard(next)` '
      + 'reading the settled run board, so any carry-back the settle writes is structurally included.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/finalBoardPostSettle.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-REPORT-01',
    title: 'The Balance Report reads one set, never a sandbox, and exports exactly what it shows',
    statement:
      'The player Balance Report reads ONLY ladder runs of the ACTIVE card set. A telemetry row that carries no '
      + 'set stamp is read as set 1, the codebase-wide legacy default, and is never substituted with the live '
      + 'set; the real value is backfilled by SQL, by the owner, and only where the row\'s own shop offers agree '
      + 'with that set (a row that saw a card outside the set\'s pool is never stamped into it). A Scene Builder '
      + 'sandbox run never uploads telemetry, whatever mode the loaded run kept, and every uploaded row is '
      + 'stamped with its set and its source so a sandbox row could never pass for a ladder row even if a '
      + 'gate slipped. The export is built from the SAME filtered rows the screen renders, through the same '
      + 'pure functions, so the file and the screen can never disagree. Every placement delta the report prints '
      + '(cards, heroes, runes, shop tiers) comes from ONE implementation, placementImpact, and every aggregate '
      + 'table the screen shows appears in the export with every column named in the readme; a section removed '
      + 'from the screen leaves the export and the readme with it.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (the Balance Report rework)', quote: 'fix up our balance report. it should only have data for the active set in it, and nothing from scene builder. also make the export export everything so that an ai can analyze all of the data for me at once.' },
      { kind: 'code', ref: 'packages/sim/src/playerReport.ts (applyReportFilters, telemetrySetOf, isLadderRow, buildBalanceExport); packages/sim/src/runTelemetry.ts telemetrySourceOf; packages/ui/src/store.ts the run-end telemetry gate; packages/ui/src/remoteBoards.ts BALANCE_SELECTS + the upload ladder' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22. The run-end block was already gated on the sandbox flag (#1236, 2026-08-26) '
      + 'and the rig launches under mode practice (#1385), so no sandbox row had ever uploaded; the gate is now '
      + 'repeated on the telemetry upload itself and every row is stamped set_id + source (on the flat row and '
      + 'inside derived). The report filters in @game/sim, the header prints the set and the counts, and Export '
      + 'all serialises the same filtered rows. Legacy rows read as set 1; the runbook backfills them to set 2 only '
      + 'where no shop offer lies outside set 2\'s pool (a 2026-09-22 read-only probe found four live rows carrying '
      + 'set-3-only cards; they stay unstamped and the runbook lists them). A stamp the client wrote inside derived '
      + 'is read on the flat rung (derived->>setId) until the columns exist, and the derived payloads are fetched '
      + 'by id for the surviving rows only, after the flat rows render. Round 2 (same day): heroImpact, runeImpact '
      + 'and tierImpact spread the shared placementImpact stats (the owner ask: "apply the same updates to heroes, '
      + 'runes, shop tiers"), goldEconomy replaces goldCurve with per-round start / spent / unspent by placement '
      + 'bucket, and Card Demand left the screen, the export, the readme and the sim together.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/reportFilters.test.ts', 'packages/sim/src/balanceExport.test.ts', 'packages/sim/src/cardImpact.test.ts', 'packages/sim/src/reportImpact.test.ts', 'packages/ui/src/telemetrySandboxGate.test.ts', 'packages/ui/src/balanceFetch.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-CAREER-01',
    title: 'The Career page trends MMR over rated runs, with an All time window',
    statement:
      'The Career page\'s Performance Trends carry an MMR line: one point per rated run in the window, plotted '
      + 'as the rating the run settled to (the same scalar the Seasonal Ranked crest prints), oldest first and '
      + 'exactly as recorded, never a running mean; the line ends on, and headlines, the live rating (R-CAREER-02). A '
      + 'run with no settled rating (practice, unrated, a row the settle stamp never reached) contributes no '
      + 'point and is never drawn as 0, while a real 0 is a point. The window tabs are 7, 30 and 90 days and All '
      + 'time; All time applies no lower bound at all and is bounded only by the rows the page fetches. The three '
      + 'rate lines beside it keep their running-mean smoothing.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (the Career page\'s Performance Trends panel)', quote: 'add to the performance trends an "MMR" line graph that tracks mmr over time. also add an "All time" tab so there is 7/30/90 days and all time.' },
      { kind: 'code', ref: 'packages/ui/src/careerData.ts (trendSeries: the mmr series via rawSeries, TrendWindow \'all\', mmrAxisOf); packages/ui/src/remoteBoards.ts CAREER_LIGHT_SELECT rating_after:entry->>ratingAfter; packages/ui/src/Career.tsx (the MMR chart, first in the panel; the All time tab); the value is settle_rank\'s stamp on run_history.entry.ratingAfter (schema.sql)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22 (the feature PR). The rating plotted is the server\'s settle stamp on the '
      + 'history row (entry.ratingAfter, projected as rating_after on the light select); since #1594 the client '
      + 'never writes it, so an unstamped row reads null and is skipped. Plotting the line raw rather than as a '
      + 'running mean is the implementation\'s reading of "tracks mmr over time" (a rating is a state, not a rate; '
      + 'the 2026-09-20 smoothing ruling was for the three rate lines), decided 2026-09-22 and open to the '
      + 'owner\'s correction. The axis is snapped to whole 100-point divisions around the window\'s ratings. All '
      + 'time reads the newest 1000 light rows the page fetches (FETCH_LIMIT), which is every run any account has '
      + 'today. A season reset inside a window is drawn as the drop it is.',
    example:
      'A player takes five bottom-half finishes on the Bronze I floor (0 MMR each), then climbs 16, 56, 40, 46, '
      + '86, 100, 110. The 30d MMR line reads 0, 0, 0, 0, 0, 16, 56, 40, 46, 86, 100, 110 with the headline 110 on '
      + 'a 0 to 200 axis; the Avg Placement line beside it is still a running mean.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/careerData.test.ts', 'packages/ui/src/Career.test.tsx', 'packages/ui/src/careerFetch.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-CAREER-02',
    title: 'The Career MMR chart always ends on the live rating the Seasonal Ranked crest prints',
    statement:
      'The MMR chart\'s headline is always the player\'s current rating, the same number the Seasonal Ranked crest '
      + 'beside it prints. When the newest rated run in the window settled to a different number (a settlement that '
      + 'wrote no career row moved the rating since), the line closes with one extra "now" point at the current '
      + 'rating. Historical points are never rewritten, and the "now" point is not counted as a run. With no rated '
      + 'run in the window the chart stays empty while the headline still shows the current rating.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner decision 2026-10-03 (the chart read 250 while the crest read 210)', quote: 'Should the MMR chart end on your live rating? yes' },
      { kind: 'code', ref: 'packages/ui/src/careerData.ts (trendSeries liveRating, endOnLive); packages/ui/src/Career.tsx (liveMmr = the crest\'s rank scalar or bare rating; TrendChart counts runs without the now point)' },
    ],
    currentBehaviour:
      'Conforms since 2026-10-03. Before it the headline and last point were the newest stamped ratingAfter, which '
      + 'lagged the crest whenever a settlement (for example the abandon settle, switched off in #1920) wrote no '
      + 'stamped history row. While a viewed player\'s rank is still loading, the chart shows the stamped series.',
    example:
      'Runs in the window settled to 230 and then 250, and a later settlement with no career row dropped the rating '
      + 'to 210. The chart draws 230, 250, 210 and its headline reads 210, matching the crest. The footer says 2 runs.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/careerData.test.ts', 'packages/ui/src/Career.test.tsx'],
      lastVerifiedAt: '2026-10-03',
    },
  },
  {
    id: 'R-REPORT-02',
    title: 'Every new run starts a fresh live observer: one derived payload holds one run',
    statement:
      'The live balance derivation (`beginDerive` / `observeAction` / `finishDerive`) and the flat telemetry log '
      + 'are per-run observers. Every door a run starts through (the hero picker for a lobby, Ascent or Practice, '
      + '`newRun`, a tutorial, `clearRun`, the Scene Builder rigs) primes BOTH against that run\'s opening state, '
      + 'so the `derived` payload an upload carries holds exactly the uploaded run\'s events: `gold`, `offers`, '
      + '`boards`, `acquisitions` and `upgrades` never carry an earlier run\'s rows in front of their own and a '
      + 'stream\'s wave never drops. A RESUMED run keeps the observers its save carries. The report\'s read side '
      + 'keeps `ledgerSegment` (the last wave-monotone segment) so rows uploaded before this fix still read as '
      + 'one run.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (reset the live derive state between runs)', quote: 'The live derived telemetry ... accumulates across runs in one browser session. A read-only probe of the 114 live rows on 2026-09-22 found that 53 payloads\' gold[], boards[] and offers[] contain earlier runs\' events in front of the uploaded run\'s own ... make every new run (newRun, lobby create, resume of a different run id) start from a fresh state.' },
      { kind: 'code', ref: 'packages/ui/src/store.ts freshObservers (spread into pickHero, newRun and startTutorial beside RANK_SLICE_RESET; clearRun and the sandbox rigs already reset); packages/sim/src/runDerive.ts beginDerive; packages/sim/src/playerReport.ts ledgerSegment (the read-side guard for older rows)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22. Until then only `clearRun` and the sandbox rigs reset the observers; the hero '
      + 'picker, `newRun` and `startTutorial` installed a new run and kept the previous run\'s `deriveState` and '
      + '`telemetryLog`, so a session that played several runs stacked them into one payload (53 of 114 live rows; '
      + 'one row held three runs; `combats` did not stack because it is keyed per wave from the run). The three '
      + 'doors now spread `freshObservers(run)`; the read-side `ledgerSegment` stays for the rows already banked.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/deriveResetBetweenRuns.test.ts', 'packages/ui/src/telemetrySandboxGate.test.ts', 'packages/ui/src/flushSaveDerive.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-REPORT-03',
    title: 'The Balance Report prints associations under honest labels and never a survival statistic as card power',
    statement:
      'Every placement comparison the Balance Report prints is an ASSOCIATION among the runs observed, labelled '
      + 'as what it is: the raw buyer association (buyers against every other placed run, kept unchanged for '
      + 'audit continuity), the sample-weighted association (the same delta shrunk for a thin sample), the '
      + 'relative raw association within tier (secondary, never called a survival correction), the exposed '
      + 'diagnostic (both sides restricted to runs whose own shop offers included the card; a diagnostic, never '
      + 'the adjusted estimate) and the adjusted association (buy against pass inside the first affordable shop '
      + 'offer, stratified on round band by shop tier inside a balance epoch, buyers weighted, supported strata '
      + 'only). The exposure fixture is the contract: late-round eligible runs whose buyers and skippers place '
      + 'identically plus early eliminations that never saw the card make the raw delta negative while the '
      + 'exposed and adjusted comparisons stay zero. Where no stratum holds both a buyer and a skipper the '
      + 'adjusted association is unavailable, never zero, and such a row is never ranked as the worst card. '
      + 'One primary observation per run per card; an unaffordable offer is not a rejection; a later purchase '
      + 'never relabels an earlier pass; a prior acquisition excludes the run. Every stream is read by its last '
      + 'wave segment. A Welch interval is printed only on the metric it belongs to and only with the documented '
      + 'minimum on each side, never collapsed. The evidence label (insufficient, candidate for review, supported '
      + 'association) needs both group sizes and the unique players behind them, so duplicating one player\'s '
      + 'runs raises neither; no label means confirmed overpowered. Missing or malformed placements never count '
      + 'toward a placement finding. The balance epoch is a filter, defaulting to the build\'s own revision or the '
      + 'newest, and older revisions are never pooled in silently: an epoch under the minimum reads as '
      + 'insufficient current data with an explicit historical toggle. The flat fetch pages every eligible row '
      + 'and states its cap and truncation; the export carries schema version 2 with the scope, the quality '
      + 'counts, the fetch coverage and the per-metric exclusions, and a version-1 column is never redefined '
      + 'under a shipped version. No display name, account id or raw player key is written into a table or into '
      + 'the export\'s runs (each run carries a per-file alias that preserves the unique-player count); unique '
      + 'players are keyed by run_telemetry.player_key (a server-side hash of the account id, 2026-09-23) on '
      + 'every count, evidence label, sensitivity toggle and export alias, and by the display name only as a '
      + 'labelled fallback on a backend that has not run that migration.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'The owner\'s balance-analytics handoff, 2026-09-22 (kept outside the repo)', quote: 'The existing raw delta arithmetic is correct, but comparing buyers with all nonbuyers systematically rewards survival and card access. Preserve raw metrics under honest labels, separate coherent balance versions, expose sample/coverage weaknesses, and add offered-run diagnostics followed by comparable decision-opportunity analysis where telemetry supports it.' },
      { kind: 'owner-chat', ref: 'The same handoff, section 8, acceptance tests', quote: 'create late-round eligible runs where buyers and skippers have identical placement distributions, plus early eliminations that could never encounter the card. Raw delta becomes negative; the eligible comparison stays zero.' },
      { kind: 'code', ref: 'packages/sim/src/reportCohorts.ts (segmentByWave, exposedDiagnostic, shopEpisodesOf, adjustedAssociation, welchInterval, evidenceLabel, dataQuality, epochsOf, accountKey / displayNameKey / playerKeyFor); packages/sim/src/playerReport.ts (cardImpactWithCoverage, performanceSortValue, scopeReport, EXPORT_SCHEMA_VERSION, buildBalanceExport, playerAliases); packages/ui/src/remoteBoards.ts fetchRunTelemetry (paged; the player_key rung and playerKeyBasis); packages/ui/src/BalancePanel.tsx; supabase/migrations/2026-09-23-player-key-drop-seat-results.sql' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22. The audited export (110 Set 2 runs) reproduces every version-1 column to '
      + 'rounding and the handoff\'s section-2 diagnostic exactly (Mysterious Joker raw -2.76 reads +0.0018 among '
      + 'the 62 buyers and 9 skippers that saw it; Black Belt Brian -1.92 reads +1.5077 among 52 and 10; Sea '
      + 'Urchin 47 exposed of 49 raw buyers). Stage C (player-cluster bootstrap, false-discovery screening) is '
      + 'deferred: with two display names behind 100 of 110 runs it would manufacture confidence, and the '
      + 'evidence banner, the export readme (howToRead) and the devlog say so. The export\'s runs carry '
      + '"player N" aliases in place of the display name (2026-09-23 review fix). Since 2026-09-23 unique players '
      + 'are counted by player_key (the owner ran the generated md5(user_id) column on the live backend; 120 rows, '
      + '8 distinct keys): the fetch reads it on its own select rung and reports playerKeyBasis, every cohort '
      + 'call, the prolific toggle and the export alias key on it, the banner prints "N players" (or "N display '
      + 'names (proxy: backend not migrated)" on the fallback), and the raw key never enters the export.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/reportCohorts.test.ts', 'packages/sim/src/balanceExport.test.ts', 'packages/sim/src/cardImpact.test.ts', 'packages/sim/src/reportImpact.test.ts', 'packages/sim/src/reportFilters.test.ts', 'packages/ui/src/balanceFetch.test.ts', 'packages/ui/src/noEmDashPlayerText.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },

  // ── The FX workbench keeps what it loads (owner ruling 2026-09-24, found building the gild) ────────────
  {
    id: 'R-FXSAVE-01',
    title: 'A def saved from the FX workbench keeps every setting it was loaded with',
    statement:
      'Loading an effect definition into the FX workbench and saving it again never changes it. Every layer '
      + 'setting the def carried (its arc, arc upward, minimum arc and per-recipient stagger, its travel window, '
      + 'anchor parts and timing, the author\'s mute / solo / layer name, and every parameter) is written back '
      + 'exactly, and a setting the author never touched is never added. The workbench reads a def on the same '
      + 'terms as the game\'s own def loader, so what an author tunes is what players see.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Gild redesign session, 2026-09-24 (approving this rule as proposed)', quote: 'approve it - i want to adjust the def settings myself though' },
      { kind: 'owner-chat', ref: 'Gild redesign session, 2026-09-24 (the goal the fix protects)', quote: 'i wish so badly to be able to create this effect in the fx workbench' },
      { kind: 'fix-pr', ref: 'https://github.com/kcodea/ascent/pull/1689 (feat/gild-trail-fx)' },
      { kind: 'code', ref: 'packages/ui/src/fx/ui/sessionState.ts arcFields (toEditorLayer + toStoredLayers); packages/ui/src/fx/defStore.ts coerceLayer' },
    ],
    currentBehaviour:
      'Conforms at the LAYER level as of 2026-09-24. Before that, toEditorLayer (load and session restore) and '
      + 'toStoredLayers (save) copied layer fields one by one and dropped `bow` and `stagger`, so loading a def '
      + 'and saving it again wiped its arc and cascade (verified on heavy-beam: stagger 120 came back as '
      + 'nothing); both now go through one arcFields(), which also carries the new `bowUp` / `minArc`. The pin '
      + 'round-trips a layer carrying EVERY field, typed Required<StoredEditorLayer>, so a new layer field fails '
      + 'the typecheck until it is added there. PARTIAL at the DEF level: seed, slot, ease, loop mode, '
      + 'followSource, label and tags ride Workbench.loadDef and toStoredDef (whose writing half and label/tag '
      + 'carry are pinned in defStore.test.ts), but the component\'s reading half is not pinned end to end.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/fx/ui/sessionState.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  // ── By-card edits reach bindings.json, once per save (owner ask 2026-09-25) ──────────────────────────────
  {
    id: 'R-FXSAVE-02',
    title: 'Effect assignments made in the FX Library are saved to the game in one explicit save that always succeeds',
    statement:
      'Every effect or sound an author assigns to a card in the FX Library (By card) plays straight away, and '
      + 'is written to the game\x27s bindings file only when the author presses Save all edits, together with '
      + 'every other pending assignment and imported sound, in one write that reloads the page once. The save '
      + 'accepts every kind of assignment the game itself can play, so a valid edit is never silently lost.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'FX Library session, 2026-09-25', quote: 'can we not have it automatically refresh the server every time something new is added? id much rather put a "Save all edits" button in the bottom left below the Set 1,2,3 options with a big orange button' },
      { kind: 'fix-pr', ref: 'https://github.com/kcodea/ascent/pull/1728 (feat/fxlib-save-all-edits)' },
      { kind: 'code', ref: 'apps/web/fxDefsPlugin.ts BINDING_FAN_OUTS; packages/ui/src/fx/ui/LibraryBrowser.tsx saveAllEdits; packages/ui/src/fx/pendingDefs.ts; packages/ui/src/choreo/bindings.ts hasUnsavedBindings' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-25. Before, every By-card edit POSTed the whole table immediately, and the dev '
      + 'server rejected it (400) whenever any row used the `struck` / `buffed` / `buffedOn` fan-outs, which its '
      + 'whitelist had never learned, so no By-card edit had reached the file since those arrived; they lived only '
      + 'in the browser\x27s session overlay. The page refresh the owner saw came from importing a sound, whose new '
      + 'def file in the globbed defs folder reloads the page. Now edits apply live and wait; imported sound defs '
      + 'are parked (fx/pendingDefs.ts, survives a reload); Save all edits sends every write in parallel. Pinned: '
      + 'the committed bindings.json must pass the endpoint and its fan-out list must equal the reader\x27s '
      + '(fxDefsPlugin.test.ts), plus the unsaved signal and the parked defs. The button itself was checked live '
      + '(one save, one reload, the file written), not by a test.',
    enforcement: {
      kind: 'scenario',
      refs: ['apps/web/fxDefsPlugin.test.ts', 'packages/ui/src/choreo/unsavedBindings.test.ts', 'packages/ui/src/fx/pendingDefs.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  // ── Match details: the whole lobby at the moment your game ended (owner ask 2026-09-28) ─────────────────
  {
    id: 'R-MATCH-01',
    title: 'Match details show every player in your lobby and the board they had when your game ended',
    statement:
      'After a lobby game (Ranked or Practice), the end screen offers Match details: every seat of the lobby in '
      + 'placement order, each with its hero, name, placement (or that it was still in when you went out), the '
      + 'round it went out or Winner, and its health when your game ended. Choosing a seat shows the board it had '
      + 'at that moment: your knockout round, or the final round when you won. A seat that went out earlier shows '
      + 'the board it went out with. The caption says which moment the board is from. The boards are the ones the '
      + 'lobby actually fielded, recorded once when your game ends and never recomputed, and they wear their '
      + 'the skins of their owners only through the Show opponent skins setting. The same record is saved with the match, '
      + 'so the match history in the Career can show it again; an older match without it says the details were not '
      + 'recorded. Under the selected board the panel shows that seat\x27s rune choices at that moment, and a seat whose run is '
      + 'currently on the Hall of Champions wears a small gold crown. The panel holds still: its size never depends on a '
      + 'scrollbar or on which seat is selected.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (the Match details feature request)', quote: 'at the end game screen add a "match details" button to see the players in the lobby and the ability to click and see what their boards were when you died or won' },
      { kind: 'owner-handoff', ref: 'Player request on Discord, relayed by the owner 2026-09-28', quote: 'i placed 6th but wanted to see what everyone else looked like at the time of my loss' },
      { kind: 'owner-chat', ref: 'Match details review on 5173, 2026-09-28', quote: 'the match details looks solid once the jittering is fixed and runes are added to the view so you can see their rune choices' },
      { kind: 'owner-chat', ref: 'Match details review, 2026-09-28', quote: 'can we also add a little crown emblem on the match details screen if any of these boards is currently a hall of champions board?' },
      { kind: 'code', ref: 'packages/sim/src/lobby/matchDetails.ts (buildMatchDetails, parseMatchDetails); packages/ui/src/store.ts matchDetailsOf (run_history.entry.match, practice_games.replay.match); packages/ui/src/matchDetails/MatchScoreboard.tsx; packages/ui/src/Career.tsx (LobbyToggle, LobbyPanel)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-28 (the feature PR). The record is built in the deferred run-end blocks, BEFORE the '
      + 'play-out of the fight ledger, from the same driver call the lobby used to field each board '
      + '(prepare(round) ?? finalBoard()). It is compact (card id, stats, Gilded, keywords, identity and the baked '
      + 'live text; about 4 to 6 KB for a full table, capped at 16 KB) and rides existing JSON: the ranked '
      + 'run_history entry and the replay payload of the practice row, so no migration. Seats still standing when you '
      + 'went out have no placement yet and read as Top N / Still in; the lobby is not played out for them. '
      + 'Generated seats carry their handle and are not tagged; the Practice bot table is tagged Bot. Titles are '
      + 'only known for your own seat. JITTER (fixed 2026-09-28): with full-text cards the board cards hung out of their tiles, '
      + 'the panel scrolled, and since the tiles are sized off the panel width the scrollbar fed back into the overflow; board '
      + 'cards are now pinned compact, the gutter is reserved, scroll anchoring is off and the strip has one height. The crown '
      + 'reads the Hall screen\x27s own query once per panel open (cached for the session once it answers).',
    example:
      'You are knocked out 6th in round 11 by Rook. Match details list the five players still in (by health, '
      + 'Rook marked as the one who knocked you out), then you, then the seats that went out before you. It opens '
      + 'on the round 11 board of Rook ("Their board when you were knocked out, round 11"); the 8th place seat shows '
      + 'the board it went out with in round 5.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/lobby/matchDetails.test.ts', 'packages/ui/src/matchDetails/matchDetails.test.tsx', 'packages/ui/src/matchDetails/runEndMatch.test.ts'],
      lastVerifiedAt: '2026-09-28',
    },
  },
  // ── A finished fight reopened by Continue can always be left (owner ask 2026-09-28) ──────────────────────
  {
    id: 'R-RESUME-01',
    title: 'A fight that was already settled and is reopened by Continue always offers End Combat, and applies nothing twice',
    statement:
      'When a run is reloaded on the combat screen after its fight has already been settled (the damage landed '
      + 'before the reload), Continue plays the fight back and then enables End Combat, win or loss, so the run can '
      + 'always leave the screen. Leaving applies no damage, Armor, Resolve, placement or rating a second time, and '
      + 'the hero strike is not replayed for damage already taken. A reload during a fight that had NOT settled '
      + 'yet still plays normally: the strike lands once and End Combat waits for it.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'bug report relayed by the owner, 2026-09-28', quote: 'a lost fight that was already settled and is then reopened with Continue never enables the End Combat button, so the run can\x27t leave that screen' },
      { kind: 'fix-pr', ref: 'fix/end-combat-after-continue' },
      { kind: 'code', ref: 'packages/ui/src/endCombatGate.ts endCombatReady; packages/ui/src/Recruit.tsx ShopControls' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-28. Before, a loss held End Combat until the hero-strike sequence reached its end, '
      + 'but that sequence early-returns on `combatSettled` (correctly: the blow was already dealt), so on a '
      + 'restored settled loss it never started and the gate never opened. Wins and draws were never held. Now a '
      + 'loss that was settled before any strike began is ready once the replay ends. Pinned: the gate cases and a '
      + 'save round trip that settles, reloads and resolves without a second charge, including the elimination '
      + 'case (endCombatGate.test.ts). The reload itself was checked live on a Practice run, not by a test.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/endCombatGate.test.ts'],
      lastVerifiedAt: '2026-09-28',
    },
  },
  {
    id: 'R-ENGRAVE-02',
    title: 'An Engraved minion keeps its combat gains even if it died in that fight',
    statement:
      'An Engraved minion keeps every stat it gained during a fight, win or lose, even when it died in that fight. '
      + 'Dying does not undo Engrave: the gains carry back to the run board exactly as they would for a survivor. '
      + 'A minion that is not Engraved keeps none of its combat gains, alive or dead.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Rules-wiki review, 2026-09-29 (asked whether a dead Engraved minion should keep its gains)', quote: 'yes this is intended. that is the entire point of the engraved mechanic' },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts playerPermaBuffs carry-back (reads every minion on the fight board, the fallen included)' },
    ],
    currentBehaviour: 'Conforms: the carry-back reads every fight-board minion, dead ones included, and a Rise does not clear the gains.',
    enforcement: { kind: 'scenario', refs: ['packages/core/src/combat/engravedKeepsGainsWhenDead.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PERSIST-EMAIL-01',
    title: "A player's email is never readable by other players",
    statement:
      'The email a player signs up with is stored on their profile but is never readable through the public or '
      + 'signed-in client roles. Other profile columns (name, tag, rank, level, title) stay readable. The client '
      + 'writes its own email but never reads any email back.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (pool investigation found profiles.email readable with the anon key; owner ran the fix)', quote: 'ran the sql' },
      { kind: 'code', ref: 'supabase/migrations/2026-09-29-hide-profile-email.sql (column-level SELECT grant without email)' },
    ],
    currentBehaviour: 'Conforms since 2026-09-29: an anon read of profiles.email or select=* is refused; the display, rank and progression columns still read.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/profileEmailPrivate.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PERSIST-01',
    title: 'Continue only resumes a started lobby game, never the retired course format',
    statement:
      'A saved run (and the title Continue button) exists only once the player has picked a hero and the game has '
      + 'started. Leaving from the title, the Practice setup screen or the hero picker writes nothing, so the next '
      + 'Play starts fresh. Only a lobby run (Play, Practice or the tutorial) may be saved or resumed: a saved run '
      + 'in the retired 17-round course format is discarded at load and no Continue is offered, and no menu path '
      + 'creates a course run.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Bug report 2026-09-30 (quit from hero select, Continue opened a Round 1/17 course run)', quote: 'remove the wave format option entirely, and only create a continue option if the player selects a hero and starts a game.' },
      { kind: 'code', ref: 'packages/ui/src/store.ts isResumableRun + flushSave isPreRun guard + pickHero always createLobbyRun' },
    ],
    currentBehaviour: 'Conforms since 2026-09-30: flushSave refuses pre-run states, writeSave/loadSave refuse lobby-less runs, and the Ascent/Rift course entry points are gone.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/continueNoLegacyCourse.test.ts'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-PERSIST-CLOUD-01',
    title: 'A signed-in player can continue a saved game on any device they are signed in on',
    statement:
      'For a signed-in (non-guest) player, the saved game is also stored on their account: at the start of each shop '
      + 'phase, on Save & Quit and when the tab is hidden. The local save is always written first and offline play is '
      + 'unchanged; the upload retries until it lands. On the title, a newer account copy (or one with no local copy) '
      + 'becomes the Continue, resuming exactly the saved run, its lobby and its pinned opponents included. Guests stay '
      + 'on their device only.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Feature request 2026-09-30 (plan approved the same day)', quote: 'if a player is playing on one device and they save/quit, can we allow that to be picked up from another device they are signed in on?' },
      { kind: 'code', ref: 'packages/ui/src/cloudSave.ts + store.ts (writeSave / flushSave upload, syncCloudAtTitle, adoptCloudRun); supabase/migrations/2026-09-30-saved-runs.sql' },
    ],
    currentBehaviour: 'Conforms since 2026-09-30 once the owner runs the saved_runs SQL; before that the feature detects the missing table and stays local-only.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/crossDeviceSaves.test.ts', 'packages/ui/src/cloudSave.test.ts'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-PERSIST-CLOUD-02',
    title: 'A saved game is played on one device at a time and newer progress is never overwritten',
    statement:
      'Pressing Continue claims the game for that device. A save from a device holding an older copy is refused by the '
      + 'server, and that device stops the game and offers to load the newer copy or return to the menu. No path lets '
      + 'an older copy replace newer progress.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Feature request 2026-09-30 (plan approved the same day)', quote: 'if a player is playing on one device and they save/quit, can we allow that to be picked up from another device they are signed in on?' },
      { kind: 'code', ref: 'put_saved_run (revision-checked write/claim) + store onCloudMoved / CloudMovedModal' },
    ],
    currentBehaviour: 'Conforms since 2026-09-30 (with the SQL applied).',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/crossDeviceSaves.test.ts', 'packages/ui/src/cloudSave.test.ts'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-PERSIST-CLOUD-03',
    title: 'A finished game clears its saves everywhere and never comes back as Continue',
    statement:
      'When a game ends (or its save is discarded), the account copy is cleared along with the local one, so Continue '
      + 'disappears on every device. A local copy of that same game left on another device is dropped at its title, '
      + 'not resumed and not uploaded again.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Feature request 2026-09-30 (plan approved the same day)', quote: 'if a player is playing on one device and they save/quit, can we allow that to be picked up from another device they are signed in on?' },
      { kind: 'code', ref: 'clear_saved_run + store run-end / clearRun cloudSave.endRun + decideAtTitle discard-local' },
    ],
    currentBehaviour: 'Conforms since 2026-09-30 (with the SQL applied).',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/crossDeviceSaves.test.ts', 'packages/ui/src/cloudSave.test.ts'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-REPORT-04',
    title: 'Balance Report fields come from live capture, never from re-simulating a lobby run as an Ascent run',
    statement:
      'Every field of the telemetry row of a lobby run is captured LIVE: round wins from the history of the run itself (every '
      + 'round counted), the shop tier at the end of each wave covering exactly waves 1 to the final wave, and the quests '
      + 'and runes offered and picked, recorded as the run is played. Replaying the action log through a plain run is '
      + 'never a source for a lobby run (it has no lobby seats and goes off course from the first combat); it remains '
      + 'only the labelled fallback for a run resumed from a save that predates live capture. Rows uploaded before live '
      + 'capture are read from the best source per field (the live derived payload before the replay), every tier '
      + 'series is cut at the live final wave, and each exported run says which source each field came from and what '
      + 'is still inferred. Each run is stamped with its matchmaking regime (band table, strength formula, band asked '
      + 'for and used); older runs infer it from their build or date and are labelled inferred. The report and the '
      + 'export can be scoped to one regime and one client build.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner reply 2026-10-03 to the Balance Report export audit (runs[].wins wrong on 31 of 36 rows of one epoch, tierByWave short or long on 32, no regime stamp)', quote: 'yes fix these issues' },
      { kind: 'code', ref: 'packages/sim/src/runTelemetry.ts (recordTelemetryAction live tier + choices, lobbyRunTelemetry, currentRegime); packages/sim/src/reportSources.ts (bestSources, withBestSources, resolveRegime, KNOWN_BUILD_ERAS); packages/sim/src/playerReport.ts (applyReportFilters, ExportedRun build / regime / sources, EXPORT_SCHEMA_VERSION 3); packages/sim/src/reportCohorts.ts (ReportScope regime + build, dataQuality.sources); packages/ui/src/store.ts the lobby telemetry upload; packages/ui/src/remoteBoards.ts BALANCE_DERIVED_SCALARS' },
    ],
    currentBehaviour:
      'Conforms since 2026-10-03. On the live 36-row epoch bba0a133 the stored wins agreed with the live combat count on '
      + '5 rows and the stored tier series covered exactly 1 to the final wave on 4; read through the new source picker, '
      + 'both are 36 of 36. Quests and runes on rows uploaded before the fix stay replay-derived (no live source exists '
      + 'for them) and are flagged; regimes on those rows are inferred.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/reportSources.test.ts', 'packages/ui/src/balanceFetch.test.ts'], lastVerifiedAt: '2026-10-03' },
  },
  {
    id: 'R-TELEMETRY-RANK-01',
    title: 'Every rated game in telemetry records the rank the player started it at, beside the matchmaking regime',
    statement:
      'Each uploaded RATED lobby game records, in its public telemetry, the medal, division, points and rating the player '
      + 'held when the game started (the rank pinned on the run at creation, so a rank change mid-game, Save & Quit or a '
      + 'cloud resume never moves it), next to the matchmaking regime stamp (band table and strength formula). Practice, '
      + 'the tutorial, the Gauntlet, sandboxes and unrated tables never carry it. A row without it reads as an UNKNOWN '
      + 'rank, never as any particular medal, and every reader degrades instead of failing. The newcomer top-4 rate is '
      + 'measured from these rows: rated games started in Bronze, developers excluded, with an interval and a sample size; '
      + 'older rows read as Bronze only from the Bronze matchmaking band they asked for, labelled approximate.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner decision 2026-10-06 (the newcomer top-4 target, about 40% in Bronze)', quote: "Start recording each player's rank in game telemetry, so we can measure real newcomers' top-4 rate" },
      { kind: 'code', ref: 'packages/sim/src/rankAtStart.ts (rankAtStartOf, parseRankAtStart, rankAtStartForTelemetry); packages/sim/src/state.ts RunState.rankAtStart; packages/ui/src/goldClock.ts pinMedalAtStart (one pin with medalAtStart); packages/ui/src/store.ts the lobby telemetry upload (derived.rankAtStart beside derived.regime); packages/ui/src/remoteBoards.ts BALANCE_DERIVED_SCALARS; packages/sim/src/playerReport.ts ExportedRun.rankAtStart; packages/tools/src/newcomer (npm run newcomer:rate, DEVELOPER_AUTHORS)' },
    ],
    currentBehaviour:
      'Conforms from 2026-10-06 for new uploads. Every row uploaded before it has no rank stamp: on 2026-10-06 the live '
      + 'table held 193 rows, none stamped, of which 26 were rated non-developer games (4 readable as Bronze from their '
      + 'band, 22 unknown; developers = LazerLemon, Orangez, LEMON). No backend change: the stamp rides inside the '
      + 'existing derived jsonb.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/telemetryRankAtStart.test.ts', 'packages/ui/src/balanceFetch.test.ts', 'packages/tools/src/newcomer/newcomerRate.test.ts'], lastVerifiedAt: '2026-10-06' },
  },
  {
    id: 'R-NEXTCOMBAT-01',
    title: 'A next-combat spell spends on the round it was cast for, and only that round',
    statement:
      'A board snapshot\'s armed next-combat spells (its banks: Weaken, Fleeting Vigor, Rallying Offensive, Marked '
      + 'Target, Open the Gates, the banked keywords, Decoy Sigil, Summoning Bulwark, Solid Ground, Containment Rune, '
      + 'Stolen Initiative; and its one-combat marks: Bloodlust, Parting Cry, Closed Casket) apply ONLY in the fight for '
      + 'the round they were cast for, which is the snapshot\'s own wave. The same board served in a LATER round (a '
      + 'recorded seat serving its final board past its own end, a seat whose recording skipped a round, an eliminated '
      + 'seat\'s ghost) fights without them. A fight never spends them on the shared snapshot: each fight works on its '
      + 'own copy, so the deferred odds probe and every later fight see the banks exactly as armed. On the player\'s '
      + 'own run the banks stay armed through the fight and are spent when it settles.',
    domain: 'persistence',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Next-combat spell audit, 2026-10-07 (Problem B: simulate spent one-shot banks on the shared snapshot)', quote: 'this is probably okay as long as they are spent on the turn the player played them' },
      { kind: 'owner-chat', ref: 'lobby-stale-final-boards ruling, 2026-09-17 (recorded seats keep serving their final board past their own end)', quote: 'nah keep it as is' },
      { kind: 'code', ref: 'packages/sim/src/boardSide.ts snapshotBanksLive / sideFromSnapshot(fightRound) / seatCombatSide; packages/core/src/combat/bankedOpeners.ts stripNextCombatBanks, stripNextCombatMarks; packages/core/src/combat/simulate.ts (per-fight questMods copy)' },
    ],
    currentBehaviour:
      'Conforms from 2026-10-07. Before, `sideFromSnapshot` shared the snapshot\'s `questMods` object and `simulate` '
      + 'spent Stolen Initiative, Containment and Solid Ground on it in place, and a stale final board or a ghost '
      + 're-cast every bank it had. Non-lobby pool boards (no round to compare) still apply their banks, as before.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/nextCombatSpells.test.ts'], lastVerifiedAt: '2026-10-07' },
  },
];
