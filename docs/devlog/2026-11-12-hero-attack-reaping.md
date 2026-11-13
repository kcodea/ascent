# 2026-11-12: The Reaping, the Ancient of Death's hero attack (style `reaping`, Ancient, dev only)

One of sixteen attacks built in parallel on `feat/hero-attacks-16` (see `2026-11-11-attack-scaffold.md`). Scaffolded
from `stitch`; nothing of Soul Stitch is left. The style is DEV ONLY and has no cosmetic yet: it plays through the
"Attack style" override and its tuner (Dev menu, "Hero Attack: The Reaping").

This file describes the attack as it stands after the THIRD PASS (2026-11-13). What the second and third passes
changed, and why, is in their own sections below. The looks are named Tier 1 to Tier 4 everywhere in this attack's own
files (tuner, hints, comments, tests), as the owner asked.

## The signature

WHAT THE SCYTHE CUTS IS COLOUR, and the stolen colour is the star. Every cut takes the struck portrait's colour, and
that colour is VISIBLE as it is taken: drops, glass shards and long ribbons in the portrait's OWN hues (read from its
art at the start, `heroReapingPalette.ts`), carried into the striker, who then glows with them (rings of those hues
round its rim). Tier 3 gathers the colour of the whole board into an orb and shatters it; Tier 4 leaves the struck
portrait as the last colour in a grey world, winds it out onto the blade (which turns rainbow) and leaves the loser grey
and cracked like old paint. No other attack removes colour. The blade is the Ancient of Death's spectral teal
(`#2fe0bc`). It uses none of Grave Call's skulls, hands or wisps and none of Hemorrhage's red slashes or blood.
Everything it draws is light and colour: there are no drawn props (the cracks are a texture over the portrait, not an
object).

## What it does

Four looks on the shared thresholds (Tier 1 from 1, Tier 2 from 6, Tier 3 from 12, Tier 4 from 20; a knockout always
plays Tier 4; there is no separate knockout variant and no variants rolled from the seed beyond the mirrored cut). Flat
2D, no hit-stop, the clock never slows. The blow lands once, as the blade crosses the middle of the struck portrait.

- **Tier 1, the cut** (owner-approved; timing unchanged). A long thin crescent of teal light sweeps once through the
  struck portrait. A STRIP of it goes grey, a hairline of bone light marks the cut, a spray of the portrait's own colours
  flies off the cut, and drops of them drift to the striker, whose rim glows faintly with them. Colour seeps back.
- **Tier 2, the cross** (owner-approved; timing unchanged). Two cuts cross at right angles. HALF the portrait is grey,
  more of its colour sprays and streams away, and the striker glows a little more.
