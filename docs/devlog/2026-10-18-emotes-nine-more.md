# Nine more crate emotes (2026-10-18)

Owner: "add the emote cosmetics i added".

## What changed

- **Catalog** (`packages/progression/src/cosmetics.ts`, `_shared/progressionCosmetics.ts` regenerated with
  `npm run progression:shared`): nine new emotes, all `acquisition: crate` (Zen Brian stays the one starter; no
  grandfathering). Proposed spread, same rule as 2026-10-15 (one face = Rare, a gesture or small scene = Epic, the
  busiest = Legendary):
  - Rare (4): Chronos Mad, Rascal Broke, Skeleton Wave, Pup Pup.
  - Epic (3): Gambler, Sexy Darah, Angry Deathswarmer.
  - Legendary (2): Dan the Man, Iggy.
  - Totals now 8 Rare / 7 Epic / 5 Legendary crate emotes (20) + Zen Brian. Crate maths: Rare 53 -> 57, Epic 66 -> 69,
    Legendary 64 -> 66; emotes are 7.3% of a first crate.
- **Names** come from the filenames; the `Emote` suffix on `DanTheManEmote.png`, `GamblerEmote.png` and
  `SexyDarahEmote.png` is dropped ("Dan the Man", "Gambler", "Sexy Darah"). `assets.master` keeps the real filename.
- **Art**: nine webps in `packages/ui/src/art/emotes/`, made the 2026-10-15 way (flood-fill key of the black border with
  a 1 px feather, keep the largest shape, trim, 512 px wide, webp q88). Real alpha, untouched: AngryDeathswarmer,
  PupPup. Keyed black: the other seven. **GamblerEmote.png** has a baked orange glow around the frame that runs to the
  canvas edge, so its glow (within ~70 px of the keyed black) fades to transparency by brightness instead of ending in a
  hard brown edge.
- Not wired: `EmoteTemplate.png` (the blank template), `SadWrangler.png` (retired 2026-10-15, stays retired). Angry
  Mushy has no file in the folder.
- Tests: `emotes.test.ts`, `emotes.db.test.ts`, `cosmetics.test.ts` (rarity counts, per-item and per-category odds),
  `CollectionScreen.test.tsx` / `CollectionSkins.test.tsx` (header totals +9), `artNoRedundantMasters.test.ts` (art
  budget 1465). Oracle R-PROG-EMOTE-01; GAME-RULES "Emotes"; patch note in the 2026-10-18 block.

## Server (owner)

1. Deploy `progression-inventory` (its catalog sync inserts the nine rows as crate items; no SQL needed, the
   acquisition check already allows `crate`), then trigger the sync with any authenticated POST to it (as before).
2. Fresh Netlify build after merge.
