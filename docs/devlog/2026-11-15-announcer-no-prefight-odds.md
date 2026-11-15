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

## Same day: the takes that curse are cut (R-TEXT-ANNOUNCER-03)

Owner: "we need to remove all of the questionable voicelines", then "there are ones that curse or use very odd
language". 125 of the 295 default clips (the original recordings) had no written text anywhere, so they were
transcribed with ElevenLabs speech-to-text (owner approved) and the texts written into the tracker.

Cut, from the default voice and all three packs (44 files), and listed in `ANNOUNCER_CUT_TAKES`:

- `game-start-10`, `-11`, `-20`, `-21`, `-24`
- `time-running-out-4`, `-5`, `-19`, `-20`, `-21`
- `cast-ale-2`

The takes that stay keep their numbers (a saved game's heard-takes list names them), so the three tables are now
explicit lists with gaps. The "very odd language" takes are the owner's pick, line by line, and are not part of this.

## Same day: the owner's pick of the odd lines

Shown the 14 out-of-place lines, the owner kept eight ("bollocks can stay. choose violence can stay. thank aeon can
stay. the beast and dwarf can stay the drinking ones can stay. game start 7 can stay"). So:

- `time-running-out-20` ("Bollocks. Look at the time, champ") is RESTORED in all four voices.
- Six more takes are cut and added to `ANNOUNCER_CUT_TAKES`: `game-start-5`, `game-start-18`,
  `entering-combat-4`, `knockout-4`, `time-running-out-14`, `time-running-out-15`.

Total cut for language: 16 takes (64 files). `big-spender` ("To infinity and beyond") is NOT cut: it is that moment's
only line, so cutting it means removing or re-recording the moment, which is the owner's call.

## Same day: RNGesus restored, start-of-combat lines at 3 s

- `game-start-5` was cut on a MIS-HEARD transcript ("May our Lord Jesus bless you"). The line is "May RNGesus bless
  you" (the Lemon devlog, 2026-10-11, had already corrected it). Owner: "restore the RNGesus line". Restored in all
  four voices; 15 takes are cut for language. Lesson: check a machine transcript against the earlier corrected ones
  before showing it for a ruling.
- Asked whether the fix was meant to be timing, the owner ruled: "if these are removed then i think we are good.
  start of combat should go from 1.6 to 3 seconds and should never be outcome focused". So the two odds lines stay
  removed and `ANNOUNCER_FACE_OMEN_DELAY_MS` goes 1600 to 3000.
