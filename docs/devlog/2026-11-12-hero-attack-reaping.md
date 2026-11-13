# 2026-11-12: The Reaping, the Ancient of Death's hero attack (style `reaping`, Ancient, dev only)

One of sixteen attacks built in parallel on `feat/hero-attacks-16` (see `2026-11-11-attack-scaffold.md`). Scaffolded
from `stitch`; nothing of Soul Stitch is left. The style is DEV ONLY and has no cosmetic yet: it plays through the
"Attack style" override and its tuner (Dev menu, "Hero Attack: The Reaping").

This file describes the attack as it stands after the SECOND PASS (same day). What the second pass changed, and why, is
in its own section below.

## The signature

WHAT THE SCYTHE CUTS IS COLOUR. Every cut drains the struck portrait to greyscale along the cut, and warm motes of its
colour lift off and are drawn into the striker. The top look drains the WHOLE SCREEN to monochrome and silence before
colour floods back to everything except the loser. No other attack removes colour. The palette is the Ancient of
Death's spectral teal (`#2fe0bc`) against black and bone white; the motes are the only warm things on screen. It uses
none of Grave Call's skulls, hands or wisps and none of Hemorrhage's red slashes or blood. Everything it draws is light
(blades, afterimages, rings, sparks, motes): there are no drawn props.

## What it does

Four looks on the shared thresholds (I 1-5, II 6-11, III 12-19, IV 20+; a knockout always plays IV; there is no
separate knockout variant). Flat 2D, no hit-stop, the clock never slows. The blow lands once, as the blade crosses the
middle of the struck portrait.

- **I, the cut** (owner-approved, unchanged). A long thin crescent blade of teal light sweeps once, point first, along
  a shallow arc through the struck portrait. A STRIP of the portrait goes grey behind it, a hairline of bone light marks
  the cut, and five motes of colour drift to the striker. The colour seeps back after a beat.
- **II, the cross** (owner-approved, unchanged). Two cuts cross at right angles. The first is a tick. On the second the
  two wedges between the cuts drain as well: HALF the portrait is grey, and more motes stream away.
- **III, the fall** (rebuilt). A HUGE crescent of teal light (3.6 portrait radii long, about 470 px) ignites beside the
  struck portrait and is DRAWN BACK through a 520 ms wind-up while a glint runs up its edge and its halo builds; it is
  held 200 ms, trembling; then it falls through the WHOLE portrait in 200 ms, edge first, five afterimages fanned out
  behind it. On the cut: a white flash, two shock rings, a thick hairline along the cut, sparks thrown the way the edge
  went, the view kicked (16 px), the entire portrait grey inside 70 ms and knocked about 20 px. Its colour is TORN OUT
  along the cut as a plume (34 fat motes, every fourth a big soft one) and pulled across to the striker. A low bell.
  With room above the portrait the crescent is raised above it and falls; on a portrait at the top of the screen the
  pivot sits under it and the crescent is drawn back toward the striker and swept across (so the wind-up is always on
  screen).
