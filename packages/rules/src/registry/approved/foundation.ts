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
      + '`ascent.musicvol`), applied live and persisted. The round won / round lost verdict chimes are removed.',
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
    title: 'The announcer speaks each game moment at most once per run, never back to back, through a priority queue with a 12 s cooldown and an eight-line cap; its own audio channel sits behind the Settings Audio panel',
    statement:
      'The announcer (announcer.ts) is a set of one-shot voice lines on game moments, spoken ONLY inside a lobby or '
      + 'Practice run on screen (the music gate: never the title, a tutorial, a sandbox rig or a replay). Each event '
      + 'speaks at most ONCE per run, recorded in the store\x27s `announced` slice, which is persisted with the '
      + 'autosave and keyed by the run seed, so a Save & Continue never replays a line and a new run starts fresh; '
      + 'BackToShop and Triple may speak twice, at least ANNOUNCER_REPEAT_GAP_WAVES (5) waves apart. The variant '
      + '(1 / 2 / 3) is drawn from the run seed. One global cooldown, ANNOUNCER_COOLDOWN_MS (12 s from the previous '
      + 'line ending), and never while a line plays: an event landing inside it is DROPPED, not queued, and stays '
      + 'unfired (it may speak later if its moment recurs and is still valid); the two forge lines and this round\x27s '
      + 'SurviveUnder10hp BYPASS the cooldown (never a playing line: they wait for it to end). Pending events are weighed together by '
      + 'priority (GameWon = GameLoss > TopTwo > TopFour > SurviveUnder10hp > LosingLowOdds = WinningLowOdds > '
      + 'ThreeWinStreak > StartCombatUnder10hp > EnteringCombatAfterLoss > MinionHits100Stats > TierSix > '
      + 'EpicRuneforge > Runeforge > Triple > Equipment > EnteringCombat > GameStart > BackToShop): the highest speaks, '
      + 'the rest are dropped. Shelf life: combat lines expire when the next shop opens, shop lines when combat starts, '
      + 'GameWon / GameLoss never expire (they wait out the cooldown). Silence: nothing in the first '
      + 'ANNOUNCER_COMBAT_SILENCE_MS (3 s) of a combat resolution; nothing over the music\x27s turn-1 fade-in (GameStart '
      + 'plays ANNOUNCER_GAME_START_DELAY_MS, 4 s, after the first shop); a Skip (`stopAllAudio`) or leaving the run '
      + 'cancels the queue and the playing line with an ANNOUNCER_STOP_FADE_MS (100 ms) fade. At most '
      + 'ANNOUNCER_LINE_CAP (8) lines per game, GameWon / GameLoss allowed on top. Timing: the Face Omen lines play '
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
      + 'it, the player among them), GameWon (1st place) and GameLoss (2nd to 8th) 1 s into the end screen. The '
      + 'announcer is its own channel: a third gain on the SFX AudioContext with its own volume and mute '
      + '(`ascent.announcervol` default 0.9, `ascent.announcermuted`), not ducked by the Game-sounds mute; the clips '
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
      {
        kind: 'owner-chat',
        ref: 'Claude Code session, 2026-09-23 (the announcer follow-up: the forge lines + the delays)',
        quote: 'i dont think the runeforge voicelines are playing? and can you slightly delay the combat and return to shop ones? they play too quickly and should be offset by about 1s.',
      },
      { kind: 'code', ref: 'packages/ui/src/announcer.ts (the queue, the detectors, the channel); packages/ui/src/announcerSlice.ts (the persisted slice); packages/ui/src/store.ts (announced, markAnnounced, combatOdds, the save round-trip); packages/ui/src/Game.tsx (the subscription + the stopAllAudio hook); packages/ui/src/Recruit.tsx (observeCombatBoard); packages/ui/src/EscMenu.tsx (the Audio panel)' },
    ],
    currentBehaviour:
      'Conforms as of 2026-09-23 (same-day follow-up). Owner report after #1653: "i dont think the runeforge '
      + 'voicelines are playing? and can you slightly delay the combat and return to shop ones? they play too quickly '
      + 'and should be offset by about 1s." Root cause: the scheduled forges (turn 6 Basic / turn 9 Epic, a hero\x27s '
      + 'turn 5 / 8, a booked Clock forge) set runeforgeOffer inside the same reducer step as the combat -> recruit '
      + 'flip (resolveCombat -> advanceCombat -> openNextStartOfTurnModal), and the return branch of syncAnnouncer '
      + 'returned before the forge check ran, so the line was never detected. Fixed: detectForge runs on the return '
      + 'update too, and the forge lines bypass the cooldown (never a playing line). ANNOUNCER_FACE_OMEN_DELAY_MS 600 '
      + '-> 1600 ms; ANNOUNCER_BACK_TO_SHOP_DELAY_MS 1000 ms added (BackToShop, TopFour / TopTwo, a forge opening with '
      + 'the return); ANNOUNCER_COMBAT_SILENCE_MS stays 3000 ms and applies to the lines detected during the fight, not '
      + 'the Face Omen lines. Before this there was no announcer and the Settings Audio section was two flat '
      + 'rows (Game sounds, Music). Known asset issue: the delivered GameWon.mp3 is byte-identical to TopTwo2.mp3 '
      + '(a mis-export the owner will replace under the same name); GameWon therefore has one variant today.',
    enforcement: {
      kind: 'scenario',
      refs: ['packages/ui/src/announcer.test.ts', 'packages/ui/src/escMenuAudioPanel.test.tsx'],
      lastVerifiedAt: '2026-09-23',
    },
  },
];
