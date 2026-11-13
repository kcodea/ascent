# 2026-11-12: Grabby Claw, the claw machine hero attack (style `claw`, Epic, dev-only)

One of the sixteen attacks scaffolded by `npm run attack:new` (see `2026-11-11-attack-scaffold.md`). The scaffold was a
copy of Card Shark; everything in `packages/ui/src/heroClaw/` and `HeroClawTuner.tsx` is now the claw's own. The style
stays DEV-ONLY with no cosmetic (the coordinator adds those).

## The idea

An arcade claw machine. A three-pronged chrome claw on a cable comes down from the top of the screen and physically
GRABS THE STRUCK PORTRAIT. No other attack picks its target up and carries it.

## The three looks (the shared tiers, mapped the way Card Shark maps them: I / II and III / IV, a knockout plays IV)

- **Fumble (I).** The claw runs in over the struck portrait with a servo judder (it snips its prongs once on the way),
  drops, clamps (the portrait squeezes), lifts it a little, loses its grip and drops it. The landing is the impact.
- **Shake (II, III).** Lifted higher and shaken side to side, three hard shakes, coins falling out on each, then
  dropped from height with a bigger bounce. The landing is the impact.
- **Prize (IV).** A prize chute slides up. The claw carries the portrait across, holds it over the chute a beat and
  lets go: it drops in, shrinking and fading behind the chute's face (the impact, with the clatter), the lamps flash,
  "WINNER" punches in, and the portrait pops back up in its own socket.

## The thing the brief did not know: the opponent's portrait has no headroom

On the real board the opponent's portrait sits against the TOP of the screen (centre about y 161, radius 130 at
1080p). A claw clamped on it there has its hub off the screen and nowhere to lift to. So `clawCramped` (pure, from the
portrait and the view) picks a second staging for a socket with no room above it:

- the claw first comes down WHOLE in the open beside the portrait (so it is read as a claw on a cable), goes up and
  over, and drops its prongs round the portrait from the top edge;
- it then PULLS THE PORTRAIT OUT of its socket, down and toward the middle, where the whole claw and cable show;
- Fumble and Shake end with the claw snatching it back up, the grip slipping, and the socket catching the portrait as
  the claw runs on off the top: it slams home (the impact) and rebounds downward. Nothing falls upward;
- Prize carries on from the open to the chute as usual.

With room above (your own portrait, bottom left) it is the plain lift and drop from the brief. Both are the same pose
function with a different `show` station.

## How

- `heroClawConfig.ts`: the tuned values, `clawPlan` (pure timeline), `clawGeo` (pure layout: the hub's stations, the
  lift clamped so the hub stays in view, the chute on the roomier side and inside the view), `clawPose` (pure: the
  claw AND the struck portrait from one clock, refilled in place, no allocation), `operatorAt` (the striker leans,
  presses and hops a little), and the camera.
- `heroClawScene.ts`: on the shared `FxPool`. The claw is a stretched cable, a hub with a lamp, two side prongs (one
  texture, mirrored, each rotated about its hinge) and a front prong that shortens as it opens. Its sprites are taken
  once and only moved. The chute is opaque and drawn over the DOM, which is what lets the portrait drop behind it.
- `heroClawTextures.ts`: cable, hub, prong, front prong, chute, WINNER sign and coin, painted once per session.
- `heroClaw.ts`: the runner. The struck portrait is the real DOM portrait, moved by `transform` (and `opacity` down the
  chute) from the same pose the claw is drawn from. Its side of the board is raised with Classic's
  `.duel-attacker-*` class (on the STRUCK side here) from the charge to the impact. Every exit (end, `finish()`,
  `cancel()`, the safety timer) restores the transform, the opacity and the class, and hides the claw and the chute.
  A class the fight itself already put on the body is left alone.

## Sounds

Three ElevenLabs calls, three clips kept, 1.59 s in total (mono, 44.1 kHz, 128 kb/s; short transients cannot reach
-20 LUFS, so the two short ones are peak-limited instead):

| clip | length | measured |
| --- | --- | --- |
| `fx/claw-servo` | 0.75 s | steady whirr from 0 to about 0.52 s, then fades; -21.7 LUFS |
| `fx/claw-clamp` | 0.22 s | three clicks at about 19, 60 and 120 ms; peak -2.3 dB |
| `fx/claw-chute` | 0.62 s | first clatter about 46 ms in, rattles to 0.5 s; peak -1.4 dB |

The servo is reused at different pitches and lengths for the run in, the winch, each shake, the carry and the yank.
Reused shared clips: `wipethudwood` (the landing thud), `sell2` (coins), `triplereward` (WINNER), `cardlanding` (the
chute sliding up and the portrait popping back). Cue times are the plan's beats; the clips' onsets are within 50 ms.

## Verified

- `heroClaw.test.ts` (51 tests): looks, tuner, plan and cues, geometry (both ends of the board, a small sandbox box),
  pose (rest before the clamp and exactly from `homeAt`, no jumps, stays in view, prongs open and close), camera, the
  runner in both directions at every look (the blow lands once; transform, opacity and class restored on the end,
  `finish()`, `cancel()` at seven moments, the safety timer), determinism from the seed, the headless scene.
- Looked at in headless Chrome (1920 x 1080, dev build) through the tuner's demo handle: all three looks in both
  directions.
- Frame times, DEV build, headless Chrome on a machine shared with fifteen other builders (so noisy): median 5.6 ms,
  95th percentile 6.7 to 11 ms, worst 45 to 77 ms across runs. Card Shark measured in the same harness, same minute:
  median 5.5 ms, worst 44 to 71 ms. The one slow frame that repeats (about 80 to 160 ms after the charge) is there for
  Card Shark too. Not measured on a production build or on the owner's machine.

## Not done / weak

- Nobody has HEARD the sounds: gains and pitches are set from measurements only.
- Your own portrait leaves a dark disc (its backing shadow, part of the bar) in the socket while it is away on the
  Prize. It reads as an empty socket, but it is not designed.
- On the Prize the shared `-N` pops at the empty socket while the portrait is down the chute.
- The pulled-out staging is this attack's own answer to the missing headroom; the owner has not seen it.
- No cosmetic, no patch note (dev-only by the brief). The Collection sandbox preview was not looked at.
