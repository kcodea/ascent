# 2026-10-14 — Card plates are a Collection reward; the first is Aquarium Rocks

Owner: *"i want to test a new cosmetic: card plates"*, *"This card plate is called Aquarium Rocks"*, then *"Turn Aquarium
Rocks into a real equippable card plate cosmetic, with its own darkening settings, and leave the standard plates
untouched."* Rulings: a crate drop, Legendary (*"aquariam rocks should be a legendary drop"*, after first shipping it at Rare); *"replace all plates, but we ALWAYS will have the gilded cards be the existing
original card plate hued gold. nothing should ever changed for gilded cards"*; *"Others see it too"*. Oracle rules
`R-PROG-PLATE-01..03`.

## OWNER RUNBOOK (do these after this PR merges, in this order)

1. **SQL.** Paste `supabase/migrations/2026-10-14-card-plates.sql` into the Supabase SQL Editor and Run. It only
   replaces `equip_cosmetic` (adds the `card_plate` slot, keeps every other slot including the emote positions); it
   writes no rows and is safe to re-run.
2. **Deploy the function** (it carries the catalog, which adds the Card Plates category and puts Aquarium Rocks in the
   crate pool): `npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza`
3. Until both are done the Card Plates tab shows Aquarium Rocks, but it cannot drop or be equipped. Doing 2 without 1
   lets it drop but equipping it answers `bad_slot`.

To see it before you own it: the DEV "Unlock everything" switch (Crate opening tuner), then Collection → Card Plates →
Equip, then start a run.

## Batch 2026-10-15

Owner: *"in this folder will be where I provide all the custom backplates that you can unlock from opening chests.
you can ignore the Gilded and Standard one ... every other one should be a legendary reward unless explicitly specified"*
(`Reference Art/Card Backplates/`). Added **Amethyst Plate** (owner's name: "Amethyst" is taken by the Amethyst
portrait frame), **Bamboo**, **Beach**, **Magma** and **Moonstone**, all Legendary crate items. Each starts from
Aquarium Rocks' darkening (its own copy of the shape, so any one can be retuned alone). Legendary is now 46 items, each
9 / 46 = 0.196%. The Collection's category tabs are now four to a row (owner: "made each section wider and have 4
sections to a row").

## What shipped

- **Catalog** (`packages/progression/src/cosmetics.ts`): a `card_plate` category ("Card Plates", weight 10, enabled,
  target `global`) and `plate_aquarium_rocks` (Aquarium Rocks, Legendary, crate). New account-wide equip slot `card_plate`
  (`EQUIP_SLOTS`, `GLOBAL_EQUIP_SLOTS`), a `cardPlate` field on `RunCosmeticSnapshot` (loadout rows, `snapshotForRun`,
  `parseCosmeticSnapshot`) and the resolver `cardPlateOf`. Adding it moved the crate odds: Legendary is now 41 items, each
  9 / 41 = 0.22%.
- **SQL** (`supabase/migrations/2026-10-14-card-plates.sql`, appended to `schema.sql`): `equip_cosmetic` accepts the
  slot with target `''`. `cardPlates.db.test.ts` runs it in PGlite.
- **Recorded per run** (`packages/sim/src/snapshot.ts` `scopeCosmetics`, `lobby/snapshotSeats.ts` `runCosmetics`): every
  board keeps the plate and a seat unions it, like the portrait frame.
- **Rendering** (`packages/ui/src/cardPlate/cardPlateLook.ts`): `CARD_PLATE_LOOKS` maps a plate's art key to its two
  images and its darkening numbers. `MinionSkins` (your own scope and each foe's, through Show opponent cosmetics)
  provides the owner's plate as `CardPlateContext`; `Card.tsx` reads it and, on a plated card that is neither GILDED
  nor a Whisper, swaps the plate image, the `.descbox` image, and writes `--ctx-box-a / -blend / -y` inline so they beat
  the Card Text tuner's `:root` values for that card only. The standard plates and darkening are byte-for-byte unchanged.
- **Aquarium Rocks' darkening** (tuned live with the owner): the owner's own shape (`backplate darkening.png`),
  opacity 0.63 (0.55, then "another 15%"), blend multiply, seat `boxY -1.22595` (1.25 px lower than the standard seat at the 138 px enlarged card).
- **Art**: `apps/web/public/frames/plates/plate_aquarium_rocks.webp` (800x1244, the standard plate body) and
  `plate_aquarium_rocks-backbox.webp` (683x1230). Masters: `Reference Art/Test Plate - Aquarium Rocks.png` and
  `Reference Art/backplate darkening.png` on the owner's desktop.
- **Collection**: a Card Plates tab (the plate whole on its tile), Equip / "Use standard plate", and hovering an owned
  plate floats Cheap Date wearing it (the same owned-only rule as skins).

## Known gaps

- The shop buy dissolve traces the standard plate's outline (`cardplate-wire.webp`). Aquarium Rocks has the same body,
  so the edge is near-identical, not exact. A per-plate wire would need `scripts/build-plate-wire.mjs` run per plate.
- A Whisper keeps its own plate (its Set 4 identity). Flagged for the owner: say so if a worn plate should cover it too.

## Adding the NEXT card plate

1. Export the plate at 800x1244 (the standard plate body) to `apps/web/public/frames/plates/<id>.webp` and its text
   darkening to `<id>-backbox.webp`.
2. One line in `cosmetics.ts`: `cardPlate('plate_<id>', '<Name>', '<rarity>')`, and one entry in `SETTINGS` in
   `packages/ui/src/cardPlate/cardPlateLook.ts` (start from Aquarium Rocks' numbers, tune live with the Card Text tuner).
3. `npm run progression:shared`, update the pinned counts in `cosmetics.test.ts`, merge, deploy `progression-inventory`.
   No SQL (the slot exists). `cardPlate.test.tsx` fails if a plate has no look or its images are missing.
