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
- **The tease** (`packTease.ts`): between the click and the turn, a glow behind the card climbs the rarity ladder one
  colour per step and stops at the card's own; each step pops the card and adds wobble. Common is one short step
  (6 frames), each rarity above adds 9 frames. The Pack Lab's `tease` knob scales the length; 0 turns it off.
- `flipTop` now starts the tease; `beginFlip` (the old tail of `flipTop`) runs when it ends. The flip sound moved with it.
- Reduced motion: the row's backs keep a neutral border until turned.

## Not done

- The tease has no sound of its own yet.
- In the built-in browser pane the scene runs at about 1.5 fps when the pane is not on screen, so the tease's steps were
  confirmed by unit tests and a start/end screenshot, not watched at speed.
