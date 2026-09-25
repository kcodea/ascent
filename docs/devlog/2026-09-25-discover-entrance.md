# 2026-09-25: The Discover entrance, with a tuner to sim it

Owner ask (verbatim): *"branch off and improve our discover card animation. i want a brief but clean fly in or float
in of the cards, with some dust and pixi to make it look clean/exciting but not over the top, with sound effects to
match the vibe."*

Built on the Runeforge entrance (PR #1706). Its runner pattern and its three lessons carry over: wait for the wipe,
don't restart on remount, and time the sounds from the animation's real start.

## What plays

When a Discover or a Choose One opens, the overlay's scrim fades up as before (its own 200 ms CSS `fadein`). The
option cards then float up into place, left to right, one stagger apart. Each starts 70 px low, at 0.9 scale and
tilted 1.5° (the tilt alternates per card). It eases out into a 4 px overshoot and settles back. Each card becomes
clickable when it ARRIVES, 70% of the way through its flight. As it arrives it puffs golden dust from its base
(`discover-arrive`) and a few star glints over its face (`discover-glint`), and a light shimmer band crosses it.
The existing golden burst behind the cards (`discoverFx.discoverBurst`) is unchanged.

With the defaults and three cards: the first card starts at 40 ms and arrives at about 320 ms. The last arrives at
about 460 ms and settles by 580 ms. Its shimmer is done by about 820 ms.

## Sound

| Cue | Clip | When | Default |
| --- | --- | --- | --- |
| open | `discover` (the existing open cue) | the overlay appears | gain 1, `discover` fader |
| whoosh | `fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3`, window 150 ms + 900 ms | the first card's start | gain 0.45, 350 ms fade |
| arrive | `cardtouch` | each card's arrival, gap-gated (60 ms) | gain 0.6, 60 ms fade |
| sparkle | `fx/djartmusic-christmas-sparkle-whoosh-1-275404`, window 1.25 s + 0.85 s (the glitter only) | the last card's arrival | gain 0.4, 350 ms fade |

Every cue plays through the PR #1708 soft-tail voice (`playTailedSample`, now reachable as `playTailedClip`). That
gives a fade over the last N ms plus a light shared reverb (mix 0.15, 0.6 s), so nothing ends abruptly. The whoosh,
arrive and sparkle cues have their own mixer faders (`discoverWhoosh`, `discoverArrive`, `discoverSparkle`). The
clip windows come from decoded envelopes: the swish peaks 450 ms into its file, so starting 150 ms in puts the peak
over the arrivals, and the sparkle file's glitter peaks at about 1.5 s.

**The open cue moved.** `store.ts` used to play `sfx.discover()` when `run.discover` went from unset to set. That
meant it played while the overlay was still held behind the combat wipe, and never for the second or third Discover
of a chain (the offer never went unset). The death-hold path had to re-fire it by hand. The entrance now plays it
when the overlay actually appears, once per Discover. Both old call sites are gone, so the cue is never doubled. A
Choose One gets no open cue (it never had one).

## Input

A card is `data-dce="flying"` until it arrives, and a flying card is `pointer-events: none`. A press on it lands on
the overlay, which settles the whole entrance (`onPointerDownCapture`). The release then lands on a different element
than the press, so no click fires, and nothing is picked. `canPick(i)` backs this up for a keyboard or programmatic
pick: a pick on a card still in flight settles the entrance instead of registering. On the Choose One, a press that
only settled the entrance is swallowed before the click-away cancel sees it.

## When it replays (and when it doesn't)

- It runs per OCCASION: `discoverOccasion(run)` = seed, wave, hand size, board size, queue length and the offer. The
  run has no Discover counter, but every step of a chain changes this (the pick lands in the hand and the queue
  shrinks), and the reducer blocks every other action while a Discover is open.
- **Minimize, then "Return to Discover"** remounts the same occasion: nothing flies, puffs or sounds. You only see
  the overlay's own 200 ms fade. A Minimize mid-flight counts too: a teardown mid-play is stamped with its time, and
  only a remount within 50 ms replays (React StrictMode's dev double mount).
- **A Disco Dan chain** (T6, then T4, then T2) plays a full entrance, open cue included, for each Discover.
- A Choose One plays on every opening (occasion null). It has no minimize, and a cancelled-then-replayed card
  should fly in again.
- Reduced motion: one plain 180 ms fade, every card clickable at once, no whoosh, dust or shimmer. The open cue
  still plays.
- Replays play it at the replay's speed.

## Tuner

Dev menu > **💫 Discover entrance**. It has **▶ Play** (a sample Discover of three real cards over the current
screen, with the golden burst; pick a card or press Esc to close) and these controls:

- Timing: open delay, start delay, stagger, flight duration.
- Motion: direction (rise, drop, left, right, or fan out of the middle card), distance, start scale, tilt, settle.
- Dust and glints: count, size, opacity, lifetime, glints.
- Shimmer: duration and brightness.
- Each sound cue: clip, gain, offset, clip start, clip length, fade-out. The arrive cue also has every-card/once and
  its min gap.
- Reverb mix and length.

It is localStorage-persisted in DEV only. Production plays `DCE_DEFAULTS`.

## Perf

- Transform and opacity WAAPI only, scheduled up front with `fill: 'backwards'`. Nothing is left holding a layer.
- One layout read per play.
- The shimmer is a pre-rasterized gradient band. Only its transform moves.
- The dust and glints are one-shot Pixi defs on the above-modal canvas.
- Measured in the dev build over 10 tuner plays and 12 Disco Dan chain picks: no long tasks.
  - The open or pick task (reducer + React commit of three cards) took 4-12 ms.
  - Every entrance timer callback (arrivals with their Pixi spawns, cues) took 1.0 ms or less.
  - The perf HUD put `discover-arrive` at about 0.2 ms per spawn.
- The worst rAF delta I could measure was 13-25 ms. That was in the Browser pane, which was hidden and throttled,
  so treat it as a rough bound.

## Files

`packages/ui/src/discoverEntrance/`:
- `discoverEntranceConfig.ts`: config, defaults, timeline, keyframes, cues and the tuner spec.
- `entrance.ts`: the runner.
- `useOfferEntrance.ts`: the occasion memo, the input guards and `discoverOccasion`.
- `DiscoverDialog.tsx`: the Discover markup, now shared with the sandbox, plus `EntranceOverlay` for the Choose One
  and `OfferSheen`.
- `DiscoverEntrancePreview.tsx`
- `discoverEntrance.css`

Also:
- `fx/defs/discover-arrive.json`, `fx/defs/discover-glint.json`
- `DiscoverEntranceTuner.tsx`
- `sfx.ts` (`playTailedClip`) and `audio/config.ts` (three faders)
- Oracle rule R-PRESENT-19
- Tests: `discoverEntrance/DiscoverDialog.test.tsx` (14)
