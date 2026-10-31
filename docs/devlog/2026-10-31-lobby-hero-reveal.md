# 2026-10-31 — The lobby reveal: who you are facing, then the rail builds itself

Owner, 2026-10-31: "I want to add an animation after the player locks in a hero and hits start game, where all the
heroes in the lobby are shown and then all portraits fly over and build the rail. This would happen in all modes."
Then: "The hero reveal animation should happen before any timers obviously, the start game text should happen after
the animation is complete. The goal of the animation is to show the player who they are facing. Hero art and player
names". Rule: R-LOBBY-REVEAL-01. Branch `feat/lobby-hero-reveal`, built on the Docked rail branch (`feat/lobby-rail-tiles`).

## The flow
Start Game → launch curtain → `pickHero` builds the run under the cover → the curtain begins the reveal, then the Good
Luck intro → the curtain lifts onto the reveal:

1. **Line-up and sweep** (~2.4 s for 8). The board is dimmed and its rail is completely hidden. Every hero of the game
   stands centre stage in the in-run hero frame (`LbHeroFrame`, with the seat's portrait-frame cosmetic), the hero's name
   over the player's name pill.
   - Every portrait is the same size; yours has only a gold ring and a gold pill.
   - The line-up reads left to right in the rail's top-to-bottom order (owner: "line it up so that left to right is top to
     bottom"). Duos stand as pairs. A Versus 1v1 shows the two heroes facing off with VS between them.
   - During the hold a MAGIC SWEEP crosses the row (owner: "a magic trail that slides across the heroes"). A band of soft
     light moves left to right; each face catches a glint band and a few `discover-glint` sparkles as it passes, with the
     owner's shimmer.
2. **Round slice, group flight, lock-in** (owner: "they fly over into place and then 'lock in' and build their slices
   sequentially from the top somewhat quickly and satisfying"):
   - The ROUND slice opens first, out of the Refresh pill.
   - Every portrait then flies at once, 35 ms apart. Each takes a FAN curve: it reaches its own row early, then slides in
     along it, so a left-to-right row ranked to a top-to-bottom column never crosses. Each shrinks ahead of its path, so
     neighbours do not overlap mid-air. They park, round, on their slices' art.
   - After a 140 ms beat the slices LOCK IN top to bottom, 100 ms apart and overlapping. Each lock has a snap (1.08, 0.97,
     1 on the frame), a gold edge flash, a `hero-power-spark` pop, one of the owner's thuds with a light shimmer, and the
     slice expanding out of the portrait (scaleX, origin at the portrait) while the portrait crossfades into the slice art.
   - Flights to the last lock take ~1.6 s. The dim lifts across it. In a 1v1 the foe lands on the opponent block and you
     land on your own board portrait, which is never hidden. The Guides tab is not part of the sequence (it is moving to a
     new home), and nothing appears at the end.
3. **Good Luck**: the words play now, in full. Their dim fades in, since the board is already lit. The shop clock and
   every opening offer start when they go.

## One gate for the clock and the opening offers
`GoodLuckIntro` renders nothing while the reveal is active, but its store stays active. Recruit's clock gate
(`turnClockMayTick`'s `introPlaying`) already read that store. Recruit's `overlaysHeld` now reads it too (owner: "have
disco dan's discover come up AFTER the start game text"). That holds every opening offer until the words are over: a
turn-1 hero Discover (Disco Dan, the Fi / Coran hero quests), quest, power, Runeforge, Choose One, scout and Ancients
offers. In **Versus** the round-1 shop deadline is the Worker's: it starts when every client has acked its intro, or
at `VERSUS_INTRO_CAP_SECONDS` (45 s). `ackIntro` acks when the Good Luck store goes inactive, which is now after the
reveal plus the words. So the shared start already accounts for the reveal, and **no Worker change was needed**.

## Nothing skips it (owner: "dont let the lobby hero reveal animation be skipped", "make the start game text unskippable")
- Clicks land on the overlay and do nothing. Every key is swallowed while the reveal plays, so neither the shop's
  hotkeys nor the Esc menu react. The Good Luck words swallow Esc and ignore clicks.
- Leaving to the title is the only early end. A store-level safety timer (9 s) is a failsafe.
- The dev tuner's "Good Luck after" off makes the reveal replace the words.

## The hidden rail
`<html data-lhr="on rail s0 s3 …">` lists what has landed, and static rules in `lobbyReveal.css` hide every seat slice,
team slot, the rail panel and the round slice not in it.
- Why the root and not the slices: a slice can REMOUNT mid-reveal (the Docked layout settles after the HUD's entrance),
  and a per-element mark would be lost. That is how the first build let the rail show behind the line-up.
- Every rule's subject names a class, so an attribute change restyles only those elements.

## Modes
- Plays in a lobby, Practice and every Versus match on round 1. Never in the Scene Builder, God Mode (its table is
  hidden), the tutorial, a Gauntlet (no rail) or a replay. Settings → Board → "Lobby reveal" turns it off (saved on the
  device).
- **Spectators**: armed when the stands showed the watched player's Hero Select, and fired when that screen turns into
  their opening shop within 4 s. A late joiner never saw the Hero Select, so they skip it.
- Reduced motion: one fade in, a short hold, one fade out while the rail fades in. It is not skippable either.

## Performance
- Every motion is a WAAPI transform or opacity animation scheduled up front. There is no per-frame JS.
- The arc is pre-sampled into keyframes with the ease on the path parameter, run linear.
- Layout is read in two passes: once when the slots are on screen (the line-up's rail order), and once at take-off
  (every stage portrait, every slot, every slot's art).
- Portraits are art the boot gate has already decoded. The line-up waits at most 500 ms for any that are not.
- Measured on the prod bundle (`VITE_PERF_BENCH=1`), headed Chrome, 240 Hz panel, a Practice start, frames from the
  curtain lifting (the first build; the later revisions add only more of the same transform / opacity animations):

  | window | reveal ON 1x | reveal OFF 1x |
  |---|---|---|
  | 1.0-3.5 s (line-up + flights) | p95 4.3 ms, worst 58 ms, 6 frames over 2 intervals | p95 4.3 ms, worst 54 ms, 8 over |
  | 3.5-7.0 s | p95 4.3, worst 4.6, 0 over | p95 4.3, worst 37.5, 2 over |

  The few long frames are the game start itself (bot lobby warm-up, first shop). The same windows have them with the
  reveal off. At 4x CPU throttle the whole game start is heavy in both builds (p95 60-350 ms), and turning the reveal
  on is no worse.

## Sounds
Owner: "dont use the same sound effect for the hero reveals as the player's hero selection", then "a woosh and shine",
then his own clips. Nothing comes from `ceremony/`.
- **Line-up:** a soft airy whoosh as it rises (`fx/stereogenicstudio-swish-swoosh-woosh-sfx-39`, 0.1 s to 1.0 s), then
  the owner's shimmer (`audio/fx/reveal-shimmer.mp3`) with the sweep.
- **Group flight:** one soft `fx/whoosh-03`.
- **Each lock:** one of the owner's three gentle thuds (`audio/fx/reveal-impact-1`, `-3`, `-4`), rotating so neighbours
  differ, plus a quiet `prismaticpick` glass shimmer pitched a little higher each lock.
- **Warming:** all of these are decoded under the launch curtain (`sfx.warmClips`).
- **Kept off the phone's per-fight decode list:** the owner's clips are not in `audio/codeClips.ts`, whose phone LRU
  working set (`phoneAudioQuality.test.ts`) had no headroom left. They play once per game, so `warmClips` covers them.
- **Passed over:** `equipmentsheen` (the Good Luck words' own shine), `triggerglow` (the in-game trigger chime), the
  sparkle-whoosh (the Good Luck sparks), and `fx/universfield-cinematic-swoosh-impact` (the owner: too heavy).

## Tuner
DEV 🎬 "Lobby reveal" has these controls, plus ▶ Replay reveal:
- **Look:** dim, portrait size.
- **Reveal:** start delay, entrance, reveal stagger, hold.
- **Reveal sweep:** sweep delay, sweep.
- **Flight:** round slice, fly duration, fly stagger, arc height.
- **Lock:** lock beat, lock stagger, lock snap, expand, crossfade, lock sound.
- **Other:** Good Luck after, the two sound gains.

`window.__bench.lobbyReveal()` lets a bench build start it over a hand-set run.
