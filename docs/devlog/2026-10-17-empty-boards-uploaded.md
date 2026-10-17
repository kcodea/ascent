# Empty boards are uploaded; a recorded seat never reaches forward (2026-10-17)

Owner report (build 38252d08f, a ranked lobby): "i just faced this board on round 1 - how is that possible that he is
shop tier 2? i feel like somethings wrong with our snapshots again". Ruling after the finding: "empty boards are never
uploaded is a problem. this has to be fixed". Rule R-LOBBY-08 (amended).

## What happened

The seat was "Crispy Orangez": one of the owner's own recorded Disco Dan runs (the adjective is the duplicate-author
prefix). Disco Dan's turn 1 is a pure Setlist (the reducer refuses every shop action, and he opens on 0 Gold), so his
real round-1 board is always EMPTY at tier 1. Two things combined:

1. **Empty boards were never uploaded.** `storeBoards` (`packages/ui/src/boardLibrary.ts`) dropped every board with no
   minions, and the server ignored one anyway (`pool_runs_upsert_from`, `pool_runs_sample`). So all 10 recorded Disco
   Dan runs (7 of them the owner's) had `first_wave = 2`; 60 of 298 eligible Set 2 runs did (Gambler 5 of 7,
   Brackus 3 of 12, scattered others).
2. **`boardAt` reached forward.** A run starting at wave 2 served its WAVE-2 board in round 1 (the 2026-09-29
   tolerance). For the two Orangez runs seeded 1184009036 / 1562648225 that is exactly the screenshot: tier 2, one
   Geode Guardian (4/3 Deathrattle, his Tier 2 pick). The displayed "Shop tier 2" was the served board's tier, so the
   panel was consistent with the fight. Not a #2110 / #2113 regression: the tolerance dates from #1862 / #1864.

The 15 vs 7 Armor was fine: every rival seat starts on the lobby's `startingArmor` 15; Brackus starts on 11 and took 4.

## What changed

- **Client uploads every round.** `storeBoards` keeps empty boards; its local dedupe signature now includes the seed
  (two runs' empty round 1 on one hero are two rounds). The run-end final-board fallback (`highestFresh`) still picks
  a board with minions.
- **Run readers keep empty rounds:** `registerOpponentRuns`, `isWholeRun`, `playerRunsFrom`, the balance corpus
  (`eligibleBoard`) and the strength tool's live pool. A run with no minions in ANY round is refused / not eligible.
- **Per-board readers still skip them:** `pickOpponent` (per-wave opponents) now filters empties explicitly; the
  god-board sample, the strength scorer, the production bots' scout / fight-score pools, the Career per-round log and
  `boardOf` (Recent Games / Hall final board) already did.
- **`boardAt`: the round number is the truth** (owner: "ANY empty board should never skip. our ROUND # is our truth in
  serving snapshots"). Round N serves exactly the recording's round-N board. A hole inside an old recording was an empty
  round: `emptyRoundOf` serves the previous round's state (tier, runes, quests, scalers; its wave kept so one-shot banks
  stay spent; its ledger id dropped) with no minions. A round before the recording begins is an empty tier-1 board. Old
  recordings that start at wave 2 stay eligible and now field an empty round 1, as in their real game.
- **SQL:** `supabase/migrations/2026-10-17-pool-empty-boards.sql` (also appended to `schema.sql`) replaces
  `pool_runs_upsert_from` (empty boards count as waves; `has_minions` gates eligibility) and `pool_runs_sample` (returns
  empty boards with the run), then runs `pool_runs_rebuild()`. No existing row changes (no empty boards exist yet).
  No Edge Function filters boards; none needs redeploying. `opponentPool.data.ts` needs no regen: it is 160 synthetic
  per-wave boards (0 imported), and its generator's empty filter is right for a per-wave pool.

## Runbook

Ship the client first, then apply the migration (Supabase SQL editor or the CLI). An older client refuses a sampled
run that holds an empty board (its whole-run check rejected one), so applying SQL before the client ships only hides the
new runs from old clients until they update.

Tests: `lobby/servingIntegrity.test.ts` (owner bar: "we need the game serving integrity to be literally perfect"): seven
recorded run shapes fill a table (whole, empty round 1, an old recording from wave 2, an empty mid-run round, an old
recording with a gap, knocked out at 4 and at 7) and a real lobby is settled round by round to 14; every standing seat's
served board, tier, runes and scalers equal its recorded round (or the empty / previous / final board the rules name),
the scout card agrees, and every seat's Health + Armor (30 + its hero's Armor at the start) moves by exactly the damage charged.
It and `emptyRoundBoards` fail on the old `boardAt`. Also `lobby/emptyRoundBoards.test.ts` (Disco Dan's turn 1 records an empty wave 1; round 1 against a recorded Disco
Dan is empty at tier 1 for a new and an old recording; pickOpponent skips empties; an all-empty run is refused),
`lobby/poolEmptyBoards.db.test.ts` (the SQL), `ui/boardLibrary.test.ts` (the upload set), plus the updated
`poolWholeRuns.test.ts`, `poolLoader.test.ts` and `corpus.test.ts`.

## Seat Armor = the hero's own Armor (same PR)

Owner ruling 2026-10-17: "use the hero's own armor instead of 15". Rule R-LOBBY-SEAT-ARMOR-01. `seatStartingArmor`
(`lobby/lobby.ts`) gives a seat that plays a hero (snapshot, hybrid, bot; the player is its run) that hero's `armor`;
a seat with no hero (`authored`: Practice bots, tutorial and Gauntlet rivals, portrait only) keeps the flat 15. The new
`LobbyRules.seatArmor: 'hero'` is in `DEFAULT_LOBBY_RULES`; a lobby saved before it has no field and reads as flat, and a
caller that pins `startingArmor` (tests, Versus with 0) gets `seatArmor: 'flat'` from `lobbyRulesOf`. The rail's bar is
full at each seat's own Resolve + Armor. Practice "health" options and the tutorial do not read the 15 (Practice
invulnerability is a reducer gate; the tutorial's rivals are authored). The legacy prototype `createLobby`
(`lobby.ts`, used by `npm run lobby`) keeps the flat value: its seats are drivers, not live-lobby seats.

Measured (150 seeded lobbies on the live Set 2 pool, 301 runs, seat-vs-seat only, the player never deals damage, capped
at round 30; flat vs hero on otherwise identical code): mean seat starting Armor 15 -> 10.96 (-4.04), mean knockout
round 15.35 -> 14.85, seats out by round 12 45.5% -> 52.2%, by round 16 76.2% -> 79.0%. Low-Armor heroes fall earliest
(Robin, 4 Armor: 16.4 -> 14.2; Keshi, 10: 19.0 -> 16.1); Darah (18) and Nadja (17) barely move. Net: tables thin a
little faster and recorded seats are a bit softer.
