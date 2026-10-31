# 2026-10-31 — The lobby reveal: who you are facing, then the rail builds itself

Owner, 2026-10-31: "I want to add an animation after the player locks in a hero and hits start game, where all the
heroes in the lobby are shown and then all portraits fly over and build the rail. This would happen in all modes."
Then: "The hero reveal animation should happen before any timers obviously, the start game text should happen after
the animation is complete. The goal of the animation is to show the player who they are facing. Hero art and player
names". Rule: R-LOBBY-REVEAL-01. Branch `feat/lobby-hero-reveal`, built on the Docked rail branch (`feat/lobby-rail-tiles`).

## The flow
Start Game → launch curtain → `pickHero` builds the run under the cover → the curtain begins the reveal, then the Good
Luck intro → the curtain lifts onto the reveal:

1. **Line-up** (~1.7 s for 8). The board is dimmed. Every hero of the game stands centre stage in the in-run hero frame
   (`LbHeroFrame`, with the seat's portrait-frame cosmetic), the hero's name over the player's name pill. In a table, you
   stand in the middle, a bit bigger with a brighter ring. Duos stand as pairs, your team first. A Versus 1v1 shows the two
   heroes facing off with VS between them.
2. **Fly** (~1.6 s). Each portrait flies on a quadratic arc to its slot's face, shrinking to fit. A rail row is
   `.lobbyseat[data-seat]` in every rail look; a Duos team slot appears with its first member. In a 1v1 the foe lands on
   the opponent block and you land on your own board portrait. The slot fades in under it, the dim lifts, and the round
   slice settles last.
3. **Good Luck**: the words play now. Their dim fades in, since the board is already lit, and the shop clock starts when
   they go.

## Where the clock is held (no new gate)
`GoodLuckIntro` renders nothing while the reveal is active, but its store stays active. Recruit's clock gate
(`turnClockMayTick`'s `introPlaying`) already reads that store, so the turn clock holds through the reveal with no
change to Recruit. In **Versus** the round-1 shop deadline is the Worker's: it starts when every client has acked its
intro, or at `VERSUS_INTRO_CAP_SECONDS` (45 s). `ackIntro` acks when the Good Luck store goes inactive, which is now after
the reveal plus the words. So the shared start already accounts for the reveal, and **no Worker change was needed**. A
local skip only ends that screen's visuals; the round still waits for the slowest client.

## Skips, modes, safety
- A click, Esc or any key skips to the Good Luck words. The capture-phase key listener keeps Esc from also opening the
  menu. The dev tuner's "Good Luck after" off makes the reveal replace the words.
- Plays in a lobby, Practice and every Versus match on round 1. Never in the Scene Builder, God Mode (its table is
  hidden), the tutorial, a Gauntlet (no rail) or a replay. Settings → Board → "Lobby reveal" turns it off (saved on the
  device).
- **Spectators**: armed when the stands showed the watched player's Hero Select, and fired when that screen turns into
  their opening shop within 4 s. A late joiner never saw the Hero Select, so they skip it.
- A store-level safety timer (9 s) ends the reveal whatever happens, so nothing can wait on it forever.
- Reduced motion: one fade in, a short hold, one fade out while the rail fades in.

## Performance
- Every motion is a WAAPI transform or opacity animation scheduled up front. There is no per-frame JS.
- The arc is pre-sampled into 14 keyframes with the ease on the path parameter, run linear.
- Layout is read once at mount (to hide the slots, via a `data-lhr` attribute per element, never a body class) and once
  at take-off (every stage portrait and every slot).
- Portraits are art the boot gate has already decoded. The line-up waits at most 500 ms for any that are not.
- Measured on the prod bundle (`VITE_PERF_BENCH=1`), headed Chrome, 240 Hz panel, a Practice start, frames from the
  curtain lifting:

  | window | reveal ON 1x | reveal OFF 1x |
  |---|---|---|
  | 1.0-3.5 s (line-up + flights) | p95 4.3 ms, worst 58 ms, 6 frames over 2 intervals | p95 4.3 ms, worst 54 ms, 8 over |
  | 3.5-7.0 s | p95 4.3, worst 4.6, 0 over | p95 4.3, worst 37.5, 2 over |

  The few long frames are the game start itself (bot lobby warm-up, first shop). The same windows have them with the
  reveal off. At 4x CPU throttle the whole game start is heavy in both builds (p95 60-350 ms), and turning the reveal
  on is no worse.

## Sounds
Reused from the hero-select ceremony, with no new assets: the reveal stinger (`ceremony/ceremonyrevealsound`) as the
line-up rises, and `ceremony/woosh1` / `woosh2` at take-off and mid-flight. Gains are in the tuner.

## Tuner
DEV 🎬 "Lobby reveal" has controls for dim, portrait size, start delay, entrance, reveal stagger, hold, fly duration, fly
stagger, arc height, land crossfade, round-slice settle, Good Luck after, and the two sound gains, plus ▶ Replay reveal.
`window.__bench.lobbyReveal()` lets a bench build start it over a hand-set run.
