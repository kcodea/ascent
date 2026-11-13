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
  screen. CHECKMATE sets above or below the portrait, on the side away from the queen when there is room.

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

See the PR notes of the coordinator's merge for the gate results as run on this branch; the numbers measured here are
in the builder's report. In short: the style's own test file (plan and cues per look, the board from every screen
corner in both directions, the poses, the camera, the runner's exits, the headless scene), the shared `heroAttack`
sweeps, the audio tests, typecheck and lint, and contact sheets of every look in both directions from a headless
Chrome at 1920 x 1080.

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
