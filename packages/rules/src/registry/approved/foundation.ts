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
    title: 'The announcer speaks each game moment at most once per run, never back to back, through a priority queue with a 12 s cooldown and a fifteen-line cap; its own audio channel sits behind the Settings Audio panel',
    statement:
      'The announcer (announcer.ts) is a set of one-shot voice lines on game moments, spoken ONLY inside a lobby or '
      + 'Practice run on screen (the music gate: never the title, a tutorial, a sandbox rig or a replay). Each event '
      + 'speaks at most ONCE per run, recorded in the store\x27s `announced` slice, which is persisted with the '
      + 'autosave and keyed by the run seed, so a Save & Continue never replays a line and a new run starts fresh; '
      + 'BackToShop and Triple may speak twice, at least ANNOUNCER_REPEAT_GAP_WAVES (5) waves apart, and Knockout twice, '
      + 'at least ANNOUNCER_KNOCKOUT_GAP_WAVES (1) apart. The variant (1 to 4) is drawn from the run seed (`announcerVariant`, '
      + 'which hashes the event\x27s index in ANNOUNCER_LINES, so the table is append-only). The RARE lines (the four random '
      + 'buy lines, Round7) roll a seeded ANNOUNCER_RARE_CHANCE (10%) per qualifying moment from the run seed, the wave and '
      + 'the buy index (`announcerRoll`), so a replay rolls the same way; never Math.random. One global cooldown, ANNOUNCER_COOLDOWN_MS (12 s from the previous '
      + 'line ending), and never while a line plays: an event landing inside it is DROPPED, not queued, and stays '
      + 'unfired (it may speak later if its moment recurs and is still valid); the two forge lines and this round\x27s '
      + 'SurviveUnder10hp BYPASS the cooldown (never a playing line: they wait for it to end). Pending events are weighed together by '
      + 'priority (GameWon = GameLoss 100 > TopTwo 90 > Knockout 88 > TopFour 85 > SurviveUnder10hp 80 > LosingLowOdds = '
      + 'WinningLowOdds 70 > ComebackWin 66 > ThreeWinStreak 65 > StartCombatUnder10hp 60 > FlawlessVictory 58 > BigHit 57 > '
      + 'EnteringCombatAfterLoss 55 > MinionHits100Stats 50 > GoldenArmy 48 > ShopBigBuff 46 > TierSix 45 > EpicRuneforge 40 > '
      + 'Runeforge 35 > Triple 30 > TribeFour 28 > Equipment 25 > BigSpender 24 > RichTurn 22 > EnteringCombat 20 > Pair 18 > '
      + 'GameStart 15 > Round7 14 > the four random buy lines 12 > BackToShop 10): the highest speaks, '
      + 'the rest are dropped. Shelf life: combat lines expire when the next shop opens, shop lines when combat starts, '
      + 'GameWon / GameLoss never expire (they wait out the cooldown). Silence: nothing in the first '
      + 'ANNOUNCER_COMBAT_SILENCE_MS (3 s) of a combat resolution; nothing over the music\x27s turn-1 fade-in (GameStart '
      + 'plays ANNOUNCER_GAME_START_DELAY_MS, 4 s, after the first shop); a Skip (`stopAllAudio`) or leaving the run '
      + 'cancels the queue and the playing line with an ANNOUNCER_STOP_FADE_MS (100 ms) fade. At most '
      + 'ANNOUNCER_LINE_CAP (15; 8 until 2026-09-24) lines per game, GameWon / GameLoss allowed on top. Timing: the Face Omen lines play '
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
      + 'RandomDwarfBuy (a 10% seeded roll on a spell / any / a Beast / a Dwarf buy, each once per game) and Round7 (a 10% '
      + 'seeded roll when wave 7\x27s Shop opens). The '
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
      {
        kind: 'owner-chat',
        ref: 'Claude Code session, 2026-09-23 (the announcer follow-up: the forge lines + the delays)',
        quote: 'i dont think the runeforge voicelines are playing? and can you slightly delay the combat and return to shop ones? they play too quickly and should be offset by about 1s.',
      },
      { kind: 'code', ref: 'packages/ui/src/announcer.ts (the queue, the detectors, the channel); packages/ui/src/announcerSlice.ts (the persisted slice); packages/ui/src/store.ts (announced, markAnnounced, combatOdds, the save round-trip); packages/ui/src/Game.tsx (the subscription + the stopAllAudio hook); packages/ui/src/Recruit.tsx (observeCombatBoard); packages/ui/src/EscMenu.tsx (the Audio panel)' },
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
      + 'correct all along), so TopTwo has one variant.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/announcer.test.ts', 'packages/ui/src/escMenuAudioPanel.test.tsx'],
      lastVerifiedAt: '2026-09-24',
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
];
