# 2026-10-07 — Skins batch 9: Canyon Drake and Thunderchorus Drake (Chorus Drake)

The owner said "yes add the new art to the catalog". Two minion skin masters were waiting, unwired, in
`C:/Game Assets/Ascent Art/Skins/Minion Skins/Rare/`. Until they were in the catalog, `skinRarityFolders.test.ts`
failed on the owner's machine ("every image in a rarity folder is wired", R-PROG-SKINS-11).

## What changed

- **Two Rare minion skins**, both for **Chorus Drake** (`d2_chorus`, a Tier 3 Dragon):
  - Canyon Drake (`skin_chorus_2`), master `Rare/Canyon Drake.png`
  - Thunderchorus Drake (`skin_chorus_3`), master `Rare/Thunderchorus Drake.png`
- **How the target was picked.** The names say only "Drake", and several Dragons are drakes. The art settles it.
  Both masters repaint Chorus Drake's own card art: the same three stacked heads singing upward, the same ring of
  music notes, the same diamond gem on the chest and the same pose on a stone ledge. Canyon Drake is a sandstone
  canyon version and Thunderchorus Drake a storm-blue lightning version. Chorus Drake already had Quartet
  Chorusdrake (`skin_chorus_1`), so these are its second and third skins.
- **Rarity** is the folder the masters sit in: Rare for both (R-PROG-SKINS-11). Names come from the filenames.
- **Art:** `npm run art:wire -- --only=skins --apply` wrote `packages/ui/src/art/skins/skin_chorus_2.webp` and
  `skin_chorus_3.webp` (512px). The gitignored PNG copies the job leaves were deleted.

## Counts

- Crate pool: Common 38, Rare 42, Epic 45, Legendary 37, Ancient 21. Per item: Common 0.921%, Rare 0.738% (was
  0.775%), Epic 0.489%, Legendary 0.243%, Ancient 0.143%.
- Category shares of a first crate: titles 11.4%, minion skins 37.4%, hero skins 16.2%, hero attacks 7.4%,
  frames 27.6%.
- 93 skins (59 minion, 34 hero). Collection total 220 (the Minions tab is 59).
- Oracle: new R-PROG-SKINS-15; R-PROG-SKINS-11 gets the owner's words for this batch. Patch note added. Edge catalog
  regenerated (`npm run progression:shared`).

## Deploy

After merge, deploy `progression-inventory` from an up-to-date `main`. The catalog sync adds the two skins. No SQL
needs to run:

```
npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza
```
