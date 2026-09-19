# 2026-09-19 — Board model: the yardstick is the wave, not a band

Owner report 2026-09-19: the replay viewer's new **Power** column showed a board going **99 → 11 from round 12
to 13 with no real change**. Directive: *"it should be running against an average board strength for all
snapshots at that turn, not a turn bracket."*

## What was wrong

`predictBoardElo` (`packages/sim/src/boardModel.ts`, the learned term the production bots search with and what
`boardPowerOf` prints) standardised every feature against a **wave band** (1–3, 4–6, 7–9, 10–12, 13–15,
16–20). Two defects, one visible and one hidden:

- **The cliff.** Crossing a band edge swapped the yardstick. The 13–15 band's mean total attack was ~5,250
  against ~390 for 10–12 — a handful of runaway boards dominate the small late bands — so a wave-12 board that
  read 99 read 11 at wave 13. Scoring every recorded board one wave past its own, the band model stepped
  **2,000–125,000 Elo** at the edges and *raised* a fixed board by ~140 Elo at every wave inside a band.
- **The r was mostly the band.** The Elo labels come from round-robins *within a band* (`board:elo`), so a
  wave-6 board out-rated a wave-4 board just by being two waves older (mean Elo 846 at wave 4 vs 2,121 at wave
  6). The band-relative model learned that slope from `power` and `wave`; its 0.789 held-out r was largely
  "which wave of the band is this". The same band recipe re-run on today's content scores **0.24**.

## What shipped

`npm run board:train` now emits **one yardstick per wave**: `BOARD_MODEL.waves[w] = { mean, scale, n }` for
every wave 1..17 (`bands` is gone; the data file is regenerated, never hand-edited). Inference is unchanged
in signature and meaning — `predictBoardElo(minions, wave)` / `boardStrength(minions, wave)`, ~1500 = average
for that wave, the same 300-Elo squash — and costs one table lookup + 52 multiply-adds + 52 compares.

The rules, all baked by the generator and documented in both headers:

| Rule | Why |
|---|---|
| **Centre = the wave's median board, scale = its IQR ÷ 1.349** (sd fallback when the IQR is 0, then 1) | the late waves are heavy-tailed: one wave-12 board holds 30k power beside a median of 1.2k; wave 17's *mean* power is 4.8M against a median of 21k. A mean / sd yardstick just moved the cliff to whichever wave the runaway sat in (a fixed board dropped 1,341 Elo at 11 → 12 vs 815 with the median). |
| **Thin waves blend, never cliff:** under `nMin` = 15 boards, neighbours pool in weighted by distance (own ×1, ±1 ×½, ±2 ×⅓, …) until the pooled weight reaches 15 | waves 14–17 hold 16 / 12 / 10 / 8 boards. `--n-min` 10–30 is flat on r. |
| **Every wave 1..maxWave is emitted; inference clamps past the ends** | a board with any fitted neighbour is always scored; the only refusal is an empty board. |
| **Labels re-centred on each wave's median Elo** | so 1500 is "the median recorded board at this wave" on BOTH sides of the regression (fitted intercept 1,445). |
| **Standardised values clipped above at +3, and only above** | unclipped, one held-out runaway (z = +10…+50) dominated the pooled fit: r 0.34 → 0.87. One-sided because the tail is one-sided and a board far *under* its wave still needs a gradient for the search — a symmetric clip flattened the learned term for the weak hand-built pilot fixtures and the strategist held its payoff in hand. |
| **`wave` feature pinned to z = 0** | constant within a wave by construction; the blended pool would otherwise leave a stray non-zero on the thin waves. |

Per-wave sample counts (the 2026-07-29 `board-elo.json` corpus, 664 human boards / 56 runs):
`1:48 2:52 3:53 4:53 5:56 6:56 7:56 8:56 9:55 10:45 11:39 12:29 13:20 14:16 15:12 16:10 17:8`.

## Measured

Run-split held-out (14 of 56 runs), same split as before:

| | pooled r | within-wave r (n-weighted) | vs wave-relative power |
|---|---|---|---|
| band model, as shipped (fit 07-29) | 0.242 | 0.63–0.96 per wave | — |
| band recipe re-run today | 0.241 | | 0.225 |
| per-wave, mean / sd, no clip | 0.340 | 0.798 | 0.331 |
| per-wave, mean / sd, clip ±3 | 0.884 | 0.829 | 0.843 |
| **per-wave, median / IQR, clip +3 (shipped, λ = 300)** | **0.867** | **0.804** | 0.822 |

The 0.02 of r given up for median / IQR buys the smoother yardstick: corpus-wide worst adjacent step 880 Elo
vs 1,608 for mean / sd. The sweep over λ is flat from 30 to 3,000 (0.861–0.867); the trainer still picks it
on the held-out set (`--lambda` pins one, and the header lists `--mean-sd`, `--clip`, `--winsor`, `--n-min`
as the reachable experiments with their measured costs).

The owner's kind of board (a median wave-12 recorded board, Elo 2,227): **Power 98 → 21 before, 74 → 36
after** at rounds 12 → 13; the top-quartile one 99 → 21 before, 91 → 37 after. The remaining drop is the
population — median recorded power goes 598 → 1,203 → 2,772 across waves 11 / 12 / 13 — and is what the
directive asked to measure against. A board that stands still loses ground; it never gains it.

## Pinned

`packages/sim/src/boardModel.test.ts` (new): the table is contiguous with the `wave` feature pinned; waves
past the ends clamp; a fixed median and a fixed strong wave-12 board scored at every wave 8..16 never move more
than 1,000 Elo between adjacent waves and never RISE more than 150; at rounds 12 → 13 `boardStrength` keeps at
least 0.3× of its wave-12 value (the band model: ≤ 0.22×); `boardPowerOf` prints the same numbers.

Two pilot fixtures were corrected, not weakened (dated in place):

- `generalistPilot.test.ts` (b) "a triple one buy away" moves from wave 1 to wave 2: every recorded wave-1
  board is one or two bodies, so a THIRD body at wave 1 is a top-decile board and the seeded 2/1 beside the
  third copy tied the triple line within half a point. From wave 2 on the pilot takes it at every budget.
- `curriculum.test.ts` (a) demonConsume's ready fixture now offers a Shop minion: Appetite Agent's Shout
  *consumes a Shop minion*, so against the old empty Shop it was a vanilla 3/2 that the pilot — correctly, by
  the new term — held in hand. With a target in the Shop it plays and aims it.

## Docs

`docs/balance-bot.md` trust ledger gains a "Board strength" row; the module headers of `boardModel.ts` and
`board-train.ts` carry the rules; patch note under 2026-09-19 "Replay viewer" (the Power column is
player-facing).

## Follow-ups

- The corpus is the 2026-07-29 fetch (56 runs, Drakko-heavy). `npm run boards:fetch && npm run board:elo --
  --human && npm run board:train` refreshes all three; `board:elo` still rates in bands (fine — labels are
  re-centred per wave), but a per-wave round-robin would need ≥ 20 boards per wave past 13.
- Waves 14–17 are blended from 8–20 boards; treat late-game Power as coarse until the corpus grows.
