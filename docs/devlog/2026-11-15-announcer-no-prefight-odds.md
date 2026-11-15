# 2026-11-15: the announcer no longer spoils a fight

Rule R-TEXT-ANNOUNCER-02 (`text`); test `packages/ui/src/announcer.test.ts`.

## The ask

Owner: "there are certain voicelines that occur at the start of combat that essentially tell you the outcome before
the fight happens. we cant have that. its not good design."

## What was doing it

Two moments from the catalog's first batch read the rail's pre-fight odds probe (`combatOdds`) 1.6 s into a fight:

- `underdogOdds`, under 20% to win: "The odds are against you."
- `heavyFavourite`, over 90% to win: "This should be comfortable."

At those thresholds the line is the result, said out loud before the first swing.

## The change

Both moments are removed outright: the event names, their priorities, tuner rows and thresholds, and the clips in the
default voice and every pack (`lemon`, `little-inu`, `underdweller`). `combatOdds` is now read in one place in
`announcer.ts`, the verdict branch (the won / lost against the odds lines), and the test fails if a second read
appears or if odds landing mid-fight makes anything speak.

Every other start-of-combat line was checked and kept: each reads only what the player already knows (Resolve, the
streak, the foe's hero / tier / ghost, the round, two players left).

## Good to know

- Removing two keys from `ANNOUNCER_LINES` shifts the index of every later event, which `announcerRoll` hashes. Only
  the seeded "does this rare line speak" rolls move (random buys, Round 7, Discover); nothing is stored by index.
- A saved game's `announced` slice may still carry the two event names. They are plain record keys and are never read.
- The tracker rows (`underdogOdds`, `heavyFavourite` and their lines) are marked `cut`.
