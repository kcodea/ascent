# Pack opening: the card face rework and the rarity tease (2026-11-24)

Dev only (DevMenu, Pack Lab). Follows `2026-11-23-pack-opening-experience.md`. Owner-driven iteration against a card
sheet artifact (every cosmetic type at every rarity) and the Pack Lab.

## The card face

- **Rarity plates.** Each rarity has its own plate (`packs/card-plate-<rarity>.webp`); a face wears its rarity's.
- **Foil cut to the real window.** `packs/card-plate-window.webp` is an alpha mask traced from the plates (a flood over
  the navy, the six plates' union): the notch and stepped corners. A rounded box left a gap. Re-trace it if the plates'
  geometry changes.
- **Foil is the background only.** The art window and the name frame are opaque navy (`#091226`, the name at 60%).
- **Foil colours.** Ancient: teal, white, pink bands. Legendary: gold, white, blue. Both `screen`, not `color-dodge`
  (dodge over the dark navy posterises into a rainbow). Epic keeps the dodged purple pearl.
- **Per-type art, with the Collection's pieces.** Hero skin in `HeroPortraitRing`; title = the painted Titles medallion
  over its `TitleBadge`, no art window and no name line; announcer = its painted medallion; attack animation =
  `HeroAttackPreview` embedded and self-playing (`embedded`, `autoKey`); card plate cropped from its top like the
  Collection tile. Board and Music have no painted medallion, so they keep a drawn emblem.
- **Bottom of the card.** Rarity name in the rarity colour (no pill), the type under it in white between pointed rules in
  the rarity colour, and the rarity medallion centred ON the card's bottom edge.

## The rarity tease

- **One neutral back.** Every card back is the navy reveal frame (`packs/card-plate-reveal.webp`), before and after the
  result arrives, so no edge or glow gives a rarity away. `paintRarityBack` and the per-rarity back textures are gone.
- **The tease** (`packTease.ts`) plays only while the pointer rests on the draw pile's top card (owner: "only do that
  buildup if the player is hovering over the card draw pile"): a glow behind the card climbs the rarity ladder one colour
  per step and holds at the card's own; each step pops the card and adds wobble. Common is one short step (6 frames),
  each rarity above adds 9 frames. Leaving the pile eases it out; hovering again rebuilds it. The Pack Lab's `tease`
  knob scales the length; 0 turns it off.
- A click turns the card at once, built up or not (`flipTop` then `beginFlip`). Touch has no hover, so no tease there.
- The glow does not cut off at the turn: it stays where the card was and fades out through the flip's first half
  (`teaseGlowFade`, driven from `flipStep`).
- Each step has a sound (`PackSounds.tease(stage)`): a short synthesised ring, a major third higher and a little louder
  per step, so the pitch climbs with the colour.
- Reduced motion: the row's backs keep a neutral border until turned.

## Not done

- The tease's sound is synthesised (no recorded clip yet).
- In the built-in browser pane the scene runs at about 1.5 fps when the pane is not on screen, so the tease's steps were
  confirmed by unit tests and a start/end screenshot, not watched at speed.

## The feel pass (same day, owner: "generate iterations that improve the real tactile feel of opening cards, and the dopamine rush of hitting it big, as well as the building excitement"; "i want the details to be intricate"; "sound effects to sound real")

- **The card aura is a shader** (`packAura.ts`, GLSL ES 3.0, WebGL only; the painted glow and burst sprites remain as the
  fallback and as a soft bed under it). One fragment shader per aura draws: wisps of warped noise streaming out from the
  card's own rounded edge, filaments, a hot rim with running sparks, fine rays (Legendary up), drifting motes; and on a
  reveal a torn plasma shell (never a clean circle), god rays with needles, a core flash, streaked embers and facet
  glints. Two auras: one under the pile (the tease) and one that rides the turning card, follows the face to its slot,
  bursts there and stays lit behind a Legendary / Ancient face. Sizes by rarity: `bigPull.ts` (`FLIP_CHARGE`,
  `AURA_BURST`, `FACE_AMBIENT`).
- **The pile answers the pointer** (`packPile.ts`): the top card lifts and leans toward a resting pointer, sinks under a
  press. `pileStep` is the one place the top card is posed (the tease only says how much to add).
- **The tease escalates**: the aura and a tinted glare on the card back climb with the colour; from Legendary the card
  trembles and a heartbeat kicks it while the pointer holds.
- **A better card turns slower** (`flipHalfMs`: Epic 330, Legendary 460, Ancient 560 ms per half), with a small sink
  before the lift. The shell, the scene and the face all read the one function.
- **The face**: a flash of the rarity's light as it opens and a punch of scale as it lands (`.pkf-flash`, `.pkf-punch`),
  and a big pull washes the theatre in its colour (`.pkop-wash`). All one-shots, opacity / transform / `scale` only.
- **Sounds are recorded clips** from the game's library (`CARD_CUES` in `packSounds.ts`): card touch on a press, a
  singing glass that climbs a pitch ladder per tease step, a low pulse for the heartbeat, a card swish (and a wind-up for
  Legendary / Ancient) on the turn, a card landing, and layered impacts and shimmer on a big pull. The synthesised tease
  ring is gone.

How it was checked: the shader's look from a CPU reference render of the shipped GLSL (it compiles in a real WebGL2
context); the maths and the face beats by unit tests. NOT checked: the motion at real speed and the sounds by ear (the
built-in browser pane ran under one frame a second). Both need the owner's eye and ear.

