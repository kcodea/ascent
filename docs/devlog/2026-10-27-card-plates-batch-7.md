# 2026-10-27: Card plates batch 7 (sixteen plates on Dark)

The owner said: "ive added a bunch of card plates to the skins folder to add to the collection in their respecttive tiers. use
the dark card back for all of them". The new masters are in `C:\Game Assets\Ascent Art\Skins\Card Plates\Legendary`.
All seven are Legendary. Each sits on the **Dark** interior with no text darkening.

`Plushie Plate.png`, at the folder's top level, is left out. It is planned as the reward for collecting every Plushie Beast.

Each plate was built with:
- `npm run plates:build -- --id <id> --frame <master> --interior dark --fit`, which gives the interior fit;
- then `--interior-sx/-sy/-y` to build the Collection image.

The masters are drawn on the standard template (1006x1563, aspect 1.555), so no `artScale` is needed. `frameX` centres each
opening where Galaxy's sits. Openings measured within 4% of Galaxy's width.

| Plate | Master | frameX | Sx | Sy | Y |
| --- | --- | --- | --- | --- | --- |
| Burden | Burden Plate.png | 0.005 | 1.043 | 1.01 | 0.0038 |
| Divine | Divine Plate.png | 0.006 | 1.026 | 0.997 | 0.0075 |
| Mytho | Mytho Plate.png | 0.006 | 1.022 | 1.008 | 0 |
| Plasma | Plasma Plate.png | 0.004 | 1.087 | 1 | 0.0075 |
| Shotsun | Shotsun Plate.png | 0.005 | 1.039 | 1.005 | 0.0009 |
| The Last Plate | The Last Plate.png | 0.005 | 1.051 | 1.02 | -0.0094 |
| Wither | Wither Plate.png | 0.01 | 1.051 | 1.009 | -0.0028 |

Then the owner said "ok i added them all": nine more, rarity from the folder, also on Dark. Same build, and all on the
standard template (openings within 1.2% of Galaxy's):

| Plate | Rarity | frameX | Sx | Sy | Y |
| --- | --- | --- | --- | --- | --- |
| Gryphon | Rare | 0.006 | 1.04 | 1.018 | 0 |
| Huffle | Rare | 0.005 | 1.044 | 1.024 | -0.0019 |
| Raven | Rare | 0.005 | 1.04 | 1.017 | -0.0066 |
| Slyther | Rare | 0.005 | 1.04 | 1.016 | 0 |
| Elder | Epic | 0.005 | 1.054 | 1.022 | 0.0038 |
| Nimbus 2K | Epic | 0.006 | 1.06 | 1.025 | -0.0028 |
| Tattle | Epic | 0.005 | 1.047 | 1.025 | 0.0009 |
| Trichalice | Epic | 0.004 | 1.055 | 1.026 | -0.0028 |
| Gjally | Ancient | 0.006 | 1.051 | 1.026 | -0.0019 |

Names drop the word "Plate" from the filename, except The Last Plate, which reads oddly without it. The owner can rename any
of them; the ids stay.

## Counts

- Crate pool: Common 45, Rare 90, Epic 88, Legendary 83, Ancient 29. Each item's chance: Rare 0.344%, Epic 0.25%,
  Legendary 0.108%, Ancient 0.103%.
- Card plates are 15.6% of a first crate.
- 78 active plates; Collection total 384.
- Oracle: R-PROG-PLATE-06. Patch note added. Edge catalog regenerated.

## Deploy

After the merge, deploy `progression-inventory` from `main`. No SQL is needed. The plates reach players with the next web
release.
