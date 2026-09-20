# 2026-09-19 — Replay viewer: the backfilled Win % fought with a neutral player side

**Owner report (with screenshot):** on the Midas run recorded 2026-09-16 09:49 (Round 14, 1st place), the
replay rail's Win % read ~0% on R9, R12, R13 and ~3% on R14 — all recorded WINS.

## Root cause

Recordings made before PR #1569 carry no stamped `odds`, so the viewer re-estimates each round with the odds
probe (`oddsInputFromCombatFrame`). That first backfill fed the probe both starting rosters from `initial` and
**neutral side states** (`combatSide({ tier, poolIds })`) for both sides. The rosters were right; the run was
missing. On the Midas run the player held Rune of Beastial Swarm (+18/+18 to every Beast per friendly Beast
death) and Rune of Warding — the fights were won *by the runes*, and a probe without them lost every sim.
R12: player 63/63, 49/46, 66/71… vs enemy 134/187, 170/258, 343/319 → 0% neutral, 100% with the runes.

Not sides swapped, not post-combat rosters, not dropped keywords/golden — those were all correct.

## Fix

- `preparePlayerCombatSide` (reducer) is split into three exported pure builders — `playerBoardMinions`,
  `playerCombatSideState`, `playerCombatConfig` — with no behaviour change (the reducer calls them).
- `oddsInputFromCombatFrame(frame, view)` now rebuilds the **player** side with those builders from the
  round's last shop frame: a `ShopView` is `RunState` minus `SHOP_VIEW_EXCLUDED_KEYS`, and the builders read
  none of those keys (a Proxy test pins that). Stats/keywords/gilding still come from `initial` (post End of
  Turn); the shop board supplies the per-instance carries the snapshot lacks; the live Imp/Undead-Lantern auras
  `simulate` folded into `initial` are backed out (the probe re-applies them); a banked Fleeting Vigor is put
  back (enterCombat rewinds it out of `initial`).
- The **enemy** side is built from the frame's `enemyScalers` (defensively — the shape grew over time and an
  older recording carries a subset), the paired seat's scouted tier, and the rival hero's power. A rival
  seat's runes/quest mods and its Undead/Beast/Attachment auras are not in the recording (its snapshot lives in
  the opponent pool), so the number stays an estimate and the rail keeps its `~`.

## Measured

Midas recording, before → after (recorded result):

| R | result | before | after |
|---|---|---|---|
| 1 | W | 100 | 100 |
| 2 | W | 100 | 100 |
| 3 | W | 100 | 100 |
| 4 | L | 4 | 4 |
| 5 | L | 0 | 0 |
| 6 | L | 0 | 41 |
| 7 | W | 100 | 100 |
| 8 | W | 16 | 100 |
| 9 | W | 0 | 99 |
| 10 | W | 100 | 100 |
| 11 | W | 60 | 100 |
| 12 | W | 0 | 100 |
| 13 | W | 0 | 100 |
| 14 | W | 3 | 100 |

Across 24 recent leaderboard recordings (262 decided rounds): direction agreement 238 → 250; recorded wins
reading below 40%: 3 of 174 (none ≤ 2%; before: 11 wins read 0–3%).

New-recording path re-verified on a throwaway run: R1 Combat Summary "0% win" → stamped `win: 0`; R2
"100% win" → stamped `win: 1` (read back from the IndexedDB round chunks).

## Tests

`packages/sim/src/replayOdds.test.ts`: live parity on three bot runs (rebuilt player half == the run's own
`oddsInput`; when End of Turn touched no run scaler the probe reproduces the live number byte-for-byte), the
scrubbed Midas fixture (`packages/sim/src/fixtures/replay-midas-2026-09-16.json`: handles pseudonymised, combat
event logs dropped) with per-round direction expectations, unit tests on the rebuilt input (overlay matching,
aura back-out, Fleeting Vigor, enemyScalers incl. partial shapes, null view), and the excluded-keys contract.
