# 2026-10-13 — The ranked gate waits on a crystal: it forms, pulses, and the press that shatters it opens the gate

**Owner asks (with the crystal art and a mock of it on the gate's centre diamond):**

> "the sliding gate screen is perfect, but i want to attempt to make it even better. 1. can you amplify the blue
> particles by 200%? i want that to be a major part of the sparks that emit. secondly. i want to add some more logic
> to how that screen works. once the gate closes with the slam. i want it to sit in that position as the center gold
> diamond forms the blue crystal ... then i want the crystal to be steadily pulsing until the player clicks it with
> their mouse. upon clicking it, i want the crystal to shatter, which then triggers the gate to slide open, revealing
> the character select screen"

Then, with a recording: "here is the sound for the crystal shattering. this should happen right when the crystal is
clicked".

## What changed

The gate was one clock (close, slam, a fixed 1 s hold, shudder, open). It is now TWO clocks with the player's hand
between them (`rankedGateTiming.ts`):

| Clock | At | What |
| --- | --- | --- |
| From "Yes" | 0 ms | The doors grind in. `gateclose`. |
| | 1500 ms | Slam: `gateslam`, recoil, flash, sparks, dust, blue embers. |
| | 1720 ms | Behind the shut doors, `startLobby` (the swap to hero select). |
| | 2150 ms | The centre diamond starts to form the crystal (1.6 s; see "it coalesces" below). |
| | 3750 ms | ARMED: the crystal is whole, pulsing, shedding embers, and takes focus. |
| ... | | The gate sits shut for as long as the player likes. |
| From the press | 0 ms | Shatter: `gateshatter`, shards, flash, a ring of embers. The doors shudder (`gaterattle`). |
| | 400 ms | `gateopen` starts. |
| | 700 ms | The doors crack apart, catch, haul open. |
| | 2200 ms | Clear. The gate unmounts. |

- **The crystal** is a real `<button>` inside the doors' body (so it shakes with them), there from forming until
  it has shattered. It acts on pointer DOWN (left button) like "Yes, let's go."; `onClick` is the keyboard's path
  and the armed crystal takes focus, so Enter or Space opens the gate. Only the armed crystal can be pressed.
- **Its place** is fixed in the gate ART's pixels (`RANKED_GATE_ART`: centre row 430.5 of 941, 236 px square, read
  off the art and checked against the owner's mock in a real render). The stylesheet scales that by the doors' own
  `cover` scale (`.rgate-doors` is a size container; `--rg-u` is one art pixel in screen px), and
  `rankedGateCrystalAt` gives the FX layer the same point. So it stays on the diamond at any window shape,
  ultrawide included.
- **Blue embers x3** at the slam (70 -> 210 before `FX_AMOUNT`, so 84 -> 252), and three new effects in
  `gateFx.ts`: `gather` (forming), `ambient` (a dozen embers a second off the waiting crystal) and `shatter`
  (67 shards, a flash, 144 embers thrown in a ring that then float up).
- **Sound:** `gateshatter.mp3` is the owner's recording, played on the press and started 24 ms in (the file opens
  on 26 ms of silence). The crystal FORMING has no recording: the `gateform` fader plays the existing gem-apply
  chime as a stand-in (`GATE_CLIP` in sfx.ts).
- Reduced motion still skips the gate, so there is no crystal to press: the swap happens at once.

## Then, after seeing it

**Owner:** "have the particles of the crystal explosion fly outward faster and further. i dont want the crystal to
physically move while its pulsing. leave that to the lighting. is it possible to apply an occasional glint to the
crystal?" and "move the 'ding' tone to when the crystal explodes, not upon clicking 'yes continue'".

- **Faster and further:** shard speed 260-1160 -> 560-2260 px/s with about half the air drag and a longer life;
  the ring of embers is thrown at 520-1820 px/s (was 200-720) with 0.55x the drag before they float up. The
  quickest now cross half a 1080p screen.
- **The crystal is still while it waits.** The body's scale pulse is gone (`rg-cry-pulse` deleted; the armed body
  has no animation at all). The pulse is light only: the glow behind it, and `.rgate-crystal-lit`, a brightened
  copy of the crystal (a STATIC `brightness` filter) whose opacity breathes on the same 1.7 s beat.
- **The glint:** every 3.8 s a slanted band of light crosses the crystal in about half a second, masked to the
  crystal's own shape (`mask: url(crystal)`), and a small four-point star flares on its upper facet as the band
  passes. Transform + opacity only.
- **The "ding":** read as the cinematic hit added on 2026-10-12 for the press of "Yes, let's go." (`gateintro`).
  It no longer plays there; it plays with the shatter clip on the press of the crystal. The Yes button now makes
  only the ordinary menu click, then the doors' grind.

**Then:** "it looks great, lets lessen the glow amount by 30%, slow down the pulsing by 50%, and slow down the
sheen by 50%".

