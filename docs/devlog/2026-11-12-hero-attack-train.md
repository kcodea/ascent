# 2026-11-12: Right on Schedule, the train hero attack (style `train`, Legendary, DEV-ONLY)

One of the sixteen attacks built in parallel on the `feat/hero-attacks-16` scaffold (see
`2026-11-11-attack-scaffold.md`). The scaffold was a copy of the soccer attack; everything in
`packages/ui/src/heroTrain/` and `HeroTrainTuner.tsx` was rewritten. The style stays dev-only with no cosmetic; the
coordinator adds that later.

## The signature

A length of RAIL TRACK fades in under the struck portrait, running off both sides of the screen, and a VEHICLE
crosses the whole screen along it, THROUGH the portrait. It always enters from the striker's side (a striker straight
above or below: yours come from the left, the foe's from the right). No other attack runs a vehicle through the
screen. The blow lands once, when the vehicle's nose reaches the portrait.

## What each look does

- **I, the handcar:** a little pump trolley, its see-saw handle rocking as it rolls, trundles across and BONKS the
  portrait: a small nudge and a fat star spinning up off the bump.
- **II, the mine cart:** a rattling ore cart, faster, hopping on the rails; it spills glowing ore chunks as it hits and
  the portrait is knocked along the track and wobbles.
- **III, the steam engine:** a whistle, then a locomotive and its tender at speed (cab, boiler, brass domes, funnel,
  headlamp, cowcatcher; red drivers turning with the side rod riding their cranks; steam from the funnel). The portrait
  is FLATTENED onto the track while it passes, then springs up past its height and settles.
- **IV, the freight express:** a CROSSING SIGNAL rises beside the track (post, bell, crossbuck with no lettering, two
  lamps), its lamps alternate with the bell, the striped GATE ARM drops, a horn sounds off screen and a headlight glow
  grows at the entry edge. Then the engine, its tender, seven freight cars (box, tank, hopper and flat car textures,
  tinted into liveries and repeated) and a red caboose streak through. The portrait is thrown up and SPINS (three whole
  turns) above the train, jolted by each car, with wind streaks, rail sparks and a camera rumble. As the caboose clears
  it there is a last puff, the portrait drops, bounces and wobbles to rest, and the gate lifts. A knockout always
  plays IV.

## How

- `heroTrainConfig.ts`: the tuned values (per-tier dials t1 to t4 on the shared `configStore`), the pure plan and cues,
  the geometry (`trainGeo`), the consist (`trainConsist`, sized from the struck portrait's radius), the motion
  (`trainMotion` / `noseTravel`), the track, signal and headlight states, the struck portrait's pose (`foePose`), the
  striker's hop and lean, and the camera. **The plan never reads where the portraits are**, so cue times are the same
  every time; the geometry only decides how fast the vehicle must go. I to III fit the approach time; IV goes at exactly
  the speed that takes the whole train past the portrait in its pass time, so the caboose clears the portrait on the
  beat the portrait drops. After the impact the vehicle speeds up smoothly if it must, so its tail is off screen on time.
- `heroTrainScene.ts`: the shared `FxPool` (cap 260; IV peaks under 200) plus own sprites made ONCE at the start:
  the track tiles (at most 26), one sprite per unit (at most 12), up to four turning wheels, the rod, the handle, the
  signal post, the gate arm, two lamp glows and the headlight. Nothing is created per frame.
- `heroTrainTextures.ts`: painted once per session on 2D canvases (track tile, handcar and handle, mine cart, engine,
  tender, four freight cars, caboose, spoked wheel, rod, signal, gate arm, steam puff, ore chunk, bonk star).
- `heroTrain.ts`: the runner on the shared Sequence / StageCamera / PortraitMover / DamageFormation. No slow motion and
  no hit-stop. Both portraits' transform and opacity are saved and restored on every exit; no z-order class is added.
- The track is drawn on the above-portrait overlay, so it covers the portraits. That is why III's flattened portrait
  rests on the near side of the track rather than under it, and why IV throws the portrait UP (only as far as the
  screen above it allows: the foe's portrait sits against the top edge, so there it rises about 28 px and mostly shows
  above the cars; your own portrait gets the full throw).

## Sound

Six clips generated with ElevenLabs (6 calls, none retried), trimmed, faded, mono 44.1 kHz 128 kb/s, levelled to -20
LUFS. Total 7.9 s.

| clip | kept | measured |
| --- | --- | --- |
| `train-bell` | 1.50 s | three dings, starting 0, 0.47 and 1.07 s in |
| `train-whistle` | 1.15 s | sounds from the first ms, holds 0.9 s |
| `train-horn` | 1.70 s | sounds from the first ms, holds 1.2 s |
| `train-pass` | 1.90 s | roar from 0.05 to about 1.2 s, then fades |
| `train-clatter` | 0.75 s | the burst is 0.08 to 0.45 s in |
| `train-handcar` | 0.90 s | two squeaks, 0.05 and 0.7 s in |

Cues: I the squeak as the handcar enters (and softer as it leaves) and a small pitched-up thud; II two rattles on the
way in, a clatter and a thud on the hit; III the whistle at the start, the pass roar as the engine is due, a boom and a
clatter on the hit; IV the bell from the lamps (rung again every 1.5 s until the caboose), a swish for the gate, the
horn 0.57 s before the train is due, the pass roar, a boom on the hit, a clatter per car at varied pitch, a whoosh
after the caboose and one for the gate lifting. The boom and the whoosh are shared clips. Nobody has LISTENED to any of
this: levels and cue times were set from measurements only.

## Verified

- `heroTrain.test.ts` (29 tests): plan and cue order per tier, both directions, geometry on screen, the nose on the
  portrait at the impact and the tail off the far edge by the exit, the portrait untouched before the blow and settled
  after, every exit restoring both portraits, sprite cap, determinism.
- Contact sheets from headless Chrome on a manual clock (every look you-strike-foe, and IV foe-strikes-you).

## Not done / weak

- Not listened to (see Sound). The horn clip has no pass-by in it, so a separate pass clip carries the rush.
- Frame times were only measured in a DEV build in headless Chrome while fifteen other builders were using the same
  machine; the numbers were too noisy to prove the 6.25 ms bar. Needs a profile on the production build.
- The crossing gate arm lies along the near side of the track and the train passes behind it; it reads as a crossing
  but is not a true road crossing.
- With the foe's portrait against the top of the screen, IV's throw has almost no room, so the spin is partly hidden
  behind the cars there.
- The Collection sandbox (`space: 'local'`) was not looked at.
- No cosmetic, patch note, GAME-RULES or oracle entry: left to the coordinator, as the brief says.
