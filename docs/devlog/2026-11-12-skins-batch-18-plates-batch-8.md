# Skins batch 18 and card plates batch 8: the 8 Bit set (2026-11-12)

Owner: "i added more minion and card plate cosmetics".

## Minion skins (9)

| Skin | Minion | Card id | Rarity | Master |
|---|---|---|---|---|
| Storybook Beggy | Beggy | k_beggy | Common | Storybook Beggy.png |
| Graffiti Scrapper | Scrapper | k_faultline | Rare | Graffiti Scrapper.png |
| 8 Bit Beggy | Beggy | k_beggy | Epic | 8 bit Beggy.png |
| 8 Bit Dawnclaw | Dawnclaw | b2_dawnclaw | Epic | 8 Bit Dawnclaw.png |
| 8 Bit Orin | Oathshield Orin | dw_orin | Epic | 8 Bit Orin.png |
| Blown Glass Yazzus | Yazzus | yazzus | Epic | Blown Glass Yazzus.png |
| Retro Boulderdash | Boulderdash | k_boulderdash | Epic | Retro Game Boulderdash.png |
| 8 Bit Echohorn | Echohorn | b2_echohorn | Legendary | 8 Bit Echohorn.png |
| 8 Bit Sylus | Sylus | sylus | Legendary | 8 Bit Sylus.png |

Beggy and Scrapper get their first skins. One buyable Set 2 minion still has none: Auric Runemaster.

## Card plates (7), on Dark

Built like batch 7: `npm run plates:build -- --id <id> --frame <master> --interior dark --fit`, then the Collection image
from the fit. All on the standard template. `frameX` centres each opening where Galaxy's sits.

| Plate | Rarity | Master | frameX | Sx | Sy | Y | Opening vs Galaxy |
|---|---|---|---|---|---|---|---|
| 8 Bit Storm | Common | 8 Bit Storm.png | 0.006 | 1.028 | 0.991 | 0.0188 | 0.972 |
| 8 Bit Flame | Rare | 8 Bit Flame.png | 0.013 | 1.018 | 0.982 | 0.0253 | 0.958 |
| 8 Bit Void | Rare | 8 Bit Void.png | 0.012 | 1.011 | 0.993 | 0.0225 | 0.953 |
| 8 Bit Arcane | Epic | 8 Bit Arcane.png | 0.007 | 1.011 | 0.987 | 0.0169 | 0.958 |
| 8 Bit Earth | Epic | 8 Bit Earth.png | 0.017 | 1.026 | 1.006 | 0.0281 | 0.942 |
| 8 Bit Frost | Epic | 8 Bit Frost.png | 0.005 | 1.004 | 0.992 | 0.0328 | 0.951 |
| 8 Bit Standard | Legendary | 8 Bit Standard Plate.png | 0.009 | 1.026 | 0.999 | 0.0169 | 0.973 |

## Calls for the owner to confirm

- **Dark interior.** No interior was named; Dark carries over from batch 7 ("use the dark card back for all of them").
- **Seats are the script's fit, untuned.** The openings are 3% to 6% narrower than Galaxy's and no `artScale` is set, so
  check them in the Card Plate Editor.
- **Names.** `8 bit Beggy.png` ships as 8 Bit Beggy, `Retro Game Boulderdash.png` as Retro Boulderdash (20 characters max),
  `8 Bit Standard Plate.png` as 8 Bit Standard.
- **8 Bit Storm is the first Common card plate.** A Card Plates focus can now roll Common; `CrateShop.test.tsx` uses
  Emotes as its "no Common" example instead.

## What moved

A first crate holds 92 Common, 145 Rare, 140 Epic, 106 Legendary and 33 Ancient items (each Common 0.38%, Rare 0.214%,
Epic 0.157%, Legendary 0.085%, Ancient 0.091%). Card plates are 11.9% of a first crate (was 10.8%). 85 active plates; the
Minions tab holds 262 skins; the Collection total is 565. Rules R-PROG-SKINS-26 and R-PROG-PLATE-07.

## Deploy

After the merge, deploy `progression-inventory` from `main`. No SQL. The art reaches players with the next release.