## The whole-presentation pass (same day, owner: "its everything, the animations, the card back visuals, the tear effects, the unsheathe effects, the entire presentation, EVERYTHING needs to be brought up"; "sound, crinkling of the card wrapper, tearing the wrapper")

- **A stage, not a dimmed menu** (`packFx.ts` `STAGE_FRAG`): one shader behind everything draws a dark void, a spotlight
  that falls on the pack (then the pile), dust in the beam, drifting motes, the pack's own colour pooled behind it, and
  a wash of a big pull's colour from where its face lands. The DOM scrim is now a near-opaque dark gradient (the summary
  and reduced motion stand on it). The ticker no longer idles while the stage is up (its dust keeps moving).
- **The foil crinkles** (`FOIL_FRAG`, on the wrapper body's own grid): faceted folds lit from the tilt. It wrinkles where
  the hand is (hover, a press, the tear's front, the sleeve grip) and `Handling.wear` keeps the wrapper a little more
  crumpled the more it is worked (it never un-crumples); it crumples fully as the sleeve falls away. A press on the
  sealed wrapper also squeezes its sides in (`writeBody`).
- **Light from inside** (`SPILL_FRAG`): shafts and rising dust in the pack's colour pour out of the opening as the strip
  comes off, and out of the sleeve's mouth as the cards slide out.
- **The tear**: a ragged fringe instead of a hairline (`TornLip`), a foil lining with creases, a sheen band and a crimped
  edge on the strip's underside (`paintStripBack`), more flecks.
- **The card back is alive** (`SHEEN_FRAG`): a band of light follows the pointer across the top back, glints twinkle on
  its lattice, the star flares softly. Never tinted by rarity.
- **The wrapper's sounds are recorded foil** (`FOIL` in `packSounds.ts`; eleven clips generated with ElevenLabs
  sound-generation on the owner's go-ahead, in `audio/fx/pack-*.mp3`). They are played granularly so they follow the
  hand: the tear and the sleeve are loops of real foil ripping and cards sliding whose level and pitch ride the speed,
  with grains of the same recordings as the foil catches; the crinkle is grains of a real wrapper crinkle fired by the
  distance the held foil is worked; one-shots for the pinch, the squeeze, the final rip, the release, the dropped
  wrapper and the cards coming out. Each recording is levelled in the table (they were not generated at one level). The
  synthesised cues remain only as the fallback until a clip has decoded.

How it was checked: frames captured from the running game in headless Chrome (playwright-core + the installed Chrome),
for the sealed pack, hover, squeeze, the tear, a slow-motion quick open through the sleeve, the pile and five reveals.
The clips were measured (length, level, envelope), not heard. NOT checked: any sound by ear, motion at 60 fps, and
performance on a real GPU (software GL only; the stage is a full-screen shader).

## The end of the pack (same day, owner: "how about when the cards are presented at the end? did all of that get enhanced?")

It had not: the summary was five equal cards on a flat backdrop with a stale caption. Now:

- **The stage stays lit.** The scene's canvas is no longer hidden for the summary; `PackScene.showSummary(spots)` clears
  the pack, the pile and the flip off the stage, moves the light to the row, and burns an aura (with a small burst)
  behind the best pulls (`summaryBest`: Epic and up, best first; the first two are lit).
- **The row is dealt**: each card leaves the pile a beat after the one before (`SUMMARY_DEAL_MS`), lands with a card
  sound, and the best pull stands raised and a little larger (`.pkf-best`). A card lifts under the pointer.
- **A head**: the pack's name between pointed rules, and "5 cards / 4 new / 1 duplicate". The reveal's caption is kept
  for screen readers only.
- The auras are placed when each best card's move has ENDED (`transitionend` on its transform), never after a guessed
  delay: a busy frame starts the move late, and a measurement taken early lit the old pile spot at pile size.

## Owner pass on the wrapper and the flip (2026-11-25)

- **The light from the opening** sits ON the wrapper's open end: it trails with the rim (`sl.lag`, as the torn lip
  does), narrows with it when the sleeve is pinched near the top (`rimPinch`, the lip too), is a little narrower than
  the wrapper (`SPILL_INSET`), keeps a thin hot line however far it reaches (`uLine`), and its dust is anchored to the
  stage so pulling the wrapper down does not drag the sparkles with it (`uReach` / `uLineY`).
- **The wrinkle overlay is gone** (owner: "it doesnt need it"). The crinkle is heard, not drawn; the press still draws
  the wrapper's sides in. Removing it, the holo's position update was cut by mistake for a few minutes (the sheen stopped
  following tilt and pinch): restored. The holo, sheen and gloss all copy the body's positions in `writeBody`.
- **No halo past the wrapper** (`PACK_HALO = 0`, owner: "fully behind the card ... im willing to do it"); the stage's
  pooled colour is the pack's light.
- **Sparks, not confetti** (`FleckPool`): additive glow sprites in the pack's colour or white-hot that leave the torn
  edge, rise on their own heat, wander, twinkle and shrink.
- **The card's aura turns with the card**: `Aura.place(..., turn)` narrows it by the flip's cosine through the scene's
  half and opens it again through the face's half. The face's opening flash is cut to the plate's own silhouette (its
  alpha as the mask); a plain rounded box showed as a pale frame off the card's edges.
- **The tease holds each tier twice as long** (`TEASE_FIRST_FRAMES` 12, `TEASE_STEP_FRAMES` 18).
- The summary deal's stagger moved to a CSS variable (`--pkf-deal`); an inline `transitionDelay` beside the `transition`
  shorthand made React warn.
- **The wrapper's highlights are cut to the art** (`MASKED_FRAG`, `GLOSS_FRAG` in `packFx.ts`): the idle sheen and the
  gloss band were plain textured meshes on the body's grid, so they lit the body's whole RECTANGLE, the art's
  see-through margin included (a pale band past the wrapper's edge, most visible when pinched). They are now drawn
  multiplied by the wrapper art's alpha; the gloss band is placed by uniforms (no per-frame uv rewrite needed for it).
- **The aura turns in the card's own perspective** (`Aura.placeTurned`): its mesh is a 13 x 13 grid and every vertex goes
  through the flip's projection (`projectTurnedRect`'s maths), through the scene's half of the turn and then the DOM
  face's half (`faceMoveEase` / `faceTurnEase`, the face's own cubic-beziers). The painted glow no longer stays behind
  the turning card when the aura carries the light. The torn lip's ends sit just inside the wrapper's sides (`LIP_INSET`).
