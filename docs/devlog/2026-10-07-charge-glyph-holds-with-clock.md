# 2026-10-07: The end-of-turn charge holds with the Shop clock

Owner report (verbatim): "when the game is paused mid round after the countdown timer has started, the audio and
the pixi visiaul of the timer rune building doesnt stop as well ... i want the audio to stay the same and synced to
the same timing at the end of each round. we just need to make sure it stops when the game is stopped in any way".

Rule: **R-TIMER-SYNC-01** (triggers).

## Root cause

- The `turncharge` build is a 21.17 s clip fired ONCE when the glyph lit (20 s left), timed so its peak lands on
  0:00. Nothing ever paused it, so any hold pushed the clock behind the sound. It also always started at 0 s of the
  clip, even when the glyph lit mid-window (Save & Continue, a covering screen closing).
- The glyph paused off its own `paused` prop, a hand copy of the countdown's gate that had drifted: it missed the
  Ancients offer, the Good Luck intro, the combat wipe and the Gold Fuse wait. The motes loop and the CSS pulse
  never paused at all.
- Every countdown teardown restarted the current second from scratch, so each pause refunded up to a second.

## Fix

- `turnClock` now publishes whether it is running and where it is inside its second (`startSecond` / `hold` /
  `halt` / `secondProgress`). The countdown in Recruit is the only writer, and its effect cleanup always `hold`s,
  so EVERY gate (present or future) holds the readout too. A hold keeps the partial second; `set` drops it.
- `chargeElapsed(window, now)` is the one reading of "seconds of the charge window gone": the fill is it over the
  window, and `sfx.turnCharge(offset)` starts the clip that far in (a 60 ms fade-in on a mid-clip start).
- `ChargeGlyph` reads `useTurnClockRunning()`; held = lit, clock not running, time left. Held stops the sound
  (120 ms fade), paints the fill once, skips mote steps and pauses the pulse (`.chargeglyph.held`). 0:00 is not
  held: the completion flash and the clip's tail still play.

Not changed: the look of the glyph, the clip, its gain, the explosion cue. Replay playback at 2x/3x still plays the
build at 1x (pre-existing).

## Follow-up: the final-countdown tick

Owner ask (verbatim): "a big clock tick sound happens on each second, essentially signaling FIVE, FOUR, THREE, TWO,
ONE (end turn)". Owner picks: the ticks BUILD, the explosion keeps 0:00, and the owner supplies the clip.

- `sfx.turnTick(n)` fires from the countdown's own tick at 5..1 (real clocks only), so a hold holds the count.
  `turnTickLevel(n)` builds linearly from FIVE to ONE (`TURN_TICK_BUILD`: volume x0.7 to x1, rate 1 to 1.12).
- Clip slot: `packages/ui/src/audio/turntick.mp3` (or `.wav`), picked up by the audio glob. A synth tock stands
  in until it exists. Its own `turntick` desk fader (ui bus, 0.5). `warmTurnTick` prefetches it from 10 s left.
