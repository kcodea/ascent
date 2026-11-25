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