- **IV, the reaping** (rebuilt around the same crescent). The whole screen drains to monochrome (600 ms) while every
  other bus is hushed; 400 ms of stillness and silence; then ONE bell tolls: two rings open from the striker, the view
  jolts, and a crescent 5.6 radii long (about 730 px, half the screen's height) ignites over the striker and is held
  520 ms, brightening. It sweeps the full width of the screen on a great arc in 380 ms, accelerating, its five
  afterimages fanned right across the screen behind it, and cuts the struck portrait: a flash over the whole screen,
  three shock rings (the last crosses the screen), the view hit hard (24 px), a thick line of light left across the
  whole screen that thins away over 700 ms, the portrait knocked about 30 px. Its colour streams out, thick and long
  (60 motes over 620 ms), into the striker. Then colour FLOODS back behind a broad bright front that runs with the edge
  of the returning colour (a warm ring and sparks off the striker as it starts), to everything except the struck
  portrait, which stays grey a moment longer and gets its colour back last.

## Second pass (owner verdict: "the 'huge' animations need some more umph ... especially reaper ... quick and not impactful. the t3 of reaper is also bad, the first 2 are great.")

- **I and II: looks and timing untouched** (a test pins their beats, mote counts, shake, dim and blade dials). Sound
  only.
- **III redesigned.** The hooded shadow, its snath and the candle are gone (three drawn props, and the scythe barely
  read). III is now the same visual language as I and II, several times the weight: a great crescent with a real
  wind-up, one heavy stroke, the whole portrait drained at once, the colour torn out as a plume.
- **IV: the hair-thin line is now the same great crescent, bigger, swept across the whole screen**, with a real silent
  beat (260 -> 400 ms), the toll made visible (rings, a jolt of the view, the blade igniting on it), a much harder cut
  and a line left behind it, a stream of twice the motes, and a bright front on the returning colour.
- **Running time of IV, after the formation: 3.68 s -> 4.44 s** (Soccer IV 3.31 s, Frost IV 3.08 s, measured in the
  same page). The first pass was not shorter than those two; it was weightless because the cut was a thin line and the
  sounds around it were missing (below). The extra 0.76 s is anticipation (the silence, the held crescent) and
  aftermath (the stream, the flood, the linger). III: 2.14 s -> 2.30 s.
- **Textures**: four canvases now (the thin blade, the wide crescent, the line, the mote). The shadow, snath, candle
  and flame canvases are deleted.
- **Pool**: III and IV make their pooled sprites at construction (during the formation), so the cut creates none.

## How the colour is drained

`heroReapingDrain.ts`, unchanged from the first pass. Each grey area is an empty `div` with
`backdrop-filter: grayscale(1) brightness(0.9)`, appended to `#stage` at z 160: over the dim (150) and both portraits,
under the above-portrait FX canvas (200). A pane greys whatever is painted under it and touches no other element, so
there is no clone of the portrait, no filter on the game root and no Pixi filter, and the teal blades and warm motes
drawn on the canvas keep their colour over a monochrome screen. After the build ONLY `opacity` and `transform` are
written, from the one clock: a strip per cut (I-II), two wedges (II), the round full pane (III-IV), and the screen veil
(IV), which fades in and slides off along the strike line with a feathered trailing edge. `veilSpan()` is now exported
so the scene can draw the bright front exactly on that edge.

Every exit (the end, `finish()`, `cancel()`, the safety timer; an unmount cancels) removes every pane, restores both
portraits' transforms, resets the camera and restores the hushed buses. Neither portrait's filter, opacity or z-order
class is ever touched.

## Frame times (second pass)

DEV build, headless Chrome 1920x1080 with the GPU, `requestAnimationFrame` deltas from 30 ms after the charge to the
end, no screencast running. The page idles at 4.2 ms (about 240 Hz) on this run.

| run | median | p95 | p99 | frames over 6.9 ms | where the long frames are (ms after the charge: ms) |
| --- | --- | --- | --- | --- | --- |
| The Reaping IV, you strike (3 runs) | 4.2 | 4.3 | 4.3 | 5 to 10 of about 1040 | 54-62: 37-46, then 1921-1946: 8-21 (the cut is at 1900) |
| The Reaping IV, the foe strikes | 4.2 | 4.3 | 4.3 | 1 of 1056 | 45: 25 |
| The Reaping IV, panes hidden | 4.2 | 4.3 | 8.3 | 18 of 1032 | 64: 46, 1926: 13, single 8 ms frames after the cut |
| The Reaping III (2 runs) | 4.2 | 4.3 | 4.3 | 4 to 5 of about 540 | 49-50: 33-38, then 942-996: 8 (the cut is at 920) |
| Soccer IV (control, 2 runs) | 4.2 | 4.3 | 4.3 | 3 to 5 of about 910 | 46-53: 33-38, 2042: 50 |
| Frost IV (control) | 4.2 | 4.3 | 8.4 | 17 of 700 | 60: 42, 2314: 17, 2744: 38 |

What that supports: the 25 to 46 ms frame about 50 ms after the charge is NOT this attack's (Soccer and Frost have the
same frame at the same place: it is in the shared start). The Reaping's own cost is one to three frames of 8 to 21 ms
in the 50 ms after the cut on IV (one skipped frame or two at 240 Hz) and single 8 ms frames after III's cut; hiding the
backdrop panes does not remove them, so they are the cut's burst of effects, not the grey. That is NOT inside the
6.25 ms bar on those frames. It is in line with the two shipped controls in the same page, and it is a dev build; the
production build has not been measured.

## How (the rest)

- `packages/ui/src/heroReaping/`: `heroReapingConfig.ts` (per-tier dials on the shared `configStore`; the pure plan,
  cues, blade geometry, the great crescent's swing `swingAt` / `swingPose` / `swingLight`, the line `lineAt`, the pure
  drain envelope `drainAt`, the portrait's knock and sag, the camera with the toll jolt), `heroReapingDrain.ts` (the
  panes), `heroReapingScene.ts` (the shared `FxPool`, cap 260; its own sprites: the thin blades, the crescent with its
  shade, halo, glint and five afterimages, the line, the flood front; up to 72 pooled motes),
  `heroReapingTextures.ts`, `heroReaping.ts` (the runner on the shared Sequence / StageCamera / PortraitMover),
  `heroReaping.test.ts` (55 tests).
- `HeroReapingTuner.tsx` on the shared tuner builder with four tier groups (buttons on top), now with a row per sound.
- Shared files: only this style's own entries (`audio/codeClips.ts`, its paragraph in `heroBlast/heroAttackStyle.ts`).

## Sound (second pass: the owner heard the first pass as having no sound effects)

