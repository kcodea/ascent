# 2026-09-25 — Triples consume BOARD copies first (R-GILD-03)

Owner rule: "the minions on board should be used first and foremeost for triples". Example: two copies on the
board and Genesis Indy's hero power gives two copies to hand; the triple should take both board copies plus one
new copy, and leave the other new copy in hand as a plain card.

- **The one consumption point.** `pullCopies` in `packages/sim/src/reducer.ts` (called only by `checkTriples`)
  used to pull from the hand first (right-most), then the board (right-most). It now pulls from the **board
  first, left-most first**, then takes only the shortfall from the hand, **newest (right-most) first**. Surplus
  copies stay where they were. The golden merge (`combineIntoGolden`: the two best copies stacked, buffs and
  per-instance accruals carried) is untouched, so a buffed board copy now reliably carries its buffs into the
  golden instead of being stranded.
- **Every route inherits it.** Buy, Discover pick, play/summon onto the board, hero powers (Gildmaster, adopted
  powers), quest/rune/devGrant copy grants, Equipment, sell-grants, and the shop-open `checkTriples` that
  catches End-of-Turn and combat carry-back copies all funnel through `checkTriples` -> `pullCopies`. No path
  consumes copies any other way.
- **Hand cap.** The shop-open "no overflow" argument was restated: `combineIntoGolden` puts the golden on the
  board whenever the hand is full, and with board-first a full hand always means at least one board slot was
  freed.
- **Outcome change only when more copies are held than a Gild needs** (or when the copies span board and hand
  unevenly under Twin Gilding / Midas). A plain 2-board + 1-arriving triple is identical to before.
- **Tests.** `packages/sim/src/tripleBoardFirst.test.ts` drives each route (owner example via a real two-copy
  grant, Rune of Copies at two stacks; buy; Discover; play; Gildmaster; board tie-break; hand shortfall). One
  existing fixture changed: `run.test.ts` "Flowing Monk buffs a friend when a summon overflows the full board"
  held five identical fillers, so the play also triples three of them; the Monk's buff now rides into the golden
  in hand, and the assertion checks board + hand. No golden/replay fixture changed; recorded opponent boards
  (`servedBoards`) are stored data, never re-simulated, so they are unaffected.
- Oracle: `R-GILD-03` in `packages/rules/src/registry/approved/gilding.ts`. Patch note: Systems.
