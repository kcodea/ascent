# 2026-10-17 — The rank a game was played at (R-GAME-RANK-01)

Owner ask, with a screenshot of Recent Games: "i want to show the rank that the game was in in this page, so it should
say Plat 3 or w/e".

- **No backend change; both sources already existed.** A Career row reads `run_history.entry.rank.before` (the
  position `settle_rank` settled the game from, stamped onto the row in the same update as `ratingAfter`, every rated
  game since medals on 2026-09-20; the light select projects it as `rank_before:entry->rank->before`). A Recent Games
  row, for any player, reads `run_telemetry.derived->rankAtStart` (R-TELEMETRY-RANK-01, uploads from 2026-10-06),
  added to the selects that already read `derived`, so no extra payload is opened.
- **Never derived from a rating.** `100 x division + points` is ambiguous at the promotion gate (Gold I at 100 equals
  Gold II at 0), so a row without a stored division shows nothing. A medal-only telemetry stamp shows nothing too.
- **Where.** `GameRank` (`gameRank.tsx`; pure helpers in `gameRankData.ts`): the crest ring without its plate plus
  "Platinum III" beside the record in `GameCard`'s header (new `rank` slot), and a 22px crest plus "Plat III" at the
  top of a `GameSplit` row's right column (`GameListItem.rank`). Practice rows never pass one; Versus/practice career
  rows are filtered by `mode`.
- **Live check:** 98 of the newest 100 Recent Games rows carried a division; a viewed Career showed one on all 50 rows.
- **Not done:** the lobby tiles (other players in a game). `MatchSeat` records no rank, so there is nothing to show
  without recording one per seat at game end.
