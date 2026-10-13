# 2026-10-13: the gate closes the game too

Owner: "when a player either loses or wins, when they hit the gem to end the combat phase, i want the doors to slide
closed and slam for a moment and then reopen to the end game stats screen. basically the exact version we had in
place yesterday before todays adjustments. do NOT touch the start match screen we did today, t hough".
Rule: **R-ENDGATE-01**.

## What shipped

- **The fight that ends a game leaves through the gate.** Pressing the End Combat gem on it (ranked or Practice, a
  loss or a win, or an Unlimited-health Practice game at its round-15 curtain) plays the gate's `end` variant: the
  doors grind shut over the fight (1.5 s), slam with the smoke, sparks and embers, hold for one second, shudder with
  the rattle (0.7 s) and grind open (1.5 s) on the end screen. 4.7 s in all, and it opens by itself.
- **It is the 2026-10-12 gate.** `rankedGateEndTimeline` is that day's single clock restored (`holdMs: 1000`), with
  no crystal, no forming, no hum and no press. Its four cues are `close`, `slam`, `rattle`, `open`.
- **The start-of-match gate is not touched.** It is the default variant (`entry`) of the same component and runs its
  own two clocks exactly as before; a test pins its timeline to the numbers it had and plays it to the armed crystal.
- Every other fight still leaves through the blue sweep.

## How the game knows it is the last fight

It does not, at the press: the lobby round settles when the fight is LEFT (the other seats fight, seats fall), and
only then is the player out or the table finished. And that settle must run **exactly once**: it tells each live seat
what happened, and a seat told twice plays two shops. So "try it, look, then do it for real" was not available.

The store already had the right tool, built for End of Turn: `preparePresentationAction` resolves an action now and
holds the result off screen, and `commitPresentationAction` lands that same result later through the ordinary commit
path. The End Combat gem now uses it:

1. `combatMayEndGame(run)` (rankedGate/endGameGate.ts), a cheap check, asks whether this fight COULD end the game.
   If not (most rounds), nothing changes: the sweep plays and `resolveCombat` is dispatched at full cover, as ever.
2. If it could, the fight is resolved at the press and held. `resolutionEndsGame(tx.after)` is then the real answer.
3. It ends the game: the gate plays, and the held result is committed behind the shut doors (0.52 s after the slam,
   once the impact shake is over, so mounting the end screen does not stutter the sparks).
4. It does not: the sweep plays and commits the held result at full cover instead of dispatching a second resolve.

## Judgement calls to confirm with the owner

- **The particles are today's**, not yesterday's: the slam uses the current FX (the tripled blue embers, +20%). One
  gate, one look. Yesterday's lighter slam would need its own amounts.
- **No "ding" at the press.** Yesterday the cinematic hit played on "Yes, let's go."; it was later moved to the
  crystal's shatter. The end-game gate has neither moment, so it plays the four door cues only.
- **Which games:** ranked and Practice (Sandbox Mode). Not the tutorial, the Gauntlet, God Mode or the Scene
  Builder, which have their own endings.
- **The swap is 0.52 s after the slam**, not yesterday's 0.22 s: an end screen is heavier to mount than hero select.

## Known limits

- `combatMayEndGame` says "cannot end" when more than three rivals still stand and the player cannot be knocked out
  by this fight. If four or more rivals ever all fall in one round, that game ends through the blue sweep: same end
  screen, no doors.
- Reduced motion: no gate, the usual exit.
- A press on the gem during a winning blow's animation closes the doors over it.

## Not verified

- **Not seen in a real game.** The gate was played in the running dev build by asking the controller for the `end`
  variant: it ran closing, shut, shudder, opening, swapped at 2.03 s, ended at 4.7 s, with no crystal at any sample
  and no console errors. The preview pane is hidden, so its motion was not watched, and the press on the gem in
  `Recruit.tsx` is not driven by a test (the helpers it calls and the store seam it uses are, on a real last fight).
- How heavy the resolve-at-press is on a slow machine. It is the same work the sweep used to hide, moved to the frame
  of the press, and only on fights that could end the game.
