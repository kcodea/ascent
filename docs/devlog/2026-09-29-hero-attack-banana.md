# 2026-09-29: Oona's Banana Cannon, the ninth hero attack (attack_banana, Legendary)

Owner ask 2026-09-29: "branch off and make some more attack types - we need a fire animation, a bleed/gash animation,
some sort of an undead animation, a beast chomp rush animation, and i would love a king oona banana cannon animation.
use the same 4 tier strategy we have been." This entry is the banana slice (the others shipped on their own branches).

## Three owner reviews, the same day

1. **First cut: 3/10.** A canvas-drawn cannon, peels, chunks and a comic POW star. Owner: "the banana cannon attack is a
   3/10. use oona's animation as a guideline. improve this dramatically." So the attack was rebuilt on King Oona's OWN
   card FX (`packages/ui/src/fx/defs/oona-banana.json`): her PAINTED banana sheet (`defs/images/banana.png`), her
   PAINTED juice splat sheet (`defs/images/chatgpt-image-sep-25-2026-09-40-24-am.png`), her gold / amber juice palette,
   her orange launch sparks and her clips (`fx/oona-launch`, `fx/oona-splat`, `fx/oona-powerup`). The drawn cannon is
   gone: the hero flings the bananas out of a golden flourish. Tier IV became the jam, on the owner's follow-up: "is it
   possible to have the banana almost like look it lands on the hero and then we slam our fist into it 4 times "jamming
   it into them" kinda? almost like a mortal combat style attack".
2. **Second review**: "the bananas should spin, not flip ... make sure the attacker hero is on top of it ... slow the
   hits and reel back further between hits, have it hit 6 times, and show blood splatting on hits 4,5,6 with increasing
   amounts, then the final banana splat. is there any way to make it look like the banana is being jammed into them a
   bit more?"
3. **Third review**: "the little bananas in huge get sent too far and explode past the hero though, can you dial that
   in? add more blood in the 5th and 6th hit and have a bunch of banana juice drip down".

4. **Fourth and fifth reviews**: "make the hero less dimmed during banana multi attack combo. make the slamming the big
   banana in feel more impactful, bigger reels back, increasingly larger time between slams and stronger impacts, add
   some pixi impact bursts", then "the hero gets messed up at the end ... make the final hit's reel back slightly further
   with a slightly larger windup and more aggressive final hit? the banana also lengthens as it goes on ... the first
   banana volley looks like it is overshot due to the zoom".

5. **Sixth review**: "can you remove the blood from the banana attack and just keep the banana splats instead". All
   blood is gone. Slams 4, 5 and 6 now fire an extra burst of Oona's painted juice splats, juice spray and juice
   spatter (plus more drips), escalating exactly as the blood did. The dials are `burstStart` / `burstAmount` (the
   saved tuner key moved to v4), and a test asserts nothing red is ever drawn.

6. **Seventh review**: "what's the leftover circle here from the banana final slam? can you remove that?" The dark
   circle was the crater ring (with the cracks), held 2.6 s and so still drawn after the attack ended. The finale now
   fades the ring and the cracks out over ~180 ms. The owner then asked to keep the final splat ("nvm keep the banana
   splat on the target still"), so the splat and the juice play out their designed fade unchanged. A test asserts no
   ring or crack is drawn at the end and that every sprite is released and the scene unmounts once the juice is done.

## What plays now (after the shared damage formation)

| tier | what plays |
| --- | --- |
| I (1-5) | A golden flourish opens on the hero; one painted banana SPINS out (backspin) on a high lobbed arc shedding gold juice sparkles, and bursts on the face into Oona's painted splat and her juice burst. |
| II (6-11) | A double (one high and wide, one flatter); the first is a tick. |
| III (12-19) | A barrage of EIGHT on varied arcs; the last lands layered splats (one big, two round it) and the biggest juice burst. |
| IV (20+) | Four warm-ups (ticks, tight on the face). The hero blazes gold; a GIANT golden banana (the same painting, gilded, with a sheen) arcs high and HANGS in view (a crown glint, a flat gold target ring), then lands STUCK in the struck hero's rim like a stake. The striking PORTRAIT dashes across and SLAMS it in SIX times, reeling far back between slams (further each time; the finisher twice as far, the view pushing in over its wind-up). Each slam drives the stake deeper (the part driven in disappears into the face; by the finisher only its end sticks out), squashes it flatter, dents the struck portrait along the blow, grows a crater ring and cracks, and squeezes thick juice out that RUNS down the face, over the rim and drips off below it. From slam 4, extra bursts of painted juice splats spray off the target (slam 5 far more, slam 6 the most, with juice spatter that stays on the face). Slam 6 bursts it: a massive painted splat, a ring of splats, a golden shockwave, gold rays, a gush of juice drips and a shower of spinning painted bananas; the crater ring and cracks fade out with the burst. |

The damage lands once: on the last banana (I-III) or on slam 6 (IV). No hit-stop; the clock never pauses. Flat 2D.

## How (the non-obvious bits)

- **Spin, not flip.** The painted sheet is a 3D tumble, which read as a left/right flip. Every projectile (and the
  shower) is now ONE side-on cell (`SIDE_FRAME` 3) rotated in the plane. Backspin: flying right it turns
  counter-clockwise. The spin is laid along the curve parameter, so the giant's spin slows as it hangs.
- **The hang.** `bananaEase` bends time round the arc's true apex (`apexOf`), slow there and fast at both ends, with
  the speed continuous across the apex. The giant's control point is solved so its apex sits exactly `giantHangY` below
  the top of the screen.
- **The striker on top.** The overlay canvas (z200) is above every portrait, so while the striker is in the jam the
  whole scene is cut by an INVERSE stencil mask of its circle. The striker reads on top of the banana and every banana
  effect, and the banana still covers the struck side's hero power. **Gotcha:** Pixi 8's `setMask({ mask: null })`
  does NOT remove a mask. It only merges options, and the leftover mask then acts as a NORMAL mask, which hid
  everything outside the striker's circle once the hero flew home. It is cleared by `world.mask = null` (regression
  test: `masked` is false after the jam).
