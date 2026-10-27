# 2026-10-27: Card plates batch 7 (seven Legendary plates on Dark)

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

Names drop the word "Plate" from the filename, except The Last Plate, which reads oddly without it. The owner can rename any
of them; the ids stay.

## Counts

- Crate pool: Legendary 83, so each Legendary item's chance is 0.108%.
- Card plates are 13.6% of a first crate.
- 69 active plates; Collection total 375.
- Oracle: R-PROG-PLATE-06. Patch note added. Edge catalog regenerated.

## Deploy

After the merge, deploy `progression-inventory` from `main`. No SQL is needed. The plates reach players with the next web
release.
