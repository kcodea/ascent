# 2026-10-13: a sound for the result (placement tones)

Owner: "apply this tone when ending the match in 5th through 8th place" (his recording, `5th through 8th tone.mp3`),
then, while it was being built, "use the start match tone we moved to when clicking the crystal if you placed 1st
through 4th."

## What shipped

- **5th to 8th:** his recorded tone, committed as `packages/ui/src/audio/placelow.mp3` (3.1 s, stereo, its swell
  peaking half a second in; untouched), on its own fader `placelow` at 0.6.
- **1st to 4th:** the gate's cinematic hit, the `gateintro` clip that plays as the crystal shatters. It is on its
  OWN fader, `placehigh` (0.72, the level it has under the crystal), so the end of a match and the crystal can be
  mixed apart. Same file, two faders.
- **When:** as the result comes into view. A game that ends through the end-game gate sets the tone off behind the
  shut doors, when the end screen is swapped in, delayed on the audio clock by 1.18 s so it lands as the doors start
  to part (`endGateRevealDelayMs`). A game that ends through the blue sweep (reduced motion, or the gate's rare
  miss) plays it at once, at the sweep's full cover.
- **Which games:** ranked and Practice, by the place the end screen shows. Not the tutorial, the Gauntlet or a
  sandbox run. Abandoning a match shows no end screen and plays nothing.

`sfx.placementTone(place, delay)` is the one entry point and `sfx.placementToneOf(place)` the table; the combat
screen (`Recruit.tsx`) calls `playPlacementTone` (placementTone.ts) on both ways out of a last fight. The clip is
loaded with the gate's (`sfx.warmGate`), which the combat screen already warms before a fight that could end the
game.

## Judgement calls to confirm with the owner

- **The moment:** the doors starting to part, not the slam and not the doors fully open. One number to move.
- **It can overlap the announcer.** The announcer's end line (game won / second place / game loss) speaks one second
  after the game ends, which with the gate is about 0.2 s before the tone. Nothing was done to separate them.
- **Levels:** `placelow` 0.6 (the gate cues' level), `placehigh` 0.72 (the crystal hit's level). Both are in the
  audio mixer.
- **Practice on Unlimited health** gets a placement from its win record at the round-15 curtain, so it plays a tone
  for that place too.

## Not verified

- Not heard. The tests pin which clip and fader each place uses, the timing, and the two call sites; nobody has
  listened to it in a game.