Measured first: the attack's output was recorded in the page (`snd.mjs` in the scratchpad: the tuner demo with sound,
a tap on the audio destination, RMS per 100 ms window). After the shared formation the first pass sat at -33 to -41
dBFS with no transient at any blow, against -25 to -33 for Soccer IV and Frost IV. It was thin as well as quiet: the
sweep clip has nothing under 3 kHz and every gain was 0.5 to 0.7 on a category that already plays at 0.29.

Three more clips were made with ElevenLabs (3 calls, of a budget of 6), processed like the first three (mono, 44.1 kHz,
128 kb/s, peak -1.7 dB):

| clip | length | what | used for |
| --- | --- | --- | --- |
| `fx/reaping-slash` | 0.50 s | the low body of a heavy blade through the air, peak at 75 ms | under every blade |
| `fx/reaping-cleave` | 0.70 s | a blade going through with a dull thud, peak at 0 ms | the body of every blow |
| `fx/reaping-drain` | 1.60 s | a long hollow rush of cold air, swelling over 0.5 s | the colour leaving, III's wind-up, IV's screen drain and flood |

With the first three (bell 3.3 s, sweep 0.8 s, breath 0.9 s) that is six own clips, 7.8 s. Two shared clips were added
to the style's list: `fx/metal-woosh` (a ring of steel on every blade) and `fx/heavy-rock-impact` (the low boom under
the bell and under III and IV's cut).

Cues now: every blade is three layers placed so their bodies land together on the crossing (sweep, slash, steel);
every blow has the cleave and a thump under it; the colour leaving is the drain; the colour coming back is a breath.
III: the drain swells through the wind-up and is cut off as the crescent falls; a short ring of steel as it is held;
the cut is the cleave over the boom with a low bell and the same bell an octave down. IV: the drain and breath under
the screen drain end as the silence starts; nothing plays for the silent beat; the toll is the bell, the bell an octave
down and the boom; the cut is the cleave and boom pitched down with the low octave of the bell struck again; then the
drain as the colour streams; the drain and a low sweep as it floods back.

Levels after the formation (dBFS RMS, 100 ms windows; "top 5" is the mean of the five loudest windows; all styles
share the formation's tail in the first 300 ms):

| | first pass: mean / top 5 | second pass: mean / top 5 | reference |
| --- | --- | --- | --- |
| I | -34.4 / -33.3 | -30.3 / -26.1 | Coin (a Rare) -31.8 / -31.1 |
| II | -33.9 / -32.5 | -28.3 / -23.9 | Coin -33.4 / -31.9 |
| III | -31.0 / -28.4 | -27.3 / -22.9 | |
| IV | -32.2 / -27.5 | -25.6 / -20.9 | Soccer IV -30.0 / -25.5, Frost IV -30.3 / -24.3 |

IV in order: the screen drain -27; the silent beat -43 to -51 for 300 ms; the toll -23 to -24; the cut -20 to -23; the
stream and the flood -24 to -26; the tail -29 to -33. So IV's blows are about 4 dB over the two references' loudest
moments and about level with the shared formation's own peak (-18). That is deliberate (this attack has few sounds and
they must carry), but it is a judgement made from numbers: NOBODY HAS HEARD ANY OF THIS. If it is too much, every gain
is one slider in the tuner.

One thing found on the way: clips added while a dev server is running do not play until it is restarted (the eager
glob is stale), so the first three measurements of this pass were of the old clips only.

## Verified

- `npx vitest run packages/ui/src/heroReaping packages/ui/src/heroAttack packages/ui/src/audio`, `npm run typecheck`
  and `npm run lint`: results in the commit's report.
- Looked at, in headless Chrome through the tuner's own Play path (the real runner between the two real portraits,
  the live backend blocked): III and IV in both directions (contact sheets read), and I and II again to confirm they
  look as before.
- After each run: no pane left in the DOM, the striker's transform and class as before, `#stage`'s inline style
  restored, the body class unchanged.

## Not done / weak

- Nobody has heard it (above).
- The 6.25 ms bar is not met on one to three frames after the cut on IV in the dev build (above); production unmeasured.
- III on a portrait at the TOP of the screen (you strike the foe) is a sideways sweep from a crescent held below and
  beside the portrait, not a fall from above: there is no room above it. The fall from above is what plays when the
  foe strikes you. Half of that sideways stroke is off the top of the screen at the moment of the cut.
- IV's crescent is about half off the screen edge while it is held over a striker in a corner.
- The shared hit number sits over the struck portrait at the moment of the cut and hides part of it on every look.
- The Collection sandbox (local space) is covered by one unit test only; it was not looked at. A scaled stage (a
  window that is not 1920 x 1080) and phones were not looked at; `backdrop-filter` on an old phone GPU is the first
  thing to check there.
- No knockout variant ("Tier V"): a knockout plays IV. No cosmetic, patch note or rules entry: dev only.
