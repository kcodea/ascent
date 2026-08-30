# The replay transport, and the one clock that ignored playback speed

**Owner report (2026-08-30):** *"replay scrub bar is very clunky and speed doesnt change the time's speed."*

Two separate problems in one sentence.

## The clock

Every paced thing in playback divides by `speed` — except the shop countdown, which ran on a literal
`window.setTimeout(tick, 1000)`. Wall time, always.

So at 5×, frames advanced five times faster while the timer on screen still counted one second per real
second. The replay and its own clock told different stories about how long the recorded turn took: a turn
that took 20 seconds to play was watched in 4, with the timer insisting it had been 4.

The tick is now `1000 / speed`. Live play has no `replaySession`, so the divisor is 1 and nothing about the
real game's timing moves.

Measured in the live client with playback **paused**, so frame advances could not reset the clock and only
the countdown's own rate was under test:

| speed | window | countdown fell by |
|---|---|---|
| 1× | 5 s | **5** |
| 5× | 2 s | **10** |

Before the fix the second row would have read 2.

## The transport

It was click-to-seek only. Every correction cost a fresh aim-and-click at an 8px target, there was no handle
to say where you were, and — the part that made it feel broken rather than merely sparse — **no clock at
all**. A viewer could not answer "how far into this am I?" except by reading a round number.

Now:

- **Drag to scrub.** Tracked on the `window`, so releasing outside the bar (or off the window) still ends the
  drag instead of leaving it stuck in scrub mode.
- **A handle**, positioned off the SETTLED percentage rather than the glide target, so it marks where the
  replay is rather than where it is heading.
- **An elapsed/total readout** (`14:39 / 18:21`), tabular figures so the bar does not jitter as digits tick.
- **Keyboard**: Space play/pause, arrows step a frame, Home/End. Text fields are never robbed of a keypress.
- A taller invisible hit area, since an 8px drag target is the mechanical half of "clunky".

A seek is issued only when the target INDEX changes, never per `pointermove` — a high-polling-rate mouse
would otherwise fire hundreds of identical seeks a second and re-render the whole board for each.

Verified live: a drag moved the replay from frame 0 to 163 of 218 (round 16, `14:39 / 18:21`, knob at 79.8%),
and the scrub state released cleanly rather than sticking.

### One thing fixed in passing

`.replayspeed input` carried a bare `cursor: pointer`, which out-specifies the global rule and swaps the
gauntlet back to the OS arrow — the exact defect CLAUDE.md's UI conventions section describes. It now uses
the gauntlet URL form.

## Still open: starting a replay at hero select

The owner also asked whether replays can start at hero select. They can, and it is small: capture begins at
`pickHero`, so frame 0 is already *after* the choice, and the offer the player chose from is still in the
store at that instant (`lastHeroOffer`) — it simply is not written into the payload. It needs a `heroOffer`
field on `ReplayV2` and a playback stage before frame 0. Not built here; the open design question is what
that stage should show in Practice, where the "offer" is the entire 53-hero roster rather than a shortlist.
