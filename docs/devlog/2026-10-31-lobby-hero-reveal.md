# 2026-10-31 — The lobby reveal: who you are facing, then the rail builds itself

Owner, 2026-10-31: "I want to add an animation after the player locks in a hero and hits start game, where all the
heroes in the lobby are shown and then all portraits fly over and build the rail. This would happen in all modes."
Then: "The hero reveal animation should happen before any timers obviously, the start game text should happen after
the animation is complete. The goal of the animation is to show the player who they are facing. Hero art and player
names". Rule: R-LOBBY-REVEAL-01. Branch `feat/lobby-hero-reveal`, built on the Docked rail branch (`feat/lobby-rail-tiles`).

## The flow
Start Game → launch curtain → `pickHero` builds the run under the cover → the curtain begins the reveal, then the Good
Luck intro → the curtain lifts onto the reveal:

1. **Line-up** (~2.3 s for 8). The board is dimmed and its rail is completely hidden. Every hero of the game stands
   centre stage in the in-run hero frame (`LbHeroFrame`, with the seat's portrait-frame cosmetic), the hero's name over
   the player's name pill. Every portrait is the same size; yours has only a gold ring and a gold pill. The line-up reads
   left to right in the rail's top-to-bottom order (owner: "line it up so that left to right is top to bottom"). Duos
   stand as pairs. A Versus 1v1 shows the two heroes facing off with VS between them.
2. **Round slice, then fly** (~3 s). The ROUND slice opens first, out of the Refresh pill (owner: "the round button should
   be the first piece to appear, then the heroes slot in"). Then one portrait at a time down the rail, 240 ms apart. Each portrait flies on a quadratic arc to its slice's ART
   (the Docked slice's face crop, the Gem rail's round face) and hits the rail: a squash (1.06 then 0.98) and a gold flash
   on the slice edge. The slice then expands out of the impact point to its full width (scaleX, origin at the hit) while
   the portrait crossfades into the slice art. The dim lifts as they go. The Guides tab is not part of the sequence (it is
   moving to a new home), and nothing appears at the end. In a 1v1 the foe lands on the opponent block and you land on your own board portrait, which is never hidden.
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

## Sounds (owner: "dont use the same sound effect for the hero reveals as the player's hero selection", then "should just be like a woosh and shine")
Nothing from `ceremony/`; all from the existing bank, no new assets.
- **The line-up** (~0.9 s): a light whoosh (`fx/stereogenicstudio-swish-swoosh-woosh-sfx-39`, 0.1 s to 1.0 s, soft
  tail) and a shine (`prismaticpick`, a bright glass chime, pitched up a touch, 160 ms in).
- **Passed over:** `equipmentsheen` (the Good Luck words' own shine, a moment later), `triggerglow` (the in-game trigger
  chime), the sparkle-whoosh (the Good Luck sparks), and the first pick, `fx/universfield-cinematic-swoosh-impact` (the
  owner found it heavy).
- **Each flight:** a quiet `fx/whoosh-03` or `swish-swoosh-woosh 27`, alternating.

## Tuner
DEV 🎬 "Lobby reveal" has these controls, plus ▶ Replay reveal:
- **Look:** dim, portrait size.
- **Reveal:** start delay, entrance, reveal stagger, hold.
- **Flight:** fly duration, fly stagger, arc height, land crossfade, impact, expand, round-slice settle.
- **Other:** Good Luck after, the two sound gains.

`window.__bench.lobbyReveal()` lets a bench build start it over a hand-set run.