- **The stake sinks without a stencil.** A second (nested) inverse mask for the struck face did not cut in Pixi 8.19.
  Instead, the stake's texture frame is cropped each frame to the part still outside the face. It uses the upright
  cell (`STAKE_FRAME` 11), cropped to its measured opaque box, anchored at the cut edge on the entry point.
- **Landing ON the face.** Splat offsets are tight to the centre (0.26 R, 0.16 R for Tier IV's warm-ups), and a tick's
  splat is capped to the face size. A test sweeps every tier, both directions, 1920x1080 and 1600x900 layouts: every
  small banana lands within 0.4 R and never flies past the target.
- **Painted sheets:** decoded through the FX image library (shared, never destroyed here), sliced once, swapped into the
  frame lists in place when they land (a scene already running picks them up), and uploaded to the GPU by a warm sprite
  during the formation.
- **Tuner:** new dials for spin, the six slams (count, spacing, reel-back, finisher wind-up and push-in, fly home), how
  far it sinks, the late juice burst (start slam, amount) and juice drips (amount, linger). The Copy / Reset / Play row is at the
  TOP (a `buttonsTop` option on `TunerSpec`, owner ask for all attack tuners), and the Speed and Reduced motion rows
  are gone.
- Oracle R-PROG-ATTACK-15 (rewritten, quotes all three reviews), GAME-RULES, patch note. Crate odds: Legendary has 12
  items, 0.42% each.

## Three bugs found in the last review (each has a regression test)

- **The blank grey disc over the striker's portrait after the jam.** Pixi 8 puts a Graphics back into the render as
  soon as it stops being a mask, so the striker's cut circle was drawn as a white disc once the cut lifted. The circle
  is now in the tree only while it is the mask (test: `strayGraphics` is false during and after the jam; both
  portraits' whole inline style is restored).
- **The stake stretching as it sank.** Cropping a texture's frame and calling `updateUvs()` does not re-measure the
  sprite's quad (a Sprite only listens for `update` on a DYNAMIC texture), so the shrinking crop was squeezed into a
  fixed quad. The stake's texture is now dynamic and refreshed with `update()` (test: the drawn quad shortens every
  slam; the test fails with the old call).
- **The splats overshooting during the zoom.** Since the scaled stage (#1762) the shared overlay canvas lives INSIDE
  `#stage`, so the DOM camera already zooms and shakes it. Mirroring the camera onto the Pixi root as well applied it
  twice, and every FX drifted away from the focus by the zoom. The camera is now mirrored only when the canvas is
  outside the camera element. Measured in the real game (the tuner demo on a manual clock; canvas rect times Pixi
  global against the portrait rect) at 1920x1080, 1600x900 and 2000x832, both directions: every warm-up splat within
  0.2 portrait radii of the centre mid-zoom (before: about 1 radius off). **This likely affects the other hero
  attacks too** (they all mirror the camera onto the same canvas), with smaller zooms; worth a follow-up there.

Also in that review: the dim lifts as the dash starts (both heroes stay bright through the jam), the gaps between slams
grow (+20% each), the reel-backs grow much further (the finisher 3.1x, its wind-up 1000 ms, its drive faster), every
slam punches the camera and shakes harder than the last, and each slam fires an escalating Pixi impact burst (white
flash, a spike-star impact frame, radial speed lines, shockwave rings, sparks, debris, and screen-edge impact lines on
the late slams).

## Perf (PROD build, `vite build` + `vite preview`, private headless Chrome over CDP, 1600 x 900, RTX 4080 D3D11, vsync and frame cap OFF: raw frame cost)

Real rAF playback, sound off, a temporary uncommitted hook to reach the runner, and the painted sheets decoded.

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms | long tasks | peak sprites |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IV you (40, first play, cold page) | 46697 | 0.2 | 0.4 | 0.6 | 248.7 | 7 | 6 | 887 |
| IV you (40, again) | 31837 | 0.4 | 0.6 | 0.7 | 6.7 | 0 | 0 | 885 |
| IV foe (40) | 32777 | 0.4 | 0.6 | 0.7 | 6.3 | 0 | 0 | 887 |
| III (14) | 12631 | 0.4 | 0.6 | 0.7 | 6.2 | 0 | 0 | 438 |
| II (8) | 12009 | 0.4 | 0.5 | 0.6 | 6.1 | 0 | 0 | 192 |
| I (3) | 11758 | 0.4 | 0.5 | 0.6 | 6.0 | 0 | 0 | 111 |

The cold-page first play spikes, and Venom Volley (poison) spikes the same way on the same cold page (worst 491 ms).
It is the page's first Pixi overlay render and formation, not this attack; in a real fight the overlay is already warm.
The sprite cap is 1100 (Tier IV, with the impact bursts, juice bursts and drips, peaks at ~890).

## Open for the owner

- The name (placeholder "Oona's Banana Cannon"; the catalog caps names at 20 characters).
- Tier IV runs about 7.1 s from the flourish (six slow, building slams was the ask). `slamGapMs`, `slamGapGrow`,
  `finisherWindMs` and `slamCount` are the dials if it should be tighter.
- Deploy `progression-inventory` so `attack_banana` reaches the catalog. No SQL.
