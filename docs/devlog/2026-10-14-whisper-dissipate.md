# Unused Whispers dissipate at End of Turn (2026-10-14)

Owner ask: "whispers need to coalesce/dissipate when unused at end of turn and not just immediately go away".

## What the player sees

On End Turn every unused Whisper in hand drifts up a little, thins and fades out while its plate breaks into soft
wisps in the Whisper colours (blue-violet into cyan). Several Whispers stagger by 80 ms; the whole thing ends inside
600 ms (the stagger shrinks for a big hand). Then the hand closes the gap with the normal `--hand-glide` reflow. The
next turn's re-grant still arrives through the existing `playPlateCoalesce` (verified live: a Galas Tome granted at
Start of Turn plays the coalesce), so the pair reads dissipate out, coalesce in.

## How

- `packages/ui/src/whisperDissipate.ts` (pure): `planWhisperDissipate` (which cards, in hand order, with their
  delays), `whisperDissipateTotalMs`, `mergeWhisperFade` (the rendered hand row while it runs) and
  `WHISPER_DISSIPATE_FX` (the dissolve overrides).
- `Recruit.tsx` `beginWhisperDissipate`, called by `endTurn` once its gates pass (both End-of-Turn paths, the turn
  timer and God Mode go through it) and by the replay's recorded End Turn. It never waits on anything: End of Turn
  resolves and commits exactly as before. The sim is untouched (`vanishWhispers` still removes them at End of Turn).
- The row: before the commit the Whisper is still in `run.hand` and just wears the class; once the commit removes it,
  `mergeWhisperFade` holds it as a GHOST at its slot (its last view) until its own fade ends; when a fade ends the card
  leaves the row at once, before or after the commit, and never reappears.
- The card: `Card`'s new `dissipate` prop (the delay) adds `.whisperdissipate`: a one-shot 420 ms animation of
  `opacity` and the individual `translate` / `scale` properties (they compose on top of the fan's own `transform`).
- The wisps: `playPlateDissolve` (the minion-play dissolve, the coalesce's mirror) now takes per-call overrides. The
  Whisper call uses the Whisper palette and a lighter load (150 motes, tighter bloom) than a minion play.
- The reflow: the hand's close-the-gap glide used to stand down in combat, and End Turn with no End-of-Turn content is
  in combat at once. `whisperGlideRef` lets the glide run for a dissipated Whisper leaving, and the hand positions keep
  refreshing in combat while a dissipate is live. Measured live: the two Growths glide from 497/670 to 583/670 over
  ~130 ms after the last Whisper leaves.

## Tests

`whisperDissipate.test.ts` (plan, stagger, cap, row merge before/after the commit, ghost slots, ended cards never
returning, End-of-Turn grants behind ghosts) and `whisperDissipateCard.test.tsx` (the class and delay on the card,
the CSS animation is one-shot and animates only opacity / translate / scale).

## Perf

Measured in headless Chrome with the frame-rate limit off (rAF runs as fast as the work allows, so the intervals are
the real per-frame cost; dev build, software compositing), the 700 ms after End Turn, three seeds, two Whispers vs none:
frames over the 6.25 ms bar 17/17, 10/11, 9/8 (with/without); median frame +0.5 to +0.8 ms while it plays. Nothing
loops: the card animation is one-shot, and each dissolve removes its own layers when done.
