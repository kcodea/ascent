# Hero attack: Sucker Punch (`glove`, a Rare, dev-only)

One of the sixteen attacks scaffolded on 2026-11-12 (`docs/devlog/2026-11-11-attack-scaffold.md`). Scaffolded from
Boomerang, rebuilt from the plan up. No cosmetic yet: it plays only through the dev "Attack style" override.

## The idea

A boxing glove on a spring. A riveted hatch pops open on the edge of the striking portrait and a red glove boings out on
a zig-zag coil that stays attached to the hero the whole way across the board, bops the struck portrait and retracts.
No other attack is tethered to its hero.

## The two looks

- **Small** (shared tiers I-II): the hatch pops, the glove peeks out, fires, ONE bop (the blow), a little boing on the
  end of the spring, and the coil hauls it back in. About 1.2 s after the formation at full board distance.
- **Big** (III-IV and every knockout): the glove winds back against the coil with a quiver while the hero leans back,
  fires harder, bops (a tick, no consequence), overshoots PAST the face on one side, the spring sways side to side with
  the glove bobbing on its end, it draws back and bops a SECOND time on the rebound (the blow). Three stars circle the
  struck head for 0.9 s. Then it retracts. About 2.3 s after the formation.

The blow lands exactly once, on the last bop. No hit-stop. Reduced motion: no glove, the numbers fade and the blow lands.

## How

- `heroGloveConfig.ts`: the tuned values, the plan (`glovePlan`, cues `charge / pop / fire / hit / impact / retract /
  home / end`), the geometry (`gloveMotion`) and the pose (`glovePoseAt`), all pure. The whole punch is laid out along
  the line between the two portrait centres, measured once. The overshoot, the draw back and the sway are in portrait
  radii rather than fractions of the distance, so close portraits and far ones read the same.
- The coil is a fixed number of strokes for the punch (from the distance, 8 to 40), each holding a fixed length of wire
  (`coilAmp`): squeezed it is fat and tight, stretched it thins. It follows a quadratic curve whose middle is thrown
  across by the sway, and the glove turns to follow the last turn of the spring.
- `heroGloveScene.ts`: one pooled scene. The hatch, every coil stroke and the glove (two sprites: tinted leather, white
  trim) are taken from the pool once at the pop and only moved after that. The scene's clock starts on the pop frame, so
  the glove is on the face on the same frame the bop's burst and the consequence fire.
- `heroGloveTextures.ts`: painted once per session on 2D canvases: the glove (mitt, thumb, cuff, shaded grey for the
  tint), its trim (gloss, laces, eyelets, piping), one coil stroke, the hatch, a five-point star, the comic burst.
- The one rolled variation (which side the glove glances past) comes from `rollSeed`, or from the blow when there is none.

## Sound

Two ElevenLabs calls, two clips kept, 1.07 s in total (mono, 44.1 kHz, 128 kb/s):

| clip | kept | level | hit point |
| --- | --- | --- | --- |
| `fx/glove-boing` | 0.58 s | -20.4 LUFS, -3.4 dB peak | at the start |
| `fx/glove-punch` | 0.40 s | -22.7 LUFS, -1.7 dB peak (the transient holds it down) | about 7 ms in |

Cues: the boing as the spring lets go (Big lower and fuller), and again softer and higher as it overshoots; the punch on
every bop (the tick higher and quieter). Reused: `clickthock` for the hatch and for the glove landing home, the shared
swish for the retract. Nobody has listened to the two new clips: they were checked by measurement only (length, onset,
loudness, band energy: the punch is mostly under 250 Hz, the boing mostly 250 Hz to 4 kHz).

## Verified

- `heroGlove.test.ts` (16 tests): tiers, tuner, plan and cue order per look, geometry at six portrait layouts in both
  looks (on the line, on the face, on screen, inside the wire's length), the pose (Small and Big), the runner (the blow
  once, on the last bop; both directions at every tier; finish and cancel at six beats restore both portraits' transform,
  class, opacity and filter; determinism; reduced motion), the scene (pool, cap, drain, destroy, a full pool).
- Looked at: contact sheets of Small and Big (you attack) and Big (foe attacks) in headless Chrome at 1920 x 1080,
  stepped on a manual clock, with close-ups.
- Perf: DEV build only, headless, vsync off, with fifteen other builders running on the same machine. Median frame
  0.9 to 1.1 ms during the attack; the 99th percentile (16 to 27 ms) and the worst frames (26 to 64 ms) were dominated
  by spikes that the shipped Boomerang showed equally in the same session (99th 22 to 30 ms, worst 32 to 205 ms), so
  they say nothing about this attack either way.

## Not done

- No clean perf number. It needs a production build on a quiet machine.
- The shared big damage number pops over the struck portrait and covers the glove for the first moments after the blow.
- The sway of the spring is modest at full board distance.
- Not seen in a real fight, in the Collection preview (`local` space) or at other window sizes.
- No cosmetic, no patch note (dev-only until the coordinator adds one). The name "Sucker Punch" is a working name.
