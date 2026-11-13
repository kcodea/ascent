# 2026-11-12: Checkmate, a hero attack played on a chessboard (style `chess`, Epic, dev only)

One of sixteen attacks built in parallel on the `npm run attack:new` scaffold. It was copied from Card Shark
(`heroCards`) and rebuilt from the plan up; nothing of the cards is left. It is still a **dev-only style with no
cosmetic**: it plays only through the dev "Attack style" override and its tuner.

## The idea

Chess pieces that move by their own rules. A faint patch of chessboard fades in on the ground beside the struck hero,
its squares turned to the line between the two heroes, and the struck portrait sits on one square like a piece about to
be taken. The squares the move will cross glow gold first, the way a chess app shows a move. The striker's pieces are
ivory when you strike and ebony when the foe does, each with gold bands.

An Epic has three looks (the same tier mapping Card Shark uses: I, then II and III, then IV and any knockout):

| look | what plays | the impact |
| --- | --- | --- |
| Pawn (1 to 5) | A pawn is set down with a tap on the file beside the hero, hops forward two squares (a tap each) and takes the portrait diagonally, as a pawn captures. | the capture |
| Knight (6 to 19) | A knight is set down, rears back, spins once on its square and jumps its L (two squares along, one across) in an arc with a somersault, landing on the portrait. | the landing |
| Queen (20+, knockout) | A wider board, with a small king of the struck side beside the portrait. The queen is set down with weight, a gleam runs up to her crown, and she sweeps the diagonal in one fast slide with a streak behind her. The king wobbles, tips over and lies on its side, and CHECKMATE sets. | the slide arriving |

From the ready (the end of the shared damage formation) the blow lands after about 0.99 s (pawn), 1.18 s (knight) and
1.06 s (queen); the sequence ends about 1.55 s, 1.78 s and 2.07 s after the ready. Card Shark runs about 1.2 s to 2.5 s.

## How

- `heroChessConfig.ts` holds everything that decides what is drawn, as pure functions: the plan and its cues
  (`chessPlan`, `chessCues`), the board for a blow (`chessBoard`: square size, which side of the line the piece starts
  on, every square, the stops, the king's square, where the word sets), and the poses at a time `t` (`chessPieceAt`,
  `chessKingAt`, `chessWordAt`, `chessBoardAlpha`, `chessHintAt`). The poses write into a reused object, so a frame
  allocates nothing.
- `heroChessScene.ts` is a subclass of the shared `FxPool`. It holds **no animation state**: each frame it asks the pure
  functions for the poses at the sequence time and draws them. After the sequence ends it keeps its own clock until the
  last fade is over, then gives every sprite back. The board is one pooled quad per square (about 20 for the pawn, 50
  for the queen), the cap is 260 sprites.
- `heroChessTextures.ts` paints everything once per session on 2D canvases. The turned pieces (pawn, queen, king) are
  painted the way a lathe makes them: row by row from a profile, each row one strip of left-to-right shading, lit on
  upward slopes and shaded under overhangs. The knight is a drawn profile on a turned base. Two woods, gold bands, a
  gold keyline. The word is gold serif capitals.
- `heroChess.ts` is the runner on the shared core (`Sequence`, `DamageFormation`, `StageCamera`, `PortraitMover`,
  `AttackVoices`). The blow lands once, through `seq.land()` on the impact cue. Sparks are seeded from the fight's
  `rollSeed` when it has one.

Geometry choices worth knowing:

- A square is 1.45 struck-portrait radii, and a piece is sized in squares, so the board and the pieces scale with the
  portraits (the stage scale, a sandbox box).
- The piece starts on whichever side of the line keeps it on screen, then on the side nearer the middle of the view.
- The queen takes the longest diagonal that starts on screen, up to four squares. Three squares are worth smaller
  squares; two full-size squares are the last resort. At 1080p she gets three squares in both directions.
- The knight's arc is capped by the room above it (the foe's portrait is at the top of the screen), and under a hero at
  the very top it lands a little lower so its head stays in view.