- **Glow -30%:** every glow opacity x 0.7 (the halo's pulse 0.45-1 -> 0.32-0.7, the lit copy's peak 0.8 -> 0.56,
  and the forming glow, which now ends at the pulse's own starting level instead of jumping down to it).
- **Pulse at half speed:** 1.7 s -> 3.4 s a breath.
- **Sheen at half speed:** the band's crossing 0.53 s -> 1.06 s; the cycle 3.8 s -> 4.4 s, so the rest between
  glints is unchanged. The star's flare stretched with it. "Slow down by 50%" was read as half the speed (twice
  as long) both times.

**Then, it coalesces:** "can we have the gem almost coalesce from sparks that suck into the middle? have it glowing
hot white as its forming. growing from the center".

The forming was a glow gathering, then the crystal popping out whole with a flash. It is now, over 1.6 s (was 1.1):

- **Sparks sucked in** (`gateFx.gather`): 204 streaks from all round, leaving steadily through the first three
  quarters. Each starts slow and far out, accelerates in along a slightly curved path, stretches as it goes and is
  gone as it arrives. 72 fine motes spiral in among them.
- **Growing from the centre:** the gem scales from a point (0.02) to full size across the forming (`rg-cry-grow`,
  on a new `.rgate-crystal-gem` wrapper that holds the image and everything painted on it), with a 5% overshoot
  and settle at the end.
- **White-hot:** `.rgate-crystal-hot`, a pure white fill in the crystal's own shape, covers the body for the first
  two thirds, with a white bloom around it that grows with it (CSS) and a white-hot core in the FX layer on top.
  Over the last third the white fades to show the blue, and the blue glow behind comes up to exactly where the
  waiting pulse begins.

**Then, the hover and the Yes sound:** "when highlighting the gem with your mouse, the gem should persistently glow
bright, like the high end of the pulse. also, can you add the 'end turn' sound effect we use in game when clicking
the end turn and start combat crystal? that can be the sound that emits when clicking the 'yes continue button'".

- **Hover holds the light.** Each pulsing light (the glow behind, the lit copy on the gem) now sits in a
  `.rgate-crystal-pulse` wrapper and has a steady twin (`-glow-hi`, `-lit-hi`) fixed at the pulse's own peak
  (opacity 0.7 / scale 1.14, and 0.56). Pointing at the ARMED crystal cross-fades the wrappers out and the twins
  in over 0.16 s; leaving cross-fades back. The wrappers carry no animation, so this is a plain opacity transition
  and the pulse underneath is never stopped or restarted (stopping an animation mid-cycle would have jumped).
  The test pins the twins to the pulse keyframes' peak values, so tuning the pulse cannot leave the hover behind.
- **"Yes, let's go." sounds like End Turn:** `sfx.combatStart()`, the cue the `faceOmen` action plays when the
  in-game End Turn crystal is pressed (`turnExplode` is the timer running out, a different sound). It replaces the
  plain menu click on that button and is warmed with the gate's cues.

**Then, the hum (its own PR, after the crystal merged):** "if i give you a sound effect, are you able to make it
infinitely repeat while hovering the crystal?", with a 15.7 s recording, `crystal hum.mp3`.

- **The loop.** The recording is a hum that swells about every 1.3 s. `gatehum.mp3` is four whole swells of it
  (3.93 s to 9.15 s, cut between two of its quiet points so the rhythm holds across the wrap), the first 140 ms an
  equal-power crossfade from the audio that follows the region, then padded with a quarter second of itself each
  side. So ANY 5.22 s window of the file loops seamlessly, and an MP3 decoder's small shift cannot open a gap.
  Measured on the encoded file: the audio one loop apart differs by about 2.5% (encoder noise) and the step at
  the wrap is the size of an ordinary sample-to-sample step. Built by a one-off script, not kept in the repo; the
  window is `GATE_HUM_LOOP` in sfx.ts and must be re-measured if the clip is replaced.
- **`sfx.gateHum(on, fadeMs)`**: the bank's one looping clip. On: starts the loop and fades up (180 ms). Off:
  fades out and stops. Its own fader, `gatehum` (ui bus, 0.5).
- **When it plays** (`RankedGate.tsx`): while a MOUSE is on the ARMED crystal. It also starts if the crystal arms
  under a mouse already resting on it, stops if the window loses focus or the tab is hidden (no leave event
  fires for those), and is cut with a 60 ms fade by the shatter.

**Then, no disc on the forming gem** (with a screenshot of a bright round spot sitting on the growing white
diamond): "can we have this circle instead grow in size to block the growing diamond? then have it pulse away to
reveal the diamond? or instead, can we have the shape be the diamond instead of a circle?". The second was taken:
the heat is the crystal's own shape, and nothing round is drawn while it forms.

