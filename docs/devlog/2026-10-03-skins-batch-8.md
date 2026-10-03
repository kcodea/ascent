# 2026-10-03 — Skins batch 8 + portrait frames batch 7: 11 hero skins, 7 frames, two skins up to Ancient

Owner: "ive also added many skins to the game's collections. can you add those all in". The two local disk checks
(`skinRarityFolders.test.ts`, `portraitFrameRarityFolders.test.ts`) listed what was unwired. The folder is the rarity.

## Hero skins (11, via `npm run art:wire -- --only=skins --apply`)

| id | name | rarity | hero |
| --- | --- | --- | --- |
| skin_hermithank_1 | Young Tradesman | Rare | hermithank (Tradesman) |
| skin_quillen_1 | Author Quillen | Legendary | quillen |
| skin_rayse_1 | Goth Rayse | Legendary | rayse |
| skin_risen_1 | Lord of Death | Legendary | risen (Lord of the Risen) |
| skin_midas_1 | Midas and Melon | Legendary | midas |
| skin_myra_1 | Auctioneer Sweeney | Ancient | myra (Auctioneer) |
| skin_nadja_1 | Goth Nadja | Ancient | nadja |
| skin_risen_2 | Lord Callen | Ancient | risen |
| skin_merrin_2 | Merrin Sweeney | Ancient | merrin |
| skin_nadja_2 | Nadja Sweeney | Ancient | nadja |
| skin_rayse_2 | Rayse Sweeney | Ancient | rayse |

- **LordOfDeath and LordCallen are Lord of the Risen**, decided from the art: both wear his spiked crown with the blue
  gem, his purple-and-gold pauldrons with skulls, and his blue-flame greatsword. Lord Callen is the living man; Lord of
  Death is the undead form with green flame.
- `Midas and Melon.png` has spaces in its name. `art:wire` normalises them away; the skins test's master regex now
  allows spaces.
- The art pass re-encoded every existing skin webp; those were reverted, so only the 11 new webps ship.

## Rarity moves

`skin_darah_1` (Leg Day Darah, `DarahSkinEpic.png`) and `skin_hunch_1` (Dance Night Hunch, `HunchSkinRare.png`) go
Legendary to Ancient: the owner moved both masters into `Hero Skins/Ancient/`. Owners keep them
(`player_cosmetics` has no rarity; the sync never deletes a row).

## Portrait frames (7, via `npm run art:frames -- --apply`)

Cream, Crystal, Disco, Econ, Snare (Epic), Chromatic Scale (Legendary, `frame_chromatic_dragonscale`; the bare
"Chromatic Dragonscale" is 21 characters, so it is named by look like Dark Scale and Gilt Scale), Reflective
(Ancient). All seven holes are ordinary (0.739 to 0.801, centred).

- **Re-exported frames.** The pass also picked up the owner's re-exports (saved after #1903 shipped) of Bonds, Death,
  Fortune, Genesis, War and Gilt Scale: thinner rings, and Genesis's leaf crescent now curls along the bottom. Bonds
  (0.715) and Death (0.625 at y 0.457) no longer need allowances. Genesis is centred left-right (x 0.480) but its hole
  sits high (y 0.390), so its by-name allowance moved from x to y in `portraitFrameCosmetic.test.tsx`.
- **Still skipped: DragonGem and ElectricBlue.** `Epic/DragonGem.png` and `Epic/ElectricBlue.png` are still
  byte-identical (md5) to `CracklingRuby.png` and `BlueEnergy.png`. The disk check's "every master is wired" case lists
  those two and nothing else. The owner should delete them or re-export them as new art.

## Counts

- Crate pool: Common 38, Rare 40, Epic 44, Legendary 37, Ancient 21. Per item: Common 0.921%, Rare 0.775%, Epic 0.5%,
  Legendary 0.243%, Ancient 0.143%. Each Ancient item is rarer than each Legendary one again.
- Category shares of a first crate: titles 11.6%, minion skins 36.7%, hero skins 16.5%, hero attacks 7.6%, frames 27.6%.
- 91 skins (57 minion, 34 hero). 52 frames (10 / 8 / 18 / 9 / 7). Collection total 217. Art budget 1423.
- Oracle: new R-PROG-SKINS-14; R-PROG-SKINS-11, R-PROG-FRAME-01, R-PROG-FRAME-04 and R-PROG-RARITY-01 updated.

## Deploy

Redeploy `progression-inventory` after merge. The catalog sync adds the 18 items and moves the two rarities. No SQL:
the Ancient rarity check is already live.