- The king stands on the first free square beside the struck hero that is on screen, and tips whichever way keeps it on
  screen. CHECKMATE sets above or below the portrait, on the side away from the queen when there is room; when it has
  to share her side it sets beside her, toward the middle of the view.

## Sound

Four ElevenLabs calls, three clips kept, 1.16 s in total, in `packages/ui/src/audio/fx/` (mono, 44.1 kHz, 128 kb/s,
trimmed to the hit, short fades, levelled toward -20 LUFS with a -1 dB peak ceiling; loudness was measured on the clip
looped, because a quarter-second hit is under the meter's gate on its own):

| clip | kept | where the hit is | level |
| --- | --- | --- | --- |
| `chess-set` | 0.24 s | the tap about 25 ms in | peak -1 dB (about -26 LUFS looped: one tap cannot reach -20 under the ceiling) |
| `chess-slide` | 0.56 s | swells to 250 to 400 ms | -20 LUFS |
| `chess-topple` | 0.36 s | the clack at the start, a second knock about 110 ms in | -20 LUFS |

Cues: `chess-set` on every set-down (pitched down for the queen), on each pawn hop (lighter, a little higher each
square) and under every capture; `chess-slide` from 80 ms in, pitched up 1.3x, as the queen leaves, so its swell ends as
she arrives; `chess-topple` when the king hits the board, followed by two soft `chess-set` knocks as it rocks to rest.
Reused: the swish (`fx/stereogenicstudio-swish...-27`) for the knight's jump and the pawn's jab, the sparkle
(`fx/djartmusic-christmas-sparkle...`) quietly for the gleam, and the shared `smack1`, `flurryhit`, `fel-spike-echo-land`
and `crit` for the captures. The first topple take was one clack with no fall in it and was not used. The second has
the fall but no roll, which is why the two settling knocks are layered from the tap.

`ATTACK_FX_CLIPS.chess` lists the three new clips and the two reused `fx/` ones (the whip-snap the scaffold listed is
no longer named).

## Verified

- `npx vitest run packages/ui/src/heroChess`: 42 tests pass (plan and cues per look, the board from the four screen
  corners in both directions, the poses, the camera, the runner's exits restoring both portraits, the headless scene).
  `packages/ui/src/heroAttack` (196) and `packages/ui/src/audio` pass; three audio suites timed out in their setup hook
  on the first run while the machine was busy and passed when rerun alone. `npm run typecheck` clean; `npm run lint`
  0 errors and no warning in this style's files.
- Looked at in headless Chrome at 1920 x 1080 from this worktree's dev server: contact sheets of all three looks in both
  directions, recorded at 0.35x so the fast beats are caught.
- Frame times (requestAnimationFrame deltas, DEV build, headless Chrome on a 240 Hz display, while fifteen other
  builders were using the machine): median 4.2 ms and 99th percentile 4.3 ms in most queen runs (12.5 ms in one), worst
  frame 29 to 58 ms. The slow frames fall about 50 ms after the ready starts and on the end cue. Card Shark, measured
  the same way in the same session, has the same two spikes (29 to 46 ms and 21 to 29 ms), so they belong to the shared
  start and teardown (the camera and the dim), not to this style. Not measured on a production build.

## Not done, or weak

- No cosmetic, no patch note, no rules entry: the style is dev only until the coordinator gives it one.
- The sounds were placed from measured onsets and levels. Nobody has listened to them.
- The king's fall has no rolling sound, only a clack and two knocks.
- The board is drawn on the overlay above the portraits, so it also lies faintly over the leaderboard rail and the shop
  when the struck hero is the foe (top right). It is subtle, but it is not under the UI.
- In a layout the game does not have (the striker almost straight below a hero at the very top) the knight's L turns on
  a square at the screen edge and its head leaves the view for a few frames.
- Not looked at: the Collection preview box, phones, reduced motion on a real device (reduced motion is covered by the
  tests only).

## Second pass (2026-11-12, after the owner played it)

The owner's verdict on the batch: the attacks need sound, and the big looks are quick and not impactful. On this one:
the board was very faint and the CHECKMATE lettering was plain.

**The board reads.** The squares are stronger (dark squares 0.3 to 0.46). The squares the move crosses now GLOW: each
has an additive gold tile and a bloom on top of it, they light one after another toward the struck hero (150 ms
apart), and each flashes as it comes on (`chessHintFlashAt`).

**Impact.** Running time from the ready: pawn 1.55 s to 1.65 s, knight 1.78 s to 1.88 s, queen 2.07 s to 3.06 s
(Storm, the Epic reference, runs 2.23 s). The queen's extra second is anticipation and aftermath:
- Before: a longer gleam (300 to 460 ms) and then a COIL (200 ms): she leans back from the diagonal and sinks, held,
  then goes. The slide itself is as fast as before.
- The capture: a whole-view flash, shake 15 to 28 px over 460 ms, a bigger punch-in, a white-hot core, three shock
  rings, a second cut across the first, chips thrown up that fall back, a gold glow that stays over a second, and the
  portrait reels on a slower, longer ring.
- After: the king rocks on its base four times, wider each time (620 ms), hangs past its balance and falls slowly,
  then all at once (520 ms), hits the board (a shock ring, dust, a camera kick), bounces once, rolls a third of a
  square and rocks to rest. CHECKMATE slams in from big and holds 1.3 s (was 0.72 s).
- The knight's landing and the pawn's capture got more shake, a hot core and falling chips, nothing longer.

**The lettering.** CHECKMATE is now in the game's own title face (Outfit at its heaviest, wide-set capitals), gold with
a pale top, a dark navy outline and a hard drop, on a slim navy band with gold rules, and 40% wider on screen. If the
web font has not loaded when the texture is first painted, the canvas falls back to the system's heavy sans.

**Sound.** Measured with a recorder on the audio output (100 ms RMS windows, after the formation). First pass, queen:
mean -38.8 dB, peak -18.3 dB; the set-down was -37, the slide -31 to -33, the capture -31 and the topple -35.
Reference, Storm IV measured the same way: mean -25.7 dB, peak -13.0 dB. Now, queen: mean -29.9 dB, peak -8.8 dB;
the set-down -27, the gleam -31 to -39, the slide -31 to -24, the capture -22, the king's rocks -23 to -38, the
topple -21. Knight: mean -31.8 dB, the landing -22. Pawn: mean -35.3 dB, the hops -32, the capture -26. The mean is
still under Storm's because this one has quiet on purpose (the coil, the king hanging before it falls) where Storm
is a continuous roar; its hits are louder than Storm's. Levels are measured, not heard.

- Two ElevenLabs calls, two new clips: `chess-knock` (0.4 s, a heavy piece slammed on wood) and `chess-roll` (0.96 s,
  the king falling over and rocking to rest). Own clips now: five, 2.5 s.
- Every placement and hop: the tap with the knock on top. Every capture: the knock over a LOW layer (the shared ground
  impact, started 380 ms in, where its hit is). The queen's slide: the wood under a fast whoosh, after a slowed slide
  swell through the coil. The king: a knock for each rock, a rush of air through the fall, then the clack, a low
  knock, the low layer and the roll. The word: a low stamp.
- Found and fixed: two reused clips were close to inaudible as they were cued. The long swish is silent for its first
  0.2 s and peaks at 0.45 s, so the short cues of it (the knight's jump) were about -45 dB: the whoosh is now the
  shared drop whoosh, which is loud at once. The sparkle is silent for its first 1.4 s, so the gleam had no sound:
  it is now played from 1.5 s in.

**Style.** No new drawn objects. The pieces stay: they are the idea, and they are painted with care.

**Verified this pass.** `heroChess.test.ts` extended (the coil, the king's rocks and slow fall, the hints lighting in
order and flashing, the longer queen). Sheets, recorded at 0.35x: the queen both ways, the knight and the pawn your
way. Frame times on the queen at 1x without the recorder, dev build, on a machine running other builders: median
4.2 ms, 99th percentile 4.3 ms in two of three runs (12.5 ms in the first); long frames only where the first pass
found them (about 60 ms after the ready starts, and on the end cue), plus one of 50 ms just after the capture in the
first run only (13 ms in the second, none in the third).

**Still weak.** The knight's lit squares are its two-along file, not the whole L. The board still lies over the rail
and the shop. Nobody has heard the mix. The config key moved to `ascent.herochess.v3`.

## Third pass (2026-11-13): Tier 3 gets its own piece, the rook

The owner's note: "this one is awesome but change the t3 so it's not the same knight attack and something else." Tier 2
and Tier 3 both played the knight (an Epic's three looks). Now every shared damage tier plays its own piece by its own
chess move, and the looks are named Tier 1 to Tier 4 everywhere in this style's files (tuner groups, play buttons, hints,
tier dials, comments, tests):

| tier | damage | piece | the move |
| --- | --- | --- | --- |
| Tier 1 | 1 to 5 | pawn | unchanged |
| Tier 2 | 6 to 11 | knight | unchanged |
| Tier 3 | 12 to 19 | **rook** (new) | set down hard on the struck hero's OWN file, three squares back; the file lights square by square (softer than the other looks, since the lit squares touch and read as one bar); it BRACES (rocks back on its heel, drawn back a quarter square like a ram, grinding, puffs of grit), then CHARGES straight down the file, gathering speed (travel = u^1.8), thumping over each seam (a flash on the square it leaves, a dust ring, specks, a camera jolt, a knock, harder each time) and RAMS the portrait head on: a shock front of flat rings and a bar thrown on through the portrait, a fan of tumbling wooden chips off its battlements, a low dust cloud, a light screen flash, and the portrait driven straight back hard. The rook bucks back off the blow and stays 0.62 s. |
| Tier 4 | 20+ and every knockout | queen | unchanged (and still the knockout look) |

Running time from the ready: pawn 1.65 s, knight 1.88 s, rook 2.13 s (impact at 1.29 s), queen 3.06 s. Every per-tier
dial (shake, zoom, punch, sparks, burst, dim) steps up 1 < 2 < 3 < 4; the queen's dials are unchanged.

- The rook is a turned piece like the pawn, queen and king: a broad parapet drum over a shaded neck, a gold collar, the
  tower tapering to the shared base; its crenels are cut out after painting (three merlons face you, the far wall shows
  dark through the gaps, a lit rim on the merlon tops). A small wooden chip texture is new too (tinted to the striker's
  wood, tumbling with a flip as it falls).
- The rook's file is the hero line itself, so it cannot pick a side like the others: under a hero at the very top with
  the striker level with it (not a layout the game has) the whole line drops just enough for its battlements to stay in
  view, capped well inside the portrait.
- The config key moved to `ascent.herochess.v4` (the old `v3...` dials were the queen's; they are the rook's now, the
  queen's are `v4...`).

**Sound.** Two ElevenLabs calls, two clips kept (0.42 s + 0.72 s; own clips now seven, 3.6 s):
`chess-rumble` (heavy wood grinding fast across a wooden board, loud from its first frame, -20 LUFS looped, peak
-6 dB) and `chess-crash` (a ram into a heavy wooden door: one crunch at 0, splinters to about 0.5 s, -20 LUFS looped,
peak -7 dB). The brace plays the rumble slowed (0.62x) and fading; the charge plays it at 1.1x with the shared drop
whoosh rising into the ram from 45% in; each seam is a knock and a tap over a short low layer, louder and lower each
time; the ram is the shared capture stack (knock, low layer, tap, punch, impact) at a level between the knight's and
the queen's, with the crash on top. The set-down is the heavy one the queen has. Levels are measured, not heard.

**Verified this pass.** `heroChess.test.ts` (52 tests): the four tiers map one to one; no two tiers share a piece or a
strike; the rook's plan (brace, one charge, seams that come faster and faster, the ram the only impact); the rook stands
on the hero's own file and never leaves it during the charge; it leans back in the brace, leaves without a snap, leans
into the run and bucks back on the ram; it lands the blow once and restores everything; both directions at all four
tiers; the on-screen sweep from every corner; a whole rook stays in the sprite cap and drains; the tier labels contain
no roman numerals or Small/Big/Huge. Sheets of every look, the rook both ways.
