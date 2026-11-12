# Duos hand-off: sound, motion and timing polish (2026-11-12)

Three owner passes in one day on the teammate board stepping in ("5/10", "the sound is off, and the ring is bad", "the
shadow looks off and timing is a bit weird ... add a tiny bit of whimsy"). Where it ended:

- **Motion** (`styles.css` `taginfly`): each body drops into its own slot from just above it, leaning a few degrees
  (alternating down the row), stretches on the way down, squashes on the floor and gives one small hop. 360 ms, 70 ms
  stagger, touch-down at 55% (`duosHandoffTiming.ts`). The sideways sweep is gone.
- **Sound** (`audio/duosCues.ts`): the drop's air, one soft thump per body on its touchdown (each a touch higher than
  the last, by turn only), a quiet ground hit under the final one. The first cue sped a cinematic stinger up to fit,
  so it re-pitched with board size. The two clips (`fx/duos-drop-whoosh`, `fx/duos-land`) were generated with
  ElevenLabs sound generation and measured (onset, peak) before being placed; nobody on the agent side heard them.
- **Removed**: the team-coloured `ground-slam` ring under the arrived board, and the dark dim over the fallen row.
- **Timing** (`choreoConfig.ts`): the stall after the last death is 390 ms (was 570), the fallen board is read for
  300 ms (was 435), and the clock now holds a 140 ms settle after the last body lands before anything follows.

Lesson worth keeping: a cue that is time-stretched to hit a landing changes pitch whenever the landing time changes.
Place a short clip at the time instead.
