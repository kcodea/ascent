# 2026-09-30 · Board strength: a run's average weighs its rounds (20 / 35 / 45)

Owner ask (2026-09-30), verbatim: *"i think we need to weigh the rounds a bit. rounds 1-5 matter much less than 6-9
which matter less than 10+. they are all still important but i wonder if weighing would be better. like 20% ish for
1-5, 35% for 6-9 and 45% for 10+?"* Rule: **R-LOBBY-09** (amended). Follows
[2026-09-30-board-strength.md](2026-09-30-board-strength.md).

## The maths

A run's average (`pool_runs.strength_avg`, `runWeightedAverageOf`) used to be the plain mean of its board
percentiles. It is now:

    value = sum_g (W_g * S_g / n_g) / sum_g W_g      over the groups g with n_g > 0
    W = 20 (rounds 1-5), 35 (rounds 6-9), 45 (rounds 10+); S_g / n_g = the mean percentile of the run's boards in g

- **Inside a group** the weight splits evenly over the run's scored boards there.
- **Missing groups renormalise.** A run that ended in round 8 weighs rounds 1-5 as 20/55 and 6-9 as 35/55; a run that
  only played rounds 1-5 is just their mean.
- **Duplicate boards for a round** keep today's convention: every scored board counts once, so a round with two
  boards counts twice inside its group (the server always averaged every scored board; the client keeps one score
  per round, so it never has duplicates). The live pool has none today.
- **The round is the board's own wave** (`boards.wave`), not its reference wave (wave 16+ boards are scored against
  reference wave 15 but still belong to the 10+ group).
- **Rounding:** half up to a whole 1..100, in exact integer arithmetic over the common denominator
  `max(n1,1) * max(n2,1) * max(n3,1)` (`weightedAvgFromGroups` in TS, `board_strength_weighted_avg` in SQL), so the
  two copies cannot round differently.
- The run's strength (`pool_runs.strength`) is still that average **ranked among runs**, unchanged.

Worked example: rounds 1-5 at 20, 6-9 at 50, 10-11 at 80: plain mean 42, weighted 0.2 * 20 + 0.35 * 50 + 0.45 * 80 =
57.5, so 58.

## What changes for players

- **New games** freeze the weighted number at game end (the client's `runStrengthFromScores`, ranked against the
  server's `run_strength_histogram`).
- **Numbers already frozen in match history stay as they were.** They are history: the plain average they were frozen
  with is kept in `run_history.entry.boardStrength` / `replay.v2.result.boardStrength` and nothing rewrites them.
- **The pool's run strengths** (what the rank bands select on) switch when the owner runs the SQL below; until then the
  server keeps the plain average, so the histogram a new game ranks against is briefly the old one.

## "Game strength" on screen

Owner, same day: *"game strength for the display"*. Everywhere the player sees a RUN's number (Career rows, Recent
Games rows, Match details' seat rows and the selected seat's panel, opponents included) the label is now **"Game
strength"**, with the game's `.gtip` hover bubble (`data-tip`, never `title=`): *"How strong your board was across the
whole game, compared with everyone else's. Later rounds count more."* (`GAME_STRENGTH_LABEL` / `GAME_STRENGTH_TIP` in
`packages/ui/src/matchDetails/matchDetailsText.ts`). The per-round numbers in Match details are still each round's
BOARD percentile. The end screen shows no strength today, so nothing changed there. Internal names (`boardStrength`,
`strength`, `R-LOBBY-09`) are unchanged.

## Owner runbook

Paste `supabase/migrations/2026-09-30-weighted-strength.sql` into the Supabase SQL Editor and Run (after
`2026-09-30-board-strength.sql`). It is one transaction that first takes `access exclusive` locks on `pool_runs` and
`boards` (the board-strength migration deadlocked against live pool reads), replaces `pool_strength_refresh` (same
signature; the trigger keeps calling it), adds `board_strength_weighted_avg`, and ends by recomputing every run's
`strength_avg` and `strength`. Idempotent. The same block is appended to `schema.sql`.

## Live pool, before and after (read-only anon GETs, `npm run strength -- measure`, 164 eligible set-2 runs)

- Weighted run averages: min 5, p10 24, median 46, p90 71, max 85. Ranked among runs: min 1, p25 25, median 49,
  p75 77, max 100; runs per decile 16 17 15 20 15 18 11 18 17 17 (ranking keeps it flat, as before).
- Mean change in run strength 6.9; 43 of 164 runs move by 10 or more.
- Runs per band, plain -> weighted: Bronze 0-30 48 -> 48, Silver 10-40 50 -> 52, Gold 20-65 73 -> 75, Diamond 10-100
  149 -> 148, Ascendant 20-100 131 -> 131. Every band still fills a table with no widening (200 simulated lobbies per
  medal: 0 widenings, 0 generated seats).
- Biggest movers (strength before -> after; mean percentile and boards per group):
  - slow start, late spike: LazerLemon / hunch **37 -> 81** (rounds 1-5 at 26, 6-9 at 55, round 10 at 79)
  - slow start: Orangez / merrin **34 -> 56** (1-5 at 5, 6-9 at 76, 10+ at 48)
  - fast start that faded: LazerLemon / gambler **70 -> 31** (1-5 at 78, 6-9 at 49, round 10 at 7); Rooks /
    hermithank **89 -> 62** (83, 68, 25)

## Tests

- `boardStrength.test.ts`: the weights and groups, even split inside a group, renormalisation (ended in round 8),
  duplicates, exact half-up rounding, and the frozen game number weighted (`runStrengthFromScores`).
- `boardStrength.db.test.ts` (PGlite): `board_strength_weighted_avg` equals `weightedAvgFromGroups` on 404 group
  shapes; synthetic runs of 4-15 rounds (unscored rounds, a duplicate round) match TS average and strength; and
  **the real live pool** (`strengthLiveScores.fixture.json`: the 171 runs' scored boards, identities dropped) loaded
  and run through the migration's own closing refresh matches TS on every run. Changing one weight in TS fails all
  three.
