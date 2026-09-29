/**
 * APPROVED RULES — domain `foundation`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';

export const FOUNDATION_RULES: GameRule[] = [
  {
    id: 'R-RANK-01',
    title: 'Ranked: a won promotion lands at 10 points, never 0',
    statement:
      'Winning a promotion game puts the player at 10 of 100 in the new division, not 0. The landing is a fixed '
      + 'constant and is never the game\'s own award, so one loss straight after a promotion can never demote. A '
      + 'fresh promotion is not armed for demotion. The client, the Edge Function and the SQL writer all use the '
      + 'same landing constant.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-21 (ranked ladder ruling)', quote: 'when a player promotes to the next medal/division, set their rating at 10/100 instead of 0/100 so they cant lose 1 game and demote' },
      { kind: 'fix-pr', ref: 'PR #1611 — packages/sim/src/rank.ts RANK_RULES.promotionLanding; supabase/functions/_shared/lobbyRating.ts RANK_PROMOTION_LANDING; the settle_rank migration' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-21 (PR #1611). It was 0 the day before. Domain note: the ladder is a structural contract '
      + 'of the lobby rather than an in-run resource, so it files under `foundation`, not `economy` (which covers '
      + 'Gold, embers and the shop economy inside a run).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/rank.test.ts', 'packages/ui/src/lobbyRatingParity.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-RANK-02',
    title: 'Ranked: no instant demotions, a demotion game stands in the way',
    statement:
      'A loss that would take a player below 0 points in any division above the floor clamps at 0 and ARMS a '
      + 'demotion game instead of demoting. Only a bottom-4 finish in that next game demotes, by one division, '
      + 'landing at 100 plus that game\'s award; across a medal boundary that is the previous medal\'s division I. '
      + 'A top-4 finish keeps the division and disarms the gate. The armed state is stored on the profile, so it '
      + 'survives between sessions, and the client, the Edge Function and the SQL writer agree on all of it.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-21 (ranked ladder ruling)', quote: 'hitting 0 mmr should halt the loss and put you in a demotion game. you need to then bottom 4 that game to demote' },
      { kind: 'fix-pr', ref: 'PR #1611 — packages/sim/src/rank.ts resolveRank/settleRank (`demotionReady`); supabase/functions/_shared/lobbyRating.ts resolveRankOutcome' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-21 (PR #1611). The gate was first (2026-09-20) only across a MEDAL boundary; the owner '
      + 'widened it to every division above Bronze I the next day. Same domain note as R-RANK-01.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/rank.test.ts', 'packages/ui/src/lobbyRatingParity.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-LOBBY-01',
    title: 'A ghost fight is never a rematch',
    statement:
      'The seat that draws the bye never faces, as a ghost, the seat it fought the round before or the seat it '
      + 'eliminated. The next most recent fallen seat stands in. When the only ghost on offer would be a rematch, '
      + 'the bye moves to another seat instead. One deliberate floor: asked for a ghost when no non-rematch seat is '
      + 'available at all, the selector still returns the most recent fallen seat, because a fight beats a free '
      + 'round. It is the bye reassignment that keeps that case off the table, so the floor is not a hole to close.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-19 (ghost rematch report, the Hearthstone rule)', quote: 'player just fought and killed the dead ghost opponent that he is fighting now. that shouldn\'t be possible.' },
      { kind: 'fix-pr', ref: 'PR #1563 — packages/sim/src/lobby/runLobby.ts ghostFor / ghostIsRematch, and the bye reassignment' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-19 (PR #1563). At a 3-alive table the bye holder used to be served the most recently '
      + 'fallen seat, which is exactly the seat it had just eliminated.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/lobby/ghostNoRematch.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-RANK-03',
    title: 'Ranked: the division numerals ascend with the climb',
    statement:
      'Within a medal the divisions read I, II, III from lowest to highest, so a player climbs Bronze I to '
      + 'Bronze II to Bronze III and then Silver I. The stored division INDEX is unchanged by this: 0 is still '
      + 'the floor and 17 still the top, and nothing compares, settles, promotes or demotes by the numeral. The '
      + 'numeral is a label derived from the index, and every surface derives it from the one helper.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (ranked numerals)', quote: 'change the ranks to 1->2->3 instead of 3->2->1' },
      { kind: 'fix-pr', ref: 'Rank numerals ascending — packages/sim/src/rank.ts divisionTierOf, packages/ui/src/rank/types.ts DIVISION_NUMERALS' },
    ],
    currentBehaviour:
      'Conforms — 2026-09-22. The flip is display-only and lives in two places: divisionTierOf now returns '
      + '(index % divisionsPerMedal) + 1 instead of divisionsPerMedal - (index % divisionsPerMedal), and the UI '
      + 'numeral plate table is reversed to match. Because no rule reads the numeral, the server copies needed no '
      + 'change: settle_rank and the Edge Function mirror move indexes, and stored profiles keep the index they '
      + 'had, so nothing was migrated and no player moved. The rank suites assert the new labels at both ends '
      + '(index 0 is Bronze I, index 17 is Ascendant III) while every settlement fixture keeps its old indexes.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/rank.test.ts', 'packages/ui/src/rank/rankFormat.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-PRESENT-01',
    title: 'Presentation may hold a card back, never change what resolved',
    statement:
      'When an effect is animated, the reducer has already resolved it. Presentation may DELAY what the player '
      + 'sees so a consequence reads in the right order, and may show a card that state has already moved, but it '
      + 'never alters, re-orders or re-rolls the outcome. Every such hold is keyed on the uid of the one card it '
      + 'is about, never a blanket flag, so nothing else changing in the same tick is swallowed with it. And every '
      + 'hold resolves on its own without a timer when the surface it belongs to goes away, because a hold that '
      + 'outlives its screen leaves a card invisible in both places at once. A hold seeded during render is '
      + 'never released from an effect cleanup: React runs a changed-dep cleanup after that render has '
      + 'committed, so the cleanup eats the batch the render just seeded and every repeat of the effect past '
      + 'the first silently stops holding anything.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (the lasso beam)', quote: 'Make sure that the beam hits the target before the card is stolen from shop and granted to hand.' },
      { kind: 'code', ref: 'packages/ui/src/lassoHolds.ts (the hold state machine + lassoHoldsForPhase); packages/ui/src/Recruit.tsx gambleHold / heldConsume / the lasso cascade; packages/sim/src/recruit.ts stealTavernMinion (resolves immediately, records only metadata)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22. The lasso cascade is the case that made the rule explicit: a stolen Shop offer '
      + 'is spliced and its copy pushed to hand in one commit, so the beam had nothing to hit. The offer is now '
      + 'rendered back into its own slot and the arrival held out of the fan until that steal\'s beam lands, while '
      + 'the resolved state is untouched. The phase gate is applied during render rather than by the release '
      + 'timer, so leaving the shop cannot strand a card. Cancelling a previous cascade happens in that same seed '
      + 'rather than in the effect cleanup, after the cleanup form shipped a bug where only the FIRST steal of '
      + 'a recruit phase held its card (caught in review, fixed 2026-09-22). The earlier holds of the same family '
      + '(`gambleHold` since 2026-09-17, `heldConsume` since 2026-08-17) follow the same shape; `heldConsume` '
      + 'still resolves only on its own timer, which is the remaining gap in the family.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/lassoHolds.test.ts', 'packages/ui/src/lassoCascade.test.tsx', 'packages/sim/src/lassoFx.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-LOBBY-02',
    title: 'Hall of Champions: the knockout ledger is retired; R-HALL-01 defines the Hall',
    statement:
      'REVISED 2026-09-22 (same day). The knockout ledger this rule first pinned (a win for the run that knocked '
      + 'the player out, a loss for every run knocked out while the player stood, written to seat_results) is no '
      + 'longer written and nothing is derived from it: a knockout is only the fight the reporter lost in their '
      + 'last round, which the fight ledger (R-HALL-01) records like every other fight. The seat_results table is '
      + 'left in place for the owner to drop. Practice, the tutorial and a sandbox still never record anything.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (Hall of Champions rework)', quote: 'if i win a game and it gets served 30 times and wins 19, it should show an overall record of 20-10. this should only be lobby mode wins, and it should be sorted by most wins' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (Hall of Champions rework)', quote: 'track the run that beat the player when they were knocked out … if i play a board that wins on turn 14 and it knocks a player out on turn 9, that board should probably get a win. subsequently, if that same board is served to a player and it comes in 3rd against the player on turn 13, my board should get a loss recorded' },
      { kind: 'fix-pr', ref: 'Hall of Champions — packages/sim/src/lobby/runLobby.ts seatOutcomesOf, packages/ui/src/leaderboardData.ts hallRecordOf, packages/ui/src/Leaderboard.tsx, the seat_results table' },
    ],
    currentBehaviour:
      'Superseded — 2026-09-22. The knockout rule shipped in #1630 that morning; the same afternoon the owner '
      + 'asked for the Hall to answer "what board has been the best against everything else" with a start-to-'
      + 'finish record ("a 15 round game may mean it was 12-3"), which needs every fight, not only knockouts. '
      + 'seatOutcomesOf / recordSeatResults / fetchSeatRecords are deleted; the fight ledger (R-HALL-01) and the '
      + 'play-out on a clone replace them. The store no longer writes seat_results.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/fightLedgerFetch.test.ts', 'packages/ui/src/hallRecord.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-HALL-01',
    title: 'Hall of Champions: the fight ledger, and the top 10 by record against everyone',
    statement:
      'At the end of every real lobby the client records EVERY fight the table resolved: one row per fought, '
      + 'non-ghost pairing, both sides named by run key (author|heroId|seed for a recorded run and for the '
      + 'reporter; bot:<kind>:<heroId> for a generated seat, and for a recorded seat whose run the session could '
      + 'not resolve, since a hybrid drove it). If the player fell before the table finished, the remaining '
      + 'rounds are played out deterministically on a COPY of the lobby (same seed, same drivers, never the '
      + 'reducer\'s lobby) and recorded as unobserved fights. Ghost fights, sit-outs, unfieldable pairings and '
      + 'bot-versus-bot fights are never rows. The upload is one batched upsert, unique on (lobby_seed, round, '
      + 'run_a, run_b), so a run finished twice never counts a fight twice. The server aggregates per run key '
      + '(fights, W-L-D, distinct lobbies, win rate, a Wilson 95% lower bound). The Hall is the top 10 runs by '
      + 'that lower bound with at least 10 fights, from every recorded run, not only lobby winners; the client '
      + 'reads the view, never a row pool. Each row shows the W-L-D across everything, the win rate, the lobbies, '
      + 'the run\'s own game (since 2026-09-23 the ledger rows of its own lobby, R-HALL-02; the career row\'s '
      + 'tally, which counts the player\'s ghost fights, only when the ledger has none), the date of its last '
      + 'fight and the rank its player held. A run\'s own career row is joined by its FULL run key (the '
      + 'history entry carries the author it was played under since 2026-09-22), never by seed + hero alone, so two '
      + 'players on the same shared seed with the same hero each keep their own row; only a row older than the '
      + 'author stamp is joined by seed + hero. Practice, the tutorial and a sandbox never record.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (Hall of Champions rework, afternoon)', quote: 'we want the hall of champions to answer \'what board has been the best against everything else\' basically, and what the top 10 are in that category' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (Hall of Champions rework, afternoon)', quote: 'we would want to know its strength start to finish though, like overall win/loss across games. so a 15 round game may mean it was 12-3' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (scoping answers)', quote: 'Play out after elimination — yes … Minimum fights to qualify for the Hall — let\'s start at 10' },
      { kind: 'code', ref: 'packages/sim/src/lobby/fightLedger.ts (fightRowsOf, playOutRunLobby, seatFightKey); packages/ui/src/remoteBoards.ts (recordLobbyFights, fetchHallRecords, fetchHallHistory, fetchRunFinalBoards); packages/ui/src/leaderboardData.ts hallRowsOf; supabase/migrations/2026-09-22-fight-ledger.sql (lobby_fights, run_fight_records)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22 (the feature branch). The play-out lives in the store\'s run-end path on a '
      + 'shallow clone (seats copied, encounters copied), never in the reducer, because a reducer-side play-out '
      + 'collided with the balance instrument\'s own play-out earlier the same day. Bot-versus-bot fights are '
      + 'skipped as an implementation call (they count for nobody the Hall or the strength read). The Hall\'s '
      + 'final warband comes from the run\'s career row (entry.board) and falls back to the run\'s highest-wave '
      + 'pool snapshot by author + hero + seed. Until the owner runs the migration the view 404s and the Hall '
      + 'shows "No records yet".',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/lobby/fightLedger.test.ts', 'packages/ui/src/fightLedgerFetch.test.ts', 'packages/ui/src/hallRecord.test.ts', 'packages/ui/src/ladderPages.test.tsx'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-LOBBY-03',
    title: 'Lobby strength: the average smoothed win rate of the seven opponents, 0 to 100',
    statement:
      'Every finished real lobby has a strength from 0 to 100: the mean over the seven opponent seats of each '
      + 'seat\'s smoothed win rate from the fight ledger, (wins + 10) / (fights + 20), so a run with no data reads '
      + '0.5; a generated seat (a bot key) reads a fixed 0.25; the strength is round(100 × mean) with no further '
      + 'rescale. It is monotonic in every opponent\'s record and rank is not an input. Tiers, in one place: Easy '
      + 'below 35, Even 35 to 54, Hard 55 to 69, Brutal 70 and up. The client computes it at run end from one '
      + 'fetch of the view and stamps it on the replay result inside the telemetry row (the Recent Games read, '
      + 'which can never be back-stamped); the history row\'s stamp is the SERVER\'s own computation at settle '
      + 'time, because the history insert is issued in the run-end tick ahead of the rank request and never waits '
      + 'on the fetch (a delayed insert would miss settle_rank\'s rank stamp for good). It is shown only after '
      + 'the game, on the Career match rows and the Recent Games '
      + 'rows, as a percentage with no tier word ("47%", owner 2026-09-22; the tier is stored, never printed); never on the post-game screen, never on the rail before '
      + 'or during a game. A run with no stamp shows nothing rather than a guess.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (lobby strength as a percentage)', quote: 'can you remove the easy/medium/hard etc and just have it say for example, 47% since its basically a percentile.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (lobby strength)', quote: 'make an algorithm that can essentially assign a lobby strength value/indicator … we can then make winning really difficult lobbies more rewarding' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (scoping answers)', quote: 'we dont want to use rank as a metric. we want to use raw data on win rate across all rounds served for the board. rank is not important right now as a factor in this small playtest. eventually it will be' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (scoping answers)', quote: 'both, but put it in the career page match results instead of post game information … no only post game in careers and recent games pages' },
      { kind: 'code', ref: 'packages/sim/src/lobbyStrength.ts (lobbyStrengthOf, STRENGTH_TIERS); supabase/functions/_shared/lobbyRating.ts lobbyStrengthValue; settle_rank step 5 in supabase/migrations/2026-09-22-fight-ledger.sql; packages/ui/src/Career.tsx + RecentGames.tsx' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22 (the feature branch). The prior (10 in 20) and the identity mapping are the '
      + 'implementation\'s call: the prior already puts a no-information table at exactly 50, a bot table at 25 '
      + 'and a proven 70% field near 70, so no rescale is applied — while the field is young most lobbies will read '
      + 'Even, which is expected and must not be tuned away by hand. The tier cuts are a starting cut.',
    example:
      'Seven opponents: a 31-7-1 run (0.695), a 0-3 run (0.435), a bot (0.25), an unserved run (0.5), a 22-8 run '
      + '(0.64), a 9-0 run (0.655) and a 20-80 run (0.25): mean 0.489, strength 49, Even. A table of seven bots is '
      + '25, Easy. Seven runs at 36-4 each is 77, Brutal.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/lobbyStrength.test.ts', 'packages/ui/src/lobbyRatingParity.test.ts', 'packages/ui/src/fightLedgerFetch.test.ts', 'packages/ui/src/runEndUploadOrder.test.ts', 'packages/ui/src/Career.test.tsx', 'packages/ui/src/ladderPages.test.tsx'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-RANK-04',
    title: 'Ranked: a top-4 finish in a hard lobby earns a bonus of up to 15 points, scaled by placement and strength; 5th to 8th never scale',
    statement:
      'A top-4 finish in a lobby of strength s adds round(15 × placementWeight × strengthFactor) rating points on '
      + 'top of the normal placement award, where placementWeight is 1.0 for 1st, 0.8 for 2nd, 0.62 for 3rd and 0.47 '
      + 'for 4th, and strengthFactor = clamp((s − 50) / 50, 0, 1) (0 at strength 50, an even lobby, and below; 1 at '
      + '100; the floor was 30 until the owner asked why a 45% lobby paid +3). The anchors: 1st at 100 = +15, 1st at '
      + '75 = +8, 4th at 100 = +7, 2nd at 100 = +12, 3rd at 100 = +9, 1st at 50 = 0, 4th at 50 = 0. It is never granted on 5th to 8th, it is never negative, and a loss is '
      + 'never scaled. The bonus is added to the award BEFORE the gate, cap and floor rules, so a top-4 at a '
      + 'promotion gate still lands on 10 of 100 (the bonus converts into the promotion like the award), a 4th at '
      + 'a medal gate still holds at 100, and a 1st at 90 of 100 still stops at 100 with the overflow discarded; '
      + 'only a mid-division finish feels the full bonus, and Ascendant III takes all of it. The weights and the '
      + '50 / 50 line live in ONE place per copy. The server is the authority: the client sends the seven opponent '
      + 'keys and the settle recomputes the strength from the fight ledger and applies the bonus itself; the sim '
      + 'and the Edge Function mirror agree with it. The result records the bonus apart (strengthBonus, '
      + 'lobbyStrength) but the rank screen prints ONE summed number in MMR ("+43 MMR", never "+40 +3"). '
      + 'It is on now, mid-season, with a patch note.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (late: the floor moves to 50)', quote: 'why did i get +3 bonus mmr for winning a 45% lobby? isnt that an extremely even game?' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (late: one number on the rank screen)', quote: 'dont say +40 +3 in the mmr post game rank screen, just say +43 MMR.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (the revised bonus rule, after the build started; supersedes the same day\'s "only winning hard lobbies should scale, and only upwards of 15 rating")', quote: 'the strength bonus applies to any TOP-4 finish, scaled by BOTH placement and lobby strength' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (the revised bonus rule, the anchors)', quote: '1st at 100 = +15, 1st at 75 = +10, 4th at 100 = +7' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (scoping answers)', quote: 'turn that on now, but explain the full rating gain algorithm to me as well' },
      { kind: 'code', ref: 'packages/sim/src/rank.ts resolveRank (the strength argument) + packages/sim/src/lobbyStrength.ts strengthBonusOf / STRENGTH_PLACEMENT_WEIGHTS; supabase/functions/_shared/lobbyRating.ts resolveRankOutcome(bonus); settle_rank in supabase/migrations/2026-09-22-fight-ledger.sql (c_bonus_weights, v_bonus, p_seat_keys); packages/ui/src/rank/rankFormat.ts deltaText' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22 (the feature branch, after the owner\'s same-day revision from a 1st-only bonus '
      + 'to the top-4 rule). The anchor table is pinned in packages/sim/src/lobbyStrength.test.ts, '
      + 'packages/sim/src/rank.test.ts and packages/ui/src/lobbyRatingParity.test.ts; the three copies multiply '
      + 'in the same order (max × weight × factor) so the doubles agree before the round. cappedPoints is honest '
      + 'about the bonus (|award + bonus| − |applied|). The rules version was not bumped: an old client only '
      + 'mis-predicts the number until the server answers, and a client that sends no seat keys settles with no bonus.',
    example:
      'Gold II 20, 1st in a 74% lobby: +40 +7 = +47 MMR, to 67. Gold II 20, 4th at 74%: +6 +3 = +9 MMR, to 29. Gold II 20, '
      + '1st at 50% (even): the plain +40, no bonus. Gold II 20, 5th at strength 100: −6, no bonus. Gold II 90, 1st at strength '
      + '100: +55 requested, lands on 100, 45 capped, promotion game ready. Gold II 100, 4th at 100: promoted to '
      + 'Gold III 10. Gold III 100, 4th at 100: holds at 100 (a medal gate needs a 1st).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/lobbyStrength.test.ts', 'packages/sim/src/rank.test.ts', 'packages/ui/src/lobbyRatingParity.test.ts', 'packages/ui/src/rank/rankFormat.test.ts', 'packages/ui/src/rank/rankSubmission.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-PRESENT-02',
    title: 'The Amplified glow plays only on a selected Equipment that can fire',
    statement:
      'The Equipment slot carries the Amplified cue (the owner\'s looping `amplified-slot` def) only while the '
      + 'SELECTED Equipment will Amplify its next activation AND has at least one charge to spend, in the shop '
      + 'phase. An Amplified Equipment with zero charges shows no glow; an unselected Amplified Equipment shows '
      + 'none until it is picked; the glow ends the moment any of that stops being true (the activation that spends '
      + 'the stack or the charge, a swap to an unamplified Equipment, the turn ending, the phase leaving the shop, '
      + 'the slot going away) and is never left running unseen (a hidden tab, any overlay covering the slot, unmount). '
      + 'The cue decorates state the reducer already resolved; it never decides anything.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (the amplified effect)', quote: 'it should only play when a usable equipment is equipped/selected. if an equipment has 0 charges it should not show the animation.' },
      { kind: 'code', ref: 'packages/ui/src/useAmplifiedSlotFx.ts (one loop, caller-owned teardown); packages/ui/src/StatusBar.tsx (the condition: hasEquip && equipmentWillAmplify && equipmentUsesLeft > 0 && phase recruit && no covering overlay, run-state (Discover / Choose One / offers / scouting) or UI-store (Compendium, Inspect view, bug reporter, ladder and balance pages, title))' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22 (the day the cue shipped). The condition is derived from the same `run.equipment` '
      + 'reads that paint the charge number blue (`equipmentWillAmplify`) and print it (`equipmentUsesLeft`), so '
      + 'the glow and the number cannot disagree. The phase gate is load-bearing: End of Turn hands every own '
      + 'charge back in the same action that starts combat, and the bar stays mounted through the fight. Same-day '
      + 'review fix: the UI-store overlays pause it too (the Compendium, the Inspect view, the Ctrl+B bug reporter, '
      + 'the ladder / balance pages, the title), the set Recruit folds into `overlayOpen` plus the Inspect view; '
      + 'the Book had left the ring burning behind its blur. OPEN, not ruled: "usable" is read as HAS A CHARGE, the '
      + 'owner\'s own clarifying sentence. Gold is not a term, so an Amplified Equipment with a charge the player '
      + 'cannot afford this moment still glows while its button is disabled. If "usable" should also mean '
      + 'affordable, AND `run.embers >= equipmentCostOf(run, def)` into the condition and add the hook case.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/useAmplifiedSlotFx.test.tsx'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-PRESENT-03',
    title: 'A repeated Equipment fire is one cue per fire: each recipient gets its own beam on its own beat',
    statement:
      'When an Equipment whose authored def flies at the body its own effect picked (`useFxTargetsBuffed`, '
      + 'Spiritbinder) fires more than once in one activation (Amplified, an extra trigger, a Calibration charge), '
      + 'the engine stamps one `use` cue PER FIRE, in fire order, each carrying that fire\'s own recipient and gain, '
      + 'never one cue folded onto the last pick. The screen plays those cues as one beam per fire, staggered, each '
      + 'landing on its own recipient with that recipient\'s numbers held to its own contact, and suppresses the '
      + 'generic self-buff pulse on every beamed body. A fire that picked nobody stamps nothing; an activation that '
      + 'picked nobody at all stamps the single target-less cue that means "play nothing". A single fire stamps '
      + 'exactly the cue it always did. Nothing about which bodies grow, by how much, or in what order changes: the '
      + 'cue is a signal, and the reducer resolved every buff before the first beam drew. An Equipment that plays on '
      + 'the slot or on what it was aimed at keeps one cue per activation however many triggers it had; a '
      + 'three-trigger Bloodpot is one travel.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (Spiritbinder multi-beam)', quote: 'spiritbinder one beam per fire' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts buffedFxTargets; packages/sim/src/reducer.ts case activateEquipment (the per-fire stamp); packages/ui/src/equipBeamCascade.ts useEquipBeamCascade' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22. PR #1628 shipped the beam with one cue per activation: a multi-trigger press '
      + 'folded every board pick into one cue aimed at the LAST body, so an earlier recipient fell through to the '
      + 'generic self-buff burst and two fires read as one beam plus one unrelated flash (flagged in that PR\'s '
      + 'review, declined pending an owner call, now ruled). `buffedFxTargets` returns one entry per recorded pick; '
      + 'the recording factory draws at most one board body per fire, which is what makes one-per-pick equal '
      + 'one-per-fire; the reducer stamps one cue per entry, scoped to `useFxTargetsBuffed` so Bloodpot, the Keg and '
      + 'every aimed Equipment are byte-identical. `useEquipBeamCascade` plays the cues 300 ms apart (the lasso\'s '
      + 'gap), measures each recipient at launch, skips a body that left the board rather than redirecting to the '
      + 'slot, holds each recipient once (two fires on one body are two beams and one continuous roll spanning both '
      + 'contacts, because the stat-hold store keeps one hold per uid; two separate rolls would need a multi-segment '
      + 'hold in the shared store, an open owner fork), keeps every launch timer and retire fn outside the per-action '
      + 'effect so a later action never cuts a beam (owner 2026-09-09), and retires them when the shop leaves and on '
      + 'unmount.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/spiritbinderBeamCues.test.ts', 'packages/ui/src/equipBeamCascade.test.tsx', 'packages/ui/src/spiritbinderBeamGuard.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-PRESENT-04',
    title: 'No FX play outlives the Pixi context it was built on: detach retires every live def play',
    statement:
      'When the board FX overlay detaches (`PixiFxLayer` unmounts at the title screen and around the rank '
      + 'preview), `pixiFx.detach()` retires EVERY def play still registered in the FX budget - one-shots and '
      + 'caller-owned loops alike - through the play\'s own idempotent `retire` (updater off, player and layers '
      + 'destroyed with their filters and particles, container unmounted and destroyed) BEFORE the stage and '
      + 'Application are torn down, and then clears its external-updater and pending-mount lists. After a detach '
      + 'the budget registry is empty, no updater is left to tick against a destroyed object, and a re-attach is '
      + 'a new world that throws nothing. A caller-owned loop that detach retired must make its owner\'s later '
      + 'dispose a harmless no-op, never a second teardown. Retiring at detach is not a budget trim and never '
      + 'moves the `fx:culled` counter.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Review finding on feat/equipment-amplified-comet-fx, relayed by the owner 2026-09-22',
        quote:
          'After the round trip the console shows exactly one [pixiFx] external updater threw - removing it to '
          + 'protect the overlay error per play that was still live at detach (Cannot read properties of null '
          + '(reading \'fxUniforms\')) ... Those plays also remain in the FX budget registry ... so they keep '
          + 'counting against maxParticles as ghosts.',
      },
      { kind: 'code', ref: 'packages/ui/src/pixiFx.ts detach; packages/ui/src/fx/fxBudget.ts retireLivePlays; packages/ui/src/fx/playDef.ts createRetire' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22. Before the fix `detach()` tore down its own hand-written effect state and '
      + 'destroyed the Application with `{ children: true }`, but never touched `extraUpdaters` or the budget '
      + 'registry: a one-shot still live at detach kept its per-frame updater, its registry entry, its pooled '
      + 'particle layer and its filter counters after Pixi had destroyed its containers and nulled its shader '
      + 'resources. The next context\'s first tick hit `setParticleTime` on a null-resources shader, the '
      + 'external-updater guard logged and evicted the updater, and because `retire` never ran the ghost sat '
      + 'in the registry for the rest of the session. Loops were fine only because their owners disposed them '
      + 'on the same unmount. `retireLivePlays` empties the registry first and retires a snapshot (remove-then-'
      + 'retire, as `trim` does; one throwing retire is logged and skipped); `detach()` calls it before '
      + '`resetFxPools()` and `app.destroy` so each pooled pair files back normally, gated to the board '
      + 'controller (`!this.label`) because `playDef` only ever plays through `pixiFx`, then clears '
      + '`extraUpdaters` (the DEV workbench updater) and `pendingMounts`.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/fx/detachRetiresLivePlays.test.ts'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-PRESENT-05',
    title: 'The Runeforge rune row never moves when the free re-roll is spent',
    statement:
      'The Runeforge overlay centres its panel vertically, so every element of the panel must keep its box across '
      + 'the free re-roll: the re-roll button STAYS MOUNTED once spent (`forge-reroll-spent`: visibility hidden, '
      + 'disabled, aria-hidden, out of the tab order, no title) instead of unmounting, so the `.forge-actions` '
      + 'footer keeps its height, the panel keeps its height and the rune tablets\x27 top edge does not change by a '
      + 'pixel on the click. Nothing else about the re-roll changes: it is still once per game, still Free, and '
      + 'still gone from sight the moment it is used.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Claude Code session, 2026-09-22 (Runeforge free re-roll nudge)',
        quote: 'the runes move down when the player uses the free re-roll can you fix that?',
      },
      { kind: 'code', ref: 'packages/ui/src/Recruit.tsx RuneforgeOverlay (.forge-actions); packages/ui/src/styles.css .forge-reroll.forge-reroll-spent' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22. Before the fix the button rendered only while `!runeforgeRerolled && '
      + '!runeforgeRerollUsed`, so the spend unmounted it, `.forge-actions` collapsed from 39.46px to 0, the panel '
      + 'shrank from 520.28px to 486.84px and the centred grid re-flowed the tablets 16.72px lower (measured at '
      + '1400x760 on the dev build). With the button kept mounted and hidden the same measurement reads a delta of 0 '
      + 'and the panel holds 520.28px.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/runeforgeRerollNudge.test.tsx'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-LOBBY-04',
    title: 'Lobby strength is the field GOING IN, printed as a percentage, and the two stamps agree',
    statement:
      'A lobby\'s strength describes its seven opponents\' records BEFORE the game it is stamped on: the fights of '
      + 'the lobby being stamped are excluded on BOTH copies (`settle_rank` aggregates `lobby_fights` where '
      + '`lobby_seed <> p_seed`; the client subtracts the rows it is about to upload from what the view reports), '
      + 'so the Career row (the server\'s stamp) and the Recent Games row (the client\'s stamp) print the same '
      + 'number and that number never depends on how the game itself went. It is printed as a percentage with no '
      + 'tier word ("47%") on every surface; the tier is stored, never shown.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (lobby strength 47 vs 50)', quote: 'the lobby difficulty shows 47 in my career and 50 in recent games, why' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (lobby strength as a percentage)', quote: 'can you remove the easy/medium/hard etc and just have it say for example, 47% since its basically a percentile.' },
      { kind: 'code', ref: 'packages/sim/src/lobbyStrength.ts excludeOwnFights + strengthText; packages/ui/src/remoteBoards.ts fetchLobbyStrength(keys, ownRows); packages/ui/src/store.ts the run-end tick; supabase/migrations/2026-09-22-lobby-strength-going-in.sql settle_rank step 5' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-22. The first cut read the view on both sides "moments apart": the client before its '
      + 'own upload landed (seven unserved seats at the prior, 50), the server after it (the same seats carrying '
      + 'this game\'s 45 rows, 47). Both now exclude the lobby\'s own fights. Labels went from "Even 47" to "47%".',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/lobbyStrength.test.ts', 'packages/ui/src/lobbyStrengthGoingIn.test.ts', 'packages/ui/src/lobbyRatingParity.test.ts', 'packages/ui/src/Career.test.tsx', 'packages/ui/src/ladderPages.test.tsx'],
      lastVerifiedAt: '2026-09-22',
    },
  },
  {
    id: 'R-LOBBY-05',
    title: 'Every generated seat fields a board, and the player\'s fight is credited to the board they actually fought',
    statement:
      'A generated (hybrid) lobby seat is seated only when the RECORDING it will play fields at least one board: '
      + 'seat selection checks the recording (a one-board prefix of `autoplayRun`), not only the live bot, because '
      + '`prepare` is recording-only. `autoplayRun` answers every blocking modal a hero can raise, including the '
      + 'hero-power Discover (`powerOffer`: Mimic every turn, Void on turn 4, Power Shifter), so every hero records '
      + 'a real run. If the player\'s paired seat still has no board (an older save, a restored lobby), the player '
      + 'faces the most recently fallen seat\'s ghost instead, as on a bye; the boardless pairing is a sit-out for '
      + 'both (the seat is neither charged nor credited), and the player\'s fight is logged against the ghost '
      + '(`bye: s0`, `standInFor: <paired seat>`), so the encounter log, "who knocked you out" and the fight ledger '
      + 'name the board the player fought. Before anyone has fallen there is no ghost, and the round is a sit-out '
      + 'for the player too.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Claude Code session, 2026-09-28 (Mimic hybrid lobby seats field no board)',
        quote: 'the Mimic seat had no board at the player\'s end round. In one game the lobby recorded that seat as the one who knocked the player out',
      },
      { kind: 'code', ref: 'packages/sim/src/snapshot.ts autoplayRun (powerOffer branch, maxBoards); packages/sim/src/lobby/seats.ts hybridSeat.canFieldBoard + recordingFieldsBoard; packages/sim/src/lobby/runLobby.ts playerOpponent + settleRunLobbyRound (boardless player foe)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-28. Before the fix `autoplayRun` had no `powerOffer` branch, so a Mimic recording '
      + 'bailed on turn 1 with zero boards; the live-bot probe seated it anyway, and when the player was paired '
      + 'with it the reducer served an ordinary pool board while the settle charged and credited the empty seat. '
      + 'Seen in 2 of 6 Practice (players) games. Every hero now records at least 5 waves.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/sim/src/lobby/seatRecordings.test.ts', 'packages/sim/src/lobby/seatProbeEmptyRecording.test.ts'],
      lastVerifiedAt: '2026-09-28',
    },
  },
  {
    id: 'R-LOBBY-06',
    title: 'A lobby that seats player runs waits for the opponent pool, never falls back to bots silently, and an all-bot lobby is unrated',
    statement:
      'Before a rated lobby (or Practice against players) is built, the launch waits for the shared opponent pool. '
      + 'When it has already loaded (the usual case) there is no wait. While it is still loading, or its last load '
      + 'failed, the player sees "Finding opponents..." with Cancel, and the pool is retried on a longer budget. '
      + 'Only when that retry genuinely fails does the lobby offer Retry, Play anyway or Back to menu; it never '
      + 'fills the table with generated seats without saying so. The pool loads one wave per request, each with '
      + 'its own timeout and retry, and registers every wave that arrives; missing waves retry in the background '
      + 'and when the browser comes back online. The last good pool for the live set is cached (IndexedDB, one '
      + 'bounded record per set, same build version, at most a week old) and fills any wave the network cannot. '
      + 'Every ranked telemetry row records the pool size and the recorded / hybrid / bot seat counts at lobby '
      + 'creation, with a flag when every seat was generated. OFFLINE = UNRATED: a lobby whose opponent seats are '
      + 'all generated (Play anyway, or any other path to an all-bot table) is marked unrated at creation from its '
      + 'seat kinds. It moves no rank, division, promotion or demotion and earns no Ranked XP or Ranked '
      + 'achievements; the end screen reads "Unrated · No opponents reached", the Play anyway text says the game '
      + 'will not be rated, and the history, boards and telemetry rows carry the unrated tag. The server refuses '
      + 'to settle a rank request whose seat keys are all generated, so an old or tampered client cannot rate one.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (all-bot rated lobby, seed 309102059)', quote: 'build the fix so this does not re-occur.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (the unrated question)', quote: 'offline = unrated' },
      { kind: 'fix-pr', ref: 'fix/opponent-pool-loading' },
      { kind: 'code', ref: 'packages/ui/src/opponentPool/poolLoader.ts createPoolLoader; packages/ui/src/opponentPool/poolGate.ts createPoolGate; packages/ui/src/hero-select/HeroLaunchCurtain.tsx; packages/sim/src/lobby/runLobby.ts lobbyPoolTelemetryOf + lobbyIsUnrated; packages/ui/src/rank/ratedRun.ts; supabase/functions/submit-rating/index.ts allSeatsGenerated' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-28. Before, the startup pull raced all 17 per-wave requests against one 4 s timer, '
      + 'so a single slow wave discarded the whole pool; nothing retried until a run ended, and nothing waited '
      + 'before the lobby was built, so an empty pool silently seated seven hybrids (1 of 24 rated lobbies since '
      + '2026-09-23), and it was rated. The server check needs the submit-rating Edge Function redeployed (no SQL). '
      + 'Known limit: a request with NO seat keys (queued before 2026-09-22) still settles, and the server cannot '
      + 'verify that the keys a client sends are the ones it faced.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/opponentPool/poolLoader.test.ts', 'packages/ui/src/opponentPool/PoolWaitPanel.test.tsx', 'packages/sim/src/lobby/poolLoadRepro.test.ts', 'packages/ui/src/rank/unratedLobby.test.ts', 'packages/ui/src/rank/RankScreen.test.tsx'],
      lastVerifiedAt: '2026-09-28',
    },
  },
  {
    id: 'R-HALL-02',
    title: 'Hall of Champions: the own-game line counts the same fights as the record line',
    statement:
      'A Hall row\'s "Own game" W-L-D is read from the FIGHT LEDGER, not from the run\'s career tally: it is '
      + 'the ledger rows of the run\'s OWN lobby (lobby_seed = the run\'s seed) that name the run as a side, '
      + 'counted from the run\'s side. Ghost fights (the odd seat paired against an eliminated seat\'s leftover '
      + 'board) are never ledger rows, so the own game and the record above it count the same fights and the two '
      + 'lines agree. The read is ONE batched query of the raw rows for all the Hall\'s lobbies at once, filtered '
      + 'by key client-side, never a query per row. Only a lobby the ledger has no rows for (a game from before '
      + 'the ledger existed) falls back to the career row\'s wins/losses/draws, and that row\'s label says "from '
      + 'the game\'s own tally", so the two definitions are never mixed silently. The record line, the sorts and '
      + 'the layout are unchanged.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (the Hall own-game line)', quote: 'why is the record 12-2-1 but also 13-2-1? what\'s right?' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-22 (the Hall own-game line)', quote: 'ledger number probably i think.' },
      { kind: 'code', ref: 'packages/ui/src/leaderboardData.ts (ownGameRecordsOf, hallRowsOf ownSource); packages/ui/src/remoteBoards.ts fetchHallOwnGames; packages/ui/src/Leaderboard.tsx (.lb-hallown)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-23. Before the fix the own-game line read the career row\'s entry.wins/losses/draws, '
      + 'which counts the player\'s ghost fights, while the record line read the run_fight_records view, which '
      + 'does not; a run that won a ghost fight showed 12-2-1 above 13-2-1 on the same row. No new SQL: the client '
      + 'reads the existing lobby_fights rows (select lobby_seed, run_a, run_b, outcome where lobby_seed in the '
      + 'ten seeds) and folds them by key. The tally fallback carries ownSource: tally and the aria-label suffix.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/hallOwnGame.test.ts', 'packages/ui/src/fightLedgerFetch.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-PRESENT-06',
    title: 'Background music plays only inside a lobby run, starts 3 s in, chains bg / bg2 with a 3 s gap, and stops the moment the run is left',
    statement:
      'Background music sounds ONLY while a lobby-mode run is on screen: `run.mode` is lobby or practice, the run is '
      + 'not a sandbox rig, no replay is playing, and the player is past the title / hero picker / Practice setup '
      + '(`isPreRun` false). It never plays on the title or the ladder pages, in a tutorial, in Scene Builder or in a '
      + 'replay. It starts MUSIC_START_DELAY_MS (3 s) after the run\x27s shop is shown (a fresh run and a Continue alike), '
      + 'then runs UNINTERRUPTED through shop, combat, end of turn, the rail and the post-game screen: nothing in the '
      + 'game pauses or ducks it, a Skip\x27s SFX silence does not touch it, and a hidden tab is not a stop. The chain '
      + 'is bg, MUSIC_GAP_MS (3 s) of silence, bg2, 3 s, bg, ... forever; each play fades in over MUSIC_FADE_MS (600 ms) '
      + 'and fades out over its last 600 ms, the gap measured from the element\x27s `ended` event (never a timer for the '
      + 'track length) to the next fade-in. A track that fails to load is skipped for the other; both failing stays '
      + 'silent without ever throwing or blocking the game. Leaving the run (Save & Quit, Play Again, the run cleared, '
      + 'a non-lobby run starting) stops it IMMEDIATELY: a MUSIC_STOP_FADE_MS (150 ms) click-guard fade, then pause and '
      + 'rewind. Settings carry a Music mute and a Music volume separate from the Game-sounds mix (`ascent.musicmuted`, '
      + '`ascent.musicvol.v2`, see R-PRESENT-13), applied live and persisted. The round won / round lost verdict chimes are removed.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Claude Code session, 2026-09-23 (lobby background music)',
        quote: 'can you wire the bg music here: C:\\Game Assets\\Ascent Art\\SFX\\Music \u2014 this should start 3 seconds into turn 1 and play in the background, uninterrupted, on repeat/looping with 3s in between plays. add a button in the settings the mute music, and have a separate mixer for the sound, so that the player can adjust the sound of the game sounds, and music. it should chain through bg-bg2 and repeat, again, with a short delay and small fade in/out. remove the round won and round lost chimes that play currently. this music should ONLY play when a player is in a lobby, and stop immediately if they leave a lobby run or practice etc.',
      },
      { kind: 'code', ref: 'packages/ui/src/music.ts (isMusicWanted, syncMusic, the phase machine); packages/ui/src/Game.tsx (the store subscription); packages/ui/src/EscMenu.tsx (the Music slider + mute); packages/ui/src/sfx.ts audioContext (the routing seam)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-23. Before this there was no background music; the combat replay played a synth '
      + 'win / lose chime at its end (useCombatReplay.ts, sfx.win / sfx.lose), both now deleted.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/music.test.ts', 'packages/ui/src/verdictChimesRemoved.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-PRESENT-07',
    title: 'The announcer speaks each game moment at most once per run (a few named exceptions), never back to back, never the same take twice in a game, through a priority queue with a 12 s cooldown and a per-event chance table; its own audio channel sits behind the Settings Audio panel',
    statement:
      'The announcer (announcer.ts) is a set of one-shot voice lines on game moments, spoken ONLY inside a lobby or '
      + 'Practice run on screen (the music gate: never the title, a tutorial, a sandbox rig or a replay). Each event '
      + 'speaks at most ONCE per run, recorded in the store\x27s `announced` slice, which is persisted with the '
      + 'autosave and keyed by the run seed, so a Save & Continue never replays a line and a new run starts fresh; '
      + 'BackToShop and Triple may speak twice, at least ANNOUNCER_REPEAT_GAP_WAVES (5) waves apart, and Knockout twice, '
      + 'at least ANNOUNCER_KNOCKOUT_GAP_WAVES (1) apart; the four generic random buy lines up to ANNOUNCER_RANDOM_BUY_MAX (3) '
      + 'times, ANNOUNCER_RANDOM_BUY_GAP_WAVES (2) apart; TimeRunningOut every Shop turn. THE NO-REPEAT BAG (2026-09-25): '
      + 'a take never plays twice in a game; the pick is random among the takes NOT yet heard (the slice\x27s `heard`, '
      + 'persisted with `fired`, so a Save & Continue keeps it); an event whose every take is heard goes SILENT for the '
      + 'rest of the game, except REUSABLE_BAG_EVENTS (the four random buys and TimeRunningOut), which reshuffle. '
      + 'THE CHANCE TABLE (`ANNOUNCER_CHANCE`, announcerConfig.ts, a Chance dial per event in the Announcer tuner): '
      + 'below 1 an event\x27s moment rolls the seeded `announcerRoll`; the random buy lines 6%, Round7 10%, all else 1. '
      + 'SPECIALTY lines (BuyDrakko, BuySylus, CastAle) speak the first time the thing happens in a game and, when '
      + 'dropped, try again next time, at most as many tries as they have takes. Which take plays is a fresh RANDOM pick every time (`announcerPick`, owner 2026-09-25: no seeds; '
      + 'which hashes the event\x27s index in ANNOUNCER_LINES, so the table is append-only). The RARE lines (the four random '
      + 'buy lines, Round7) roll a seeded chance (6% / 10%, the chance table) per qualifying moment from the run seed, the wave and '
      + 'the buy index (`announcerRoll`), so a replay rolls the same way; never Math.random. One global cooldown, ANNOUNCER_COOLDOWN_MS (12 s from the previous '
      + 'line ending), and never while a line plays: an event landing inside it is DROPPED, not queued, and stays '
      + 'unfired (it may speak later if its moment recurs and is still valid); the two forge lines, this round\x27s '
      + 'SurviveUnder10hp and TimeRunningOut BYPASS the cooldown (never a playing line: they wait for it to end). Pending events are weighed together by '
      + 'priority (GameWon = GameLoss 100 > TopTwo 90 > Knockout 88 > TopFour 85 > SurviveUnder10hp 80 > LosingLowOdds = '
      + 'WinningLowOdds 70 > ComebackWin 66 > ThreeWinStreak 65 > StartCombatUnder10hp 60 > FlawlessVictory 58 > BigHit 57 > '
      + 'EnteringCombatAfterLoss 55 > MinionHits100Stats 50 > GoldenArmy 48 > ShopBigBuff 46 > TierSix 45 > EpicRuneforge 40 > '
      + 'BuyDrakko = BuySylus 36 > Runeforge 35 > Triple 30 > TribeFour 28 > Equipment 25 > BigSpender 24 > RichTurn 22 > EnteringCombat 20 > Pair 18 > '
      + 'CastAle 16 > GameStart 15 > Round7 14 > the four random buy lines 12 > BackToShop 10 > TimeRunningOut 5): the highest speaks, '
      + 'the rest are dropped. Shelf life: combat lines expire when the next shop opens, shop lines when combat starts, '
      + 'GameWon / GameLoss never expire (they wait out the cooldown). Silence: nothing in the first '
      + 'ANNOUNCER_COMBAT_SILENCE_MS (3 s) of a combat resolution; nothing over the music\x27s turn-1 fade-in (GameStart '
      + 'plays ANNOUNCER_GAME_START_DELAY_MS, 4 s, after the first shop); a Skip (`stopAllAudio`) or leaving the run '
      + 'cancels the queue and the playing line with an ANNOUNCER_STOP_FADE_MS (100 ms) fade. No per-game '
      + 'line cap (removed 2026-09-25; it was 8, then 15): the cooldown, once-per-event rule, priority and shelf life pace it. Timing: the Face Omen lines play '
      + 'ANNOUNCER_FACE_OMEN_DELAY_MS (1.6 s) after the flip; the return lines (BackToShop, TopFour / TopTwo, a forge '
      + 'opening with the return) ANNOUNCER_BACK_TO_SHOP_DELAY_MS (1 s) after resolveCombat. Triggers: GameStart (wave 1\x27s '
      + 'first shop), BackToShop (a return from combat, twice per game at most, first no earlier than wave 2), '
      + 'Equipment (an Equipment acquired, 400 ms after its SFX), Triple (a gilded minion formed), TierSix (tier 6), '
      + 'Runeforge / EpicRuneforge (the offer opening; the scheduled forges open INSIDE the resolveCombat step that '
      + 'returns the run to the shop, so the return update is checked too), EnteringCombat (the first Face Omen, still eligible through '
      + 'wave 3), EnteringCombatAfterLoss (a Face Omen after two consecutive losses), StartCombatUnder10hp (Resolve '
      + 'at or below 10 going in, Armor not counted), SurviveUnder10hp (surviving such a fight; it also plays right '
      + 'after this round\x27s StartCombatUnder10hp, as the round\x27s only line), LosingLowOddsFight (a loss at 65%+ win '
      + 'odds from the rail\x27s real probe, skipped when absent), WinningLowOddsFight (a win at 35% or less), '
      + 'ThreeWinStreak (the third consecutive win), MinionHits100Stats (a player minion at 100+ Attack or Health, in '
      + 'the shop or the fight, never the enemy side), TopFour / TopTwo (four / two seats standing when the rail shows '
      + 'it, the player among them), GameWon (1st place) and GameLoss (2nd to 8th) 1 s into the end screen. The second '
      + 'batch (2026-09-24): Knockout (the return update: this round\x27s encounter where seat 0 dealt damage and its foe '
      + 'went from standing to out; the table settles on resolveCombat, so the line lands with the rail\x27s elimination, '
      + 'shop shelf, 1 s), BigHit (a verdict win whose enemyDamage, capped by lossDamageCap for the wave, is 15+), '
      + 'ComebackWin (a verdict win right after 3+ losses in a row; a draw breaks the run), FlawlessVictory (a verdict win '
      + 'from wave 5 with lastCombat.playerDeaths exactly 0), GoldenArmy (3+ gilded minions on the board, the hand not '
      + 'counted), RichTurn (a return to the shop with 20+ Gold), BigSpender (20+ Gold spent this turn with 10+ still held), '
      + 'ShopBigBuff (a Shop minion offer over 50 Attack by offerBuyStats), Pair (the first two copies of one non-golden '
      + 'minion across board and hand), TribeFour (4 minions of one tribe bought in one Shop turn, a dual-tribe minion '
      + 'counting for both, an All-tribe one for every tribe), RandomSpellBuy / RandomCardBuy / RandomBeastBuy / '
      + 'RandomDwarfBuy (a 6% seeded roll on a spell / any / a Beast / a Dwarf buy, up to 3 per game) and Round7 (a 10% '
      + 'seeded roll when wave 7\x27s Shop opens). The third batch (2026-09-25): EnteringCombat has 7 takes, RandomCardBuy 8, '
      + 'TimeRunningOut (every Shop turn whose clock, a real timer only, ticks down to ANNOUNCER_TIME_WARNING_SECONDS, '
      + '15 s; Recruit\x27s countdown calls observeTurnClock on every tick; shop shelf, so End Turn expires it; bypasses the '
      + 'cooldown but waits out a playing line, and is dropped if the clock reaches 0 first), BuyDrakko (the Shop minion '
      + 'named Drakko, id `drummer`, bought; the hero Drakko is never bought), BuySylus (the Shop minion Sylus bought; '
      + 'Rune of Sylus granting one is not a buy) and CastAle (an Ale, ALE_IDS, cast from hand: spellsCast rises while '
      + 'an Ale leaves the hand). The '
      + 'announcer is its own channel: a third gain on the SFX AudioContext with its own volume and mute '
      + '(`ascent.announcervol.v2`, see R-PRESENT-13; `ascent.announcermuted`), not ducked by the Game-sounds mute; the clips '
      + 'load lazily on first need. Settings shows one "Audio" button (aria-expanded, collapsed by default, its state '
      + 'remembered) that expands three channel rows, Game sounds / Music / Announcer, each a slider and a mute.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Claude Code session, 2026-09-23 (the announcer)',
        quote: 'i added announcer sfx here: C:\\Game Assets\\Ascent Art\\SFX\\Announcer \u2014 can you look at them? I named them for when they should trigger. they shouldn\x27t trigger more than once per game, though. and they shouldn\x27t trigger back to back for things like equipment or triples etc.',
      },
      {
        kind: 'owner-chat',
        ref: 'Claude Code session, 2026-09-23 (the announcer)',
        quote: 'with this we\x27ll need an announcer toggle and audio channel as well, similar to music. i think it\x27s best we put an "audio" button in the settings window that expands/collapses these 3 channels with mute toggles for each.',
      },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-23 (the announcer, on the queue logic)', quote: 'i like your logic you\x27ve shared here' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-24 (announcer lines, second batch)', quote: 'the gamewon is correct. there was a toptwo2 that was wrong which i removed.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-24 (announcer lines, second batch: the random buy lines)', quote: 'Rare: ~10% per buy' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-25 (announcer, third batch: the timer)', quote: 'the running out of time can play everytime theres 15 seconds left' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-25 (announcer, third batch: the no-repeat rule)', quote: 'we have a global rule to never repeat lines except maybe the generic random buys sometimes?' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-25 (announcer, third batch: the chance table)', quote: 'we need to have low-ish chances to proc the on-buy style ones except for specialty targeted ones, like drakko/sylus etc.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-25 (announcer lines, third batch: Entering Combat takes + Low on time)', quote: 'wire new announcer sfx C:\\Game Assets\\Ascent Art\\SFX\\Announcer' },
      {
        kind: 'owner-chat',
        ref: 'Claude Code session, 2026-09-23 (the announcer follow-up: the forge lines + the delays)',
        quote: 'i dont think the runeforge voicelines are playing? and can you slightly delay the combat and return to shop ones? they play too quickly and should be offset by about 1s.',
      },
      { kind: 'code', ref: 'packages/ui/src/announcer.ts (the queue, the detectors, the channel); packages/ui/src/announcerSlice.ts (the persisted slice); packages/ui/src/store.ts (announced, markAnnounced, combatOdds, the save round-trip); packages/ui/src/Game.tsx (the subscription + the stopAllAudio hook); packages/ui/src/Recruit.tsx (observeCombatBoard, observeTurnClock); packages/ui/src/EscMenu.tsx (the Audio panel)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-24 (the second batch of lines, see the end). Owner report after #1653: "i dont think the runeforge '
      + 'voicelines are playing? and can you slightly delay the combat and return to shop ones? they play too quickly '
      + 'and should be offset by about 1s." Root cause: the scheduled forges (turn 6 Basic / turn 9 Epic, a hero\x27s '
      + 'turn 5 / 8, a booked Clock forge) set runeforgeOffer inside the same reducer step as the combat -> recruit '
      + 'flip (resolveCombat -> advanceCombat -> openNextStartOfTurnModal), and the return branch of syncAnnouncer '
      + 'returned before the forge check ran, so the line was never detected. Fixed: detectForge runs on the return '
      + 'update too, and the forge lines bypass the cooldown (never a playing line). ANNOUNCER_FACE_OMEN_DELAY_MS 600 '
      + '-> 1600 ms; ANNOUNCER_BACK_TO_SHOP_DELAY_MS 1000 ms added (BackToShop, TopFour / TopTwo, a forge opening with '
      + 'the return); ANNOUNCER_COMBAT_SILENCE_MS stays 3000 ms and applies to the lines detected during the fight, not '
      + 'the Face Omen lines. Before this there was no announcer and the Settings Audio section was two flat '
      + 'rows (Game sounds, Music). 2026-09-24 (second batch): fifteen new events wired, ThreeWinStreak gained a second '
      + 'variant, the cap went 8 -> 15, and the TopTwo2 clip was removed (the owner: it was the wrong take; GameWon.mp3 was '
      + 'correct all along), so TopTwo has one variant. 2026-09-25 (third batch): five new EnteringCombat takes '
      + '(entering-combat-3..7), seven RandomCardBuy takes (random-card-buy-2..8), the new TimeRunningOut (21 takes, every '
      + 'turn at 15 s), BuyDrakko (5), BuySylus (4) and CastAle (6) events, the no-repeat bag, the chance table (the random '
      + 'buys 10% -> 6%, up to 3 per game) and the tuner\x27s Chance dial; the test suite checks every clip exists and no '
      + 'two share audio.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/announcer.test.ts', 'packages/ui/src/escMenuAudioPanel.test.tsx'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  {
    id: 'R-PRESENT-08',
    title: 'In combat the minions and the striking heroes paint OVER the hero cluster; its popovers still open over the board',
    statement:
      'During a combat replay every unit on either board (idle, dying, attacking / lunging, struck, poisoned, reborn), '
      + 'the Pixi FX canvas and the damage floats paint ABOVE the bottom-left hero cluster: the hero portrait, the '
      + 'hero-power diamond with its counter and name pill, the equipment slot, the rune nodes. A minion wound up or '
      + 'lunging over that corner is never drawn behind it. The cluster still paints above the plain board art and '
      + 'the under-card FX canvas, still receives the pointer over its own diamonds, and its popovers keep opening '
      + 'over the board: while a hero-power or equipment diamond or a rune node is hovered (or the run-buffs pop-out '
      + 'is open) the whole cluster lifts above every unit, still below the foe portrait and the FX canvas. The '
      + 'hero-duel lift (the striking side at z100) keeps winning over both. Mechanism: `.app.combat` dissolves the '
      + 'app\x27s stacking context (z-index auto, the move `body.modalup` and the hand-hover rule already make), the '
      + 'bar drops to z0 in combat (`:where(body:has(.app.combat)) .statusbar`) and the idle unit rises to z1 '
      + '(`:where(.app.combat) .unit`, dying z2), with every attacking / struck / reborn value and the lunge\x27s '
      + 'inline z12 untouched so the defender still sorts over the attacker in the one root context. The bar must '
      + 'never go NEGATIVE (a z-1 bar sits under `.app`\x27s transparent box and loses the pointer over the diamond), '
      + 'and `.app` must never be RAISED instead (`.boardbg` is its child and would cover the cluster). The shop '
      + 'order (bar z40 over `.app` z1) is unchanged.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Claude Code session, 2026-09-23 (hero cluster z-order)',
        quote: 'can you fix the z axis of the hero power art etc? it is on top of minions and heroes so when they attack they are behind it.',
      },
      { kind: 'code', ref: 'packages/ui/src/styles.css (the COMBAT Z-ORDER LADDER comment at `.app.combat`; the `:where(body:has(.app.combat)) .statusbar` rules; the DUEL Z-ORDER block); packages/ui/src/choreo/channels/lunge.ts (the inline zIndex 12)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-23. Before the fix `.statusbar` (a #root sibling at z40) painted over the whole '
      + '`.app` (z1) in every phase, so a minion lunging out of the leftmost slot, or wound up over the power diamond, '
      + 'was drawn behind the portrait / diamond / equipment slot / rune nodes; a frozen wind-up of the leftmost '
      + 'minion showed its attack badge hidden under the "1/3 Lucky Seat" diamond. Verified live on port 5255: the '
      + 'same frozen frame with the fix shows the card over the diamond; hovering the diamond lifts the bar to z41 '
      + 'and its tooltip (and a rune node\x27s tooltip) renders over the card.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/combatZOrder.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-PRESENT-09',
    title: 'One store per tab: the game store is never hot-swapped, and the Scene Builder panel writes the store the board reads',
    statement:
      'The Zustand game store (`useGame`) is an app-root singleton: a browser tab holds exactly ONE instance, and '
      + 'every surface (the board, the Gold pill, the status bar, the Scene Builder panel, the announcer and music '
      + 'subscriptions) reads and writes that same instance. In the dev server a Vite HMR update that would '
      + 're-evaluate `packages/ui/src/store.ts` (the file itself edited, or any module under it: `@game/sim`, the '
      + 'announcer slice, the profile) is accepted by reloading the page (`import.meta.hot.accept(() => '
      + 'window.location.reload())`), never patched in place: a re-evaluation runs `create()` again and mints a '
      + 'second store, and whichever modules the patch did not re-execute keep the first. The rule is absent in the '
      + 'player build (no `import.meta.hot`). Consequence for the rig: under GOD rules the Scene Builder opens on '
      + '999 Gold and the panel tops it back up whenever it dips; a Library click puts that card in the shop row; '
      + '"+ enemy" pins one more minion onto the enemy row for this wave (`servedBoards[wave]`, `sandboxFoeWave`). '
      + 'A panel control whose write does not show on the board is a defect, and the first thing to check is '
      + 'whether the tab holds two stores (`window.useGame !== the store a component holds`).',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Claude Code session, 2026-09-23 (Scene Builder regression)',
        quote: 'the scene builder is broken for me for some reason. can you please fix this? i dont have infinite money in god mode and cannot add cards to the shop',
      },
      { kind: 'code', ref: 'packages/ui/src/store.ts (the `import.meta.hot` guard after the DEV `window.useGame` handle); packages/ui/src/SceneBuilder.tsx (`mutate`, the refill, `addToShop`, `addEnemyFromPanel`); packages/ui/src/Game.tsx (the panel mounts on `run.sandbox`)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-23. Before the guard, `store.ts` had no HMR handling at all, so a merge that touched '
      + 'the store or anything under it while a tab was open was patched in place: the owner\x27s tab (a dev server '
      + 'up since fd8ee7d18, with #1644 and #1653 both touching store.ts merged under it) ended with the Scene '
      + 'Builder panel bound to the old store (\x22round 1 · 8 left · GOD\x22, 999 Gold, every Library '
      + 'click landing there) and the board + Gold pill bound to the new one (the saved run, 4 Gold). Reproduced on '
      + '2026-09-23 on port 5263 by touching store.ts with the sandbox open (`window.useGame` changed identity; the '
      + 'old store still held the sandbox) and by touching announcerSlice.ts (the HMR batch re-executed Game, EscMenu, '
      + 'Recruit and store.ts but not SceneBuilder.tsx). With the guard both touches reload the page '
      + '(`performance.getEntriesByType(\x27navigation\x27)[0].type === \x27reload\x27`). A page reload was always '
      + 'the manual workaround; the guard makes it automatic.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/sceneBuilderPanel.test.tsx', 'packages/ui/src/sceneBuilderLaunch.test.ts'],
      lastVerifiedAt: '2026-09-23',
    },
  },
  {
    id: 'R-PRESENT-10',
    title: 'The cast preview: a spell cast by a rune or a minion shows its card above the caster for a moment',
    statement:
      'Whenever a spell is CAST BY A RUNE or BY A MINION (never by the player from hand or shop), the game floats '
      + 'that spell\x27s card preview above its caster: above the rune\x27s node on the rune rail for a rune-cast, above '
      + 'the minion\x27s card for a minion-cast (Rune of the Gilded Ledger\x27s random stat spell, Rune of the Spell '
      + 'Market\x27s Staff of Guel, Rope Wrangler\x27s Lasso, a Gemstorm Instigator\x27s Rubies, a Mirrorwing re-cast, an '
      + 'End-of-Turn cast). NOTE 2026-09-24: ONLY THE RUNE CASE IS ON for now; minion casts (shop, End of Turn and '
      + 'combat) are gated off by `CAST_PREVIEW_SOURCES` (owner: hide/disable the combat/minion side), with their code '
      + 'kept wired so re-enabling is one line. It is the plated card the hover reveal shows, with its live text, at '
      + 'the owner-baked size (0.6 of the full plated card, 32 px higher than flush above its source); it fades in '
      + '(150 ms), lingers (500 ms), then fades out (190 ms). Size, side of the source, X/Y offset, fade-in, linger, '
      + 'fade-out and max opacity are '
      + 'owner-tunable per context (shop / combat) on the DEV Cast Preview tuner, which also carries the combat '
      + 'once-per-fight switch and a Preview test button (the combat knobs are hidden while combat is gated off); '
      + 'prod ships the baked defaults. In the shop '
      + 'every cast previews; a second cast from the SAME source while its preview is still up REPLACES it (the card '
      + 'swaps, a small xN count appears, the linger restarts) and casts from different sources sit side by side, '
      + 'nudged apart rather than overlapping. IN COMBAT a source that casts the SAME spell repeatedly previews it '
      + 'only on its FIRST cast of that spell in that fight (Fatecarver, Warflame); a different spell from the same '
      + 'source previews once too; the memory resets at the start of every combat and on a replay seek. The player\x27s '
      + 'own cast and an Equipment\x27s cast show no preview. Presentation only: the sim records the cast on a per-action '
      + 'channel (`RunState.castFx`, stamped in `applyCastEffects` off the recruit cast-actor stack) and emits a '
      + '`spellResolved` consequence under a capturing collector; nothing in gameplay reads either. The layer is fixed '
      + 'and input-transparent, animates opacity/transform only, and reads layout once per preview.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Owner balance list, 2026-09-23 (Rune of the Gilded Ledger)',
        quote: 'please have a copy of the spell that gets cast pop up above the rune when it is cast. use a hover preview and let it linger for about 2 seconds. have it fade in/out like a preview',
      },
      {
        kind: 'owner-chat',
        ref: 'Owner balance list, 2026-09-23 (Rune of the Spell Market)',
        quote: 'when this happens, show Staff of Guel with the same preview style we talked about. this should become the norm, when a spell or something is cast or triggered from runes and minions.',
      },
      {
        kind: 'owner-chat',
        ref: 'Owner detail, 2026-09-23 (combat)',
        quote: 'for the preview -> for card like fatecarver or warflame that casts the same spell every time, it should only do the quick pop one time in combat.',
      },
      {
        kind: 'owner-chat',
        ref: 'Owner feedback, 2026-09-23 (cast preview follow-up, with screenshots)',
        quote: 'this is far too large. can you build a tuner for me to adjust size, positioning, and linger duration? also, why does fate carver not show the growth preview? warflame does. it is also massive. make sure to add all of the details to the tuner so i can tune both. add an alpha/opacity lever as well.',
      },
      {
        kind: 'owner-chat',
        ref: 'Owner follow-up on PR #1671, 2026-09-24',
        quote: 'use the values below for the rune triggering one, but let\x27s hide/disable the combat/minion side for now, because it isn\x27t what i want right now.',
      },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts (`castActorStack`, `withCastActor`, the RECRUIT_FACTORIES wrap, the record at the top of `applyCastEffects`, `EotStepFx.casts`); packages/sim/src/state.ts (`CastFx`, `recordCastFx`, `castFx`/`castFxSeq`); packages/ui/src/castPreview.ts (the store, `placeCastPreview`); packages/ui/src/CastPreviewLayer.tsx; packages/ui/src/choreo/channels/castPreview.ts (`spellCastsIn`, `CastPreviewMemory`); packages/ui/src/choreo/score.ts (the `castPreviewFx` cue); packages/ui/src/useCombatReplay.ts (`onSpellCastPreviews`); packages/ui/src/choreographer/consequencePresenters.ts (`spellResolved`); packages/ui/src/styles.css (`.castprev`); packages/ui/src/castPreviewConfig.ts (the tuner\x27s one config accessor: `castPreviewLook`, `castPreviewTimings`, `castPreviewCombatOncePerFight`); packages/ui/src/CastPreviewTuner.tsx (the panel + Preview test); packages/core/src/effects/factories.ts (the combat `castRepeat` verb now logs the `sc` + `spellId` announcement from the caster; `castTribeAttackSpell` stamps `spellId`)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-23. Verified live on port 5267: a Rune of the Gilded Ledger paying out floats the cast '
      + 'spell above its rune node; a Rope Wrangler\x27s End-of-Turn Lasso floats above the Wrangler; sampled computed '
      + 'opacity climbs through the fade-in, holds at 1 for the linger and falls through the fade-out; the rune rail '
      + 'and the warband row rects are identical before and after the preview (no layout shift). Equipment casts '
      + 'deliberately record nothing (an open question for the owner; see the devlog). FOLLOW-UP 2026-09-24: the '
      + 'preview is smaller by default and fully tunable (Cast Preview tuner, shop + combat knob groups, live). '
      + 'Fatecarver previewed nothing in combat because its Growth cast through the arena\x27s `castRepeat` verb, whose '
      + 'combat half ignored the spell id and logged no "X casts Y" `sc` event, so the preview scan had nothing to '
      + 'find (Warflame / Flamebeat cast through `castNamedSpellInCombat`, which always logged it). The verb now logs '
      + 'one announcement per cast from the CASTER, so Fatecarver, Taragosa and Hoardbreaker (Growth), Watcher and '
      + 'Wick Mortis (Lantern of Souls) and Ashen Broodlord (Staff of Guel) preview once per fight above themselves; '
      + 'Anubis\x27s Echo Lantern line now carries its spell id. The combat memory is claimed only once the caster has '
      + 'an on-screen rect. GATED 2026-09-24 (owner follow-up on PR #1671): the owner-tuned values are baked as the '
      + 'defaults (rune/shop: 0.6 size, above, offset 0 / -32 px, 150 / 500 / 190 ms, opacity 1; the combat set is '
      + 'baked too for when it returns) and `CAST_PREVIEW_SOURCES = { rune: true, minion: false, combat: false }` '
      + 'turns the minion and combat previews off: `fireCastPreviewAt` is a no-op for a minion source, '
      + '`showCombatCastPreviews` (the combat feeder) returns without showing or claiming, and the tuner shows only '
      + 'the "Rune casts" group. The engine fix stays: combat casts still log their `sc` + `spellId` events (the '
      + 'Combat Log names them), they simply preview nothing while the gate is off.',
    enforcement: {
      kind: 'scenario',
      refs: [
        'packages/sim/src/castFx.test.ts',
        'packages/ui/src/castPreview.test.ts',
        'packages/ui/src/CastPreviewLayer.test.tsx',
        'packages/ui/src/choreo/channels/castPreview.test.ts',
        'packages/ui/src/castPreviewConfig.test.ts',
        'packages/core/src/combat/combatCastAnnounce.test.ts',
        'packages/ui/src/castPreviewGate.test.ts',
      ],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-PHASE-01',
    title: 'Effects, mechanics and FX work in every phase and from every source by default',
    statement:
      'An effect, mechanic, trigger, tally or FX is wired to work in EVERY phase it can occur in (recruit / Shop, End '
      + 'of Turn, combat) and from EVERY source (the player, a rune, a minion, a hero, a quest) by default. A '
      + 'phase-limited or source-limited behaviour needs an explicit owner ruling; when unsure, ask the owner. '
      + 'Concretely for FX: a spell\x27s own cast effect (its card-level `spellCast` row in bindings.json: Growth '
      + '-> `growth-effect`, Waking Rift (`sparkplug`) -> `waking-rift-fx`) plays on EVERY cast of that spell: the player\x27s cast from hand, a rune\x27s or a '
      + 'minion\x27s cast in the Shop, an End-of-Turn cast, and a combat cast (Fatecarver, Taragosa, Hoardbreaker '
      + 'Drake, Sporebat). Every combat cast announces itself (`sc` + `spellId`) and stamps its buffs with `spellId` '
      + '(`withCastingSpell` at `resolveCombatSpellCast` and the arena\x27s `castRepeat`), and every Shop / End-of-Turn '
      + 'cast by a rune or minion is recorded on `castFx` (`recordActorCast`, shared by `applyCastEffects` and the '
      + 'arena\x27s `castRepeat`), so a per-spell effect binds to the SPELL in every phase. PRESENTATION (owner ruling '
      + '2026-09-24): when a CARD casts a spell that has its own cast effect (Fatecarver, Taragosa, Hoardbreaker, a '
      + 'Mage-Pup, Sporebat), that effect REPLACES the generic buff tendril / descend for the buffs that cast produced, '
      + 'in every phase: the stat change and number still land, only the travelling ribbon is dropped. One predicate '
      + '(`castFxReplacesTendril`) reads the sim\x27s spell tag on the buff (combat `buff.spellId`, the shop '
      + '`BuffFxEvent.spellId`, End of Turn `statsChanged.spellId`); a spell with no cast effect keeps its tendril. '
      + 'A RUNE is a caster like a card (owner ruling 2026-09-24): a spell a rune casts (Gilded Ledger, Spell Market\x27s '
      + 'Staff of Guel, Recurrence, Lassoing, Might, Spellhide\x27s Start-of-Combat re-cast) plays its own effect and '
      + 'its buffs carry the spell tag AND the rune (`BuffFxEvent.sourceRuneId`, `statsChanged.castByRune`, combat '
      + '`sc.rune`), so a bound effect replaces the tendril exactly as for a card, and anything that needs a source '
      + 'position stems from the rune\x27s node on the rune rail (player side; an enemy rune is not on screen). A '
      + 'per-buff row (an Ale, Dragonflame) plays per buff from the node; an unbound spell draws the stock trail from '
      + 'the node. SOUND (owner 2026-09-24): a spell\x27s cast effect rings ONCE per burst: a second play of the same '
      + 'def within `spellCastSfxGapMs` (Buff tuner, default 120 ms, the Undead Aura rule) plays its visuals with its '
      + 'Sound layers dropped, in every phase and from every source. REPEAT RUNES ARE RUNE CASTS (owner 2026-09-24): '
      + 'a rune that repeats or multiplies a cast (Shared Pour, Astral Draft, Distillation, Shared Reflection, and the '
      + '"they cast twice" / "an additional time" runes Hoardflame, Dragon Breath, the Bottomless Cask) runs its extra '
      + 'resolutions with THAT RUNE as the cast actor (`runeExtraCasts` + `castWithRuneRepeats`, and the Distillation / '
      + 'Shared Reflection echoes under `withCastActor`), so they take the rune-cast path above; the player\x27s own '
      + 'resolution keeps the player\x27s visuals, and gameplay is unchanged. THE RUNE CAST FLOURISH (owner 2026-09-24): '
      + 'EVERY rune cast, in every phase, first flourishes on the rune\x27s node: a transform-only badge pulse and the '
      + '`rune-cast-flourish` glyph flash; a spell whose own effect plays once gets a `rune-cast-mote` from the node to '
      + 'where it lands, and the effect waits for the mote; a spell whose visuals already travel from the node releases '
      + 'them a short lead after the flash. Knobs: the Cast Preview tuner\x27s "Rune cast flourish" group (off = the '
      + 'pre-flourish look exactly). EVERY BUFF A CAST PRODUCES CARRIES THE CAST (owner 2026-09-24): a cast factory that '
      + 'opens its own nested buff capture (Dragonflame per repeat, Great Pot per type, the targeted Gifts) captures '
      + 'through `captureCastBuffFx`, so its records keep the spell, the rune (`sourceRuneId`) and the casting minion '
      + '(`castByUid`, End of Turn `statsChanged.castByUid`); a spell\x27s PER-BUFF row (Dragonflame\x27s column, an Ale\x27s '
      + 'or Great Pot\x27s volley) plays through ONE helper (`playCastFanOutBuffFx`) for every non-player caster in every '
      + 'phase: from the rune node, from the casting minion\x27s body, or on the minion when there is no source; it '
      + 'replaces the tendril / descend and keeps the 120 ms sound gap (the player\x27s own volley included).',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Owner ask, 2026-09-24 (Growth effect)',
        quote: 'i added a growth effect for whenever growth is cast, by any means. player,rune,minion etc and any phase. recruit, combat, end of turn whatever it may be. (this should be default by now anyways and if it isnt, please write into the oracle that our effects and mechanics should be wired to work across phases by default. always ask if unsure)',
      },
      {
        kind: 'owner-chat',
        ref: 'Owner ask, 2026-09-24 (Waking Rift effect, same PR)',
        quote: 'i added a waking rift effect',
      },
      {
        kind: 'owner-chat',
        ref: 'Owner ruling on PR #1672, 2026-09-24 (tendril)',
        quote: 'the growth and waking rift effects should replace the tendril for a card that carried those effects, like fatecarver as an example.',
      },
      {
        kind: 'owner-chat',
        ref: 'Owner ruling, 2026-09-24 (rune casts)',
        quote: 'spells cast from runes and cards should use the spell effects, like gilded ledger should show the animations we build for the spells when it is cast. they can stem from the rune if there needs to be a source position.',
      },
      {
        kind: 'owner-chat',
        ref: 'Owner ruling, 2026-09-24 (one sound per burst)',
        quote: 'make it so if 2 fatecarvers are down, or the effect is cast twice or something, that it only plays the sound effect one time. give it the same behavior as the undead aura sfx timing.',
      },
      {
        kind: 'owner-chat',
        ref: 'Owner ask, 2026-09-24 (repeat runes + the rune cast flourish)',
        quote: 'yeah the runes that repeat casts should use the rune-cast visual. can we do anything to add a bit of flair to this? like some sort of short flash/pixi effect/make it smoother and cleaner with a bit of a \x27magic\x27 element to it? nothing crazy. spin up a concept and open a server on the branch for me to play with.',
      },
      {
        kind: 'owner-chat',
        ref: 'Owner report, 2026-09-24 (spell FX from every source)',
        quote: 'dragonflame animation is not playing from the gilded ledger etc. why? all spell animations and sfx should be wired to play whenever a spell or minion is cast/played from any source. can you find the disconnect?',
      },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts (`castTagStack`, `captureCastBuffFx`, `captureBuffFx` castByUid); packages/ui/src/fx/spellCastFx.ts (`playCastFanOutBuffFx`); packages/ui/src/Recruit.tsx (`replayBuffFxEvents`, `castFanOutGain`); packages/ui/src/useCombatReplay.ts (`fireBuffCasts`); packages/ui/src/choreo/bindings.json (`greatpot`)' },
      { kind: 'code', ref: 'packages/sim/src/recruit.ts (`runeExtraCasts`, `castWithRuneRepeats`, the Shared Reflection spread); packages/sim/src/reducer.ts (the spell cast sites, the Distillation echo); packages/ui/src/fx/runeCastFlourish.ts; packages/ui/src/fx/defs/rune-cast-flourish.json + rune-cast-mote.json; packages/ui/src/fx/spellCastFx.ts (`playRuneSpellCastFx`); packages/ui/src/castPreviewConfig.ts (the `runeFlourish*` knobs)' },
      { kind: 'code', ref: 'packages/core/src/effects/factories.ts (`withCastingSpell`, `resolveCombatSpellCast`, the combat arena `castRepeat`); packages/sim/src/recruit.ts (`recordActorCast`, the shop arena `castRepeat`); packages/ui/src/fx/spellCastFx.ts (`playSpellCastFx`, `playRecordedCastFx`, `playCombatSpellCastFx`); packages/ui/src/choreo/bindings.ts (`spellCastFxFor`, `spellCastFanOutFor`); packages/ui/src/fx/spellCastFx.ts (`playRuneCastBuffFx`, `runeNodeCentre`, `spellCastSoundAllowed`); packages/ui/src/buffFxConfig.ts (`spellCastSfxGapMs`); packages/ui/src/choreo/score.ts (the `spellCastFx` cue); packages/ui/src/Recruit.tsx (the `castFxSeq` watcher, the `spellCast` presenter context, the legacy End-of-Turn beat); packages/core/src/effects/arena.ts (`ARENA_EFFECTS`, the shared cross-phase bodies)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-24 for spell cast FX (Growth and Waking Rift are the first spells bound). Combat casts through the arena\x27s '
      + '`castRepeat` (Fatecarver / Taragosa / Hoardbreaker\x27s Growth) previously logged no `sc` announcement and '
      + 'emitted untagged buffs, and a shop Rally\x27s inline "cast Growth" recorded no cast; both are fixed. Rune casts '
      + 'were untagged and their buffs drew nothing (sourceless); fixed 2026-09-24, and Rune of Spellhide\x27s '
      + 'Start-of-Combat re-cast now announces itself (`sc` + `rune`). Known remaining gaps: an Equipment\x27s cast '
      + 'deliberately records nothing (R-PRESENT-10). The repeat runes (Shared Pour, Astral Draft, Distillation, Shared '
      + 'Reflection, Hoardflame, Dragon Breath, the Bottomless Cask) rode the player\x27s cast path until 2026-09-24; '
      + 'at the player\x27s play sites they are rune casts now. Still on the old presentation: a MINION\x27s multiplied '
      + 'cast (its extras stay the minion\x27s), a Discover spell\x27s extra Discovers (no cast visual), and a Ruby echoed '
      + 'by Distillation / Redirection (the Ruby hop). Until 2026-09-24 a rune\x27s or a minion\x27s Dragonflame / Great Pot / '
      + 'targeted Gift went out UNTAGGED (the factory\x27s nested capture hid its targets from the tagged outer one), so a '
      + 'Gilded Ledger Dragonflame drew a generic descend with no sound, and a minion\x27s Ale / Dragonflame drew a descend '
      + 'in the Shop and nothing at End of Turn; fixed. Follow-up (owner answers relayed 2026-09-24, same PR): every '
      + 'rune / minion / combat cast rings the generic cast sound through one per-spell burst gate (`playGenericCastSound`, '
      + 'the player cast included); Golden / Reinforcing Ale (no buffs) play their row once at the source; a Lasso cast '
      + 'by any rune or minion leaves the real caster (`_origin` defaults to `rune:<id>` / `board:<uid>`); Staff of Guel '
      + 'plays its shop-wide effect on the authoritative End of Turn (`auraChanged` `shopBuff`); a minion arriving in the '
      + 'Shop or at End of Turn from any source gets the landing dust and the summon sound, the summon clips gated per '
      + 'clip; a standalone combat Dragonflame wave no longer plays its column twice. Known gameplay gap, report only: '
      + 'Rune of Lassoing does not pay for a Rope Wrangler Lasso (the Wrangler factory bypasses `castSpell()`). '
      + 'The mechanic half of the '
      + 'default is enforced by the Doc Bot `factoryPhase` lane (every trigger/factory pair implemented in every '
      + 'phase its trigger dispatches, or a registered excuse).',
    enforcement: {
      kind: 'scenario',
      refs: [
        'packages/ui/src/fx/spellCastFx.test.ts',
        'packages/sim/src/growthCastFx.test.ts',
        'packages/core/src/combat/growthCastTag.test.ts',
        'packages/sim/src/docbot/factoryPhase.test.ts',
        'packages/sim/src/effectArena.test.ts',
        'packages/sim/src/castFx.test.ts',
        'packages/ui/src/fx/runeCastFx.test.ts',
        'packages/sim/src/runeCastFx.test.ts',
        'packages/core/src/combat/runeCastSc.test.ts',
        'packages/sim/src/runeRepeatCastActor.test.ts',
        'packages/ui/src/fx/runeCastFlourish.test.ts',
        'packages/sim/src/spellFxEverySource.test.ts',
        'packages/ui/src/fx/spellFxEverySource.test.ts',
        'packages/ui/src/fx/spellFxEverySource2.test.ts',
        'packages/ui/src/fx/summonSfxGate.test.ts',
      ],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-PRESENT-11',
    title: 'The Discover overlay sits over the live board, and nothing shows a native browser tooltip',
    statement:
      'While a Discover (or any overlay on the shared `.discover-ov` chrome: Choose One, quest and hero-power offers, '
      + 'the scout reveal, commissions) is open, the player sees their REAL game behind the choices: the shop row, the '
      + 'warband, the hero, the hand and the lobby rail, dimmed by a translucent scrim. No opaque stand-in image of an '
      + 'empty board may replace it, and no per-frame blur may run over the live board (perf). No rendered element '
      + 'carries a native `title` tooltip (a `title` attribute on a DOM element, an SVG `<title>` child, or an '
      + 'imperative `el.title` / `setAttribute(\x27title\x27)`); screen readers get `aria-label` / `aria-description`, and '
      + 'hover text the player needs uses the game\x27s own bubble (`.gtip[data-tip]`).',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Owner report with screenshots, 2026-09-24 (Discover backdrop)',
        quote: 'why does the discover not have the actual live board',
      },
      {
        kind: 'owner-chat',
        ref: 'Owner report with screenshots, 2026-09-24 (native tooltips)',
        quote: 'also remove the window tooltips on these buttons (and every button they break immersion so badly)',
      },
      { kind: 'code', ref: 'packages/ui/src/styles.css (`.discover-ov`, `.gtip[data-tip]`); eslint.config.mjs (`banTitleTooltips`); packages/ui/src/useDraggablePanel.ts' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-24. Verified live on port 5279: with a Discover open the shop minions, warband, hero '
      + 'portrait, Health pill and lobby rail all show through the scrim; `document.querySelectorAll(\x27[title]\x27)` is 0 '
      + 'on the title screen, the shop, an open and a minimized Discover, the Esc menu, Career and the Ladder page.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/discoverBackdropNoTitle.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-PRESENT-12',
    title: 'An effect plays over its full area: no particle layer is clipped short of the viewport',
    statement:
      'Every authored effect renders its whole area and animation wherever it fires (shop, End of Turn, combat), '
      + 'whatever the board count, the screen size, or where the minion sits. A blurred or filtered particle layer '
      + 'may be bounded by the VIEWPORT (Pixi clips every filter to it, which is the performance bound) and by '
      + 'nothing smaller: not the board row, not the card, not a fixed guess at how far motes travel. The particle '
      + 'layer bounds (`PARTICLE_BOUNDS_HALF_EXTENT` in `particleLayerPool.ts`) must contain the whole viewport '
      + 'under any transform an effect applies to its layer (head pivot, drift, scale, spin), up to a 4K viewport.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Owner bug report with screenshot, 2026-09-24 (purple haze around a lone enemy minion sliced by a hard vertical edge)',
        quote: 'noticing effects gettin cut off in certain cases like this if a board isn\x27t full or something. these effects shouldnt be cut off by such restrictions and should play their full area/animation unless that somehow breaks something.',
      },
      { kind: 'code', ref: 'packages/ui/src/fx/particleLayerPool.ts (PARTICLE_BOUNDS_HALF_EXTENT, particleBounds)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-24. Before, every particle layer had a fixed +/-2000 px boundsArea, which Pixi used '
      + 'as the filter area, so on a 2560x1440 viewport a blurred layer was cut at x = 2000 (measured live: filter '
      + 'bounds -16..2016 before, -16..2576 after). On viewports up to 2000 px the filter area is unchanged (it was '
      + 'already clipped to the viewport).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/fx/particleLayerPool.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-PRESENT-13',
    title: 'Every Settings Audio slider defaults to 50, and 50 plays the owner mix; the Announcer dev tuner shapes each line',
    statement:
      'The three Settings Audio sliders (Game sounds, Music, Announcer) all DEFAULT to 50. A slider position is not the '
      + 'gain: `sliderToGain` (packages/ui/src/audio/volumeCurve.ts) maps it piecewise linearly per channel, 0..50 onto '
      + '0..ref and 50..100 onto ref..1, with ref = the owner\x27s 2026-09-23 mix (Game sounds 0.5, Music 0.2, Announcer '
      + '0.7). So 50 plays that mix, 100 plays full gain exactly as before, 0 is silent, and nothing exceeds the old '
      + 'maximum; Game sounds is the identity line. The curve runs at the one place each channel turns its slider into a '
      + 'gain (`level()` in music.ts / announcer.ts; the SFX master gain IS the Game-sounds slider). Saved values from '
      + 'before the curve are not read: Music and Announcer moved to `ascent.musicvol.v2` / `ascent.announcervol.v2`, and '
      + 'the saved Game-sounds master gain is dropped ONCE (`ascent.audiomix.v2` records it), leaving the mixing desk\x27s '
      + 'per-category levels and every mute as they were. A choice made after that persists. Every storage read is '
      + 'guarded, falling back to the defaults. The Announcer DEV tuner (announcerConfig.ts; prod ships its baked '
      + 'DEFAULTS) gives each event a Volume (0 to 200 percent, multiplied into that line\x27s gain, the final gain '
      + 'clamped at 1) and a Timing offset (-2000 to +3000 ms added to the event\x27s built-in delay, never earlier '
      + 'than the moment the event was detected). The offset only moves when a pending line becomes due: the cooldown '
      + 'still counts from when the previous line actually ended, and the cap and shelf life are unchanged.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Owner ask with a screenshot of the Settings Audio panel (Game sounds 50, Music 20, Announcer 70), 2026-09-24',
        quote: 'bake these audio values as the default volumes, but all at the 50 mark for volume.',
      },
      {
        kind: 'owner-chat',
        ref: 'Owner ask, 2026-09-24 (the Announcer tuner)',
        quote: 'add an announcer tuner to the dev panel that has volume for each event, and a timing adjust that allows me to offset timing of the event earlier or later',
      },
      { kind: 'code', ref: 'packages/ui/src/audio/volumeCurve.ts; packages/ui/src/music.ts, announcer.ts (`level()`); packages/ui/src/sfx.ts (`resetMasterOnce`); packages/ui/src/announcerConfig.ts' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-24. Before, each slider value WAS the gain, defaulting to Game sounds 0.5, Music 0.2 and '
      + 'Announcer 0.7, so the three sliders opened at 50 / 20 / 70.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/audio/volumeCurve.test.ts', 'packages/ui/src/audioDefaultMix.test.ts', 'packages/ui/src/announcer.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-PRESENT-14',
    title: 'A card only slides when its row changed: a spell cast never moves the warband',
    statement:
      'The warband and tavern cards slide (the commit FLIP) only when the rows themselves changed since the last '
      + 'commit: a card was sold, bought, summoned, removed or reordered. Casting a spell (Growth or any other) '
      + 'changes no row, so no card moves. A layout change with the same cards in the same order (a window '
      + 'resize, a docked panel) is not a move either: the next row change settles from the current layout '
      + 'instead of flinging the survivors in from the old one. The commit FLIP diffs through `commitFlipDeltas` '
      + '(`packages/ui/src/commitFlip.ts`), which returns nothing unless the row key changed.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Owner bug report, 2026-09-24',
        quote: 'when casting growth it randomly moves the warband, please fix that',
      },
      { kind: 'code', ref: 'packages/ui/src/commitFlip.ts (commitFlipDeltas); packages/ui/src/Recruit.tsx (RowFlip commit branch)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-24. Before, the FLIP key also carried the drag lift flag, so a spell dragged up and '
      + 'released re-ran the commit branch with no row change, and it diffed against a sweep of unbounded age: '
      + 'after any layout change the whole warband slid in from its old spot (measured live: all seven cards '
      + 'tweened in from 147..479 px right; a 300 px row shift gave a -99 px slide on all six). Fixed: 0 moved frames.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/commitFlip.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },

  // ── Rows glide, they never blink (owner ruling 2026-09-24, the gild rework) ──────────────────────────────
  {
    id: 'R-SLIDE-01',
    title: 'When a card leaves the warband or the shop, the cards that stay glide into their new slots',
    statement:
      'Whenever the warband or the shop re-lays-out because cards left it (bought, sold, played, eaten by a '
      + 'triple, taken by an effect), every card that stays GLIDES from where it stood to its new slot, the same '
      + 'slide a card makes when one is placed on the board from hand. This holds for BOTH rows in the same '
      + 'action: a buy that completes a triple slides the warband as well as the shop, and a played minion whose '
      + 'effect takes a card out of the shop slides the shop as well as the warband. A card never jumps to its '
      + 'new slot. (Which cards count as having moved at all is R-PRESENT-14: only a row change moves a card.)',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Gild rework session, 2026-09-24', quote: 'currently, when the cards are removed from the board and or shop, the units do not slide into their new spots, they immediate blink. i want the same sliding effect we have when putting a card on board from hand. this should go for both the shop and warband sliding' },
      { kind: 'fix-pr', ref: 'https://github.com/kcodea/ascent/pull/1689 (feat/gild-trail-fx)' },
      { kind: 'code', ref: 'packages/ui/src/rowSlides.ts commitSlidePlan (which row); packages/ui/src/commitFlip.ts commitFlipDeltas (how far, R-PRESENT-14); packages/ui/src/Recruit.tsx RowFlip slideFromSweep (the drop branch also slides the row it was not dragged in)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-24. A DROP commit (hand play, reorder, sell, buy) only animated the row it was '
      + 'dragged in, off a drop-time capture; any other row the same commit re-laid-out snapped. Reproduced live '
      + 'in a sandbox: dragging the third copy in to buy it gilded the two board copies, and the surviving '
      + 'warband cards moved 51px each with no slide; after the fix the moved survivor slides in from exactly its '
      + 'old slot (-103px on a 1280px viewport) and one that did not move does not slide. The mirror case (a hand '
      + 'play whose effect takes a card out of the SHOP) runs the same code with the rows swapped and is covered by '
      + 'the pin, but was not reproduced live. Merged with R-PRESENT-14 (landed on main the same day, on the same '
      + 'RowFlip branch): the deltas now come from `commitFlipDeltas`, so a drop whose rows did not change slides '
      + 'nothing, and the one resize listener that drops the sweep is R-PRESENT-14\x27s. The pin composes both: '
      + 'which row (this rule) over how far (that one). The GSAP tween itself needs real layout and was verified '
      + 'live, not in the test.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/rowSlides.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  // ── The combat <-> shop curtain covers every screen shape (owner bug 2026-09-24, ultrawide) ───────────
  {
    id: 'R-PRESENT-15',
    title: 'The combat and shop curtain covers the whole screen on every aspect ratio, and its glowing edge rides the seam out',
    statement:
      'The curtain that blooms out of the End Turn / End Combat gem between the shop and combat always grows '
      + 'until it covers the ENTIRE viewport, whatever its shape (16:9, 21:9, 32:9 or anything else), before the '
      + 'scene swaps underneath it. Its full size comes from the live viewport: the distance from the gem to the '
      + 'farthest corner. The glowing ring on its edge is sized from the same number, so it stays on the edge the '
      + 'whole way out and leaves past the farthest corner. It never stops short on the screen. A window resize '
      + 'during the wipe re-measures. The bloom is an ellipse stretched by how much wider than 16:9 the screen is '
      + '(a circle on 16:9 and narrower), so on 21:9 and 32:9 it reaches the sides together with the top and '
      + 'bottom, and by default it is still moving when it reaches full cover instead of crawling into the far '
      + 'corner. Its durations, easing, stretch and edge are dev-tunable (Screen wipe tuner) with baked defaults.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Bug report session, 2026-09-24 (21:9 screenshot of RETURNING TO SHOP)', quote: 'the screen wipes between combat/shop seem not built for 21:9 and stop/pause here and it\x27s janky. can you make sure the animation fully covers the ultrawide display as well?' },
      { kind: 'fix-pr', ref: 'https://github.com/kcodea/ascent/pull/1707 (fix/screen-wipe-ultrawide)' },
      { kind: 'owner-chat', ref: 'Follow-up after playing #1707 on the ultrawide, 2026-09-24', quote: 'the screen wipe still isnt perfect, can you make it smoother/wider/cleaner so that there\x27s no jank on an ultrawide?' },
      { kind: 'fix-pr', ref: 'fix/screen-wipe-polish' },
      { kind: 'code', ref: 'packages/ui/src/wipeGeometry.ts wipeAspect + wipeCoverEllipse + wipeOriginFor; packages/ui/src/screenWipeConfig.ts (WIPE_DEFAULTS, wipeCssVars); packages/ui/src/Recruit.tsx measureWipeOrigin; packages/ui/src/styles.css .wipecurtain / .wipefront' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-24. The curtain clip already used the farthest-corner radius, but the ring '
      + '(`.wipefront`, a 1000px texture scaled up) read `--wipe-front-scale`, which Recruit never set, so it '
      + 'always stopped at the 4.4 fallback, a ring about 2130px out. On 3440x1440 the cover radius is about '
      + '2650px, so the ring slowed to a halt around x=390 with the blue still travelling, which read as the wipe '
      + 'stalling (on 1920x1080 the same fixed ring instead ran well AHEAD of the blue). The scale is now '
      + 'r / 485, putting the ring\x27s bright line on the seam. The tell states also snap the zero circle to the '
      + 'freshly measured gem, so the bloom centre no longer slides from the old origin during the first half '
      + 'of the sweep. Verified live in headless Chrome at 1920x1080, 2560x1080, 3440x1440 and 5120x1440, '
      + 'both directions. Round 2 (same day): the circle became the aspect-stretched ellipse, with an ease that '
      + 'leaves the screen still moving (default cubic-bezier(0.45, 0, 0.7, 0.85)), and the ring became a '
      + 'double-layer edge (glow inside the seam, soft halo outside it). Verified again at all four sizes; the '
      + 'worst frame in any sweep stayed at or under 16.7ms at 3440x1440 and 5120x1440.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/wipeGeometry.test.ts', 'packages/ui/src/wipeMachine.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  // ── Nothing in the game paints over the combat <-> shop curtain (owner bug 2026-09-24, bleed-through) ─────
  {
    id: 'R-PRESENT-17',
    title: 'Nothing in the game shows through the combat and shop curtain, and the scene only swaps under full cover',
    statement:
      'While the curtain is up (from the gem\x27s charge-up until the reveal sweep ends), nothing in the game '
      + 'paints over it: no damage tally, flying number, damage float, card reference, cast preview or tooltip. '
      + 'Anything still animating when the wipe starts is swallowed by the bloom, and a float that belongs to '
      + 'the new screen (the lobby damage you dealt) waits until that screen is revealed. The board behind the '
      + 'curtain only swaps during the fully covered hold. Deliberate full-screen menus (Esc, hero select, dev '
      + 'tools) may still open above it.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Follow-up after playing #1707 on the ultrawide, 2026-09-24', quote: 'also sometimes background elements come through the wipe or it flickers, not sure what\x27s causing it' },
      { kind: 'fix-pr', ref: 'fix/screen-wipe-polish' },
      { kind: 'code', ref: 'packages/ui/src/wipeMachine.ts wipeUp + combatBackdropShown; packages/ui/src/Recruit.tsx (body.wipe-up); packages/ui/src/styles.css body.wipe-up rules; packages/ui/src/lobbyDamageFx.ts whenCurtainDown; packages/ui/src/LobbyPanel.tsx' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-24. Reproduced in real lobby play (headless Chrome at 3440x1440 and 5120x1440, '
      + 'with a scanner listing every visible element whose stacking context outranks the z250 curtain while it '
      + 'covers): (1) the loss-damage tally and its flying tier numbers (z2000/2001) kept animating when End '
      + 'Combat was clicked mid-tally, so they floated over the exit bloom; (2) the lobby damage float (z2000) '
      + 'fires when the round settles, and the round settles UNDER the curtain at full cover, so it popped onto '
      + 'the blue hold. Both show as elements coming through the wipe or flickering. Now `body.wipe-up` drops '
      + 'those floats to z240 under the curtain and hides the hover layers (card refs, cast previews, game '
      + 'tooltips), and the lobby float waits for the curtain to lift. Scanner after: 0 records across all four '
      + 'sizes and 5-round runs (before: 5 to 8 per run). The wipe FX canvas also renders its empty stage before '
      + 'hiding, so a cleared wipe can never flash stale motes on the next one.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/wipeMachine.test.ts', 'packages/ui/src/lobbyDamageFx.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  // ── The Good Luck intro's sounds end on a soft tail (owner 2026-09-24) ─────────────────────────────────
  {
    id: 'R-PRESENT-16',
    title: 'The Good Luck intro sounds fade out with a light reverb tail instead of stopping dead, and a skip fades them quickly',
    statement:
      'The two Good Luck intro sounds (the shine and the spark sparkle) each fade to silence over their last few '
      + 'hundred ms (tunable, 300 ms shine / 350 ms spark by default) and carry a subtle reverb tail (wet 0.2, '
      + '0.7 s) that rings on after the clip ends. The intro ending on its own never stops them, so the tails ring '
      + 'out over the live board. A skip (Esc, a click, a replay, leaving) fades whatever is still sounding in '
      + 'about 120 ms rather than cutting it. Every node of a play is disconnected once its tail (or the skip '
      + 'fade) is done, so plays never pile up.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Good Luck intro session, 2026-09-24', quote: 'the good luck sfx ends abruptly. can you give it a tiny bit of reverb and/or fade it out a bit so it isnt an abrupt end' },
      { kind: 'fix-pr', ref: 'fix/good-luck-sfx-tail' },
      { kind: 'code', ref: 'packages/ui/src/audio/tailFade.ts scheduleTailFade + scheduleSkipFade; packages/ui/src/sfx.ts playTailedSample + goodLuckShine / goodLuckSpark; packages/ui/src/goodLuck/goodLuckIntroConfig.ts goodLuckTail (the Sound tuner rows)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-24. The abrupt end was the SPARK: it plays a 1.1 s to 2.0 s window of the sparkle-whoosh '
      + 'clip, and at 2.0 s the sparkle is still about -23 dB (only ~10 dB under its -13 dB peak), so the hard '
      + 'window end cut it mid-ring. The shine clip decays to about -63 dB on its own and the intro\x27s natural end '
      + 'never stopped either sound. An offline render of the fixed spark voice now falls smoothly from the '
      + 'fade start through the reverb tail instead of dropping to silence in one 50 ms step.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/audio/tailFade.test.ts', 'packages/ui/src/goodLuck/GoodLuckIntro.test.tsx'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-PRESENT-18',
    title: 'A combat replay always reaches its end: a rewatch or a Skip of any fight, a zero-event fight included, finishes and hands back',
    statement:
      'Every combat replay reaches `done`, however it was started. That covers a fresh fight, the Fight Recap\x27s '
      + 'Watch replay (a seek to the first moment) and a Skip, and it holds for a fight with no events at all (an '
      + 'empty player board, where the enemy simply wins). Skip always ends the replay. A rewatch never changes '
      + 'the run: the settle and the damage strike happen once, whatever is rewatched. When a rewatch ends, played '
      + 'out or skipped, the player lands back on the Fight Recap they pressed it from, and End Combat still '
      + 'returns them to the shop.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Fight Recap follow-ups, 2026-09-24', quote: 'the watch replay gets me stuck in a screen here' },
      { kind: 'code', ref: 'packages/ui/src/useCombatReplay.ts (`endNonce` re-arms the final hold on seek + Skip); packages/ui/src/Recruit.tsx (`watchReplay` / `rewatchingRef`)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-24. Before the fix the final-hold timer that flips `done` only re-armed when '
      + '`replayComplete` changed from false to true. An empty player board resolves with zero events, so the replay '
      + 'has zero beats and `replayComplete` is true before and after a seek: Watch replay cleared `done` and nothing '
      + 'set it again, and Skip (setting the beat index to 0 again) did nothing. The arena sat on the enemy board '
      + 'with Skip showing. Verified live on port 5288: a zero-event loss rewatch returns to the recap in about 250 ms, '
      + 'Skip during a rewatch returns too, the run and seat health are unchanged, and End Combat settles the round once.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/replayRewatch.test.tsx'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  {
    id: 'R-PRESENT-19',
    title: 'A Discover (and a Choose One) floats its options in, and a card still in flight can never be picked',
    statement:
      'When a Discover or a Choose One opens, its option cards float in left to right with a soft stagger and a tiny '
      + 'settle (transform and opacity only), each one puffing golden dust and a few glints and getting one shimmer as '
      + 'it arrives. The Discover open cue plays with the overlay, once per Discover (each step of a chain such as Disco '
      + 'Dan\x27s included, never while the overlay is held behind the combat wipe or a pending shop death), with a '
      + 'whoosh, a gap-gated settle per card and one sparkle, all on soft tails. A card is pickable from the moment it '
      + 'arrives; a press during the entrance settles it at once and never picks a card still in flight (nor cancels a '
      + 'Choose One). Minimize then Return, a re-render or a remount never replays it (Return shows the overlay\x27s '
      + 'own quick fade). Reduced motion gets a plain fade with every card pickable at once.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Discover entrance session, 2026-09-25', quote: 'i want a brief but clean fly in or float in of the cards, with some dust and pixi to make it look clean/exciting but not over the top, with sound effects to match the vibe.' },
      { kind: 'fix-pr', ref: 'feat/discover-entrance' },
      { kind: 'code', ref: 'packages/ui/src/discoverEntrance/entrance.ts runEntrance; packages/ui/src/discoverEntrance/useOfferEntrance.ts useOfferEntrance + discoverOccasion; packages/ui/src/discoverEntrance/DiscoverDialog.tsx; packages/ui/src/discoverEntrance/discoverEntranceConfig.ts DCE_DEFAULTS' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-25. Before it the options simply popped in with the overlay and the open cue played from '
      + 'the store the moment the offer existed, even while the overlay was still held, and not at all for the second '
      + 'and third Discover of a chain.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/discoverEntrance/DiscoverDialog.test.tsx'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  {
    id: 'R-PRESENT-20',
    title: 'No FX particle outlives its play: an aux canvas clears the frame its last play leaves',
    statement:
      'The above-modal and under-card FX canvases only render while something is mounted on them, but a canvas '
      + 'keeps showing the last frame it presented. So the frame after the LAST container leaves a slot (any '
      + 'retire: a caller\'s cancel such as a Discover pick mid-entrance, a natural finish, the lifetime ceiling, '
      + 'a budget cull) must present ONE empty stage, clearing every particle that was still in the air, and only '
      + 'then idle. The unmount wakes the ticker so that clearing frame always happens. No star, dust puff or '
      + 'other particle from a retired play may stay painted on screen. This holds for every def on every slot, '
      + 'not per effect.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Owner bug report 2026-09-25 (two shop-board screenshots)',
        quote: 'bug - sometimes getting these stars lingering ... i think it\'s from discover',
      },
      { kind: 'code', ref: 'packages/ui/src/pixiFx.ts renderAbove / renderUnder (aboveShowing / underShowing), mountLayer disposers, staleSlots' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-25. Before the fix `renderAbove` / `renderUnder` returned early whenever their layer '
      + 'had no children, so the tick after the last play unmounted never drew: the canvas froze on the previous '
      + 'frame. Picking a Discover card while its cards were landing runs the entrance\'s `cancel`, which retires '
      + 'the in-flight `discover-glint` (cream stars) and `discover-arrive` (brown dust) plays at full alpha, and '
      + 'those particles then sat over the shop board until some later above-slot effect happened to render. A '
      + 'natural finish left the second-to-last frame the same way (fainter). Each slot now tracks whether its '
      + 'canvas is still showing content and renders one empty frame when it goes empty; `pixiFx.staleSlots()` is '
      + 'the DEV watchdog (`window.__pixiFx.staleSlots()`).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/fx/auxCanvasClearsOnRetire.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  // ── The scaled stage (owner ask 2026-09-26: small screens + phones) ─────────────────────────────────────────
  {
    id: 'R-PRESENT-21',
    title: 'Below 1920x1080 the whole game shrinks as one piece; nothing reflows or drifts off the board art',
    statement:
      'The game never lays out smaller than its 1920x1080 design size. On a smaller window or a phone held '
      + 'sideways it lays out at the design size and one uniform scale shrinks everything to fit: board art, '
      + 'cards, text, buttons, overlays, tooltips, floats, the drag card and the FX. Nothing is repositioned or '
      + 'resized on its own, so every piece stays where it sits on the 1080p desktop, just smaller. Extra window '
      + 'width or height is filled by the board backdrop, never by bars. At or above the design size (desktop, '
      + '1440p, 21:9 and 32:9 ultrawide) nothing changes. Portals and FX layers live inside the scaled stage; a '
      + 'screen-measured position is converted to stage space before it is written into CSS. A phone held '
      + 'upright shows a rotate-your-device screen.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Owner ask 2026-09-26 (responsive pass)',
        quote: 'when the screen shrinks our art pieces fly all over the place, and the mobile experience is really bad',
      },
      { kind: 'code', ref: 'packages/ui/src/stage.ts (fitStage, applyStage, toStage/rectToStage/stageViewport, stageHost); packages/ui/src/styles.css #stage + [data-stage-scaled]; packages/ui/src/fx/playDef.ts stageSink' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-26. Before, the layout was scaled with a CSS variable that raw-px borders, gaps, fonts '
      + 'and clamp() floors ignored, plus a phone-only mode (stage under 600px tall) that zoomed cards 1.36x and the '
      + 'board art 1.3x, so below ~1080px tall the pieces pulled apart from the board and each other. Now #stage '
      + 'wraps #root and every portal, lays out at a layout viewport of at least 1920x1080 and carries one '
      + 'transform: scale(s).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/stage.test.ts', 'packages/ui/src/stageTripwire.test.ts'],
      lastVerifiedAt: '2026-09-26',
    },
  },
  {
    id: 'R-PRESENT-22',
    title: 'On touch, a tap reaches everything a mouse hover reaches, and a tap on a card inspects it',
    statement:
      'Nothing important is hover-only. On a touch screen a tap on anything with a hover tip or preview opens it '
      + 'and it stays open until the next tap lands somewhere else. A tap on a card in the shop, warband, hand or '
      + 'combat opens the enlarged Inspect view (tap outside it to close), except while a hero power, Equipment, '
      + 'targeted Battlecry or spell is being aimed, where the tap picks the target. A finger must move about 10px '
      + 'before a card press becomes a drag, so a tap never turns into a tiny drag. Mouse behaviour is unchanged.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Owner answers 2026-09-26 (responsive pass)',
        quote: 'no hover-only information anywhere critical',
      },
      { kind: 'code', ref: 'packages/ui/src/touchInput.ts (installTouchInput, tapInspectAllowed, TAP_SLOP); Card.tsx onClick; Recruit.tsx dragThreshold; styles.css .tt-on mirrors' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-26. Before, tips were CSS :hover or onPointerEnter only, a tap either never opened them '
      + 'or closed them on release, card inspect was right-click only, and the drag threshold was 0px, so a finger tap '
      + 'on a card started a drag.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/touchInput.test.ts'],
      lastVerifiedAt: '2026-09-26',
    },
  },
  // ── One authored buff effect per buff (owner ruling 2026-09-24, King Oona's banana) ───────────────────────
  {
    id: 'R-BUFFFX-01',
    title: 'A minion\x27s authored buff effect plays exactly once per buffed unit, instead of the buff tendril',
    statement:
      'When a minion that has its own authored buff effect gives another unit stats, that effect travels from '
      + 'the minion to each unit it buffed, once per unit, and the stock buff tendril does not also play. This '
      + 'holds whether the buff lands as its own beat (King Oona doubling a summoned Beast) or inside the '
      + 'minion\x27s attack. Two source-to-target effects drawn for one buff read as the buff happening twice.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Milestone-hit / Oona session, 2026-09-24 (the ask)', quote: 'i also created a def for oona when his effect procs called oona banana. it should travel from oona to the unit effected by him' },
      { kind: 'owner-chat', ref: 'Milestone-hit / Oona session, 2026-09-24 (asked: should the banana replace the tendril?)', quote: 'Banana replaces tendril (Recommended)' },
      { kind: 'fix-pr', ref: 'https://github.com/kcodea/ascent/pull/1702 (feat/oona-banana-fx)' },
      { kind: 'code', ref: 'packages/ui/src/choreo/score.ts fxDef `buffed` fan-out (stands down for a no-spell minion buff); packages/ui/src/useCombatReplay.ts fireBuffCasts `sourceBuffDefFor` (plays the def in place of the tendril)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-24 for a minion buff with no spell behind it. Since PR #1416 the tendril path '
      + '(`fireBuffCasts`) has swapped a card\x27s `buffWave`/`buffed` def in for the tendril on EVERY buff wave, '
      + 'while the score\x27s `buffed` fan-out still played the same def on the same beat, so a standalone wave drew '
      + 'it twice (King Oona\x27s banana, Karwind\x27s flame ring). The fan-out now stands down for those buffs, the '
      + 'mirror of the `buffedOn` fan-out skipping spell buffs. The pin runs the real cue runner on a simulated '
      + 'Oona wave and asserts the score hands the cast to the tendril path without playing the def itself; '
      + 'that `fireBuffCasts` then plays it once is read from the code, not exercised (it is a React hook).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/choreo/oonaBanana.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },

  // ── A travelling buff effect lands where its unit settles (owner report 2026-09-24, King Oona's banana) ────
  {
    id: 'R-BUFFFX-02',
    title: 'A buff effect that travels to a unit lands where that unit ends up, not where it stood when it fired',
    statement:
      'When a minion\x27s authored buff effect travels to a unit whose row is still shifting (the unit was just '
      + 'summoned and is growing into its slot, or more summons in the same cascade keep pushing it over), the '
      + 'effect lands on the slot the unit settles into. It follows the unit to where it ends up rather than '
      + 'striking the empty spot the unit has already left.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Milestone-hit / Oona session, 2026-09-24', quote: 'i need the banana to land on where the unit ends up. im noticing that the banana is landing where the unit was(which is usually correct), but in the case of multiple summons at once, it misses the mark as the unit continues to shift over as more summons occur' },
      { kind: 'fix-pr', ref: 'https://github.com/kcodea/ascent/pull/1702 (feat/oona-banana-fx)' },
      { kind: 'code', ref: 'packages/ui/src/fx/settledSlot.ts settledSlotCenter + createSettlingPoint; packages/ui/src/useCombatReplay.ts settleTarget (fireBuffCasts source-authored branch); packages/ui/src/fx/playDef.ts PlayDefOptions.target' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-24 for a MINION\x27s authored buff def (the `buffWave`/`buffed` source-authored path in '
      + '`fireBuffCasts`: King Oona, Karwind, Paragon, Standard Bearer). The target is the unit\x27s SETTLED slot, '
      + 'computed from its row (centre + index x pitch, a growing slot counted at full width, a dying one dropped), '
      + 're-measured every 100ms for the flight only (never per frame), and the effect eases onto each new goal. '
      + 'PARTIAL: the stock buff tendril and spell-authored buff defs still aim at the fire-time rect. The pin '
      + 'covers the settled-slot math and the easing; the wiring into the live replay was not exercised by a test '
      + '(it is a React hook) and was handed to the owner to eyeball in play.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/fx/settledSlot.test.ts'],
      lastVerifiedAt: '2026-09-24',
    },
  },
  // ── An effect preview plays on every screen (owner report 2026-09-25, silent imported sound) ─────────────
  {
    id: 'R-FXPREVIEW-01',
    title: 'An authored effect plays in full on every screen, and the FX Library play button just plays the sound',
    statement:
      'An authored effect played outside a fight or shop (the title screen, menus) runs from start to finish, '
      + 'motion and sound, exactly as it does in a run. In the FX Library, a card slot\x27s play button plays the '
      + 'slot\x27s SOUND in place: it never covers the screen or traps the author behind a close button. A slot '
      + 'holding an effect with visuals does not play there; a note tells the author to open it with Edit.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'FX Library session, 2026-09-25', quote: 'when clicking the play button i do not hear the imported audio' },
      { kind: 'owner-chat', ref: 'FX Library session, 2026-09-25', quote: 'the screen goes dark like this but no sound plays' },
      { kind: 'owner-chat', ref: 'FX Library session, 2026-09-25', quote: 'when previewing the sound, i dont want that dark overlay to happen. when it does, theres no option other than hitting the X in the corner to exit the fx workbench entirely. that is not good. we just want that play button to play the audio. if it is a def, then dont let it work. have text that pops up to say "Press Edit to View Def"' },
      { kind: 'fix-pr', ref: 'https://github.com/kcodea/ascent/pull/1728 (feat/fxlib-save-all-edits)' },
      { kind: 'code', ref: 'packages/ui/src/pixiFx.ts startDetachedClock / wake / runExtraUpdaters; packages/ui/src/fx/ui/LibraryBrowser.tsx playSlot' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-25. The main effects overlay (whose ticker advances every played effect and draws '
      + 'the above-modal canvas) only mounts in a run (`Game.tsx`), so on the title screen a preview was placed '
      + 'and never advanced: the scrim went dark, visuals sat at their first frame, and a sound layer (which starts '
      + 'inside an update) never played. Verified in a real browser tab on the title screen: no main app, the '
      + 'preview fired, and no audio source ever started, for a committed sound (Void Panther) as well as an '
      + 'imported one. `pixiFx` now runs a detached rAF clock whenever work arrives with no main app (it yields to '
      + 'the real ticker and respects the Skip freeze). The pin drives a def with no main app and asserts it is '
      + 'ticked and presented; audible playback itself needs a focused tab and was left to the owner. The By-card '
      + 'play button no longer opens the dark preview stage (removed): a sound-only def plays in place, any other '
      + 'shows "Press Edit to View Def" (checked live in the DOM, not pinned by a test).',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/fx/detachedClock.test.ts'],
      lastVerifiedAt: '2026-09-25',
    },
  },
  {
    id: 'R-PRACTICE-SURGE-01',
    title: "Practice Tribes: pick one or more of the set's tribes and the game has only their cards plus neutral",
    statement:
      'The Practice screen "Tribes" row lists Normal plus exactly the tribes of the set a new run is created on, in '
      + 'that set order, and is multi-select. Normal is exclusive: picking it clears every tribe, picking a tribe '
      + "clears Normal, and unpicking the last tribe returns to Normal. With tribes picked, the run's active tribes "
      + "ARE the picked tribes (not the seeded roll), and the run's card pool is narrowed to them: every shop offer, "
      + 'Discover, spell and random card is a minion of a picked tribe (a dual type counts when either tribe is '
      + 'picked), a neutral minion, or a spell that is neutral or of a picked tribe. The hero offer, rune and quest '
      + 'tribe gates follow the same tribes. Normal plays exactly as before (the seeded roll, the full set pool). A '
      + 'saved draft with a tribe from another set, or the retired single tribe surge, opens on Normal. '
      + 'The filter is for the PLAYER only: the enemy side of the player fights (random cards made for the opponent) draws from the FULL set pool.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (Practice tribes, enemy pool)', quote: 'they can use the full set, the tribe surge is just for the player' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (Practice screen)', quote: "practice tribe surge should only have the active set's tribes." },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (Practice screen, follow-up)', quote: "yeah let's change tribe surge to that tribe's cards plus neutral cards, and all spells associated, but make it multi select. so i can choose demons + dragons and have demons/dragons/neutrals in the game. reword 'none' to 'Normal'" },
      { kind: 'code', ref: 'packages/sim/src/practiceTribes.ts (options, toggle, practiceRunTribes); packages/sim/src/lobby/runLobby.ts createLobbyRun; packages/sim/src/cardPool.ts poolOf; packages/core/src/tribeGate.ts inRunTribes; packages/ui/src/PracticeOptions.tsx' },
    ],
    currentBehaviour:
      "Conforms, 2026-09-27. Was a single-select Tribe surge that doubled one tribe's shop odds (the list was "
      + 'first hard-coded across sets, then narrowed to the active set earlier the same day).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/practiceTribes.test.ts'], lastVerifiedAt: '2026-09-27' },
  },
  {
    id: 'R-EQUIPFX-ANCHOR-01',
    title: 'An Equipment-driven Spell or Ruby power gain plays over the Equipment slot; the Buffs panel draws above it',
    statement:
      'When using an Equipment raises Spell Power or Ruby power (Dual Rubetta’s improving your Rubies), the '
      + 'power flourish and its number float play over the Equipment slot, not over the hand or the Shop row. And the '
      + 'run Buffs panel, when open, draws above the Equipment slot (the hero block lifts above the slot while the '
      + 'panel is open).',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (Dual Rubettas screenshot)', quote: 'fix - ruby buff goes over hand instead of the equipment for dual rubettas, also the spell panel should go on top of equipment z axis wise' },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts rubyPowerFxUid / spellPowerFxUid = EQUIPMENT_FX_ANCHOR on activateEquipment; packages/ui/src/Recruit.tsx anchor lookup; packages/ui/src/styles.css .statusbar .hero:has(> .herobuffs.open)' },
    ],
    currentBehaviour: 'Conforms, FIXED 2026-09-27: an Equipment gain had no card uid, so the flourish fell back to the hand; the Buffs panel was trapped under the slot by the hero block stacking context.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/equipmentFxAnchor.test.ts'], lastVerifiedAt: '2026-09-27' },
  },
  {
    id: 'R-PRACTICE-UPLOAD-01',
    title: 'A finished Practice game (bots or players, any Health) always records to Recent Games',
    statement:
      'When a Practice game ends (the placement screen: round 15 on Unlimited Health, every bot out, or knocked out on '
      + 'Normal), exactly one row is written to practice_games and shows on the Recent Games Practice tab. Every value '
      + 'matches its column type: the game length is whole milliseconds (duration_ms is an int column). A rejected '
      + 'upload is logged to the console with the database code and message, never swallowed.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (Recent Games empty after a friend finished a practice game)', quote: 'my friend just finished a practice game vs bots but it isnt showing on games played. why not?' },
      { kind: 'code', ref: 'packages/ui/src/practiceGames.ts practiceGameOf (Math.round on durationMs); packages/ui/src/remoteBoards.ts uploadPracticeGame (rounds again, logs the returned error)' },
    ],
    currentBehaviour: 'Conforms, FIXED 2026-09-27: the length was a fractional frame-clock value (e.g. 23031.7), so Postgres rejected every real practice row (22P02, invalid input syntax for type integer) and the client ignored the returned error. Reproduced end to end against the live table before the fix.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/practiceGames.test.ts'], lastVerifiedAt: '2026-09-27' },
  },
  {
    id: 'R-CAREER-PRACTICE-01',
    title: 'The Career has a Practice tab: your finished Practice games with their results, the bot level, and a Watch when a replay was recorded',
    statement:
      'The Career centre column has a third tab, PRACTICE (after Match History and Heroes, persisted per browser like them). '
      + 'It lists the career owner’s finished practice games from practice_games (read by user_id, newest first, up to 25), '
      + 'each as the Match History banner: hero, WIN/LOSS by placement, the fight record, the placement verdict, date, length, '
      + 'rounds, the final team and the runes, plus the options as pills: "Bots · Level N" (or "Players") and "Unlimited HP" / '
      + '"Normal HP". A practice game records the SAME replay payload a ranked run uploads (practice_games.replay); the lists only '
      + 'probe replay->v2->version, and a row carrying a v2 replay offers Watch Replay (Career and Recent Games Practice tabs), '
      + 'which fetches that row’s replay by id and plays it in the replay viewer. A row without a replay shows no button. Before '
      + 'the replay column exists the upload retries without it, so the result still records.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (Career practice tab)', quote: 'add practice games as a tab in the career as well so players can see practice games they played ... the practice bot games should include the bot level' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (practice replays)', quote: 'okay go ahead and do it' },
      { kind: 'code', ref: 'packages/ui/src/Career.tsx PracticeRow; packages/ui/src/remoteBoards.ts fetchMyPracticeGames / fetchPracticeReplay / uploadPracticeGame; packages/ui/src/store.ts assembleReplayV2; supabase/migrations/2026-09-27-practice-games-replay.sql' },
    ],
    currentBehaviour: 'Conforms since 2026-09-27. Only practice games finished after the replay migration runs carry a replay; older rows show results only.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/Career.test.tsx', 'packages/ui/src/practiceGames.test.ts', 'packages/ui/src/ladderPages.test.tsx'], lastVerifiedAt: '2026-09-27' },
  },
  {
    id: 'R-PRACTICE-TIME-01',
    title: 'Practice has an Unlimited time option: no shop timer at all',
    statement:
      'The Practice Time row offers 1x, 2x, 3x, 4x and Unlimited. Unlimited (timeMult 0) runs the shop with no turn '
      + 'clock (the same effectively-infinite clock the tutorial uses): the timer shows the infinity symbol and never '
      + 'locks actions. The in-game timer dropdown offers the same choice. Scored modes never read it.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (Practice options)', quote: 'add an unlimited time option in practice' },
      { kind: 'code', ref: 'packages/sim/src/state.ts PracticeConfig.timeMult 0; packages/ui/src/Recruit.tsx infiniteClock + ShopTimer; packages/ui/src/store.ts setPracticeTimer / loadPracticeTimer; packages/ui/src/PracticeOptions.tsx TIMES' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-27).',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/practiceUnlimitedTime.test.ts'], lastVerifiedAt: '2026-09-27' },
  },
  {
    id: 'R-PRACTICE-HEROES-01',
    title: 'Practice Heroes: Beginner offers Indy, Warden and Keshi as a three-choice pick; All offers every hero',
    statement:
      'The Practice setup screen has a Heroes row (Beginner / All), Beginner by default. Beginner shows the usual '
      + 'three-choice hero pick, always exactly Indy, Warden and Keshi. All shows every Practice hero (tribe-gated as '
      + 'before). A draft saved before the row existed opens on Beginner.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (Practice options)', quote: 'add heroes tab in practice that says Beginner / All. the starter selector should give the 3 hero choices like the main game does, except it only offers these 3 heroes: Indy, Warden, Keshi' },
      { kind: 'code', ref: 'packages/sim/src/heroes.ts BEGINNER_HERO_IDS / practiceHeroChoiceIds; packages/sim/src/state.ts PracticeConfig.heroes; packages/ui/src/store.ts confirmPracticeSetup + loadPracticeConfig; packages/ui/src/PracticeOptions.tsx Heroes row' },
    ],
    currentBehaviour: 'Conforms (built 2026-09-27).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/practiceBeginnerHeroes.test.ts'], lastVerifiedAt: '2026-09-27' },
  },
  {
    id: 'R-PROG-XP-01',
    title: 'Account XP per game: Ranked 100 + 40 Top 4 + 60 first + 25 comeback; Practice 60% of that; the tutorial 250 once',
    statement:
      'Account XP is permanent, earn-only and separate from the ranked ladder. A completed Ranked game earns 100, plus 40 '
      + 'for a Top 4 finish, plus 60 for 1st, plus 25 for a comeback (a combat win right after 4 or more consecutive combat '
      + 'losses; a draw neither adds to nor clears the streak; once per run). A standard Practice game earns 60% of the '
      + 'equivalent Ranked XP, summed then rounded (60 / 84 / 120 / 135). A Practice game with no meaningful placement '
      + '(Unlimited Health, played to the curtain) earns a flat 60. The first completion of the current Learn Ascent course '
      + 'earns 250 once per account. The Scene Builder, sandboxes and quit games earn 0. No caps, no diminishing returns. '
      + 'The server computes the XP from its own source rows (the accepted rank result, the player\'s own practice row, a '
      + 'unique tutorial claim), never from a number the client sends, and a duplicate settlement returns the original result.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (account progression MVP brief)', quote: 'XP values and curve exactly as the handoff: Ranked 100 complete + 40 Top 4 + 60 first + 25 comeback' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (account progression MVP brief)', quote: 'Practice = round(0.60 × equivalent ranked XP)' },
      { kind: 'code', ref: 'packages/progression/src/rules.ts xpForSettlement / comebackAfterLosses; supabase/migrations/2026-09-27-account-progression.sql settle_progression; supabase/functions/_shared/progressionRules.ts (generated)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-27 (account progression MVP). Earns nothing until the owner runs the migration, deploys submit-progression and sets the progression epoch.',
    enforcement: { kind: 'scenario', refs: ['packages/progression/src/rules.test.ts', 'packages/progression/src/sqlParity.test.ts', 'packages/progression/src/server.test.ts', 'packages/sim/src/progressionFacts.test.ts'], lastVerifiedAt: '2026-09-27' },
  },
  {
    id: 'R-PROG-CURVE-01',
    title: 'Account Level curve: 250 XP per level to Level 11, 400 to Level 26, 500 after; lifetime XP stored, no backfill',
    statement:
      'Every account starts at Level 1 with 0 XP. Levels 1 to 10 each need 250 XP to advance, 11 to 25 need 400 each, and '
      + '26 onward need 500 each, uncapped (Level 11 begins at 2500 lifetime XP, Level 26 at 8500). The server stores '
      + 'LIFETIME XP and derives the level (versioned curve), so one game can cross several levels. No game finished before '
      + 'the progression epoch counts: there is no retroactive backfill.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (account progression MVP brief)', quote: 'Curve: 250 per level for levels 1→11, 400 for 11→26, 500 after; store LIFETIME xp; level derived; versioned. No caps, no diminishing returns. No retroactive backfill' },
      { kind: 'code', ref: 'packages/progression/src/rules.ts CURVE_BANDS / levelOfXp / levelProgress; progression_level_of in supabase/migrations/2026-09-27-account-progression.sql; progression_config.epoch' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-27.',
    enforcement: { kind: 'scenario', refs: ['packages/progression/src/rules.test.ts', 'packages/progression/src/sqlParity.test.ts'], lastVerifiedAt: '2026-09-27' },
  },
  {
    id: 'R-PROG-TITLE-01',
    title: 'Every account unlocks the Alpha Tester title at Account Level 2; guests earn XP too and are gently asked to save it',
    statement:
      'The Level 2 reward is the title "Alpha Tester" (a level milestone, never in a crate), granted to EVERY account that reaches Account Level 2 '
      + '(level-based, so an existing account that reaches Level 2 gets it too) and equipped automatically when no title is '
      + 'equipped. The Collection\x27s New rewards pop-up announces it (moved off the post-game panel 2026-09-28, R-PROG-NEWREWARDS-01); the Career shows the level, the XP bar and the equipped title publicly. '
      + 'Anonymous (guest) players earn XP from their first game, because a guest session is a real account id that the email '
      + 'upgrade keeps. When a guest reaches Level 2 the post-game panel shows a gentle "Save your progress" prompt (never a '
      + 'gate) that opens the account panel, and the Career shows a small reminder. With no session at all, a game earns no XP.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (account progression MVP brief)', quote: 'ONE title, "Alpha Tester", unlocked by EVERYONE at Account Level 2' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (account progression MVP brief)', quote: 'Anonymous players: they ACCUMULATE XP from their first game' },
      { kind: 'code', ref: 'settle_progression c_alpha_title / c_alpha_level in supabase/migrations/2026-09-27-account-progression.sql; packages/progression/src/rules.ts TITLES; packages/ui/src/progression/ProgressionPostgame.tsx; packages/ui/src/progression/AccountLevel.tsx' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-27. Where titles show (review surfaces only, never in game) is R-PROG-TITLE-02.',
    enforcement: { kind: 'scenario', refs: ['packages/progression/src/sqlParity.test.ts', 'packages/progression/src/rules.test.ts', 'packages/ui/src/progression/ProgressionPostgame.test.tsx', 'packages/ui/src/Career.test.tsx'], lastVerifiedAt: '2026-09-27' },
  },
  {
    id: 'R-PROG-GUEST-01',
    title: 'A guest sees a slow-blinking "Sign in!" button left of their portrait, and must sign in to change the portrait',
    statement:
      'On the main menu, a guest (an anonymous account) sees a "Sign in!" button just left of their portrait in the top-right '
      + 'account corner. It blinks slowly (a glow that breathes on about a 2.4 second cycle; still under reduced motion) and '
      + 'opens the account panel, which upgrades the guest in place. It is gone the moment the account is real, with no reload, '
      + 'and it never shows when there is no account backend or no session (nothing to sign into). A guest cannot change their '
      + 'portrait: clicking it opens a "Sign in to change your portrait" prompt (Not now / Create account) instead of the avatar '
      + 'picker, the picker refuses to render for a guest, and with no backend the prompt says accounts are unavailable. A '
      + 'signed-in player changes their portrait as before. Client-side only.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (guest sign-in button)', quote: 'add a "sign in!" button that slow flashes/blinks in the top right to the left of the player icon/name. don\x27t let non-signed in players change the portrait either, they need to sign in for that.' },
      { kind: 'code', ref: 'packages/ui/src/GuestSignIn.tsx (GuestSignInButton, PortraitSignInGate, accountsAvailable); packages/ui/src/Title.tsx (the account corner); packages/ui/src/AvatarPicker.tsx (the guest guard); styles.css .guestsignin / guestsigninblink' },
    ],
    currentBehaviour:
      'Conforms, built 2026-09-29. The title account corner is the only place the player identity and the portrait picker '
      + 'live. The chosen portrait itself is still stored on the device (localStorage); the gate is a client-side nudge, not a server check.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/GuestSignIn.test.tsx'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-NEWREWARDS-01',
    title: 'The end screen stays short; achievements, titles and crates wait in a one-time New rewards pop-up in the Collection',
    statement:
      'After a game the end screen shows the placement, the XP gained, the level bar and the level-up moment, and, when the game '
      + 'earned anything new, one line saying new rewards are waiting in the Collection. The achievements, first-time titles and '
      + 'crates a settlement awarded are queued for that account (they survive a reload) and shown once, as a New rewards pop-up the '
      + 'next time the Collection opens: achievements with their XP and a link to see them all in the Career, titles, and crates '
      + 'with Open and Open all through the Collection\x27s own crate opener. Closing it in any way marks them seen, and a reward '
      + 'is never shown twice. While rewards wait, every Collection entry point wears an orange NEW pill.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Match details review, 2026-09-28', quote: 'can you have the unlocks, achievements, and crates be a pop up when the player gets back to the collection?' },
      { kind: 'owner-chat', ref: 'Match details review, 2026-09-28', quote: 'just highlight the collection\x27s text in orange or have a "new" pill or something on it so players go there?' },
      { kind: 'code', ref: 'packages/ui/src/progression/newRewards.ts (queue, localStorage per account, the never-twice set); packages/ui/src/progression/NewRewardsPopup.tsx; progressionStore.ts applyProgressionOutcome; ProgressionPostgame.tsx; Title.tsx, MenuSidebar.tsx, AccountLevel.tsx (the NEW pill)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-28. The queue is local (localStorage, per account id), filled when a settlement answer is '
      + 'confirmed, so rewards earned on another device show there, not here. A queued crate already opened elsewhere drops out of '
      + 'the pop-up; a pop-up left with nothing never opens. The guest save prompt stays on the end screen.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/progression/newRewards.test.tsx', 'packages/ui/src/progression/Crates.test.tsx', 'packages/ui/src/progression/ProgressionPostgame.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-CRATE-01',
    title: 'Every Account Level grants one sealed crate; the first settled game grants the Level 1 Welcome Crate; enrolled accounts were backfilled',
    statement:
      'An account earns exactly one sealed crate per Account Level: the settlement that enrolls an account (its first '
      + 'settled game) creates the Level 1 Welcome Crate, and every settlement creates one crate for each level it newly '
      + 'reaches (a jump across several levels creates several). So an account at Level L has earned L crates. The ledger row '
      + 'records how many crates the settlement created and their ids, and a duplicate settlement returns the same crates. '
      + 'Crates need no key and are earned even while the crates switch is off (banked). Accounts already enrolled when crates '
      + 'shipped received their Welcome Crate plus one crate per level already reached, through an idempotent backfill.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'C:/Users/kevin/.codex/visualizations/2026/09/10/01a08bcd-7027-7c60-a951-4c941ed57d4a/ascent-account-progression-achievements-claude-handoff.md §2 + §5.1', quote: 'Every level grants one crate.' },
      { kind: 'owner-handoff', ref: 'C:/Users/kevin/.codex/visualizations/2026/09/10/01a08bcd-7027-7c60-a951-4c941ed57d4a/ascent-account-progression-achievements-claude-handoff.md §5.1', quote: 'Level 1 creates one Welcome Crate on progression enrollment.' },
      { kind: 'code', ref: 'settle_progression step 9b + section 14c backfill in supabase/migrations/2026-09-28-progression-crates.sql; cratesForSettlement in packages/progression/src/rules.ts; settlementParity in packages/progression/src/server.ts' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28. Live once the owner runs the crates migration.',
    enforcement: { kind: 'scenario', refs: ['packages/progression/src/crates.db.test.ts', 'packages/progression/src/server.test.ts', 'packages/progression/src/cosmetics.test.ts'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-CRATE-02',
    title: 'A crate picks its reward when OPENED, from what remains, never a duplicate; an exhausted pool keeps it sealed; opening is never forced',
    statement:
      'Opening a crate is optional (right after the game or later from the Collection; Continue is always available) and '
      + 'happens on the server in one transaction under the per-user progression lock. The reward is chosen at OPEN time from '
      + 'the active, crate-sourced items in a live category that the player does not own, by the fixed-odds roll of '
      + 'R-PROG-CRATE-03 (since 2026-09-29; before that, one draw weighted rarity x category over what remained). A rolled '
      + 'rarity with nothing left never fails the open: it falls to the nearest rarity with something left. '
      + 'The player never receives an item they already own (unique ownership is the final guard), and a second open of '
      + 'the same crate returns the committed reward. When nothing eligible remains the crate stays sealed and the answer is '
      + '"pool_exhausted"; it is never converted into currency or anything else. Earn only: no keys, purchases or rerolls.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-handoff', ref: 'C:/Users/kevin/.codex/visualizations/2026/09/10/01a08bcd-7027-7c60-a951-4c941ed57d4a/ascent-account-progression-achievements-claude-handoff.md §5.1', quote: 'Choose the reward when the crate is opened, not when earned.' },
      { kind: 'owner-handoff', ref: 'C:/Users/kevin/.codex/visualizations/2026/09/10/01a08bcd-7027-7c60-a951-4c941ed57d4a/ascent-account-progression-achievements-claude-handoff.md §2', quote: 'A player can never receive a cosmetic they already own.' },
      { kind: 'owner-handoff', ref: 'C:/Users/kevin/.codex/visualizations/2026/09/10/01a08bcd-7027-7c60-a951-4c941ed57d4a/ascent-account-progression-achievements-claude-handoff.md §5.4', quote: 'Do not roll a rarity first and fail when that rarity is exhausted.' },
      { kind: 'code', ref: 'open_crate + progression_crate_pool in supabase/migrations/2026-09-28-progression-crates.sql, replaced by supabase/migrations/2026-09-29-crate-fixed-rarity-odds.sql; pickCrateReward / eligibleCrateCosmetics in packages/progression/src/cosmetics.ts; packages/ui/src/progression/CrateOpener.tsx' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28; the roll itself changed 2026-09-29 (R-PROG-CRATE-03).',
    enforcement: { kind: 'scenario', refs: ['packages/progression/src/crates.db.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/progression/src/sqlParity.test.ts', 'packages/progression/src/inventory.test.ts', 'packages/ui/src/progression/Crates.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-CRATE-03',
    title: 'Crates roll a rarity FIRST at fixed, published odds (Common 50 / Rare 30 / Epic 15 / Legendary 5), then an unowned item of it, each equally likely; an empty rarity falls to the nearest one with something left',
    statement:
      'Opening a crate makes ONE server-side draw. It first rolls a rarity at fixed odds: Common 50%, Rare 30%, Epic 15%, '
      + 'Legendary 5%. The odds never change as items are added, and they are shown to players (the Collection crate bay '
      + 'prints them). It then picks an item of that rarity from the eligible ones (active, not admin_off, category enabled '
      + 'and not admin_off, crate-sourced, not owned), EVERY item of the rarity EQUALLY likely (owner: "yeah equal '
      + 'chance"), so each Legendary is 5% divided by the number of eligible Legendaries, whatever its category. The '
      + 'category weights stay in the catalog, kept for later, but the roll does not read them (roll_version 2, earlier '
      + 'the same day, split a rarity by category weight). If the rolled rarity has nothing eligible, the crate '
      + 'falls to the NEAREST rarity with something left, ties toward the MORE COMMON one (Epic empty goes to Rare before '
      + 'Legendary). If nothing is eligible anywhere the answer is pool_exhausted and the crate stays sealed. Everything '
      + 'else is unchanged: no duplicates, the per-user lock, already_opened, the admin_off kill switch. Opened crates '
      + 'record roll_version 3. The odds live once in TS (CRATE_RARITY_ODDS) and once in SQL (progression_crate_pick), '
      + 'and a parity test fails on any drift. The lower-rarity tie-break is the builder\x27s call (the owner did not '
      + 'specify it), flagged for review.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (crate odds, option C chosen)', quote: 'go to C' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (crate odds, the numbers)', quote: 'make it 50/30/15/5 though' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (crate odds, each item within a rarity equally likely?)', quote: 'yeah equal chance' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (CRATE_RARITY_ODDS, CRATE_ROLL_VERSION, rollCrateRarity, crateRarityFallback, pickCrateReward, crateChances, crateOddsLine); supabase/migrations/2026-09-29-crate-fixed-rarity-odds.sql (progression_crate_pool) and 2026-09-29-crate-uniform-within-rarity.sql (progression_crate_pick, open_crate); packages/ui/src/progression/CollectionScreen.tsx (CrateBay odds line)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29. Live once the owner runs both 2026-09-29 migrations (fixed odds, then equal chance) and deploys progression-inventory.',
    enforcement: { kind: 'scenario', refs: ['packages/progression/src/cosmetics.test.ts', 'packages/progression/src/sqlParity.test.ts', 'packages/progression/src/crateOdds.db.test.ts', 'packages/ui/src/progression/CollectionScreen.test.tsx'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-CATALOG-01',
    title: 'The launch cosmetic catalog is 15 crate titles; every other category exists but is switched off; equipping checks ownership on the server',
    statement:
      'The cosmetic catalog is data shaped for every category (announcer, hero skin, minion skin, title, hero attack, board, '
      + 'music), with only titles enabled at launch: 15 crate titles (7 Common, 5 Rare, 2 Epic, 1 Legendary) with permanent '
      + 'ids. Alpha Tester stays the Level 2 grant and is never in the crate pool. A player equips one owned title (or none) '
      + 'from the Collection; the server checks ownership. The equipped title and the owned titles are public; crates are '
      + 'private. Clients can never write ownership, crates or the loadout.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-27 (level crates + catalog brief)', quote: "let's just do 15 titles to start. we'll start creating assets for the catalog as well." },
      { kind: 'code', ref: 'COSMETICS / COSMETIC_CATEGORY_DEFS in packages/progression/src/cosmetics.ts; cosmetic_categories + cosmetic_catalog seeds and equip_title in supabase/migrations/2026-09-28-progression-crates.sql; packages/ui/src/progression/CollectionScreen.tsx' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28. Title names are placeholders for the owner to rename (ids stay).',
    enforcement: { kind: 'scenario', refs: ['packages/progression/src/cosmetics.test.ts', 'packages/progression/src/sqlParity.test.ts', 'packages/progression/src/crates.db.test.ts', 'packages/ui/src/progression/Crates.test.tsx', 'packages/ui/src/Career.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PRESENT-23',
    title: 'A spell cast in combat plays its effect on the CASTER\x27s side of the board',
    statement:
      'When a minion (or rune) casts a spell in combat, the spell\x27s own cast effect plays on the board of the side that '
      + 'owns the caster. A board-wide effect authored on the screen-centre camera (Growth\x27s `growth-effect`, laid over '
      + 'the player\x27s row) is moved onto the ENEMY\x27s row when an opponent cast it: its camera is translated by the '
      + 'player-row to enemy-row distance, so the authored effect keeps the same relation to the caster\x27s own board. The '
      + 'player\x27s own casts keep the authored placement. The caster\x27s side comes from the event\x27s own `side` stamp, else '
      + 'the replay\x27s uid to side map (initial boards plus summons), else the row the body renders in. Presentation only: '
      + 'the engine outcome and the event log are unchanged.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Owner bug report, 2026-09-27',
        quote: 'fatecarver\x27s growth animation plays on the player\x27s board when the fatecarver is an opponent.',
      },
      { kind: 'code', ref: 'packages/ui/src/fx/spellCastFx.ts (`playCombatSpellCastFx`, `combatCastCamera`, `sideCameraFromRows`); packages/ui/src/choreo/score.ts (the `spellCastFx` cue, `ScoreCtx.sideOf`); packages/ui/src/useCombatReplay.ts (`unitSides`); packages/ui/src/choreo/channels/castPreview.ts (`spellCastsIn` carries `side`)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-27. Before this, every combat cast of a camera-anchored spell effect played at the viewport '
      + 'centre whatever the caster\x27s side, so an enemy Fatecarver / Taragosa / Hoardbreaker Growth (and an enemy '
      + 'rune\x27s bound cast) bloomed over the player\x27s board.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/fx/spellCastFx.test.ts'], lastVerifiedAt: '2026-09-27' },
  },
  {
    id: 'R-PROG-COLLECTION-01',
    title: 'The Collection is its own screen, and opening a crate plays a rarity-escalated, skippable opening that starts on the click',
    statement:
      'The Collection is a screen of its own (a menu-sidebar page, reached from the title Collection plaque, the menu '
      + 'sidebar and the Account Level card on your Career), not a panel of the Career: sealed crates with Open and Open all, '
      + 'owned titles with Equip, and the categories not yet switched on shown as coming soon. Opening a crate (there, or from '
      + 'the post-game row) plays a full-screen opening: the anticipation starts on the click while the server is asked and '
      + 'holds for as long as the answer takes; the rarity of the answer then picks the charge, burst and reveal, escalating '
      + 'from Common (quick and clean) through Rare (blue) and Epic (purple, a longer charge, more particles) to Legendary '
      + '(gold, the longest build, the heaviest burst, god rays and a sting). A failed answer winds down to "Could not open '
      + 'the crate. Try again." A click or a key skips to the reveal (pressed before the answer, the reveal lands the moment '
      + 'it arrives); reduced motion shows a short fade instead. Presentation only: the server still picks the reward at open '
      + 'time (R-PROG-CRATE-02).',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Collection screen + crate opening brief)', quote: 'make the collection screen separate and build a AAA animation for crate opening, with pixi and everything. put a tuner in for it to test it' },
      { kind: 'code', ref: 'packages/ui/src/progression/CollectionScreen.tsx; packages/ui/src/progression/CrateOpener.tsx (the theatre + flow); packages/ui/src/progression/crateFx/crateFxConfig.ts (presetFor / crateBeats); packages/ui/src/progression/crateFx/crateScene.ts + crateFxPixi.ts (the Pixi layer); showCollection / openCollection / goTo(collection) in packages/ui/src/store.ts' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28. The crate is drawn procedurally until the crate art from the owner drops in through the `crateArt` tuner key.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/progression/Crates.test.tsx', 'packages/ui/src/progression/crateFx/crateFx.test.ts', 'packages/ui/src/Career.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-COLLECTION-02',
    title: 'The Collection lays out as a full album: category tabs, filters, every item owned or not, a detail panel, and a crate bay always in view',
    statement:
      'The Collection shows the WHOLE catalog of a category, owned or not, in a stable order (rarest first): owned items '
      + 'bright in their rarity frame, missing items dimmed with the rarity still readable and a lock, the equipped item '
      + 'with a full gold rim and an Equipped ribbon. The header shows overall completion ("N / M") and the Account Level with '
      + 'its XP bar. Categories are tabs with an owned / total count; the ones not switched on yet are locked tabs that open '
      + 'a coming-soon view. Show (All / Owned / Missing) and Rarity filters carry counts. Selecting an item opens it in a '
      + 'detail panel: large on a nameplate, its rarity, its status, how it is found ("Found in crates.", "Reach Level 2."), a '
      + 'preview under your name, and Equip or Take off (a missing item says how to get it instead). A crate bay (count, '
      + 'next crate, Open, Open all) stays in view whatever tab is open and starts the unchanged crate opening. An owned item '
      + 'you have not looked at wears NEW until you select it; that flag is local to the device and never sent to the '
      + 'server. A guest sees a slim save row.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Collection layout brief)', quote: 'i think the layout is horrible. research best in class collection screens and mimic them' },
      { kind: 'code', ref: 'packages/ui/src/progression/CollectionScreen.tsx; packages/ui/src/progression/collectionModel.ts (albumOf / filterAlbum / loadSeen / saveSeen); packages/ui/src/progression/collection.css' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28. Titles, Heroes and Minions are live (the skins joined the same day, R-PROG-SKINS-01); the other four are locked tabs until their art ships.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/progression/CollectionScreen.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-SKINS-01',
    title: 'A skin replaces the art of ONE hero or ONE card everywhere it appears, for its owner, as recorded on that run',
    statement:
      'A hero skin replaces one hero\'s portrait; a minion skin replaces one card\'s art, by stable id. It shows wherever '
      + 'that target appears for the player who wears it: hero select, the seat list, your portrait (also the combat hero), '
      + 'the NOW FACING and fight-recap portraits, the end screen, the Career (favourite hero, match history), and every '
      + 'card of that id in the shop, hand, board, combat, Discover, the end screen board, the Career boards and the Minion '
      + 'Book. A Gilded copy wears the skin with the normal Gilded frame and effects on top (no separate unlock). Tokens are '
      + 'their own card ids and stay unskinned. Balance, targeting and hitboxes never change. A run RECORDS the loadout when '
      + 'it starts (equipping mid-run changes the next run); every board it captures carries it scoped to that board, and a '
      + 'lobby seat built from a recorded run copies its owner\'s, so opponents, replays and history show the skins worn in '
      + 'THAT run, never anyone\'s current loadout. A payload with no skins (every older one) is default art.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (skins v1 brief)', quote: "let's use these 2 black belt brian skins as our first 2 skin concepts" },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (skins v1 brief)', quote: "let's use these 2 hero skins as our first 2 hero skin concepts" },
      { kind: 'code', ref: 'packages/ui/src/skins/skinArt.ts (heroPortrait / minionSkinMap / the Card context); packages/sim/src/snapshot.ts (scopeCosmetics); packages/sim/src/lobby/snapshotSeats.ts + runLobby.ts (seat cosmetics); packages/ui/src/store.ts (recordRunCosmetics)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28: Sheriff Brian, Glitch Brian, Grandmaster Brian and Sketchbook Brian (Black Belt Brian), Clocktower Voss (Bellringer Voss), the batch-2 minion skins (R-PROG-SKINS-07), Surf Day Albus, Bath Day Warden (placeholder names).',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/skins/skins.test.tsx', 'packages/ui/src/skins/lobbySkins.test.tsx', 'packages/sim/src/lobby/seatCosmetics.test.ts', 'packages/ui/src/Career.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-SKINS-02',
    title: '"Show opponent cosmetics" (Settings, on by default; was "Show opponent skins") hides OPPONENTS\' cosmetics only, never your own',
    statement:
      'Settings has a "Show opponent cosmetics" switch (labelled "Show opponent skins" until hero attacks became cosmetics on '
      + '2026-09-28; same stored setting), on by default and stored like the other client settings. Off, every '
      + 'opponent\'s hero and minion skins render as default art everywhere they appear: the lobby seat list, combat, the '
      + 'NOW FACING and fight-recap portraits, the scouted board, replays, and another player\'s Career page, and an '
      + 'opponent who strikes you plays the Classic hero attack instead of their equipped one. Your own equipped cosmetics '
      + 'always show. It is a pure display switch: it changes nothing recorded or sent.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (skins v1 brief)', quote: 'this is an opponent toggle only, because they will be manually equipping skins on their own anyways' },
      { kind: 'code', ref: 'packages/ui/src/store.ts (showOpponentSkins); packages/ui/src/skins/skins.tsx (useOpponentSkins / opponentSkins); packages/ui/src/EscMenu.tsx' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/skins/skins.test.tsx', 'packages/ui/src/skins/lobbySkins.test.tsx', 'packages/ui/src/Career.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-SKINS-03',
    title: 'The reward kill switch: one line retires an item or a category; ownership is never deleted, so restoring puts it back',
    statement:
      'An item is RETIRED when it is switched off in code (active false, or its category disabled, in cosmetics.ts; the next '
      + 'deploy syncs it) OR by the owner\'s one-line emergency switch in the database (admin_off on the item or the category, '
      + 'a column the code sync never writes, so the next deploy can never undo it). The effective state everywhere is active '
      + 'AND NOT admin_off (items) and enabled AND NOT admin_off (categories). A retired item leaves the crate pool, it cannot be equipped, it drops out of every '
      + 'profile\'s loadout, the Collection hides it (owned or not, and the counts move with it), and every renderer shows '
      + 'default art even where a player has it equipped or an old board, seat or replay names it. The client reads the '
      + 'server\'s switches on boot and caches the last answer. An unknown or removed id (an old replay, a newer client) never '
      + 'crashes: it is default art. Ownership rows and loadout rows are never deleted, so flipping the switch back restores '
      + 'the item exactly as it was, still owned and still equipped.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (skins v1 brief)', quote: 'we need to have the ability to remove any rewards from the game if we want to as well' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (catalog sync ruling)', quote: "yeah let's do option 2 then to make it automated when i add skins" },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (isCosmeticLive / parseServerCatalogState, which reads admin_off); supabase/migrations/2026-09-28-progression-skins.sql (admin_off, the four one-line switches in its header, the effective state in progression_crate_pool / equip_cosmetic / progression_profile_json); packages/ui/src/progression/collectionModel.ts (albumOf)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28.',
    enforcement: { kind: 'scenario', refs: ['packages/progression/src/skins.db.test.ts', 'packages/progression/src/skins.test.ts', 'packages/ui/src/skins/skins.test.tsx', 'packages/ui/src/progression/CollectionSkins.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-SKINS-05',
    title: 'The cosmetic catalog is owned by code: deploying progression-inventory syncs it; adding a cosmetic needs no SQL',
    statement:
      'packages/progression/src/cosmetics.ts is the source of truth for the cosmetic catalog. The progression-inventory Edge '
      + 'Function carries a generated copy and, on the first request of every cold start, pushes it to the database '
      + '(sync_cosmetic_catalog): categories and items in code are inserted or updated (weight, enabled, target, rarity, '
      + 'source, target, active); an item no longer in code is marked inactive, never deleted, because ownership references '
      + 'it. A content hash makes an unchanged catalog one read. The sync never writes the owner\'s emergency switch '
      + '(admin_off). So adding or retiring a cosmetic is: its art, a cosmetics.ts entry, npm run progression:shared, merge, '
      + 'and one deploy of progression-inventory. Only that function syncs; submit-progression does not, so two functions '
      + 'deployed at different times can never push different catalogs over each other.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (catalog sync ruling)', quote: "yeah let's do option 2 then to make it automated when i add skins" },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (catalogSyncPayload / catalogHash); packages/progression/src/inventory.ts (syncCatalogOnce); supabase/functions/progression-inventory/index.ts; supabase/migrations/2026-09-28-progression-skins.sql (sync_cosmetic_catalog)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28. Takes effect once the owner pastes the skins SQL and deploys progression-inventory.',
    enforcement: { kind: 'scenario', refs: ['packages/progression/src/skins.db.test.ts', 'packages/progression/src/skins.test.ts', 'packages/progression/src/sqlParity.test.ts', 'packages/progression/src/sharedArtifact.test.ts'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-SKINS-04',
    title: 'Equipping a skin goes through the server: owned, made for that target, live; Default is always selectable',
    statement:
      'A player equips a skin per target (one hero, or one card) from the Collection\'s Heroes and Minions tabs. The server '
      + 'accepts it only when the player owns it, it is made for that exact hero or card and slot, and it is live (not '
      + 'retired); anything else is refused and the loadout stays as it was. "Use default art" (Default) is always '
      + 'selectable, even for a retired item. The client never writes ownership or the loadout itself.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (skins v1 brief)', quote: 'they will be manually equipping skins on their own anyways' },
      { kind: 'code', ref: 'supabase/migrations/2026-09-28-progression-skins.sql (equip_cosmetic); packages/progression/src/inventory.ts (equip_cosmetic); packages/ui/src/progression/CollectionScreen.tsx' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28.',
    enforcement: { kind: 'scenario', refs: ['packages/progression/src/skins.db.test.ts', 'packages/progression/src/skins.test.ts', 'packages/ui/src/progression/CollectionSkins.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },  {
    id: 'R-PROG-SKINS-06',
    title: 'Black Belt Brian has three crate skins, one per rarity (Rare, Epic, Legendary); Bellringer Voss has an Epic one',
    statement:
      'Black Belt Brian (card id blackbelt) has three minion skins in the crate pool: skin_blackbelt_1 (Rare), skin_blackbelt_2 '
      + '(Epic) and skin_blackbelt_3 (Legendary). Each ships its own art (packages/ui/src/art/skins/<id>.webp), and its master '
      + 'is named for its rarity (BlackBeltBrianSkinRare / SkinEpic / SkinLegendary.png). Bellringer Voss (card id '
      + 'n2_bellringer) has one Epic minion skin, skin_bellringer_1 (master BellringerVossSkinEpic.png). With both added, '
      + 'the first-crate odds were Common 47.6%, Rare 31.5%, Epic 19.3%, Legendary 1.7%, and a skin 30.6% (re-pinned when the '
      + 'first hero attack joined the pool: R-PROG-ATTACK-01).',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Legendary Brian skin)', quote: 'i added a legendary black belt brian skin and renaemd skins to match their rarity' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Bellringer Voss skin)', quote: 'put the bellringer voss skin in too' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (COSMETICS, skin_blackbelt_3, skin_bellringer_1); packages/ui/src/art/skins/skin_blackbelt_3.webp + skin_bellringer_1.webp' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28. Reaches the database on the next deploy of progression-inventory (the catalog sync, R-PROG-SKINS-05).',
    enforcement: { kind: 'scenario', refs: ['packages/progression/src/skins.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/skins/skins.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-SKINS-07',
    title: 'Skins batch 2: thirteen more minion skins join the crates, rarity from the owner filenames',
    statement:
      'Thirteen minion skins from C:/Game Assets/Ascent Art/Skins/Minion Skins are crate items, each targeting its card by '
      + 'stable id and shipping its own art (packages/ui/src/art/skins/<id>.webp): skin_blackbelt_4 (Common, Black Belt '
      + 'Brian), skin_drummer_1 (Rare), skin_drummer_2 and skin_drummer_3 (Epic) for the Drakko MINION (card id drummer, not '
      + 'the hero), skin_jenkins_1 (Rare, Jensen & Fi), skin_joker_1 (Rare, Mysterious Joker), skin_nimbus_1 (Rare, Nimbus), '
      + 'skin_paragon_1 (Rare, the Set 2 Paragon, not Deepdelve Paragon), skin_stewardofspells_1 (Epic, Steward of Spells; '
      + 'master SpellStewardSkinEpic.png), skin_sylus_1 (Rare) and skin_sylus_2 (Legendary) for Sylus, skin_venom_1 (Epic, '
      + 'Venom) and skin_zyff_1 (Rare, Zyff, the Betrayer). Names are placeholders for the owner to rename (ids stay). With '
      + 'them in, the first-crate odds are Common 29.6%, Rare 50.7%, Epic 16.6%, Legendary 3.1%, and a non-title item 71.2% '
      + '(total weight 19515).',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (skins batch 2)', quote: 'i added some skins here: can you wire those up now?' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (COSMETICS, skins batch 2); packages/ui/src/art/skins/*.webp' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28. Reaches the database on the next deploy of progression-inventory (the catalog sync, R-PROG-SKINS-05).',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/skins/skins.test.tsx', 'packages/progression/src/skins.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/progression/CollectionSkins.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-COLLECTION-03',
    title: 'The crate opening draws the owner\x27s two-layer treasure chest: the lid blasts off, the open body stays',
    statement:
      'The crate in the opening is the owner\x27s chest art in two layers, a body and a lid (apps/web/public/collection/'
      + 'crate_body.webp and crate_lid.webp), the lid seated on the rim with its notch over the lock spike. While it waits '
      + 'the whole chest breathes and shakes and the lid jumps on each pulse; light in the rarity colour leaks from the seam '
      + 'between lid and body and from the keyhole, never from cracks. At the burst the lid blasts off (up, spinning, under '
      + 'gravity) and a light column pours out of the open body, with shards from the rim; the open body stays on the '
      + 'pedestal, glowing, while the nameplate rises above it. Legendary: the lid pops on the first burst, the body '
      + 'flashes on the second. If either layer cannot load, a painted chest stands in whole; a single-picture override '
      + '(the crateArt tuner key) still replaces the two layers. Presentation only.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (chest art)', quote: 'added new chest pngs here: C:\\Game Assets\\Ascent Art\\Collection Stuff can you wire this up to work' },
      { kind: 'code', ref: 'packages/ui/src/progression/crateFx/chestModel.ts (CHEST_ART, artChestModel, loadChestImages); crateScene.ts (the lid, seam and keyhole light, launchLid); crateFxPixi.ts (bake: the art or the painted fallback)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/progression/crateFx/crateFx.test.ts', 'packages/ui/src/progression/Crates.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-ACH-01',
    title: 'Achievements batch 1 pay XP only: 248 achievements, no titles yet, nothing hidden yet; the reward slot can take a title later',
    statement:
      'The first achievements pay Account XP and nothing else: Career, Ranked, Heroes (Debut, Contender, Victory, Mastery for '
      + 'each of the 33 playable heroes), Economy and Build, Mechanics, Runes and Set 2 (by tribe, plus cross-tribe and rune '
      + 'feats). Every definition carries a reward slot for a title, left empty, so a title can be attached later without a '
      + 'migration. The framework supports hidden achievements, but none ship yet. Set 2 feats count only in Set 2 runs.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (achievements batch 1 brief)', quote: "let's just get the normal xp related achievements in for now though." },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (achievements batch 1 brief)', quote: 'we need set 2 achievements because that is the active set right now.' },
      { kind: 'code', ref: 'packages/progression/src/achievements.ts (ACHIEVEMENTS, rewards.titleId, hidden)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28 (off until the owner sets progression_config.achievements_epoch). Extended 2026-09-29 by R-ACH-04: the hero Titled (new, 3 Ranked 1sts) and Mastery tiers now fill the title slot (281 achievements); every other achievement still pays XP only.',
    enforcement: { kind: 'scenario', refs: ['packages/progression/src/achievements.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-ACH-02',
    title: 'Achievements are evaluated inside the settlement: XP in the same transaction as the match XP, never twice, nothing before the epoch',
    statement:
      'settle_progression evaluates every live achievement against the game it settles, under the same lock and in the same '
      + 'transaction as the match XP. A completion is written at most once per account and its XP lands on the same ledger row '
      + '(so it also levels the account and earns crates). A duplicate settlement returns the original result and evaluates '
      + 'nothing again. Nothing is evaluated before the owner sets the achievements epoch, and a game recorded before it never '
      + 'counts. Server-known facts (the game, placement, comeback, rank result, Career-best rank, distinct heroes) come from '
      + 'the database; a client can never supply them. Assumed defaults (the owner can flip them): Practice counts for any-game '
      + 'achievements only with Normal Health and a turn timer; rank achievements pay from the Career best on the first game '
      + 'after launch; rank names use the ascending 1/2/3 numerals; hero Victory and Mastery count Ranked only.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (achievements batch 1 brief)', quote: "let's just get the normal xp related achievements in for now though." },
      { kind: 'code', ref: 'supabase/migrations/2026-09-28-achievements.sql (settle_progression step 7b, sync_achievement_catalog); packages/progression/src/achievements.ts evaluateAchievements' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28.',
    enforcement: { kind: 'scenario', refs: ['packages/progression/src/achievements.db.test.ts', 'packages/progression/src/sqlParity.test.ts', 'packages/sim/src/achievementMetrics.test.ts'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-ACH-03',
    title: 'The Career has an Achievements tab after Practice: every achievement shows with its reward; a hidden one is a blurred "Hidden" tile',
    statement:
      'Once achievements are switched on, the Career shows an Achievements tab right after Practice, on your own Career and '
      + "on anyone else's. Categories (Career, Ranked, Heroes, Economy and Build, Mechanics, Runes, Set 2 by tribe) carry "
      + 'done / total counts, and All / Completed / In progress filters. Each tile shows the name, the exact requirement, the '
      + 'reward ("+150 XP"), the completion date once done, and on your own page a progress bar for a counting achievement '
      + '(progress values stay private). A hidden achievement shows as a blurred "Hidden" tile with no name, requirement or '
      + 'reward until completed. After a game, the Account XP panel lists "Achievement unlocked: <name> +N XP" rows.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (achievements batch 1 brief)', quote: `we'll need an achievements tab in career next to practice. most should show, with their reward, but the hidden ones will be blurred or say "Hidden"` },
      { kind: 'code', ref: 'packages/ui/src/progression/AchievementsTab.tsx; packages/ui/src/progression/achievementsModel.ts; packages/ui/src/progression/ProgressionPostgame.tsx; packages/ui/src/Career.tsx' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28. The 3 Career showcase slots are a follow-up.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/progression/AchievementsTab.test.tsx', 'packages/ui/src/progression/ProgressionPostgame.test.tsx', 'packages/ui/src/Career.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-ACH-04',
    title: 'Hero titles: 3 Ranked 1sts with a hero grant its title (the Titled tier); 10 grant its golden MASTER version, which upgrades the same title in place',
    statement:
      'Every playable hero has a title (Warden "Warded", Gambler "Gambling Addict", Albus "Albus Student", ...). A new hero '
      + 'achievement tier, Titled (hero.<id>.titled, 150 XP), completes at 3 Ranked 1st-place finishes with that hero and '
      + 'grants the title (title_hero_<id>, Epic, the normal title look). The existing Mastery tier (hero.<id>.mastery, 10 '
      + 'Ranked 1sts, 250 XP) now grants the master version (title_hero_<id>_master): the SAME name, shown as a golden plate '
      + 'with embroidered text. Victory (1 Ranked 1st, 100 XP) stays XP only. Practice never counts toward either (Ranked '
      + 'only, like Victory). The grant happens inside settle_progression, in the same transaction as the completion: the '
      + 'title is owned (player_cosmetics, keyed, never twice) and listed in the result\x27s unlockedTitles. The master '
      + 'supersedes the base title: a worn base title is swapped for its master the moment it is earned, and the Collection '
      + 'shows one entry per hero title (the master once owned, else the base). A new hero title is worn only when nothing '
      + 'is worn. Hero titles are achievement rewards and never drop from a crate. Existing Mastery progress backfills the '
      + 'Titled tier (a backfilled completion grants the title but pays no XP).',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (hero titles)', quote: 'the hero\x27s title is granted at 3 wins with a hero, then the mastery of that title is after 10 wins with that hero' },
      { kind: 'code', ref: 'packages/progression/src/achievements.ts (heroDefs, HERO_TITLE_WINS, HERO_MASTERY_WINS); packages/progression/src/cosmetics.ts (HERO_TITLE_NAMES, HERO_TITLE_COSMETICS, titleShelf, isMasterTitle); packages/progression/src/server.ts (settlementParity); supabase/migrations/2026-09-29-hero-titles.sql (settle_progression steps 7c + 9a, the backfill); packages/ui/src/progression/collectionModel.ts (albumOf)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29. Live once the owner runs supabase/migrations/2026-09-29-hero-titles.sql and redeploys submit-progression and progression-inventory.',
    enforcement: { kind: 'scenario', refs: ['packages/progression/src/heroTitles.db.test.ts', 'packages/progression/src/achievements.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/progression/src/sqlParity.test.ts', 'packages/ui/src/progression/CollectionScreen.test.tsx'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-TITLE-04',
    title: 'A master hero title renders as a golden plate with embroidered text on every surface that shows a title, as static CSS',
    statement:
      'Wherever a title is shown (the Career name header, the Collection album tile, detail nameplate and preview, the New '
      + 'rewards popup, the Achievements tab reward line, the Leaderboard, the Hall of Champions and Match details), a hero '
      + 'title\x27s MASTER version (title_hero_<id>_master) is painted by TitleBadge as a bevelled metallic gold plate with a '
      + 'dashed thread stitch inside its edge and the name embroidered in crimson satin stitch (thread strands clipped to '
      + 'the letters over a raised, outlined underside). Its text content is exactly the title name (no native tooltip, no '
      + 'own cursor), a custom title style never paints over it, and it is entirely static: no animation, transition or '
      + 'will-change on any .tb-master rule. The base hero title keeps the normal rarity look.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (hero titles)', quote: 'the master title should be a golden plate and embroidered text' },
      { kind: 'code', ref: 'packages/ui/src/titles/TitleBadge.tsx; packages/ui/src/titles/titleStyle.ts (TitleLook.master); packages/ui/src/styles.css (.titlebadge.tb-master); packages/ui/src/Career.tsx; packages/ui/src/progression/CollectionScreen.tsx; packages/ui/src/progression/NewRewardsPopup.tsx; packages/ui/src/progression/AchievementsTab.tsx' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/titles/titles.test.tsx', 'packages/ui/src/progression/CollectionScreen.test.tsx'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-ATTACK-01',
    title: 'Hero attacks are cosmetics: Classic is everyone\'s default, Blast ("Arcane Barrage", attack_blast, Legendary) drops from crates',
    statement:
      'The hero_attack cosmetic category is live. Its first item is attack_blast (placeholder name "Arcane Barrage", Legendary, '
      + 'crate-sourced, account-wide: target global, no hero or card), whose assets name the animation it plays (style blast). '
      + 'Nobody plays Blast by default: without an equipped hero attack the post-combat blow is the Classic lunge. It is '
      + 'equipped in the Collection\'s Attack Animations tab (Equip, or "Use Classic" to take it off) through equip_cosmetic '
      + 'with slot hero_attack and target \'\' (the SQL refuses any other target, an unowned item, a skin in the attack slot '
      + 'and the attack in a skin slot). The owner approved the animation and made it a Legendary reward. The second hero '
      + 'attack, attack_quake ("Tectonic Slam", Legendary, style quake: R-PROG-ATTACK-05), the third, attack_arcana '
      + '("Arcana", Legendary, style arcana: R-PROG-ATTACK-06), the fourth, attack_blades ("Phantom Blades", Legendary, '
      + 'style blades: R-PROG-ATTACK-07), the fifth, attack_enraged ("Enraged Strike", Legendary, style enraged: '
      + 'R-PROG-ATTACK-11), the sixth, attack_poison ("Venom Volley", Legendary, style poison: R-PROG-ATTACK-12), the '
      + 'seventh, attack_frost ("Frost Nova", Legendary, style frost: R-PROG-ATTACK-13), and the eighth, attack_holy '
      + '("Consecration", Legendary, style holy: R-PROG-ATTACK-14), re-pinned the first-crate odds to Common 45.5%, Rare '
      + '30.2%, Epic 18.5%, Legendary 5.9%; a non-title item 33.5%; the eight attacks together 4.3%. The ninth, attack_fire '
      + '("Inferno", Legendary, style fire: R-PROG-ATTACK-15), joined under the fixed rarity odds (2026-09-29: a Legendary '
      + 'is 5%, shared equally by its items), making Legendary twelve items at 0.417% each and the nine attacks together 3.75%. The tenth, attack_undead '
      + '("Grave Call", Legendary, style undead: R-PROG-ATTACK-17), joined the same day under the same fixed odds, making '
      + 'Legendary thirteen items at 0.385% each and the ten attacks together 3.85%. The eleventh, attack_beast '
      + '("Stampede", Legendary, style beast: R-PROG-ATTACK-18), joined the same day under the same fixed odds, making '
      + 'Legendary fourteen items at 0.357% each and the eleven attacks together 3.93%. The twelfth, attack_banana '
      + '("Oona\x27s Banana Cannon", Legendary, style banana: R-PROG-ATTACK-19), joined the same day under the same fixed '
      + 'odds, making Legendary fifteen items at 0.333% each and the twelve attacks together 4%. The thirteenth, '
      + 'attack_bleed ("Hemorrhage", Legendary, style bleed: R-PROG-ATTACK-21), joined the same day under the same fixed odds, '
      + 'making Legendary sixteen items at 0.3125% each and the thirteen attacks together 4.06%. The four Rare attacks '
      + '(attack_coin, attack_boomerang, attack_bubble, attack_backstab: R-PROG-ATTACK-28 to 32) made Rare seventeen items '
      + 'at 1.765% each; every hero attack together is now 11.1% of a first crate.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Blast hero attack)', quote: 'the new blast attack is going to be a cosmetic unlock, not a new default' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Blast approval)', quote: 'those are good thresholds, this blast animation looks good! make it a legendary reward' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (hero_attack enabled, attack_blast, heroAttackOf, EQUIP_SLOTS); supabase/migrations/2026-09-28-progression-hero-attack.sql; packages/ui/src/progression/CollectionScreen.tsx' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28. The item reaches the database on the next deploy of progression-inventory (the catalog sync); equipping needs the hero attack migration run.',
    enforcement: { kind: 'scenario', refs: ['packages/progression/src/cosmetics.test.ts', 'packages/progression/src/heroAttack.db.test.ts', 'packages/ui/src/progression/CollectionHeroAttack.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-ATTACK-02',
    title: 'The STRIKER\'s hero attack plays: yours when you win, theirs (from their recorded snapshot) when they win; unknown or retired = Classic',
    statement:
      'The equipped hero attack is recorded in the run\'s cosmetic snapshot (heroAttack) and rides every captured board and '
      + 'lobby seat, like skins. When a fight ends, the winning side\'s hero attack plays: yours from your run\'s snapshot, '
      + 'the opponent\'s from their seat\'s recorded snapshot (only while "Show opponent cosmetics" is on). Replays use the '
      + 'recorded snapshot. An unknown, retired or unrecognised id always falls back to Classic. A DEV-only override (the '
      + 'Blast tuner\'s Attack style row) can force a style for both sides; production ignores it, and there is no '
      + 'player-facing style setting outside the Collection.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Blast hero attack)', quote: 'the new blast attack is going to be a cosmetic unlock, not a new default' },
      { kind: 'code', ref: 'packages/ui/src/heroBlast/heroAttackStyle.ts (resolveHeroAttackStyle); packages/ui/src/heroBlast/attackerCosmetic.ts; packages/sim/src/snapshot.ts (scopeCosmetics); packages/sim/src/lobby/snapshotSeats.ts' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroBlast/heroBlast.test.ts', 'packages/sim/src/lobby/seatCosmetics.test.ts'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-ATTACK-03',
    title: 'A hero attack is presentation only: it shows the ENGINE\'s blow and lands the consequence exactly once, on its impact beat',
    statement:
      'Whatever style plays, the blow is the engine\'s (heroStrikeDamage: the capped enemyDamage on a win, playerLossDamage '
      + 'on a lobby loss). The shared damage formation (R-PROG-ATTACK-08) builds that value on screen from the engine\'s own numbers '
      + '(never a DOM sum), and Blast fires the consequence (the health drop, Armor first, via settleCombat) exactly once, on the frame the '
      + 'lead bolt lands or, at IV, the supernova detonates; if frames stop, a safety timer still lands it. Blast escalates in FOUR '
      + 'distinct steps on the shared damage tiers (thresholds 6 / 12 / 20, owner-approved), the way Arcana and Frost ladder '
      + '(owner 2026-09-29): I 1-5 ONE bolt; II 6-11 a volley of TWO; III 12-19 a BARRAGE of five fanned bolts (the lead bolt '
      + 'lands the blow, the rest pound in after it) with secondary explosions and embers; IV 20+ the colossal beam, which '
      + 'lands as a tick (FX only), holds, then POURS into the struck hero (its tail races after its front) while the light '
      + 'implodes onto it, and detonates in an arcane SUPERNOVA (rays, three shockwaves, a corona, secondary explosions): the '
      + 'blow lands on the detonation, never on the beam landing. Under reduced motion it is fades only (no flight, bolts, shake or '
      + 'zoom). No hero attack ever freezes its clock (R-PROG-ATTACK-10). Leaving the fight mid-animation cancels it without landing, exactly as Classic\'s timers are cleared.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Blast approval)', quote: 'those are good thresholds, this blast animation looks good! make it a legendary reward' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Blast hero attack)', quote: 'i want the numbers to all combine, and then the screen slightly shakes and zooms as he blasts pixi blasts from the hero to the opponent to deal the damage' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Blast fourth tier)', quote: 'use the same 4 tier strategy we have been. add a tier to the blast attack so they all have 4' },
      { kind: 'code', ref: 'packages/ui/src/heroBlast/heroBlastConfig.ts (blastPlan, blastCues, tierOf, TIER_DEFAULTS Bolts / Beam / Nova); packages/ui/src/heroBlast/heroBlast.ts (playHeroBlast, cameraAt); packages/ui/src/heroBlast/heroBlastScene.ts (the beam drain, collapse, nova); packages/ui/src/heroBlast/heroStrikeDamage.ts; packages/ui/src/Recruit.tsx' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28; the four-step ladder (a barrage of five at III, the supernova at IV) 2026-09-29.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroBlast/heroBlast.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-ATTACK-04',
    title: 'Every hero attack anchors on the centre of each round portrait AT REST (never a wrapper, never mid-entrance)',
    statement:
      'Blast and Quake both measure the two heroes once, at the start of the attack, on the round portrait ART (the player\x27s '
      + '.heroimg, the foe\x27s .combatopp-img), not on a wrapper (the player\x27s also holds the name pill). Any CSS animation '
      + 'still running on the foe portrait (its drop-in, mid-flight when a tuner preview mounts it) is seeked to its end for '
      + 'that one measure and put back, so the impact, the ring and the -N always land centred on the portrait, in combat, '
      + 'in replays and in the shop preview. This fix changed Blast too (it shares the anchor).',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Quake anchor bug)', quote: 'you can see the foe area isnt centered. can you fix that? may be wrong for blast too' },
      { kind: 'code', ref: 'packages/ui/src/heroBlast/portraits.ts (portraitGeometry, restingRect)' },
    ],
    currentBehaviour: 'Conforms, fixed 2026-09-28.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroBlast/portraits.test.ts'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-ATTACK-05',
    title: 'Quake ("Tectonic Slam", attack_quake, Legendary): tiers I-III hurl boulders into stone spikes; only the huge hit (IV) is an earthquake that erupts; the SAME damage tiers as Blast',
    statement:
      'attack_quake (placeholder name "Tectonic Slam", Legendary, crate, account-wide, style quake) plays the Quake: the shared '
      + 'damage formation (R-PROG-ATTACK-08: the minion tiers and the hero tier build the engine\x27s blow), then the attacking hero '
      + 'rises and stomps. Tiers I-III (1-19) have NO crack line: boulders are ripped out of the ground and lobbed onto the '
      + 'target (I one, II two, III three hot ones; earlier boulders land as ticks), and a crown of stone spikes bursts out '
      + 'round the struck portrait with a spray of molten grit. Only Tier IV (20+) is an EARTHQUAKE: the board rumbles, a '
      + 'quick fracture (under 350 ms) races to the target and the ground ERUPTS: a light burst, a shock ring, spikes, a '
      + 'violent upward spray of magma, a geyser of molten streaks, dust and tumbling rock (an emitter, never a solid column), '
      + 'embers, a crater, follow-up explosions. The spikes are clusters of seeded, hand-painted rock shards (lit, mid and '
      + 'shadow faces, grain, a rim highlight, a contact scorch), never cones or cylinders. One shared tierOf and the shared '
      + 'thresholds 6 / 12 / 20. Presentation only: the consequence lands once, on the last boulder or the eruption; reduced '
      + 'motion is fades only; an unknown or retired id plays Classic.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Quake hero attack)', quote: 'branch off and make a new attack animation called quake. same attack dmg threshold logic as blast. the concept being an earthquake attack essentially with varying degrees of strength/cracks/explosions' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Quake review)', quote: 'quake looks solid' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Quake rework)', quote: 'the quake animation is not up to par with the others. can you take a quick pass at improving that? maybe only the huge hit should quake, and the others can be slightly different? i think the line animation is over used. i also think the quake itself could look a bit better, maybe faster but then have pixi burst out of it almost like an eruption.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Quake polish)', quote: 'i dont like the cylinder/cones you put in here, it looks pretty sloppy and obviously ai. can you please add some more polish to this?' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_quake); packages/ui/src/heroQuake/ (heroQuakeConfig quakePlan, heroQuake playHeroQuake, heroQuakeScene); packages/ui/src/heroAttack/ (the shared core: tiers, combine numbers, one clock, stage camera, voices)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28. The item reaches the database on the next deploy of progression-inventory (the catalog sync); the equip SQL already accepts the hero_attack slot.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroQuake/heroQuake.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/progression/CollectionHeroAttack.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-ATTACK-06',
    title: 'Arcana (attack_arcana, Legendary) is the third hero attack: magic ribbons lobbed from the hero, 1 / 2 / a barrage of 5 / a vortex that explodes, on the SAME damage tiers; the blow lands ONCE',
    statement:
      'attack_arcana ("Arcana", the owner\x27s name; Legendary, crate, account-wide, style arcana) plays Arcana: the shared damage '
      + 'formation (R-PROG-ATTACK-08: the minion tiers and the hero tier build the engine\x27s blow), a charge (an arcane circle opens '
      + 'under the striking hero), then clean magic RIBBONS (a tapering strip with a violet body, a white-hot core, a cyan strand '
      + 'and a sigil orb at the head) lobbed on high arcs from the hero. It escalates on exactly the tiers Blast and Quake use '
      + '(one shared tierOf, thresholds 6 / 12 / 20): I 1-5 ONE ribbon; II 6-11 TWO on different heights and opposite sides; '
      + 'III 12-19 a BARRAGE of FIVE fanned arcs landing in rhythm; IV 20+ the ribbons swirl into a vortex over the struck '
      + 'hero\x27s frame that tightens and speeds up, converge and EXPLODE outward. The consequence (the damage, Armor, Resolve) '
      + 'lands exactly ONCE: on the LAST ribbon (every earlier barrage ribbon is a tick with FX only) or, at IV, on the explosion. '
      + 'Presentation only; reduced motion is fades only; an unknown or retired id plays Classic. The owner named Arcana the '
      + 'quality bar for hero attack animations.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Arcana hero attack)', quote: "let's branch out and make one more attack animation, same setup as the last 2, but let's make like a magic one called arcana. tier 1 attack will be s clean pixi ribbon arc'd and lobbed from hero location. tier 2 attack will be 2 of those. tier 3 attack will be barrage of 5 of those. tier 4 attack will be a swirl of them over the opponent hero frame and then they explode and ribbon/pixi blast outward" },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Arcana review)', quote: 'arcana looks so god damn good' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_arcana); packages/ui/src/heroArcana/ (heroArcanaConfig arcanaPlan / arcanaCues / ribbonMotions, heroArcana playHeroArcana, heroArcanaScene); the shared core in packages/ui/src/heroAttack/' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28. The item reaches the database on the next deploy of progression-inventory (the catalog sync); the equip SQL already accepts the hero_attack slot.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroArcana/heroArcana.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/progression/CollectionHeroAttack.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-ATTACK-07',
    title: 'Phantom Blades (attack_blades, Legendary) is the fourth hero attack: summoned swords aim, lock and thrust straight in, 1 / a crossed 2 / a fan of 5 / 6 and a greatsword, on the SAME damage tiers; the blow lands ONCE',
    statement:
      'attack_blades ("Phantom Blades", a placeholder name for the owner to rename; Legendary, crate, account-wide, style blades) '
      + 'plays the Blades: the shared damage formation (R-PROG-ATTACK-08: the minion tiers and the hero tier build the engine\x27s '
      + 'blow), then spectral swords are SUMMONED round the striking hero (each assembles out of flying slivers, raised to the sky), '
      + 'swing round to AIM at the target, LOCK dead still for a breath, and are loosed in dead-straight THRUSTS (a kick back, '
      + 'afterimages, a cut of light) that STICK in the struck hero and quiver. It escalates on exactly the tiers every other '
      + 'hero attack uses (one shared tierOf, thresholds 6 / 12 / 20): I 1-5 ONE blade; II 6-11 a PAIR whose thrusts cross in '
      + 'an X; III 12-19 a FAN of FIVE that hammer in, in rhythm; IV 20+ six blades hammer in as ticks, then a GREATSWORD is '
      + 'summoned, swung round to aim and held trembling while a reticle locks onto the target and the stuck blades are bound '
      + 'to it, and is loosed to impale the target. The consequence (the damage, Armor, Resolve) lands exactly ONCE: on the '
      + 'LAST blade (every earlier blade is a tick with FX only) or, at IV, on the greatsword; every stuck blade then SHATTERS '
      + '(FX only). Presentation only; reduced motion is fades only; an unknown or retired id plays Classic.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (the fourth hero attack)', quote: 'branch off and make a new style animation and surprise me with it. arcana is top tier good. use that as your benchmark for quality. make it unique' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_blades); packages/ui/src/heroBlades/ (heroBladesConfig bladesPlan / bladesCues / bladeMotions / bladePose, heroBlades playHeroBlades, heroBladesScene); the shared core in packages/ui/src/heroAttack/' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28. The item reaches the database on the next deploy of progression-inventory (the catalog sync); the equip SQL already accepts the hero_attack slot.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroBlades/heroBlades.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/progression/CollectionHeroAttack.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-ATTACK-08',
    title: 'Every hero attack (Classic and every cosmetic) opens with ONE shared damage formation: minion tiers pulse left to right and merge, the hero tier joins, the full blow shows, then reduces to the cap; every number is the engine\x27s',
    statement:
      'Before the attack itself, identically for Classic, Blast, Quake, Arcana and Phantom Blades (one implementation, '
      + 'packages/ui/src/heroAttack/damageFormation.ts and formationConfig.ts): (1) each surviving minion of the striking side, '
      + 'LEFT TO RIGHT, pulses its tier badge and its tier number pops up above it with a rising tick (the stagger compresses '
      + 'on a big board); (2) the numbers flow toward the middle (up off your row, down off the foe\x27s) and MERGE into one '
      + 'minion number; (3) the striking hero\x27s tier number pops in at the hero; (4) the minion number JOINS it (the default; '
      + 'the tuner can play the other direction); (5) the FULL blow slams in; (6) ONLY when the round cap cut the blow: a slash '
      + 'hits the full number (a flash and a jolt, never a freeze) and it counts down to the cap at once and a "Damage capped" stamp slams on and holds; then '
      + '(7) the style\x27s own attack carries the final number and lands the consequence once, on its impact beat (Classic: the '
      + 'hero lunges, R-PROG-ATTACK-09). Every number is the ENGINE\x27s: the fight\x27s own breakdown '
      + '(damageBreakdown on a loss, enemyDamageBreakdown on a win, each with the survivors\x27 uids), the blow before the cap '
      + '(playerDamageUncapped / enemyDamage) and the round cap the run loop stamped (damageCap); a result recorded before '
      + 'those fields plays what it knows (no breakdown: just the blow; no cap stamp: no cap beat). Reduced motion keeps every '
      + 'stage as quick fades. Presentation only.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (the damage formation)', quote: 'we need to change the dmg numbers / should have the tier section pulse with the number showing up from left to right / have them all flow up and merge into a single numbere / then the hero tier dmg shows / and joins / or the minion tier dmg number joins the hero number / and then have the full dmg show / then a moment where it reduces to the cap / and said damage capped / and then the attack happens / purely a change in how the dmg formation happens/shows' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (scope)', quote: 'apply it to ALL attacks' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (first review)', quote: 'dmg tally looks decent, i think it needs to slow down between steps slightly so it\x27s a bit more obvious what\x27s happening. like when it gets slashed and says capped - it all looks fantastic just needs to be a bit slower and oomphier in general but it is a great start' },
      { kind: 'code', ref: 'packages/ui/src/heroAttack/ (damageFormation, formationConfig, formationRunner, badgeAnchors); packages/ui/src/heroBlast/heroStrikeDamage.ts (heroStrikeNumbers); packages/core/src/combat/simulate.ts (enemyDamageBreakdown, survivorUids); packages/sim/src/reducer.ts (damageCap, playerDamageUncapped)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroAttack/damageFormation.test.ts', 'packages/sim/src/damageFormationData.test.ts'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-ATTACK-09',
    title: 'Classic, the free default hero attack, plays on the same one clock as the cosmetic attacks: no green / red number pill, the ORIGINAL swing speed, a basic but impactful hit with a subtle camera',
    statement:
      'After the shared damage formation (R-PROG-ATTACK-08) the number sinks into the striking hero, who plays the ORIGINAL '
      + 'Classic swing: a minion attack\x27s wind-up, the distance-scaled strike leading with a corner and its ease, the '
      + 'rebound off the clack and the elastic settle (the Lunge tuner\x27s values, run at the old 1.15 tempo). On contact: a '
      + 'the shared strike burst and smack (no freeze), a small squash and knockback on the struck portrait, a SUBTLE '
      + 'camera punch and shake (well under the Legendary attacks\x27), and the same big -N every attack punches onto the '
      + 'target; the consequence lands exactly once, on contact. The old green attack pill on the striking hero and the red '
      + 'damage-taken number on the struck one are retired (both directions). The stretch from the join to the capped '
      + 'number plays slower (a longer join, more hold on the full total, a longer count-down, a longer stamp hold). '
      + 'Presentation only; reduced motion is fades only.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Classic cleanup)', quote: 'do we just remove the green/red number pill from the hero windup for the normal animation? can you clean up the normal animation so it\x27s a bit more in line with these? i think slightly slowing down the combination -> capped speed so it\x27s a bit more readable in general is important too' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Classic speed)', quote: 'try and match the same speed as how it was for the wind up and normal hit. it should be basic but impactful. dont over do the zoom/shake.' },
      { kind: 'code', ref: 'packages/ui/src/heroAttack/heroClassic.ts (classicSwing, strikePose, playHeroClassic); packages/ui/src/heroAttack/classicConfig.ts; packages/ui/src/heroAttack/formationConfig.ts (the slower join-to-cap defaults)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroAttack/damageFormation.test.ts'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-ATTACK-10',
    title: 'No hero attack ever freezes: no hit-stop or freeze frame in Classic, Blast, Quake, Arcana, Phantom Blades or the damage formation',
    statement:
      'The hero-attack clock never stops. There is no hit-stop on any impact (Classic, Blast, Quake, Arcana, Phantom Blades), '
      + 'no freeze on Quake\x27s slam, no freeze on the damage formation\x27s cap slash (the count-down starts on the '
      + 'slash), and no pinning of the clock to a beat: every frame advances it by exactly the time played. Impacts keep '
      + 'their weight through the flash (each impact starts at its brightest), the squash and knockback, the shake, the '
      + 'particles and the sound. The shared clock (packages/ui/src/heroAttack/sequence.ts) has no way to hold, and no tuner '
      + 'offers a hit-stop. The consequence still lands exactly once, on the impact beat.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (hit-stop removal)', quote: 'all of them seem to have some hit stun freeze frame? i dont want that. remove the freezeing frame from all of the animations. it looks like lag' },
      { kind: 'code', ref: 'packages/ui/src/heroAttack/sequence.ts (no hitStop, no freeze beats); every style config (no HitStop / SlamStop dials); packages/ui/src/heroAttack/formationConfig.ts (crunchAt = capFrom); packages/ui/src/heroAttack/classicConfig.ts' },
    ],
    currentBehaviour: 'Conforms, fixed 2026-09-28.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroAttack/damageFormation.test.ts'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-ATTACK-11',
    title: 'Enraged Strike (attack_enraged, Legendary) is the fifth hero attack: CLASSIC\'s own lunge, enraged; one hit / a double / a combo of three / a rampage and an overhead haymaker on the SAME damage tiers; every hit a full cycle that reads on contact; the blow lands ONCE; no freeze',
    statement:
      'attack_enraged ("Enraged Strike", a placeholder name for the owner to rename; Legendary, crate, account-wide, style '
      + 'enraged) plays Classic\x27s swing enraged: after the shared damage formation (R-PROG-ATTACK-08) the striking hero '
      + 'plays the SAME swing Classic does (R-PROG-ATTACK-09: its coil direction, its distance-scaled strike and ease, its '
      + 'rebound and elastic settle, at its tempo), amplified: a deeper coil and a bigger '
      + 'swell while a rage aura burns round the portrait (flame tongues licking off the rim, a hot rim and a halo, charge '
      + 'rings closing in, hot motes pulled in, a rising growl) that peaks in a RAGE BURST just before the drive (the portrait '
      + 'flares, heat-shimmer rings tear off the rim, a roar), a dash that leaves crisp afterimages of the portrait, a rage '
      + 'streak and a scorch skid on the ground. THE HIT READS ON CONTACT (polish 2026-09-28): unlike Classic, the striker '
      + 'stops with its rim at the struck portrait\x27s rim (never over its face) and stays planted a beat, so on the contact '
      + 'frame the struck face shows a white flash, crisp shockwave rims, bold red claw rips with white-hot cores (raked on '
      + 'the side away from the big -N), glowing rage cracks on its rim, its knockback and squash, and sparks that bounce '
      + 'back toward the middle of the screen (a hero in a corner keeps its spray in view). EVERY HIT IS A FULL CYCLE '
      + '(polish 2026-09-28): after each hit the striker RECOILS hard off the foe (stretched), COILS (squashed, trembling, '
      + 'a ring tightening onto it), flies back in with its own streak, afterimages and scorch, and lands its own impact '
      + '(a flash, a rip, rim cracks, a spark burst, the foe knocked back, a camera punch), each hit harder than the last. '
      + 'It escalates on exactly the tiers every other hero attack uses (one shared tierOf, thresholds 6 / 12 / 20): I 1-5 '
      + 'ONE enraged hit; II 6-11 a DOUBLE; III 12-19 a COMBO of three, the last a finisher after a deeper wind; IV 20+ a '
      + 'RAMPAGE of five slams that come faster and faster, then the HAYMAKER: the striker rears way back and up over the '
      + 'board at the peak of its rage (the flames tower, the biggest roar, a dark ring of pressure closing in) and brings '
      + 'an overhead blow DOWN on an arc onto the struck hero: a giant flaming crescent, a screen-filling rage shockwave, '
      + 'molten cracks round the struck portrait, rubble, an ember storm and the strongest camera punch (the old meteor is '
      + 'gone). The consequence (the damage, Armor, Resolve) lands exactly ONCE: on the LAST strike (every '
      + 'earlier strike is a tick with FX only) or, at IV, on the haymaker. No hit-stop or freeze anywhere (R-PROG-ATTACK-10). '
      + 'The coil, the rear-back and the haymaker arc are kept inside the screen, so a portrait in a corner stays in view. Presentation only; '
      + 'reduced motion is fades only; an unknown or retired id plays Classic.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (the fifth hero attack)', quote: 'branch off and make one more animation, which is just a legendary version of this strike. it should be a 10x more exciting and oomphier more impactful and pixi animation dense attack animation, but basically a legendary version of this attack, just amplified or enraged.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Enraged first review)', quote: 'enraged needs way more polish. it\x27s a 4/10. pleaes take a huge pass at improving it and cleaning it up' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Enraged polish pass)', quote: 'the enrage animations kinda meh, can you polish it up' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Enraged combo + haymaker)', quote: 'the multi attack ones need to feel more impactful when they reel back, let them fly back in and impact each time. the final hit\x27s entire animation stinks, please fully redo the huge animation for enrage' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Enraged polish review)', quote: 'enrage is much better.' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_enraged); packages/ui/src/heroEnraged/ (heroEnragedConfig enragedPlan / enragedCues / enragedGeo / enragedPose / enragedCameraAt, heroEnraged playHeroEnraged, heroEnragedScene); classicSwing in packages/ui/src/heroAttack/heroClassic.ts' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28. The item reaches the database on the next deploy of progression-inventory (the catalog sync); the equip SQL already accepts the hero_attack slot.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroEnraged/heroEnraged.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/progression/CollectionHeroAttack.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-TITLE-02',
    title: 'The equipped title is RECORDED with the run and shows on out-of-game review surfaces only (Leaderboard, Hall, Match details, Career), never in game',
    statement:
      'The equipped title (profiles.equipped_title_id) is recorded in the run\'s cosmetic snapshot at run start (title), like '
      + 'skins and the hero attack, and rides every captured board, the snapshot seats and replay frames, so a review '
      + 'surface can show the title another player wore in THAT run. Only a live catalog title is recorded or shown; an '
      + 'unknown, retired or non-title id shows nothing; a snapshot from before titles has none; bots and generated seats '
      + 'have none. Titles show ONLY on out-of-game review surfaces: the Leaderboard rows (the player\'s equipped title, read '
      + 'in the same profiles select), the Hall of Champions rows (the title recorded with that run), Match details and the '
      + 'Career. No surface of a live run or a replay\'s gameplay view shows one (the lobby rail, the combat plates, Now '
      + 'Facing, your hero). Another player\'s title follows "Show opponent cosmetics" (off hides it; your own always shows '
      + 'where one can be identified). One component (TitleBadge) paints every title: its rarity colour today, a custom '
      + 'gradient and optional transform-only shimmer keyed by title id later.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (titles in game)', quote: 'it\x27d be cool to show them where possible' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (titles review on 5174)', quote: 'i think it should show in like leaderboard/match details views, but it looks bad in game' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (RunCosmeticSnapshot.title, titleOf, withEquippedTitle, snapshotForRun); packages/sim/src/snapshot.ts (scopeCosmetics); packages/sim/src/lobby/snapshotSeats.ts; packages/ui/src/store.ts (recordRunCosmetics); packages/ui/src/titles/ (TitleBadge, titleStyle); packages/ui/src/Rankings.tsx; packages/ui/src/Leaderboard.tsx' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28. Match details rows (PR #1806) were wired on 2026-09-29: see R-PROG-TITLE-03.',
    enforcement: { kind: 'scenario', refs: ['packages/progression/src/titles.test.ts', 'packages/sim/src/lobby/seatCosmetics.test.ts', 'packages/ui/src/titles/titles.test.tsx'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-TITLE-03',
    title: 'Match details shows every player\x27s title from that run (end screen and Career), your own as recorded, others through "Show opponent cosmetics"; none for bots or older records',
    statement:
      'Each row of Match details (the end screen dialog and the Career match card\x27s inline expand, one component) '
      + 'renders TitleBadge beside the hero name with the title that player wore in that run. The title is read from the '
      + 'seat\x27s recorded cosmetic snapshot, which the stored match record already carries per seat (cosmetics.title, '
      + 'within the record\x27s size cap), so no extra query runs. Your own seat on your own record shows yours as recorded '
      + '(an older record that only kept your titleId still shows it); every other seat, and every seat of someone '
      + 'else\x27s record, goes through "Show opponent cosmetics" (off hides it). A bot seat never shows one; a record '
      + 'from before titles were recorded has none; an unknown or retired title shows nothing.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (titles in game, then the review on 5174)', quote: 'it\x27d be cool to show them where possible … i think it should show in like leaderboard/match details views' },
      { kind: 'code', ref: 'packages/ui/src/matchDetails/MatchScoreboard.tsx (seatTitle, SeatRow); packages/sim/src/lobby/matchDetails.ts (MatchSeat.cosmetics, buildMatchDetails, parseSeat)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/matchDetails/matchDetails.test.tsx', 'packages/sim/src/lobby/matchDetails.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-ATTACK-12',
    title: 'Poison Darts (attack_poison, "Venom Volley", Legendary) is the sixth hero attack: one dart / two / a fan of five / six that stick, swell, IMPLODE and burst in a toxic cloud, on the SAME damage tiers; the blow lands ONCE; no freeze',
    statement:
      'attack_poison ("Venom Volley", a placeholder name for the owner to rename; Legendary, crate, account-wide, style '
      + 'poison): after the shared damage formation (R-PROG-ATTACK-08) the striking hero leans back while venom gathers at '
      + 'the throwing hand, then flicks small poison darts (a dark needle, a venom vial, fletching, a glowing green tip) on a '
      + 'slight arc with a thin toxic vapour trail. Each dart THUNKS into the struck portrait and sticks at its own angle, '
      + 'quivering, on the side of the face clear of the big -N, with a venom splat, green droplets, a tiny toxic puff and a '
      + 'sickly green tint pulse over the portrait (an opacity overlay, never an animated filter); stuck darts ride the '
      + 'knockback. It escalates on exactly the tiers every other hero attack uses (one shared tierOf, thresholds 6 / 12 / '
      + '20): I 1-5 ONE dart; II 6-11 TWO in quick succession; III 12-19 a FAN of five thunking in in rhythm; IV 20+ six '
      + 'darts stick round the face (every one a tick), then they GLOW and PULSE while the venom SWELLS, everything is '
      + 'SUCKED inward into one tight point (a dark ring contracting), and a violent TOXIC BURST lands the blow (a '
      + 'green-black shockwave, bubbling toxic cloud puffs, acid droplets arcing out with gravity, a lingering haze). The '
      + 'consequence (the damage, Armor, Resolve) lands exactly ONCE: on the LAST dart (every earlier dart is a tick with FX '
      + 'and sound only; at I-III the poison then seeps and the darts dissolve, looks only) or, at IV, on the burst. No '
      + 'hit-stop or freeze anywhere (R-PROG-ATTACK-10). Presentation only; reduced motion is fades only; an unknown or '
      + 'retired id plays Classic.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (the sixth hero attack)', quote: 'branch off and make a poison dart animation. the final one should throw multiple poison darts that implode with poison' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Poison Darts review; the look is approved as shipped)', quote: 'the dart one is so good. great stuff.' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_poison); packages/ui/src/heroPoison/ (heroPoisonConfig poisonPlan / poisonCues / dartMotions / stickOffset / poisonCameraAt, heroPoison playHeroPoison, heroPoisonScene); playAcidSizzle / playToxicFizz in packages/ui/src/sfx.ts' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28. The item reaches the database on the next deploy of progression-inventory (the catalog sync); the equip SQL already accepts the hero_attack slot.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroPoison/heroPoison.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/progression/CollectionHeroAttack.test.tsx', 'packages/ui/src/heroAttack/damageFormation.test.ts'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-ATTACK-13',
    title: 'Frost ("Frost Nova", attack_frost, Legendary) is a hero attack: icicles crystallise and fire (one / two / a volley of five), and Tier IV adds a frost nova across the screen that encases and shatters; the blow lands ONCE; the ice freezes, the clock never does',
    statement:
      'attack_frost ("Frost Nova", a placeholder name for the owner to rename; Legendary, crate, account-wide, style frost) '
      + 'plays after the shared damage formation (R-PROG-ATTACK-08): a frost rune opens under the striking hero, a cold mist '
      + 'gathers and faceted ICICLES crystallise one by one round the portrait rim (clear of the face), each aimed at the '
      + 'struck hero; each draws back a hair and fires fast with an ice-dust trail, and shatters on the struck hero into '
      + 'faceted shards and snow while frost creeps over the portrait edge. It escalates on exactly the tiers every other '
      + 'hero attack uses (one shared tierOf, thresholds 6 / 12 / 20): I 1-5 ONE icicle; II 6-11 TWO (from either side); '
      + 'III 12-19 a VOLLEY of five landing in rhythm, the centre one last and biggest; IV 20+ four icicles, then the hero '
      + 'gathers the cold and releases a FROST NOVA, a wide rolling wave front that blasts across the screen from the '
      + 'attacker to the target, freezing an ice sheet with frost ferns behind it; it ENCASES the struck hero in ice, and '
      + 'the ice SHATTERS outward. The consequence (the damage, Armor, Resolve) lands exactly ONCE: on the LAST icicle '
      + '(every earlier icicle is a tick with FX only) or, at IV, on the encasement shattering (every icicle a tick). No '
      + 'hit-stop or freeze anywhere (R-PROG-ATTACK-10): the ice holds still while the shared clock runs on. The camera '
      + 'follows the volley in, pans home for the gather and rides the nova, so neither hero leaves the frame. Presentation '
      + 'only; reduced motion is fades only; an unknown or retired id plays Classic.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (the Frost hero attack)', quote: 'branch off and create an ice/freeze blast one. icicles and then a frost nova blast that blasts across the screen from the attacker to the target' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Frost first review)', quote: 'frost already looks incredibly good.' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_frost); packages/ui/src/heroFrost/ (heroFrostConfig frostPlan / frostCues / icicleMotions / novaMotion / frostCameraAt / frostCameraFocus, heroFrost playHeroFrost, heroFrostScene, heroFrostTextures)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28. The item reaches the database on the next deploy of progression-inventory (the catalog sync); the equip SQL already accepts the hero_attack slot.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroFrost/heroFrost.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/progression/CollectionHeroAttack.test.tsx', 'packages/ui/src/heroAttack/damageFormation.test.ts'], lastVerifiedAt: '2026-09-28' },
  },
  {
    id: 'R-PROG-ATTACK-14',
    title: 'Consecration (attack_holy, Legendary) is a FLAT hero attack: a holy smite / a double smite / a spear rain and smite / SIX swords that ramp in, implode and fire a flat consecrated blast, on the SAME damage tiers; the blow lands ONCE; no freeze',
    statement:
      'attack_holy ("Consecration", a placeholder name for the owner to rename; Legendary, crate, account-wide, style holy) '
      + 'plays a radiant gold-and-white holy attack, drawn FLAT (owner 2026-09-29: no faux-3D): every sigil, rune circle, '
      + 'shockwave ring, consecration ring and crack is a full, top-down shape on the flat board, never a perspective '
      + 'ellipse or a tilted ground plane, and the transform never skews or squashes a sprite. After the shared damage '
      + 'formation (R-PROG-ATTACK-08) the striking hero invokes (a flat golden halo ring round the portrait, a slow '
      + 'sunburst, light drawn in, a choir swell) and a beam of light rises off it. It escalates on exactly the tiers every '
      + 'other hero attack uses (one shared tierOf, thresholds 6 / 12 / 20): I 1-5 a golden rune SIGIL flashes onto the '
      + 'struck portrait and a PILLAR of light drops onto it; II 6-11 a DOUBLE smite, the first a tick; III 12-19 a RAIN of '
      + 'six light spears plants glowing, cracking seeds round the struck hero, then the pillar drops and the seeds erupt '
      + 'with it; IV 20+ (the owner\x27s finale as reworked 2026-09-29) ONE holy sword flies in from off screen along its '
      + 'own heading and strikes the CENTRE of the board, then five more (six by default, tunable) fly in one after another '
      + 'from DIFFERENT directions round the compass, each from roughly opposite the last, every one converging on the '
      + 'centre with its own impact; they RAMP UP (each flight shorter and each gap between bites shorter than the last, the '
      + 'last sword the biggest) and stay PLANTED round the centre, points inward, round a holy ring; then the centre '
      + 'IMPLODES (every sword and all the light sucked into the middle, a sharp inward collapse) and releases the FLAT '
      + 'consecrated blast, which skims the board to the struck hero tearing radiant cracks and lighting runes, and holy '
      + 'flames (a flat corona round the rim) and light erupt round the struck portrait. The consequence (the damage, Armor, '
      + 'Resolve) lands exactly ONCE: on the last smite (every earlier smite, spear and sword is a tick with FX only) or, at '
      + 'IV, on the eruption (never on a sword, the implosion or the flight). No hit-stop or freeze anywhere '
      + '(R-PROG-ATTACK-10). Every anchor is the round portrait art at rest (R-PROG-ATTACK-04). The palette is gold and white '
      + '(the owner: "less yellow and more gold + white"). Presentation only; reduced motion is fades only; an unknown or '
      + 'retired id plays Classic.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (the holy hero attack)', quote: 'branch off and create a holy weapon + consecration attack. first tier is a holy aoe blast on the opponent, final blast a large holy sword slams into the middle of the board and a consecration erupts from it damaging the opponent. fill in the middle tiers' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Holy review, first)', quote: 'for holy -> i want the sword come down and explode into light which then shoots the consecrated cracked ground at the opponent. also make they holy color less yellow and more gold + white' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-28 (Holy review, second)', quote: 'make the sword come down fast from above the screen and create an impact when it hits, then send the flat consecrated blast at the opponent. the sword should slam down and explode fast, then the wake builds and rapidly flies at the opponent and strikes them.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Holy flat + six swords)', quote: 'branch off and modify the holy attack sequence - i want this to be flat and not faux-3d. also, let\x27s take this animation to the extreme - have 6 swords fly in from different directions starting with 1, then they ramp up in speed and the center implodes into that blest towards the enemy.' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_holy); packages/ui/src/heroHoly/ (heroHolyConfig holyPlan / holyCues / holyGeo / swordHeadings / holyCameraAt, heroHoly playHeroHoly, heroHolyScene)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-28; flattened and the six-sword finale 2026-09-29. The item reaches the database on the next deploy of progression-inventory (the catalog sync); the equip SQL already accepts the hero_attack slot.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroHoly/heroHoly.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/progression/CollectionHeroAttack.test.tsx', 'packages/ui/src/heroAttack/damageFormation.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-ATTACK-15',
    title: 'Inferno (attack_fire, Legendary) is a hero attack of LIVE PARTICLE FIRE: a fireball / two / a volley of five that sets the target ablaze / a meteor that detonates, on the SAME damage tiers; the blow lands ONCE; no freeze',
    statement:
      'attack_fire ("Inferno", a placeholder name for the owner to rename; Legendary, crate, account-wide, style fire) plays '
      + 'a fire-mage attack in which EVERY flame is live particle fire (the shared PixiFire: hundreds of small soft additive '
      + 'flame puffs and licking tongues that rise with buoyancy, sway on a curl field, flicker and cool over their life from '
      + 'white-hot through yellow, orange and red to a dark ember, over a deep normal-blend body that keeps the colour on a '
      + 'light board, leaving smoke and throwing embers), never a flame image. After the shared damage formation '
      + '(R-PROG-ATTACK-08) fire catches round the striking hero\x27s upper rim and FIREBALLS ignite round the portrait (never '
      + 'over the face, never above the frame), draw back and are hurled on slight arcs with comet tails of flame, smoke and '
      + 'embers. It escalates on exactly the tiers every other hero attack uses (one shared tierOf, thresholds 6 / 12 / 20): '
      + 'I 1-5 ONE fireball bursts on the struck hero; II 6-11 TWO, the struck rim briefly alight; III 12-19 a VOLLEY of five '
      + 'bigger fireballs landing in rhythm, the struck hero CATCHING more with every tick, then the last one FLARES it up (a '
      + 'gout of flame off the portrait) and leaves its upper rim ABLAZE, dying down to embers and smoke; IV 20+ three '
      + 'fireballs (ticks), then the hero hurls a column of fire into the sky and the struck hero is MARKED for the build-up '
      + '(the ground under it glowing hotter, heat rings closing in, flames licking up round it) while a METEOR streaks down '
      + 'from above the frame on a low diagonal from the striker\x27s side and DETONATES, in layers: a white-hot flash core, '
      + 'thin shockwaves, a FIRE NOVA racing outward, a dome of fire, a fireball ROLLING UP into a mushroom of smoke, BURNING '
      + 'DEBRIS flung out on arcs trailing fire, a pillar of fire ENGULFING the struck hero that burns out to embers, and a '
      + 'scorch. The consequence (the damage, Armor, Resolve) lands exactly ONCE: on the last fireball (every earlier fireball '
      + 'is a tick with FX only) or, at IV, on the detonation. No hit-stop or freeze anywhere (R-PROG-ATTACK-10). Every anchor '
      + 'is the round portrait art at rest (R-PROG-ATTACK-04). Presentation only; reduced motion is fades only; an unknown or '
      + 'retired id plays Classic.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (more attack types)', quote: 'we need a fire animation ... use the same 4 tier strategy we have been ... same with the new fire animation, it should look like live flame/fires pixi sprites etc' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Fire first review)', quote: 'fire one looks solid - can you make the 3rd fire tier a bit better and the meteor slightly slower build up and a cooler explosion' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_fire); packages/ui/src/heroAttack/pixiFire.ts (PixiFire); packages/ui/src/heroFire/ (heroFireConfig firePlan / fireCues / fireballMotions / meteorMotion / fireCameraAt, heroFire playHeroFire, heroFireScene)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29. The item reaches the database on the next deploy of progression-inventory (the catalog sync); the equip SQL already accepts the hero_attack slot.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroFire/heroFire.test.ts', 'packages/ui/src/heroAttack/pixiFire.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/progression/CollectionHeroAttack.test.tsx', 'packages/ui/src/heroAttack/damageFormation.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-ATTACK-16',
    title: 'Hero attack FIRE is live particle fire, never a flame picture: Enraged Strike\'s rage aura, its towering rear and its crater burn in the shared PixiFire',
    statement:
      'Every flame a hero attack draws is the shared live particle fire (packages/ui/src/heroAttack/pixiFire.ts: pooled, '
      + 'hard-capped, zero allocation per frame, seeded): soft additive flame puffs and licking tongues rising with buoyancy '
      + 'and turbulence, flickering and cooling white-hot to red, a normal-blend body under them, smoke and embers. Enraged '
      + 'Strike (R-PROG-ATTACK-11) no longer draws its aura as swaying strip-mesh flame tongues: its crown of fire burns off '
      + 'the upper rim as particles (turning to the TRAILING rim and streaming back on a dash, so it never burns across the '
      + 'face, and leaving a trail of fire behind the moving hero), its Tier IV rear-back sends a column of fire roaring up, '
      + 'and its haymaker crater bursts into flame and keeps burning for a beat. Its timing, tiers, strikes, claws, sparks, '
      + 'rings and sound are unchanged.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (more attack types)', quote: 'fix the fire in enrage with pixi style fire so it looks less like a flame image and more liike actual fire' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Enraged fire review)', quote: 'enraged looks way better' },
      { kind: 'code', ref: 'packages/ui/src/heroAttack/pixiFire.ts; packages/ui/src/heroEnraged/heroEnragedScene.ts (the aura emitter, rear, crater)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroAttack/pixiFire.test.ts', 'packages/ui/src/heroEnraged/heroEnraged.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-ATTACK-17',
    title: 'Grave Call (attack_undead, Legendary) is a FLAT undead hero attack: one shrieking skull / two skulls / grave hands and a wisp swarm then a skull / a grave rift and a giant skull maw that chomps, on the SAME damage tiers; the blow lands ONCE; no freeze',
    statement:
      'attack_undead ("Grave Call", a placeholder name for the owner to rename; Legendary, crate, account-wide, style undead) '
      + 'plays a necromantic attack in sickly spectral green and teal over a deep purple-black, with bone white, drawn FLAT '
      + '(every circle, hole, rift and crack is a top-down shape; no sprite is skewed or tilted). After the shared damage '
      + 'formation (R-PROG-ATTACK-08) the striking hero RAISES the dead (a necrotic grave circle turns under it, grave smoke '
      + 'circles its rim, ghost wisps spiral in) and the circle flares. It escalates on exactly the tiers every other hero '
      + 'attack uses (one shared tierOf, thresholds 6 / 12 / 20): I 1-5 a spectral SKULL pops out of the hero on the side '
      + 'facing the target and SHRIEKS (its jaw drops, shriek rings), flies at the target on a slight arc trailing '
      + 'afterimages and shedding wisps, jaw wide, and BITES as it lands (the jaw snaps shut), bursting into ghost wisps, '
      + 'bone shards and a spectral echo of itself; II 6-11 TWO skulls on opposite arcs, the first a tick; III 12-19 a grave '
      + 'circle opens under the struck hero, four skeletal HANDS claw up out of the board round it and DRAG at it (the '
      + 'portrait sinks and trembles), a SWARM of eight ghost wisps streams from the hero and strikes it in rhythm, then one '
      + 'big skull finishes it and the hands shatter into bone; IV 20+ a GRAVE RIFT tears open across the board between the '
      + 'heroes (a jagged void lit green, cracks racing off it), a giant spectral SKULL MAW rises out of it and its eyes '
      + 'ignite, it SHRIEKS (the jaw drops wide, shriek rings, the view trembles, the struck hero shudders), LUNGES across the '
      + 'board trailing afterimages and CHOMPS shut on the struck hero, then a wave of necrotic MIST washes out and the rift '
      + 'closes. The maw is always whole on screen: its chomp slides toward the middle of the screen (still over the struck '
      + 'hero) far enough that the maw and the camera punch fit, and a view too short makes it smaller, never cropped. The '
      + 'consequence (the damage, Armor, Resolve) lands exactly ONCE: on the last skull\x27s bite (every earlier skull, every '
      + 'grip and every wisp is a tick with FX and sound only) or, at IV, on the chomp (never on the rift, the rise, the '
      + 'shriek or the lunge). No hit-stop or freeze anywhere (R-PROG-ATTACK-10). Every anchor is the round portrait art at '
      + 'rest (R-PROG-ATTACK-04). Sound reuses existing clips only. Presentation only; reduced motion is fades only; an '
      + 'unknown or retired id plays Classic.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (five more hero attacks)', quote: 'branch off and make some more attack types - we need a fire animation, a bleed/gash animation, some sort of an undead animation, a beast chomp rush animation, and i would love a king oona banana cannon animation. use the same 4 tier strategy we have been.' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_undead); packages/ui/src/heroUndead/ (heroUndeadConfig undeadPlan / undeadCues / undeadGeo / undeadCameraAt, heroUndead playHeroUndead, heroUndeadScene, heroUndeadTextures)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29. The item reaches the database on the next deploy of progression-inventory (the catalog sync); the equip SQL already accepts the hero_attack slot. The id is 17 because 15 and 16 are left for the fire and bleed attacks built alongside it.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroUndead/heroUndead.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/progression/CollectionHeroAttack.test.tsx', 'packages/ui/src/heroAttack/damageFormation.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-ATTACK-18',
    title: 'The Stampede (attack_beast, Legendary) is a beast chomp rush: spirit wolves leap and front jaws SNAP SHUT on the target (one / a staggered pair / a pack of five with dust / six and a colossus that slams and roars), on the SAME damage tiers; the blow lands ONCE; no freeze',
    statement:
      'attack_beast ("Stampede", a placeholder name for the owner to rename; Legendary, crate, account-wide, style beast) '
      + 'plays a primal beast chomp rush in feral green and amber, drawn flat. After the shared damage formation '
      + '(R-PROG-ATTACK-08) the striking hero crouches back and growls while feral energy gathers round it; then spirit '
      + 'wolves (heads of feral energy with streaming manes, burning eyes and gleaming fangs) burst off it and LEAP at the '
      + 'struck hero, their jaws opening as they close in. As each lands, a pair of spectral jaws (a front view: an upper '
      + 'and a lower fang row) fades in wide and SNAPS SHUT over the struck portrait exactly on that beat, the fangs '
      + 'interlocking, leaving bite marks that ride the portrait, the portrait squeezed flat between them and shaken. It '
      + 'escalates on exactly the tiers every other hero attack uses (one shared tierOf, thresholds 6 / 12 / 20): I 1-5 '
      + 'one wolf and one chomp; II 6-11 two, staggered (the first a tick); III 12-19 a pack of five streaming across in '
      + 'lanes and kicking up dust (four ticks, then the last, dead-centre chomp); IV 20+ six chomps round the face (all '
      + 'ticks), then a COLOSSAL beast rises behind the target: its jaws fade in far above and below it (a jaw on a side '
      + 'with little room waits just inside that screen edge; the maw is ALWAYS centred on the struck portrait and its '
      + 'bite lands exactly on the portrait centre, never slid toward the middle of the screen), its eyes ignite and a mane of light flares, the jaws creep in, then SLAM '
      + 'shut over the whole portrait; a beat later it ROARS (the jaws spring open, shockwave rings and speed lines, the view '
      + 'rattles) and dissolves. The consequence (the damage, Armor, Resolve) lands exactly ONCE: on the last chomp (every '
      + 'earlier chomp is a tick with FX and sound only) or, at IV, on the slam (never on a chomp, the rise or the roar). No '
      + 'hit-stop or freeze anywhere (R-PROG-ATTACK-10). Every anchor is the round portrait art at rest (R-PROG-ATTACK-04). '
      + 'Presentation only; reduced motion is fades only; an unknown or retired id plays Classic.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (more hero attacks)', quote: 'branch off and make some more attack types - we need a fire animation, a bleed/gash animation, some sort of an undead animation, a beast chomp rush animation, and i would love a king oona banana cannon animation. use the same 4 tier strategy we have been.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Stampede review)', quote: 'the final beast chomp isnt centered on the hero correctly, can you fix that?' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_beast); packages/ui/src/heroBeast/ (heroBeastConfig beastPlan / beastCues / beastMotions / biteOffset / clampGap / colossalGap / beastCameraAt, heroBeast playHeroBeast, heroBeastScene, heroBeastTextures)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29. The item reaches the database on the next deploy of progression-inventory (the catalog sync); the equip SQL already accepts the hero_attack slot.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroBeast/heroBeast.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/progression/CollectionHeroAttack.test.tsx', 'packages/ui/src/heroAttack/damageFormation.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-ATTACK-19',
    title: 'Oona\x27s Banana Cannon (attack_banana, Legendary) flings King Oona\x27s PAINTED bananas (spinning, backspin) that burst into her painted splats: one / a double / a barrage of eight / a giant golden banana that lands stuck in the target and is slammed in SIX times, on the SAME tiers; the blow lands ONCE; no freeze',
    statement:
      'attack_banana ("Oona\x27s Banana Cannon", a placeholder name for the owner to rename; Legendary, crate, account-wide, '
      + 'style banana) is built on King Oona\x27s OWN card FX (fx/defs/oona-banana.json): her PAINTED banana (one side-on cell '
      + 'of her sheet) is every projectile and her PAINTED juice splat sheet is every impact, with her juice palette, her '
      + 'launch sparks and her clips (fx/oona-launch, fx/oona-splat, fx/oona-powerup). There is no drawn cannon. After the '
      + 'shared damage formation (R-PROG-ATTACK-08) a golden flourish opens on the striking hero and it flings bananas that '
      + 'SPIN in the plane with BACKSPIN (never flip through the sheet\x27s frames) along high lobbed arcs, shedding juice '
      + 'sparkles, and burst on the struck portrait into the painted splat and a juice burst. It escalates on exactly the '
      + 'tiers every other hero attack uses (one shared tierOf, thresholds 6 / 12 / 20): I 1-5 one banana; II 6-11 a double, '
      + 'the first a tick; III 12-19 a barrage of eight on varied arcs with layered splats; IV 20+ four warm-up bananas '
      + '(ticks), the hero blazes gold, then a GIANT GOLDEN BANANA arcs high and HANGS in view (a crown glint flashes on it, '
      + 'a flat golden target ring locks on) and LANDS stuck in the struck hero\x27s rim as a stake. The striking PORTRAIT '
      + 'itself dashes across and SLAMS it in SIX times (a tunable count), reeling far back between slams (further each '
      + 'time, each gap longer than the last, the finisher furthest and wound up longest, the view pushing in over its '
      + 'wind-up), every slam a harder punch with an escalating impact burst (flash, spike-star impact frame, speed lines, '
      + 'rings, sparks, debris; screen-edge impact lines on the late slams): each slam drives the stake deeper (the part '
      + 'driven in disappears into the face, so by the finisher only its end sticks out), squashes it flatter, dents the '
      + 'struck portrait along the blow, grows a crater ring and cracks at the entry and squirts juice out sideways; from '
      + 'the fourth slam extra painted juice splats burst off the target, more each slam (no blood: the owner removed it). While it slams, the striking portrait reads ON TOP of '
      + 'the banana and every banana effect (the overlay is cut by its circle), and the banana covers the struck side\x27s '
      + 'hero power; the dim lifts as the striker dashes, so both heroes stay bright through the jam; the camera is applied '
      + 'to the FX exactly once (never mirrored onto a canvas that already rides the camera). The sixth slam bursts it: a massive painted splat, a ring of splats, a golden shockwave, gold rays and '
      + 'a shower of spinning painted bananas; the crater ring and cracks fade out with the burst (no dark circle is left '
      + 'after the attack), the splat and the juice fade as designed, and every sprite is released once they have. The consequence (the damage, Armor, Resolve) lands exactly ONCE: on the last '
      + 'banana (every earlier banana is a tick) or, at IV, on the sixth slam (never on a warm-up, the landing or an earlier '
      + 'slam). No hit-stop or freeze anywhere (R-PROG-ATTACK-10). Flat 2D. Presentation only; reduced motion is fades only; '
      + 'an unknown or retired id plays Classic.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (more hero attacks)', quote: 'branch off and make some more attack types - we need a fire animation, a bleed/gash animation, some sort of an undead animation, a beast chomp rush animation, and i would love a king oona banana cannon animation. use the same 4 tier strategy we have been.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Banana first review)', quote: 'the banana cannon attack is a 3/10. use oona\x27s animation as a guideline. improve this dramatically.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Banana Tier IV)', quote: 'is it possible to have the banana almost like look it lands on the hero and then we slam our fist into it 4 times "jamming it into them" kinda? almost like a mortal combat style attack' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Banana second review)', quote: 'the bananas should spin, not flip. ... make sure the attacker hero is on top of it ... slow the hits and reel back further between hits, have it hit 6 times, and show blood splatting on hits 4,5,6 with increasing amounts, then the final banana splat.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Banana, no blood)', quote: 'can you remove the blood from the banana attack and just keep the banana splats instead' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Banana, clean end)', quote: 'what\x27s the leftover circle here from the banana final slam? can you remove that?' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Banana, keep the splat)', quote: 'nvm keep the banana splat on the target still' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_banana); packages/ui/src/heroBanana/ (heroBananaConfig bananaPlan / bananaCues / bananaRig / bananaPos / jamGeo / jamPose / bananaCameraAt, heroBanana playHeroBanana, heroBananaScene, heroBananaTextures); fx/defs/oona-banana.json (the art and clips)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29. The item reaches the database on the next deploy of progression-inventory (the catalog sync); the equip SQL already accepts the hero_attack slot.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroBanana/heroBanana.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/progression/CollectionHeroAttack.test.tsx', 'packages/ui/src/heroAttack/damageFormation.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PRESENT-24',
    title: 'Your portrait frame ring paints OVER your hero power (and its cost coin), yet the power stays fully pressable under it',
    statement:
      'When a portrait-frame ring is on your hero portrait, the ring (and the portrait block that carries it) paints above '
      + 'the hero-power diamond and its cost coin wherever they overlap: in the shop, in combat, and while the portrait '
      + 'lunges in a hero strike. The ring never takes a click: every press, hover and tooltip on the power lands on the '
      + 'power even where the ring covers it. With no frame on, the layering is unchanged. The foe side already conforms: '
      + 'the foe\x27s power icon sits under the foe portrait and its ring. Mechanism: the ring lives inside `.statusbar '
      + '.hero`, a transformed (self-contained) block that sat at z auto inside the bar while `.statusbar .heropanel` sits '
      + 'at z41; with a frame on, StatusBar adds `pf-top` and `.statusbar .hero.pf-top` ranks the block at z42 (under the '
      + 'open Buffs panel lift, z43). The ring layer (`.pframe-box`, `.pframe`) is pointer-events none.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      {
        kind: 'owner-chat',
        ref: 'Claude Code session, 2026-09-29 (portrait frame over the hero power, with a screenshot)',
        quote: 'fix the Z axis of the hero power here so that the player frame is on top of that',
      },
      { kind: 'code', ref: 'packages/ui/src/StatusBar.tsx (the `pf-top` class on `.hero`); packages/ui/src/styles.css (`.statusbar .hero.pf-top`, `.pframe-box`, `.pframe`)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-29. Before the fix the Aegis diamond drew over the Rank #1 ring\x27s edge. Verified live on '
      + 'port 5223 (Rank #1 ring, frame scale 1.3): the ring now paints over the diamond, every sampled point inside the '
      + 'diamond still hits the button, a press on the ring-covered edge arms the power, and the hover tooltip opens.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/portraitFrame/portraitFrameZOrder.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-RANK-05',
    title: 'Ranked: quitting an unfinished rated game settles it as a finish in the lowest place still open, with the normal Rating change for that place',
    statement:
      'A RATED game (Play mode, a lobby with at least one recorded player at the table) that the player abandons before '
      + 'it ends settles exactly as if they had finished in the lowest placement still available at that moment: the '
      + 'number of seats still alive. Nobody out yet is 8th; one seat already out is 7th; and so on. The normal placement '
      + 'award for that place applies unchanged, with every gate that already exists for it (a demotion game, a '
      + 'promotion game, the top-4 strength bonus, the all-generated refusal). ABANDONING means giving up the one saved '
      + 'game: discarding it from the title, or starting any new game (Play, Practice, the tutorial) that replaces it. '
      + 'Save & Quit is NOT quitting: the game stays live, Continue resumes it, and it settles once at its real end. '
      + 'Practice, the tutorial, the Scene Builder and an unrated all-generated lobby abandon for free. A game already '
      + 'over (the player out, or the lobby finished) has settled through its normal end and is never settled again. '
      + 'The literal rule stands at the top too: with 4 or fewer seats alive the lowest open place is 4th or better, so '
      + 'a quit there GAINS Rating and can win a promotion game. A quit moves Rating ONLY: it earns no Account XP and '
      + 'writes nothing to Career or Recent Games.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (quitting a rated game)', quote: 'yes, quitting an official game should lose you MMR relative to the lowest available place when you quit. for example. if one player was already out, then quitting would place you in 7th place. losing you MMR' },
      { kind: 'owner-chat', ref: 'Same session, 2026-09-29 — asked whether a quit with 4 or fewer alive may gain Rating / promote', quote: 'YES' },
      { kind: 'owner-chat', ref: 'Same session, 2026-09-29 — asked whether a quit should earn Account XP for its placement', quote: 'NO' },
      { kind: 'owner-chat', ref: 'Same session, 2026-09-29 — asked whether quits should show in Career and Recent Games', quote: 'NO' },
      { kind: 'owner-chat', ref: 'Same session, 2026-09-29 — asked about closing the wipe-the-save gap server-side', quote: 'Eventually - we will want to write saved and quit games to supabase as well.' },
      { kind: 'code', ref: 'packages/sim/src/lobby/runLobby.ts abandonPlacementOf; packages/ui/src/rank/ratedRun.ts rankedAbandonOf / abandonWarningOf; packages/ui/src/store.ts settleAbandonedRun (clearRun, pickHero, newRun, startTutorial); settles through the existing rank queue + supabase/functions/submit-rating (unchanged, it already accepts any placement 1-8)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-29 (feat/quit-costs-rating). Until then an abandoned rated game never settled and cost '
      + 'nothing. The quit placement is computed on the client from the saved lobby and submitted like any finish, so '
      + 'the server settles it with the same rules; the server has no separate quit record and cannot force a settle '
      + 'for a save that is never discarded (the save lives on the device). A save the game itself drops because the '
      + 'build no longer has one of its cards is not a player quit and does not settle. The Clear and Play '
      + 'tips on the title name the placement a rated save would count as. No career row, fight-ledger rows or XP are written for a '
      + 'quit: only the Rating moves.',
    example:
      'Silver II 50, quit on round 3 with all eight alive: an 8th, -40, to 10. The same with one seat out: a 7th, -28, '
      + 'to 22. At Silver II 0 in a demotion game, quitting with nobody out demotes. Save & Quit on round 6, Continue, '
      + 'win the lobby: one settlement, a 1st.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/lobby/abandonPlacement.test.ts', 'packages/ui/src/rank/quitCostsRating.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  // ── A card's On Death sound plays for the card that died (owner report 2026-09-29) ─────────────────────
  {
    id: 'R-FX-DEATH-01',
    title: "A card's On Death effect plays when THAT card dies, wherever its death lands",
    statement:
      'Whatever a card has in its On Death slot (FX workbench, By card) plays every time a unit of that card '
      + 'dies in combat, on the dying unit, whether it dies from an attack, a spell, an Echo or anything else. '
      + 'It never plays the attacker\x27s or any other card\x27s On Death effect in its place.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (unit voices)', quote: 'im not hearing any on death sounds' },
      { kind: 'fix-pr', ref: 'fix/on-death-sounds: packages/ui/src/choreo/score.ts (new deathFx channel; the fxDef row stands down for death kinds)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-29. Before, the only path was the fxDef row on a `death`-kind moment, which named '
      + 'the moment\x27s card from its SOURCE (the killer, or nothing for a lone death), and most deaths land inside '
      + 'a `damage` moment or an attack exchange where that row never asked for `death` at all: so 300+ bound '
      + 'On Death voicelines never played. The `deathFx` channel now scans every moment\x27s death events and plays '
      + 'the dying card\x27s binding on that unit (binding gain respected).',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/choreo/score.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  // ── A knockout always plays the hero attack's Huge version (owner ask 2026-09-29) ─────────────────────
  {
    id: 'R-PROG-ATTACK-21',
    title: 'Hemorrhage (attack_bleed, Legendary) is a FLAT slashing hero attack: one gash / a cross / a flurry ending in a claw rake / three rakes, a heartbeat, EIGHT accelerating screen-splitting zips and a bloody explosion, on the SAME damage tiers; the blow lands ONCE; no freeze',
    statement:
      'attack_bleed ("Hemorrhage", a placeholder name for the owner to rename; Legendary, crate, account-wide, style bleed) '
      + 'plays a stylised crimson slashing attack, drawn flat (no faux-3D). After the shared damage formation '
      + '(R-PROG-ATTACK-08) the striking hero draws back and turns (a blade raised: a crimson glint and a thin crescent at '
      + 'its striking edge). Each slash is a swing at its rim that looses a flying crimson CRESCENT; as it reaches the '
      + 'struck portrait it turns to the cut\x27s angle and runs straight through the face, a white-hot seam drawing behind '
      + 'it, blood spraying along the blade\x27s direction, and the line OPENING into a gash (a dark wound with a bright red '
      + 'lip). It escalates on exactly the tiers every other hero attack uses (one shared tierOf, thresholds 6 / 12 / 20): '
      + 'I 1-5 one clean diagonal gash; II 6-11 a CROSS (X) of two gashes, the first a tick; III 12-19 a flurry of four fast '
      + 'slashes and a three-claw RAKE (every wound bleeding, drips running down the portrait); IV 20+ (owner 2026-09-29: hilariously over the top) three claw rakes (each also sweeping a wide line across the screen) carve the face and the wounds THROB with a heartbeat while the striker winds a huge crescent; '
      + 'then the screen-splitting MEGA-SLASH zips through the target EIGHT times (tunable) each on its OWN line and each sweeping IN from the far side of the screen across the board, through the '
      + 'target and out past it (a fan either side of the line to the middle of the screen, so every wide crescent crosses the screen from the very first zip), each with its seam, a spray, a fresh gash and blood flung across the whole screen along its line that PILES UP (more each zip) until after the explosion, the camera whipping along it, the cadence '
      + 'ACCELERATING into a blur; then a beat of held tension (never a freeze: the wounds pulse faster, blood is drawn in) and a huge BLOODY EXPLOSION '
      + '(a white-red flash core, five shockwave rings, a huge stain, blood thrown high to rain across the board, big splats PAINTING the whole screen out to the UI edges with a '
      + 'crimson vignette, dripping stains, arterial spurts; all of it fades out cleanly). The consequence (the damage, Armor, Resolve) lands '
      + 'exactly ONCE: on the last cut (every earlier cut is a tick with FX only) or, at IV, on the explosion (never on a rake, a heartbeat, a zip or the tension). A knockout plays Tier IV whatever the number (R-PROG-ATTACK-20). Wounds, drips, stains and the tint '
      + 'ride the struck portrait\x27s knockback. No hit-stop or freeze anywhere (R-PROG-ATTACK-10). Presentation only; '
      + 'reduced motion is fades only; an unknown or retired id plays Classic.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (more hero attacks)', quote: 'branch off and make some more attack types - we need a fire animation, a bleed/gash animation, some sort of an undead animation, a beast chomp rush animation, and i would love a king oona banana cannon animation. use the same 4 tier strategy we have been.' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Bleed review)', quote: 'make the bleed one extremely extremely over the top like hilariously over the top for the huge attack. like do 8 zips of the long attack animation and have a bloody explosion at the end' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Bleed review, blood)', quote: 'bleed\x27s first 2 slash throughs on the huge attack still dont have the line slashes. add way more blood splatters across the screen. it should be hilariously bloody by the end of the combo' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_bleed); packages/ui/src/heroBleed/ (heroBleedConfig bleedPlan / bleedCues / slashGeos / wavePos / megaGeo / zipGeos / bleedCameraAt / bleedCameraFocus, heroBleed playHeroBleed, heroBleedScene, heroBleedTextures)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29. The item reaches the database on the next deploy of progression-inventory (the catalog sync); the equip SQL already accepts the hero_attack slot.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroBleed/heroBleed.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/progression/CollectionHeroAttack.test.tsx', 'packages/ui/src/heroAttack/damageFormation.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-ATTACK-20',
    title: 'A hero attack that knocks the struck player out always plays its Tier IV ("Huge") version, in every style',
    statement:
      'When the end-of-combat hero attack ELIMINATES the struck player (their Resolve + Armor going in is at or under '
      + 'the blow the engine decided, so the settle takes them to 0), the attack plays Tier IV whatever the damage number: '
      + 'every style (Classic, Blast, Quake, Arcana, Phantom Blades, Enraged Strike, Venom Volley, Frost Nova, Consecration, '
      + 'and any style added later) and the damage formation it opens with. Both directions: your blow that knocks the foe '
      + 'seat out, and the foe\x27s blow that knocks you out. A ghost (already out, never charged) is never knocked out, '
      + 'and invulnerable Practice never knocks you out. Presentation only: the number shown and the consequence are '
      + 'unchanged. The tier rule lives in one place (attackTier in packages/ui/src/heroAttack/tiers.ts) and the '
      + 'knockout is read off the state the engine settles from (heroStrikeKnockout), so a replay plays what the live '
      + 'fight did.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (knockout plays huge)', quote: 'add logic so that if a player knocks someone out, it always plays the "huge" animation.' },
      { kind: 'code', ref: 'packages/ui/src/heroAttack/tiers.ts (attackTier, KNOCKOUT_TIER); packages/ui/src/heroBlast/heroStrikeDamage.ts (heroStrikeKnockout); packages/ui/src/heroAttack/options.ts (knockout); every style config plan (attackTier); packages/ui/src/Recruit.tsx (the post-combat sequence passes knockout)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroAttack/knockoutTier.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  // ── The first EPIC hero attacks: Card Shark and Storm Call (owner ask 2026-09-29) ─────────────────────────
  {
    id: 'R-PROG-ATTACK-26',
    title: 'Card Shark (attack_cards, EPIC) deals playing cards in THREE looks: one Ace / three Aces / a royal flush that turns gold and bursts into confetti; the blow lands ONCE',
    statement:
      'attack_cards ("Card Shark", a placeholder name for the owner to rename; EPIC, crate, account-wide, style cards) is an '
      + 'Epic hero attack: one idea, shorter than the Legendaries, and THREE visual tiers instead of four. It reads the SAME '
      + 'shared tier every style reads (attackTier: thresholds 6 / 12 / 20, a knockout is Tier IV) and maps it locally: I -> '
      + 'small, II and III -> medium, IV -> big, so a knockout always plays big. After the shared damage formation '
      + '(R-PROG-ATTACK-08) the hero deals playing cards (painted ivory faces with plain suit pips and letters, no copied card '
      + 'art): SMALL, one Ace of spades drawn and flicked spinning into the struck hero, where it sticks EDGE FIRST with a flash '
      + '(the blow); MEDIUM, three Aces thrown in quick sequence, thunk thunk thunk, each sticking at its own angle round the '
      + 'face (the first two are ticks, FX only; the blow lands on the third); BIG, a royal flush of spades dealt face down '
      + 'into a hand fanned out UPRIGHT in front of the hero (kept on screen), flipped face up one by one (10, J, Q, K, A), the '
      + 'faces turned GOLD with a flash and a glint sweeping each card, held a beat, then all five fired together to land '
      + 'together and burst into card confetti (chips and suit pips fluttering down) on the struck hero (the blow lands on the '
      + 'burst). Stuck cards ride the struck portrait\x27s knockback and fall away after. The consequence lands exactly ONCE. '
      + 'No hit-stop (R-PROG-ATTACK-10). The camera is applied ONCE: the Pixi root mirrors the DOM camera only when its '
      + 'canvas is not already inside the camera element. Presentation only; reduced motion is fades only; an unknown or '
      + 'retired id plays Classic.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (rare and epic attacks)', quote: 'branch off and build 5 animations that range from rare -> epic. all of the animations we have done so far are legendary. rare and epics should only have 2 or 3 tiers to them and generally be less exciting, but still extremely clean and fun. get creative' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_cards); packages/ui/src/heroCards/ (heroCardsConfig cardsLevel / cardsPlan / cardsCues / fanPoses / heldPoses / cardMotions / cardsCameraAt, heroCards playHeroCards, heroCardsScene, heroCardsTextures); packages/ui/src/heroAttack/stageCamera.ts (heroFxCanvas: the camera applied once, R-PROG-ATTACK-25)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29. The item reaches the database on the next deploy of progression-inventory (the catalog sync); the equip SQL already accepts the hero_attack slot.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroCards/heroCards.test.ts', 'packages/ui/src/heroAttack/knockoutTier.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/progression/CollectionHeroAttack.test.tsx', 'packages/ui/src/heroAttack/damageFormation.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-ATTACK-27',
    title: 'Storm Call (attack_storm, EPIC) strikes with live lightning in THREE looks: a crackling arc / a forked double strike with static / a storm cloud\x27s thick strike; the blow lands ONCE',
    statement:
      'attack_storm ("Storm Call", a placeholder name for the owner to rename; EPIC, crate, account-wide, style storm) is an '
      + 'Epic hero attack in THREE visual tiers, mapped from the shared tier exactly as Card Shark (R-PROG-ATTACK-26): I small, '
      + 'II and III medium, IV (and every knockout) big. Every bolt is procedural: a jagged line whose shape is REDRAWN every '
      + 'few frames from a seeded generator (a live crackle; a replay crackles the same), ends pinned, in electric blue and '
      + 'white with violet. After the shared damage formation static crackles round the hero, then: SMALL, a bolt\x27s leader '
      + 'races from the hero into the struck hero and it flickers; the zap and a small spark burst land the blow; MEDIUM, a '
      + 'trunk leaves the hero and FORKS into two branches that strike one after the other (the first a tick, FX only; the '
      + 'blow on the second), and static crawls over the struck portrait while it JITTERS; BIG, the hero calls a thin bolt up, '
      + 'a small STORM CLOUD gathers over the struck hero (with no room above a hero at the top of the screen it rolls in over '
      + 'the top edge and still drops onto the face, never a sideways beam), rumbles and lights up from inside twice, then '
      + 'drops one THICK strike: a flash across the screen, a ring of sparks, a shock ring and static crawling over the '
      + 'portrait while the cloud breaks up (the blow lands on the strike). The consequence lands exactly ONCE. No hit-stop '
      + '(R-PROG-ATTACK-10). The camera is applied ONCE (as R-PROG-ATTACK-26). Presentation only; reduced motion is fades '
      + 'only; an unknown or retired id plays Classic.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (rare and epic attacks)', quote: 'rare and epics should only have 2 or 3 tiers to them and generally be less exciting, but still extremely clean and fun. get creative' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_storm); packages/ui/src/heroStorm/ (heroStormConfig stormLevel / stormPlan / stormCues / stormGeometry / stormCameraAt, heroStorm playHeroStorm, heroStormScene, heroStormTextures)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29. The item reaches the database on the next deploy of progression-inventory (the catalog sync); the equip SQL already accepts the hero_attack slot.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroStorm/heroStorm.test.ts', 'packages/ui/src/heroAttack/knockoutTier.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/progression/CollectionHeroAttack.test.tsx', 'packages/ui/src/heroAttack/damageFormation.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  // ── The Rare hero attacks (owner ask 2026-09-29): two visual tiers each ───────────────────────────────
  {
    id: 'R-PROG-ATTACK-28',
    title: 'A RARE hero attack has exactly two visual tiers: the shared I-II play Small, III-IV play Big (so a knockout plays Big)',
    statement:
      'Every Rare hero attack (attack_coin, attack_boomerang, attack_bubble, attack_backstab, and any Rare added later) '
      + 'reads its tier from the shared attackTier (packages/ui/src/heroAttack/tiers.ts: the owner-approved thresholds 6 / 12 / '
      + '20 and the knockout rule, R-PROG-ATTACK-20) and maps the four shared tiers onto TWO visual tiers inside its own '
      + 'config: I-II play Small, III-IV play Big. A knockout forces the shared Tier IV, so it always plays Big. Its tuner has '
      + 'two groups of per-tier dials (Small, Big), the Copy / Reset / Play row on top and no Speed or Reduced motion button. '
      + 'Like every style: the shared damage formation opens it, the consequence lands exactly once on its impact beat (every '
      + 'hit before it is a tick, FX and sound only), the clock never pauses (no hit-stop), it is flat 2D, the camera is '
      + 'applied once (never mirrored again onto an FX overlay that already rides the #stage camera), and reduced motion lands the blow '
      + 'with no motion. Rares are shorter and calmer than the Legendaries (about 1.2 to 2.5 s after the formation).',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (the Rare and Epic hero attacks)', quote: 'build 5 animations that range from rare -> epic. all of the animations we have done so far are legendary. rare and epics should only have 2 or 3 tiers to them and generally be less exciting, but still extremely clean and fun. get creative' },
      { kind: 'code', ref: 'packages/ui/src/heroCoin/, heroBoomerang/, heroBubble/, heroBackstab/ (coinLevel / boomerangLevel / bubbleLevel / backstabLevel); packages/ui/src/heroAttack/rareTuner.ts; packages/ui/src/heroAttack/stageCamera.ts (heroFxCanvas: the camera applied once, R-PROG-ATTACK-25)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroCoin/heroCoin.test.ts', 'packages/ui/src/heroBoomerang/heroBoomerang.test.ts', 'packages/ui/src/heroBubble/heroBubble.test.ts', 'packages/ui/src/heroBackstab/heroBackstab.test.ts', 'packages/ui/src/heroAttack/knockoutTier.test.ts', 'packages/ui/src/heroAttack/attackTunerButtons.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-ATTACK-29',
    title: 'Coin Flick (attack_coin, "Pocket Change", Rare): a spinning gold coin pings the target; Big ricochets it and bursts it into a shower of coins; the blow lands ONCE on the last ping',
    statement:
      'attack_coin ("Pocket Change", a placeholder name for the owner to rename; Rare, crate, account-wide, style coin): after '
      + 'the shared damage formation the striking hero dips back while a glint gathers at its hand, then flicks a gleaming '
      + 'gold coin on a slight arc, spinning (a flat in-plane turn plus an edge-on flip read as its width closing and '
      + 'opening), trailing afterimages. SMALL (shared I-II): it PINGS the struck hero with a four-point sparkle, a gold ring '
      + 'and glitter (THE impact) and caroms off, tumbling away. BIG (III-IV, knockouts): a ricochet volley, it pings the '
      + 'face (a tick), hops off and back (a tick), and the last ping (THE impact) bursts it into a small shower of coins '
      + 'that spill out and fall. The ding climbs a step per ping. The consequence lands exactly once, on the last ping.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (the Rare and Epic hero attacks)', quote: 'build 5 animations that range from rare -> epic. all of the animations we have done so far are legendary. rare and epics should only have 2 or 3 tiers to them and generally be less exciting, but still extremely clean and fun. get creative' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_coin); packages/ui/src/heroCoin/ (coinPlan / coinCues / coinPath / coinCameraAt, playHeroCoin, HeroCoinScene)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroCoin/heroCoin.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/heroAttack/damageFormation.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-ATTACK-30',
    title: 'Boomerang (attack_boomerang, "Come Back Around", Rare): it whirls out, thwacks the target and curves home to be caught; Big throws two on crossing paths; the blow lands ONCE on the last thwack',
    statement:
      'attack_boomerang ("Come Back Around", a placeholder name; Rare, crate, account-wide, style boomerang): after the shared '
      + 'damage formation the hero winds back and throws a carved wooden boomerang (teal inlay, a teal ribbon trail, a spin '
      + 'blur) that whirls out on a curve, THWACKS the struck hero (an impact star, a teal ring, wood chips) and swings back '
      + 'round the other side to the hero, who catches it with a small pop. SMALL (shared I-II): one boomerang; its thwack is '
      + 'THE impact. BIG (III-IV, knockouts): two, thrown a beat apart from either side on paths that CROSS, a double thwack '
      + '(the first a tick, the second THE impact) and both caught in turn. The return and the catch come after the blow '
      + 'and are looks only. The consequence lands exactly once, on the last thwack.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (the Rare and Epic hero attacks)', quote: 'build 5 animations that range from rare -> epic. all of the animations we have done so far are legendary. rare and epics should only have 2 or 3 tiers to them and generally be less exciting, but still extremely clean and fun. get creative' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_boomerang); packages/ui/src/heroBoomerang/ (boomerangPlan / boomerangMotions / boomerangPos, playHeroBoomerang, HeroBoomerangScene); packages/ui/src/heroAttack/ribbonTrail.ts' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroBoomerang/heroBoomerang.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/heroAttack/damageFormation.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-ATTACK-31',
    title: 'Bubble Pop (attack_bubble, "Bubble Trouble", Rare): an iridescent bubble drifts over, engulfs the face and pops; Big streams little bubbles first and pops a big one with a splash ring; the blow lands ONCE on the pop',
    statement:
      'attack_bubble ("Bubble Trouble", a placeholder name; Rare, crate, account-wide, style bubble): after the shared damage '
      + 'formation an iridescent soap bubble (a turning pastel film, upright reflections, a constant wobble) swells at the '
      + 'hero\x27s rim while the hero puffs up, drifts over on a floaty weave, swells round the struck hero\x27s face, strains, '
      + 'and POPS into droplets and a fizz of tiny bubbles. SMALL (shared I-II): one bubble; the pop is THE impact. BIG '
      + '(III-IV, knockouts): a stream of little bubbles first (each blips on the face: a tick), then one BIG bubble that '
      + 'swells round the whole portrait and pops with a splash ring (THE impact). Soft and playful: a pastel palette, a '
      + 'gentle shake. The consequence lands exactly once, on the pop.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (the Rare and Epic hero attacks)', quote: 'build 5 animations that range from rare -> epic. all of the animations we have done so far are legendary. rare and epics should only have 2 or 3 tiers to them and generally be less exciting, but still extremely clean and fun. get creative' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_bubble); packages/ui/src/heroBubble/ (bubblePlan / bubbleDrifts / driftPos, playHeroBubble, HeroBubbleScene)' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroBubble/heroBubble.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/heroAttack/damageFormation.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-ATTACK-32',
    title: 'Backstab (attack_backstab, "Shadow Step", Rare): the striking PORTRAIT fades into smoke, steps out behind the target and stabs back toward home; Big lunges, then stabs from the side, then from behind; the blow lands ONCE on the stab from behind; the portrait is always restored',
    statement:
      'attack_backstab ("Shadow Step", a placeholder name; Rare, crate, account-wide, style backstab): after the shared damage '
      + 'formation the striking hero\x27s own PORTRAIT moves (as Classic and Enraged do). SMALL (shared I-II): it fades into '
      + 'dark smoke where it stands, steps out BEHIND the target (past it along the line from the striker), draws back and '
      + 'stabs back TOWARD its own side (a dagger slash in violet and teal; the target jolts toward the striker): THE impact; '
      + 'then it fades, reappears in its own slot and settles. BIG (III-IV, knockouts): Classic\x27s own lunge (a tick), it '
      + 'vanishes into smoke on the face, steps out at the target\x27s SIDE and stabs across (a tick), vanishes again, steps '
      + 'out BEHIND and stabs back toward home (THE impact), then smokes home and settles. A spot that would leave the '
      + 'screen swings round the target until it fits, and every stab drives at the target\x27s centre, so the hit never '
      + 'leaves the target. The striker is raised over the target (the .duel-attacker-* z-order) for the whole attack, and '
      + 'its transform, opacity and z-order class are restored exactly on every exit (the end, finish, cancel, unmount). '
      + 'The consequence lands exactly once, on the stab from behind.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (the fourth Rare, relayed by the coordinator)', quote: 'add a stealth backstab attack to the rare branch. portrait fades and attacks from behind the target back towards the player portrait and settles. the larger version can do a "normal" lunge attack then vanish into smoke and hit from the side, then vanish and hit from behind again' },
      { kind: 'code', ref: 'packages/progression/src/cosmetics.ts (attack_backstab); packages/ui/src/heroBackstab/ (backstabPlan / backstabGeo / fitSpot / backstabPose, playHeroBackstab, HeroBackstabScene); classicSwing in packages/ui/src/heroAttack/heroClassic.ts' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroBackstab/heroBackstab.test.ts', 'packages/progression/src/cosmetics.test.ts', 'packages/ui/src/heroAttack/damageFormation.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-ATTACK-25',
    title: 'A hero attack\x27s camera reaches its FX exactly ONCE: while the view zooms and shakes, the effects stay on the struck portrait',
    statement:
      'The hero attack camera (packages/ui/src/heroAttack/stageCamera.ts, shared by every style that draws Pixi FX) writes '
      + 'one zoom + shake transform onto the camera element (`#stage` in a fight or a tuner demo, the sandbox box in the '
      + 'Collection preview). It mirrors that transform onto the style\x27s Pixi root ONLY when the canvas the FX are drawn '
      + 'on does not already ride the camera element. Since the scaled stage (#1762) the shared above-portrait canvas lives '
      + 'inside `#stage`, and the preview\x27s canvas inside its box, so in every real context the FX are NOT mirrored: '
      + 'before this, every style applied the camera twice (a zoom of z squared about the focus plus a doubled shake) and '
      + 'its FX drifted off the struck portrait by up to about a portrait radius during the push-ins (measured in the real '
      + 'game on every style, both directions, at 1920x1080 (most also at 1600x900 and 21:9), and in the preview). Decided once per attack '
      + 'at the camera start (no per-frame layout read). The camera motion, the portrait motion, timings and layering are '
      + 'unchanged; with no DOM camera (tests) the mirror is the only camera and still moves; reduced motion has no camera.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Banana Cannon review, splats during the zoom)', quote: 'looks like it is overshot due to the zoom' },
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (double camera follow-up)', quote: 'make sure it doesnt break how our animations work' },
      { kind: 'code', ref: 'packages/ui/src/heroAttack/stageCamera.ts (fxCanvasRidesCamera, heroFxCanvas, StageCamera.start / apply); every style runner passes heroFxCanvas(o)' },
    ],
    currentBehaviour: 'Conforms, fixed 2026-09-29.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/heroAttack/stageCamera.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-PROG-CRATE-04',
    title: 'A guest cannot open crates: every Open shows a create-an-account gate; guests still earn and see their sealed crates',
    statement:
      'A guest (anonymous account) earns crates and sees them sealed in the Collection, but cannot open them. Every '
      + 'player-facing crate open (the Collection crate bay\x27s Open and Open all, and the New rewards pop-up\x27s Open and '
      + 'Open all) shows a small gate instead of the crate opener: "Create an account to open crates", with Create account '
      + '(closes it and opens the account panel) and Not now; Esc or a click outside closes it. A guest\x27s Open wears a '
      + 'small lock and the bay says "Create a free account to open them." Creating the account upgrades the guest in place, '
      + 'so the crates carry over, and the moment the account stops being a guest the gate closes and Open works with no '
      + 'reload. The gate warns that signing into an EXISTING account switches to it and leaves the guest\x27s crates behind, '
      + 'and the account panel says the same at the moment that happens. With no account backend the gate says accounts '
      + 'are unavailable instead of opening a panel that cannot work. Dev tuners and the crate FX preview (practice crates, '
      + 'never the server) are not gated.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (crate sign-in gate)', quote: 'ask players not signed in to sign in when they try to open a crate? we\x27d like players to create sign ins for account progression' },
      { kind: 'code', ref: 'packages/ui/src/progression/CrateSignInGate.tsx; CollectionScreen.tsx begin() (the one crate-open path) + CrateBay guest hint; packages/ui/src/AccountPanel.tsx (existing-account warning); remoteBoards.ts signInWithEmail `existing`' },
    ],
    currentBehaviour: 'Conforms, built 2026-09-29 (the owner picked a hard gate over a soft nudge). Client-side gate: the server does not yet refuse an anonymous open.',
    enforcement: { kind: 'scenario', refs: ['packages/ui/src/progression/CollectionScreen.test.tsx', 'packages/ui/src/progression/Crates.test.tsx', 'packages/ui/src/AccountPanel.test.tsx'], lastVerifiedAt: '2026-09-29' },
  },
];
