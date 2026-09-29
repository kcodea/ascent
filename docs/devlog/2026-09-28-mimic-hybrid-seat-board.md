# 2026-09-28 — Mimic hybrid lobby seats fielded no board

**Report.** In 2 of 6 real Practice (players) games the Mimic seat had no board, and in one the lobby credited
that seat with knocking the player out.

**Root cause.** `autoplayRun` (the headless recorder behind every generated `hybrid` seat) had no branch for the
hero-power Discover (`powerOffer`). Mimic raises one at the start of every turn, and it blocks every other
action, `faceOmen` included, so the loop bailed on turn 1 with ZERO boards. Seat selection's
`canFieldBoard` probe asked the LIVE bot, which can play Mimic, so the seat was seated anyway and its
recording-only `prepare` returned null all game. When the player was paired with it, `playerOpponent` returned
null, the reducer fought an ordinary pool board, and `settleRunLobbyRound` still charged and credited the paired
seat as though it had fought.

Of all 59 heroes only Mimic recorded nothing; Void (not playable) recorded 3 waves (its turn-4 `powerOffer`).

**Fix.**
- `autoplayRun` answers `powerOffer` (pick 0). Every hero now records 8+ waves.
- `hybridSeat.canFieldBoard` also requires the RECORDING to field a board, via `recordingFieldsBoard` (a
  one-board prefix of `autoplayRun`, new `maxBoards` arg, ~1-2 ms). The live-bot check is kept so selection is
  unchanged for heroes it already rejects. `createRunLobby` measured ~55 ms before, ~60 ms after (20 seeds).
- A player paired with a boardless seat faces the latest ghost (as on a bye). The pairing is logged as an
  unfought sit-out for both; the player's fight is logged against the ghost with `bye: 's0'` and the new
  `standInFor` field. Before any elimination there is no ghost and the round is a sit-out for the player too.

**Follow-up worth a look (not done).** The live bot still cannot play Disco Dan, but his recording works, so the
live-bot half of the probe keeps rejecting a hero whose seat would be fine. Dropping that half would seat Disco
Dan and change lobby compositions, so it needs its own PR.

Oracle: R-LOBBY-05.
