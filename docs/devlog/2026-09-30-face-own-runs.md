# 2026-09-30 · You face your own runs too (up to 4 seats)

Owner ruling (2026-09-30), verbatim: *"this is a problem - you should face your own boards too. you should also be able
to occupy up to 4 of your own snapshots. please fix this"*. This reverses the "your own runs never sit at your table"
half of R-LOBBY-08 (2026-09-29, which the owner had been asked about under "Open for the owner" in
[2026-09-29-pool-whole-runs](2026-09-29-pool-whole-runs.md)).

- **Client fetch** (`opponentPool/poolFetch.ts`): the RPC is called with `p_exclude_user: null`, and the pre-SQL
  fallback no longer drops the player's runs. **No SQL change**: `pool_runs_sample` keeps the parameter, defaulting to
  null, and a null excludes nobody.
- **Seat selection** (`createRunLobby`): the own-run filter and `LobbySeatOptions.excludeOwnerId` are gone. The player
  is an author like any other, so the same cap applies: at most 4 of the 7 seats (`MAX_SEATS_PER_PLAYER`).
- A lobby filled only with your own runs (plus generated seats) is RATED: those are real recorded runs.
- Rule: R-LOBBY-08 reworded (owner quote added). Tests: `poolWholeRuns.test.ts` (own runs seat, capped at 4; an
  own-runs-only pool fills 4 seats), `poolFetch.test.ts` (nobody excluded on either path).
