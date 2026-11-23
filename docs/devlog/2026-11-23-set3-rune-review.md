# 2026-11-23: Set 3 rune review board, carryover pass

The owner voted on every Set 2 rune Set 3 did not have yet, plus 27 new concepts, on the "Set 3 Runes" review board.
The board was an ADDITION list: nothing already in Set 3 was on it, so "No" means "stays out" and changes nothing.

This PR (the carryover pass):
- 68 Set 2 runes gain `set3` (67 Yes + Mountain Trade, a Neutral vote the owner chose to keep). The list lives in
  `packages/sim/src/set3ReviewJoined.ts`; older "Set 2 only" pins read `withSet3` so only the review's join can move them.
- Edits that apply in every set (owner: "Everywhere"), with a patch note:
  - Summit: fixed turns 9 and 11 (`SUMMIT_TURNS`); bought later, only the turns ahead pay.
  - Top Shelf: at the top Tier, the two right-most minion offers are that Tier (`guaranteeTopShelf`), two more per copy.
  - Spellstone: Basic (moved into `RUNES`).
  - Pair: renamed Tempo (id `rune_pair` kept).
  - Wildfire: Demon tag dropped.
- Three seed-sensitive tests moved seeds (lobby seed 4 now wins untouched) and runDerive accepts a 0-Gold buy (Thrift).

The 17 approved new runes are built in their own PRs (Undead, Spirits, Hybrids #2858). Rule: R-SET3-RUNE-REVIEW-01.
