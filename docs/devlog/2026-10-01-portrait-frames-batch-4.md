# 2026-10-01 — Portrait frames batch 4: five Epic rings, three moved to Legendary, bare names

Mike asked how to add more frames, and said he had no rarity folders, only the files: "i dont have those folders. i
just have each name". The art masters live on Kevin's machine (`C:/Game Assets/Ascent Art/Skins/Portraits`). Mike's are
loose PNGs in `Desktop/Reference Art`.

## What shipped

- **`npm run art:frames -- --src <dir>`** (`packages/tools/src/wire-portrait-frames.ts`). It reads masters from any
  folder: first `<dir>/<Rarity>/<file>`, then a loose file in `<dir>` matched ignoring spaces and case
  (`Epic/BlueEnergyFrame.png` finds `Blue Energy Frame.png`). It now MERGES into `frameSkins.data.json`: a frame
  whose master is not found keeps its existing webp and geometry. Before this, a run without every master wiped the
  missing frames' measurements, so only the machine holding all of them could wire a batch.
- **Five new Epic frames.** Multichrome Energy, Blue Energy, Crackling Ruby, Topaz and Jade. Mike first said "These
  are all rare", then: "the other ones should be Epic, not rare". Six of the eleven files he listed had already
  been wired by Kevin in #1897 (Ruby, Dark Scale, Gilt Scale, Dark Cloud, Venom, Wedding). I compared them
  pixel-for-pixel against the shipped webps before skipping them. Crackling Ruby is a different ring from Ruby.
- **Three rarity moves** (owner: "Lets make Obsidian Venom and Dark Cloud legendary as well as Gold Dragonscale"):
  Gilt Scale goes from Common to Legendary, and Dark Cloud and Venom go from Epic to Legendary. Their `assets.master`
  now points into `Legendary/`.
- **Bare names** (owner: "lets remove portrait and or frame from all names in the title"). All 36 frames drop the
  " Frame" suffix: "Honey", "Gilded", "Fire". The medal-word ban still applies (Gilt Scale stays Gilt Scale).
- Counts: 36 frames (6 Common, 8 Rare, 14 Epic, 8 Legendary). The crate pool is 34 / 39 / 40 / 38 (Common 1.471%,
  Rare 0.769%, Epic 0.375%, Legendary 0.132% per item). Oracle R-PROG-FRAME-01 and -04, GAME-RULES, the SQL comment
  and a patch note were updated.

## Follow-ups for Kevin's art folder

`portraitFrameRarityFolders.test.ts`'s disk half runs only where `C:/Game Assets/.../Portraits` exists, so CI and
Mike's machine skip it. On Kevin's machine it will fail until the folders match the catalog:
- move `GoldenDragonscale.png` from Common/ to Legendary/;
- move `DarkCloudPortrait.png` and `VenomPortrait.png` from Epic/ to Legendary/;
- add Mike's five masters to Epic/ under the catalog names `MultichromeEnergyPortrait.png`, `BlueEnergyFrame.png`,
  `CracklingRubyFrame.png`, `TopazFrame.png` and `JadeFrame.png`.

## Deploy

Redeploy `progression-inventory`. The catalog sync adds the five frames and updates the three rarities and every
name. No SQL needs to run.