- The round sources are gone: the FX layer's white core and blue bloom at the centre (`gateFx.gather`), and the
  radial `.rgate-crystal-burst` during forming (it is now the shatter's alone).
- **A pile-up, too:** the hundreds of additive sparks all ended on one point and added up to a bright round spot
  there. They are now taken up as they reach the gem (`absorbed(r)`: fading between 0.36 and 0.1 of its size from
  the centre), well short of the middle.
- **The heat in the diamond's shape:** `.rgate-crystal-heat`, a white fill masked to the crystal and blurred, in
  the gem so it grows with it. The blur sits on the PARENT of the masked fill: a mask is applied after its own
  element's filter, so blurring the masked element itself would cut the bloom back to the hard edge. The blur is
  static; only opacity animates.
- Checked in a real render (mid-forming, the gem at 70%): a white diamond with a soft diamond-shaped bloom, no
  disc. The owner's first option (a circle growing to cover the diamond, then pulsing away) was not built.

**Then, the warble back, in the diamond's shape (its own PR):** "i want the edges to still warble and shift as the
diamond glows. like the circle did. can you have the particals instead have the diamond shape around the edge?".

The disc's crawling edge had been the pile-up of sparks coming and going. Removing the pile-up removed the life.
It is back, on the diamond's outline:

- **Where particles end.** Every streak and mote now lands on the gem's EDGE, at the size the gem is at that
  moment, instead of fading out short of the centre (`absorbed` is gone). The edge is the diamond
  `|x|/halfW + |y|/halfH = 1` scaled by the gem's growth.
- **They stay a moment.** A streak that arrives turns to lie along the edge, slides along it, breathes in and out
  of it, and fades over 170 to 400 ms.
- **The rim.** 180 soft motes are born ON the edge all through the forming; each drifts along it, breathes, swells
  and fades. They overlap, so the outline's brightness and thickness never hold still. Their size follows the
  gem's, and the whole rim cools off with the heat over the last 30%.
- **One growth curve.** `rankedGateCrystalGrowth` (rankedGateTiming.ts) is the `rg-cry-grow` keyframes as numbers
  (the same cubic-bezier, evaluated with `wipeGeometry.cubicBezier`), and `RANKED_GATE_CRYSTAL_BODY` is the solid
  diamond's extent inside its image. A test reads the stylesheet's keyframes and fails if JS and CSS disagree,
  since the particles would then ride an edge that is not where the gem is.

Not watched: the FX layer is mocked in tests and the preview pane does not animate. Whether the rim reads as a
warble, and how thick and bright it should be, is the owner's to judge.

**Then, softer, wilder, fuller, and a touch lower (same PR):** "can you further blur and distort the edges of the
diamond as its growing? increase the particles that are being sucked into the edges" and "can you lower the diamond
just slightly? its corner is slightly higher than the center line".

- **Blur + distort.** The white-hot face was one crisp white diamond. It is now three PLIES, each the crystal's
  shape in white, blurred by 3 / 6 / 10 art px, each warping on its own loop (0.37 / 0.53 / 0.44 s: uneven
  stretch, a degree or two of turn, a little skew and shift). Where they agree the diamond is solid; round the
  outside they keep disagreeing, so the edge swims. The bloom behind is wider and softer (blur 9 -> 16, scale
  1.16 -> 1.26) and warps too. The crisp crystal underneath is now hidden until 60% of the forming and fades up
  as the white cools (`rg-cry-body-in`), or its hard edge would show through the soft one.
  PERF: each ply's blur is a static filter on the ply itself and the animation is that ply's own transform, so
  it is a cached texture moved by the compositor, not a re-blur per frame. The mask sits on the ply's `::before`
  for the same reason as the bloom's (a mask is applied after its own element's filter).
- **More particles.** Streaks sucked into the edge 170 -> 320 (384 with `FX_AMOUNT`), spiral motes 60 -> 120,
  rim motes 150 -> 210 and fatter and looser (they add to the blur and the distortion themselves).
- **Lowered 3.5 art px.** The crystal is a kite: its side corners are on row 111 of its 232 px image, five rows
  above the image's middle, so centring the IMAGE on the emblem left the corners above the emblem's centre line.
  The line was measured as the emblem's axis of vertical symmetry in the gate art (row 429), and `crystalCy`
  moved 430.5 -> 434 so the corners land on it. Checked in a real render: corners at 409.5 px, line at 409.1.

## Judgement calls to confirm with the owner

- "Amplify by 200%" was read as three times as many (plus 200%), not twice.
- The doors still SHUDDER (with the rattle) as the crystal shatters, then open 0.7 s after the press. The ask was
  "shatter, which then triggers the gate to slide open"; the shudder was kept as the gate's reaction to it.
- The gate waits forever. There is no timeout and no skip: the crystal is the only way through.
- The ambient trickle of embers off the waiting crystal was not asked for.
- The forming sound is a stand-in.
- The crystal art is 232 px square, shown at about 280 px on a 1080p screen (more on larger ones), so it is
  slightly soft. A larger source would sharpen it.

## Verified

- `rankedGate.test.tsx` (25 tests): both clocks, the crystal's place at 16:9 and ultrawide, the exactly-once seam,
  and the real component on fake timers: forming is not pressable, the armed gate does not move in ten minutes,
  only a left press or the keyboard opens it, the release after a press is not a second press, and nothing is
  left mounted. Plus the shipped files, faders, and the compositor-only CSS tripwire (16 keyframes).
- In a real render (the gate branch's dev server, 1600x900): the armed crystal sits centred on the emblem's
  diamond, covering the gold diamond inside the steel recess, as in the owner's mock.
- **Not watched or heard:** the forming, the pulse, the shatter and every particle effect. The preview pane does
  not run animation frames. They are the owner's to judge on the dev server.
