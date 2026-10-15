# 2026-10-15 — New standard + gilded plates, layered card plates, thirteen more plates

Owner (2026-10-15): *"i want to replace the standard card plate with this"*, *"the gilded backplate i provided will
always be the gilded backplate, even if the standard card has a skin on"*, *"lets lock in that the gilded card does not
need the gold hue filter applied"*, then *"layer two layers to create a card frame"* and *"going forward i think its
better to do it this way, with the layers ... if i dont specify, just default to the brown one"*. Oracle rules
`R-PROG-PLATE-01`, `-02` (amended), `-05` (new).

## OWNER RUNBOOK (after this PR merges)

1. **No SQL.** The `card_plate` slot already exists (2026-10-14-card-plates.sql).
2. **Deploy the function** so the catalog syncs the thirteen new plates and the rarity changes:
   `npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza`
   Deploy from `main`: deploying a branch without these plates marks them inactive.

## What shipped

- **Standard plate** (`frames/cardplate-standard.webp`): every card without a plate cosmetic wears it, whatever the
  tribe; the ten tribe plates and the old neutral plate are deleted (2.8 MB off the boot download). The tribe name still
  prints along the bottom (`TRIBE_PLATED`). Its text darkening is the socketless shape (`desc-backbox-standard.webp`);
  the Whisper keeps the old socketed one.
- **Gilded plate** (`frames/cardplate-gilded.webp`): every gilded card, whatever plate its owner wears. No text
  darkening, no colour filter: the `--plate-gold-tone` rule and the Card Plate tuner's five gold sliders are gone, and
  `cardPlate.test.tsx` fails if any rule filters a gilded plate again.
- **Layered plates** (`packages/ui/src/cardPlate/cardPlateLook.ts`): `layered: true` paints the INTERIOR (shared, in
  `frames/plates/interiors/`: brown, dark, magma, water, simpleblack), then the darkening, then the FRAME inside the text
  panel under the name and text. The interior is anchored to the frame's box (5.4463% down the plate), not the text
  panel, so they agree at every card size; `interiorSx / interiorSy / interiorY` tuck it 8px under the frame's opening,
  `frameX` nudges frame and interior together, `darken: false` drops the darkening. The Collection shows a pre-built
  composite (`<id>.webp`).
- **`npm run plates:build`** (`scripts/build-card-plate.mjs`): writes a plate's frame layer, a copy of Aquarium Rocks'
  darkening and its Collection image; `--fit` measures the interior stretch and nudge; `--interior-src` adds an interior.
- **Plates now** (nineteen): Ancient Mooncloud, Simple Black, Simple White; Epic Moonstone, Bamboo, Smooth Aqua, Smooth
  Blue, Smooth Red; Legendary Aquarium Rocks, Amethyst, Beach, Magma, Galaxy, Crackling Gemstone, Hand Drawn, Blue Hand
  Drawn, Green Hand Drawn, Topaz, Blossom (built as "Test Blossom"). Beach, Magma and Moonstone moved from single images
  to layered frames on their own interiors.
- **Art fixes made on the way**: Blossom's frame was 11px left of centre (shifted in the art); Magma's frame had an
  opaque background outside the plate (masked with the standard plate's alpha); Mooncloud's art is not on the template
  (990x1515, clouds past the edge), so it was fitted at x1.026 with its opening centred and bottom-aligned.
- **Buy animation**: `plateFx.ts` samples the standard plate, and `cardplate-wire.webp` was rebuilt from it.

## Known gaps

- Plate art is not in the boot preload (the preloader skips `frames/plates/`), so a plate's first appearance fades in
  once decoded. Preloading only the EQUIPPED plate at run start would close that if it ever shows.
- Aquarium Rocks, Amethyst and Bamboo are still single-image plates; converting them needs a frame-only export each.
