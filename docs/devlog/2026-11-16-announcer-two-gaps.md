# 2026-11-16: the announcer keeps two gaps

Rule R-PRESENT-ANNOUNCER-GAPS-01; test `packages/ui/src/announcer.test.ts` ("two gaps").

## Why

Owner, the day after the gap went from 12 s to 25 s: "the last game i played felt shockingly quiet with regards to the
announcer". A line that lands inside the gap is DROPPED, not delayed, and most moments get one chance a game. With a 25 s
gap the start-of-combat line (3 s into the fight) silenced that fight's result line and the standings lines on the return
to the Shop. Shown the two options, the owner chose "lets do the two gaps".

## What

- `ANNOUNCER_BIG_COOLDOWN_MS` = 10 s for a moment at `ANNOUNCER_BIG_MOMENT_PRIORITY` (30, Triple) or above: results,
  standings, knockouts, the low-Resolve lines, rune forges, the named-card specials.
- Everything below keeps `ANNOUNCER_COOLDOWN_MS` = 25 s: back to Shop, the random buy lines, entering combat,
  Equipment, a pair, tier up.
- `pump` holds each ready line to its own gap (`announcerCooldownFor`). Drop-not-delay, the bypass lines and the
  terminal lines are unchanged.

## Not verified

The cutoff (30) and the 10 s are a proposal. Nobody has played a game on it; the owner tunes by ear.
