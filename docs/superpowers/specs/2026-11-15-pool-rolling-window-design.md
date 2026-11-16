# Rolling opponent pool: only the newest 250 runs are seated

Status: approved by the owner (Mike, 2026-11-15); built on feat/pool-rolling-window.

## Why

The game is rebalanced often. A recorded run keeps the boards it was built with, so a run from before a nerf can field
a board nobody can build today. Every usable run is drawn with equal chance however old it is, and 41% of the pool
(225 of 551 runs) is more than five weeks old. Owner, 2026-11-15: "its tough facing strong boards that are now weakened
due to balancing changes", "lets do newest 250 runs".

## What changes for players

- A new lobby (rated, Practice against players) is seated only from the **newest 250 usable runs of its card set**.
  "Newest" is the order the runs were started in.
- Ranked Duos (corrected while planning): seats filled from solo runs follow the same window. Recorded duo TEAMS are a
  separate, much smaller pool (`duo_runs`) and are not windowed in this change.
- As new runs are played, the oldest drop out, one for one. At today's pace (50 to 80 runs a week) the pool covers
  about the last four weeks.
- A set with fewer than 250 usable runs serves all of them, as today.
- The 1 to 100 strength number and the Bronze / Silver / Gold bands are ranked among those 250 only, so each band
  keeps its share of the runs that can actually be seated.
- Everything else about seating is unchanged: uniform random draw, at most 4 seats per player, your own runs included,
  band widening, generated seats when the pool cannot fill a table.

## What does not change

- **Games in progress.** A saved game carries its own table, so a run that drops out stays in any game already seated
  with it.
- **Nothing is deleted.** Old runs stay in the database for Career, match details, replays and the balance tools. They
  are only never seated in a new game. Raising the number brings them back.
- God Mode's board sample and the balance / strength tools keep reading every run.

## Approaches considered

1. **Newest 250 runs (picked).** Never starves the pool, one number to tune. The window in days stretches in a quiet
   week and shrinks in a busy one.
2. **Last 30 days with a floor of 250.** A fixed time window, but two numbers and two rules for the same result today.
3. **Gradual fade (old runs less likely).** Old boards still appear, and it breaks the uniform draw that the database
   and its hub copy must reproduce exactly.

## How it is built (my calls)

- **In the database, not the game client.** `pool_runs` gets a stored flag, `live`, true for the newest 250 eligible
  runs of each set (by `id`, which is upload order). The number is one SQL constant (`pool_live_limit()`).
- The once-a-minute pool refresh job (`pool_refresh_dirty`) recomputes the flag after it adds new runs, and before it
  re-ranks strength.
- Every reader that seats a table filters `eligible and live`: `pool_runs_sample`, `pool_runs__pick` (kept identical
  to each other, as the parity test demands), and `pool_mirror_index`. The hub mirror already
  drops a run that leaves its index, so the hub follows with no Worker change and the draw port is untouched.
- The run strength ranking (`pool_strength_refresh`) and the run histogram the client ranks its own game against rank
  among live runs only. A run that is not live keeps its last number.
- **No app release is needed**, but the hub must be deployed first (found in review: the hub deletes stored runs at
  most 128 per call, and this drops about 300 at once; the fix is in the same PR). Once the SQL is applied, every
  installed copy, old versions included, gets the new pool on its next fetch. A game client that is already running
  keeps the runs it loaded until it restarts.

## Rule and tests

- New approved rule `R-POOL-ROLLING-01` (lobby domain) quoting the owner, pinned by a PGlite test: 260 runs in, the
  10 oldest are never drawn; a new run pushes out the oldest; strength ranks cover live runs only; a set under the
  limit serves everything; `pool_runs_sample` and `pool_runs_sample_keys` still agree for a seeded draw.
- `docs/GAME-RULES.md` (the pool section), a devlog entry, and a patch note ("You now face only recently played
  boards").

## Open to the builder

- Whether the strength histograms need their own live filter or already follow from the ranking.
- The ops health check that compares the hub mirror with the database must compare against live runs.

## Needs a human

- The SQL is applied by a developer (`npm run db:apply`). It is Kevin's side of the repo, so he should see the PR.
