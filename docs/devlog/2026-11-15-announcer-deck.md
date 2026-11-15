# 2026-11-15: the announcer's shuffled deck, and a longer gap

Rule R-PRESENT-ANNOUNCER-DECK-01 (`foundation`); test `packages/ui/src/announcerDeck.test.ts`. R-PRESENT-07 amended (25 s).

## The ask

Owner: "it feels like i hear a lot of the same lines pretty constantly, i need your help in designing a system that
feels more randomized. perhaps we need more lines too", then "lets add more lines, lengthen the gap, and yes how can
we have lines like a shuffled deck?"

## Why it repeated

The no-repeat bag lives in the run's `announced` slice, so it remembers one game. Every new game picked uniformly from
the full list again: with 18 game-start lines, two games in a row open on the same line about 1 time in 18, and hearing
a line you heard within the last three games is near 1 in 6.

## The deck (`announcerDeck.ts`)

Per moment, the device keeps the takes dealt so far (localStorage `ascent.announcerdeck.v1`).

- A deal picks at random among the candidates NOT yet dealt. The candidates are what the game already allows (this
  game's unheard takes; a keyed moment's own takes), so every in-game rule is untouched.
- When every candidate has been dealt, the OLDER half goes back in and the recently heard half stays out. A plain
  "reshuffle everything" let a line come back one game after it played (the end of one pass, the start of the next).
- So: all N takes before any repeat, and from then on a take waits out at least N/2 others.

It goes through `AnnouncerDeps.deck` (load / save), so the old announcer suites run with a store that remembers
nothing and pin their takes exactly as before.

## The gap

`ANNOUNCER_COOLDOWN_MS` 12 s to 25 s. A line that lands inside the gap is dropped, not queued, so this is also the
"talks less" lever: a start-of-combat line now usually means no verdict line for a short fight. The lines that bypass
the gap (the 15-second timer warning, the forge lines, Survive after its own warning) still do.

## Not in this PR

More lines. One-line moments get nothing from a deck; they need takes, recorded for all four voices.