- **Tier 3, the harvest** (rebuilt in the third pass, 3.25 s after the formation). The board's colour is GATHERED: the
  screen greys from its edges inward (a ring of light on the closing edge) while drops of every colour (the portrait's
  hues and the board's rose, blue and gold) run in ahead of the grey, spiralling, into one ORB of colour over the struck
  portrait: lobes of those hues swirling inside a rim of light, motes orbiting in it. The portrait greys as its colour
  goes into the orb. A great teal crescent is drawn back and held over it (520 ms wind-up and a 260 ms hold), falls, and
  cuts the orb: it SHATTERS into a storm of 52 glassy shards of those colours that burst out and are drawn into the
  striker, who blazes with rings of them. The board gets its colour back (the grey lifts 380 ms after the shatter); the
  target stays grey a beat longer.
- **Tier 4, the reaping** (rebuilt around ribbons in the third pass, 5.0 s after the formation). The whole screen drains
  to monochrome EXCEPT the struck portrait (the veil has a round hole over it): the last colour in the world. Silence.
  ONE bell tolls and the teal crescent ignites over the striker. The portrait's colour is WOUND OUT of it as three long
  spiralling ribbons (rope meshes, a braid a third of a turn apart, turning as it is drawn) onto the blade, and the
  portrait greys as they go. The blade turns into a blazing rainbow scythe (a second crescent painted in every colour,
  cross-faded in, with a shimmering fringe; a high bell). One sweep across the screen, its afterimages fanned behind it
  in the stolen colours; it cuts the portrait: a flash, rings and sparks in its colours, a line across the screen fringed
  with them, and the loser CRACKS like old paint (a craquelure over the grey face, a puff of grey dust). The stolen
  colour spills off the cut into the striker and floods back into the world in a wave from the striker behind a band
  of its colours. The loser stays grey and cracked a moment; then the paint flakes off and falls, and its colour returns.

## Second pass, for the record (owner verdict: "the 'huge' animations need some more umph ... especially reaper ... quick and not impactful. the t3 of reaper is also bad, the first 2 are great.")

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

## Third pass (owner verdict: "The Reaping - really sweet concept but overall really lackluster, especially t3 and t4 feel extremely generic and unexciting.")

- **The stolen colour is the portrait's own.** `heroReapingPalette.ts` draws the struck portrait's `<img>` onto a 24 x 24
  canvas ONCE at the start (cached per image), bins vivid pixels by hue and keeps the strongest (at most four, a warm and
  a cool always; a portrait of one colour gets a deeper and a lighter shade of it). Measured on real art: Pete gives
  gold, teal-green and green; Chaos violet, orange and magenta; Djinn violet, orange and pink. A tainted or missing
  image falls back to the tuner's warm hues. Every drop, shard, ribbon, ring and the striker's glow use these.
- **Tier 3 is no longer "a big crescent and a flash".** It is the HARVEST above: the gather (a new pane, below), the orb,
  the shatter into shards, the striker blazing. The strike's generic white and teal rings are gone on this tier; the
  shatter's rings are the orb's colours. The crescent is kept, now cutting the orb.
- **Tier 4 is rebuilt around the ribbons and the rainbow blade**: the portrait spared by the drain, the ribbons, the
  rainbow scythe and rainbow afterimages, the cracks and the flaking, the spill and a coloured flood front. The toll's
  rings were turned down (they read as a curtain in the first captures).
- **Tiers 1 and 2** keep their timing and look; they got the portrait's own colours on their drops, a spray of them off
  each cut, and a faint glow of them on the striker ("overall really lackluster").
- **New textures** (all painted once): the rainbow crescent, a glass shard, a ribbon strip (faint tail, bright head),
  and a seeded old-paint craquelure. **New pure functions** in the config: `gatherRadius` / `gatherAt01`, `orbAt`,
  `ribbonSpan` / `ribbonPoint`, `rainbowAt`, `crackAt`, `stolenAt`.
- **Running time after the formation**: Tier 3 2.30 s -> 3.25 s; Tier 4 4.44 s -> 5.00 s (the ribbons add 1.1 s of
  anticipation; the silence went 400 -> 320 ms).

### How the gather is drawn

A full-screen `backdrop-filter: grayscale` pane with an even-odd `clip-path: path()` that is the screen minus a circle
round the struck portrait; the circle closes from past the farthest corner onto the portrait (log space, so the edge
sweeps fast over the far board and slows as it closes). This is the one pane that writes something other than opacity
and transform per frame: the pane paints nothing, so a new clip costs no raster. The first try, a small square with a
round hole in its MASK scaled up to 100x and down, rendered a black band across the bottom of the screen in the
captures (the scaled element ran tens of thousands of px wide), so it was dropped. Tier 4's veil spares the struck
portrait with a second, radial layer in its mask (`mask-composite: intersect`), dropped in ONE write as the flood starts.

### Sounds (third pass)

Four new clips from ElevenLabs (4 calls of the 8 allowed), processed like the others (mono, 44.1 kHz, 128 kb/s, peak
under -1 dB):

| clip | length | what | used for |
| --- | --- | --- | --- |
| `fx/reaping-orb` | 1.50 s | a resonant hum of glassy energy (mostly under 200 Hz), about -22 LUFS | Tier 3: the orb filling, cut off by the blow; Tier 4: the blade filling with colour; both: the striker taking the colour in (pitched up, short) |
| `fx/reaping-shatter` | 0.90 s | a glass orb shattering, transient at 0 ms, -20 LUFS | Tier 3: the shatter, over the cleave and the boom |
| `fx/reaping-wind` | 1.10 s | silk ribbons whipped into a spiral, swelling to a body at 470 ms | Tier 4: the ribbons, twice (placed so each body lands as the ribbons are widest) |
| `fx/reaping-crack` | 0.80 s | old paint cracking, brittle crackle | Tier 4: the cut (the paint cracks) and, higher and quieter, the flakes falling |

Every new beat has its sound: the gather (the long rush of air and a low breath), the orb (the hum), the ribbons (the
whirl and the hum), the blaze (a high bell and steel), the shatter, the cracks, the stolen colour arriving (the hum,
high), the flakes. Own clips now total 12.1 s (ten clips); `phoneAudioQuality.test.ts` stays green.

Levels after the formation, measured the same way as the second pass (dBFS RMS, 100 ms windows; "top 5" is the mean of
the five loudest windows):

| | second pass: mean / top 5 | third pass: mean / top 5 |
| --- | --- | --- |
| Tier 1 | -30.3 / -26.1 | -29.4 / -25.7 |
| Tier 3 | -27.3 / -22.9 | -27.5 / -22.7 (no window under -45 dB in 3.9 s) |
| Tier 4 | -25.6 / -20.9 | -25.6 / -21.2 (the silent beat is still there: -45 and -50 for two windows) |

So the level is held where the second pass set it. NOBODY HAS HEARD ANY OF THIS: the numbers are measured, not heard.

## Frame times (third pass)

DEV build, headless Chrome 1920x1080 with the GPU, `requestAnimationFrame` deltas from 30 ms after the charge to the
end, no screencast. THE MACHINE WAS SATURATED while this was measured (CPU load 93 to 100%, about 20 other Chrome
processes from parallel builders), so the numbers are noisy; Soccer IV was measured in the same page as the control.

| run | median | p95 | p99 | worst | frames over 6.9 ms |
| --- | --- | --- | --- | --- | --- |
| The Reaping Tier 4, you strike (2 runs) | 4.2 | 8.4 | 12.5 to 20.9 | 67 to 79 | 122 to 149 of about 1000 |
| The Reaping Tier 4, the foe strikes | 4.2 | 8.3 | 12.5 | 100 | 125 of 1021 |
| The Reaping Tier 3 (2 runs) | 4.2 | 8.3 to 12.5 | 12.6 to 29.2 | 58 to 162 | 47 to 137 of about 600 |
| Soccer IV, control (2 runs) | 4.2 | 8.3 | 8.5 to 16.7 | 67 to 71 | 76 to 89 of about 800 |

What that supports: on this loaded machine The Reaping's top look drops about as many frames as the shipped control,
a little more (about 12 to 14% of its frames over 6.9 ms against 10 to 11% for Soccer IV). It does NOT show the
6.25 ms bar is met; the second pass's quiet-machine numbers (1 to 10 long frames) cannot be repeated until the machine
is quiet. Hiding the panes did not change Tier 3's count beyond the noise. Production is unmeasured.

## How (the rest)

- `packages/ui/src/heroReaping/`: `heroReapingConfig.ts` (per-tier dials on the shared `configStore`; the pure plan,
  cues, blade geometry, the great crescent's swing, the line, the drain envelope, the gather, the orb, the ribbons, the
  rainbow, the cracks, the stolen glow, the portrait's knock and sag, the camera), `heroReapingDrain.ts` (the panes,
  the gather's clip, the veil's hole), `heroReapingPalette.ts` (the stolen colours from the portrait's pixels),
  `heroReapingScene.ts` (the shared `FxPool`, cap 300; its own sprites and the six rope meshes; up to 72 pooled motes
  and shards), `heroReapingTextures.ts` (eight canvases), `heroReaping.ts` (the runner on the shared Sequence /
  StageCamera / PortraitMover), `heroReaping.test.ts` (65 tests).
- `HeroReapingTuner.tsx` on the shared tuner builder with four tier groups named Tier 1 to Tier 4 (buttons on top),
  a row per sound, new rows for the gather, the orb, the shards, the ribbons, the blaze and the stolen glow.
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

- Third pass: `npx vitest run packages/ui/src/heroReaping packages/ui/src/heroAttack packages/ui/src/audio` (928 tests,
  22 files, green), `npm run typecheck` and `npm run lint` (0 errors; no warnings in this attack's files).
- Looked at, in headless Chrome through the tuner's own Play path (the real runner between the two real portraits,
  the live backend blocked): every tier, Tiers 3 and 4 in both directions and zoomed on the struck portrait (contact
  sheets read and iterated: the scaled gather pane's black band, a Tier 4 veil that did not spare the portrait, a
  one-colour orb, tiny shards and a blob over the striker were all found that way and fixed).
- After each run: no pane left in the DOM and `done` true (the preview then unmounts the foe portrait, so the capture
  script's own before/after compare of it reads "changed"; the unit tests pin the restore on every exit).

## Not done / weak

- Nobody has heard it (above).
- The 6.25 ms bar is NOT shown to be met: the machine was saturated during the third pass's measurements, where the top
  look dropped about as many frames as the Soccer IV control, a little more. Production unmeasured.
- The gather writes a `clip-path` per frame for about a second (measured, not isolated as a cost on a loaded machine).
- The palette reads the portrait's `<img>`; a portrait drawn another way (a CSS background) falls back to the tuner hues.
- Tier 3 on a portrait at the TOP of the screen (you strike the foe) is a sideways sweep from a crescent held below and
  beside the portrait, not a fall from above. The fall from above is what plays when the foe strikes you.
- Tier 4's crescent (and so the rainbow blade the ribbons wind onto) is about half off the screen edge while it is held
  over a striker in a corner.
- The shared hit number sits over the struck portrait at the moment of the cut and hides part of it on every look.
- The Collection sandbox (local space) is covered by one unit test only; it was not looked at. A scaled stage (a
  window that is not 1920 x 1080) and phones were not looked at; `backdrop-filter` on an old phone GPU is the first
  thing to check there.
- No knockout variant: a knockout plays Tier 4. No cosmetic, patch note or rules entry: dev only.
