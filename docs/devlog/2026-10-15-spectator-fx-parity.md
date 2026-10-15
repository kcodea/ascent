# Spectators get the full game: FX, sound and animation parity (2026-10-15)

Owner (via coordinator): "please look into spectating in all modes - make sure pixi effects are firing as well as
sound effects. all animations etc are important to be on there". Oracle R-SPECTATE-AV-01, -02, -03.

## The audit harness

A two-page Playwright harness (kept out of the repo, in the session scratchpad) plays a scripted shop turn and fight
as the PLAYER with the real spectator publisher sending into a capture channel (run on the live-lobby branch, whose
publisher needs no second player). A SPECTATOR page then receives exactly
those messages, on the same clock, through the real watch screen. Both pages record every sound cue (the `sfx` API),
every authored FX play (`playDef`'s `fx:` perf label), every direct Pixi call, and every CSS `animationstart`. The
two lists are diffed as multisets. Two scripts ran: a plain turn (buy, play, refresh, tier up, sell, freeze, End
Turn, fight, End Combat), and a rich one (an aimed spell, an untargeted spell, a triple and its Discover, an End of
Turn Dwarf engine with five beats).

Before: 25 differing trigger kinds on the plain turn. After: the only differences left are input-only cues (hover
breaths, hover card refs, hover sounds), call-count plumbing (the aim line redrawn per frame instead of per pointer
move), the Discover pick (same clip, played by `discoverSelect` instead of `pickPress`), and frame-rate-bound trail
density.

## What was missing, and the root fix

- **Card-action presentation lived in the input handlers** (cast FX and sparks, sale float and coins, the pick-up
  touch, the play landing). New `actionPresenter.ts`: Recruit registers ONE presenter; the player's handlers AND the
  spectator's action queue (`versus/spectate.ts`) call it with the same description. A spectator's own play no longer
  rings a summon sound (it is marked as the player's placement, as the player's is).
- **End of Turn**: the press is tapped when PREPARED (`tapEndTurn` in `preparePresentationAction`), carrying the
  recorded batch; the watch screen plays it through the replay viewer's `replayEotCue` path (same compiler, timeline
  and presenters) with `hold`, so the lock and projections stay until the watched player's next view lands, and
  the per-action FX trackers advance past its seqs synchronously (no replay of the beats after the fight).
- **Leaving a fight**: the watch screen now emits the End Combat press cue (the gem's relight and pulse) and runs
  Recruit's own exit curtain; the shop swaps in at the curtain's full cover (`spectatorFightCovered`) instead of
  appearing before the curtain.
- **The End Turn / End Combat gem** joined `pressCue.ts` (`endTurn`, `endCombat`).
- **The held card**: the grab shrink (`.dragshrink`) and the wind trail (`dragTrail.ts`, one step shared with the
  player's drag) now play on the live drag and the flight ghost.
- **Aim lines** (spell, hero power, Equipment, Battlecry): `pixiFx.setAimLine` records the live aim (`aimState.ts`);
  the tap sends it with the cursor and the watch screen draws the same line.
- **Acts-only moments** (the End Turn press changes nothing visible) wake the publisher and go out as an empty delta.
- **Audio**: the watch screen plays the game music (`isWatchScreen`: `replaying` with no recorded replay). The
  announcer stays silent for spectators (decision: its lines address the player as "you" and key on the local run's
  history).
- The Triple Reward plays as a spell on both paths (`playsAsSpell`, `instView.ts`).
