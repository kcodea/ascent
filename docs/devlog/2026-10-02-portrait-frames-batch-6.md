# 2026-10-02 — Portrait frames batch 6: Cherry Blossom, six rarity moves, Mike's rarities win

Kevin said "i added more frames, please put them in the game". The local disk check
`portraitFrameRarityFolders.test.ts` found new PNGs and seven frames sitting in a different rarity folder from their
catalog rarity.

## What changed

- **One new frame:** Cherry Blossom (Epic, `frame_cherry_blossom`). Its hole is centred and normal-sized (0.753).
- **The Ancient frames are not in this batch.** Bonds, Fortune, Genesis, Time and War first sat in Legendary/. Partway
  through, the owner moved them, with a new Death, into a new `Portraits/Ancient/` folder for a new "Ancient" rarity.
  Another branch, stacked on this one, builds that rarity and wires the six. The disk check only reads the four
  existing rarity folders, so it does not flag Ancient/ yet. Two measurements for that branch: Bonds has a small
  centred hole (0.594, under the usual 0.6 floor), and Genesis is a crescent whose hole sits right of centre (x 0.609,
  past the usual 0.05). Both will need a by-name allowance in `portraitFrameCosmetic.test.tsx`, the same way Wedding
  and Simple Ring have one.
- **Rarity follows the folder, except where Mike set it** (owner: "use mike's setting if he has any frame rarities
  set"). Mike's #1898 settings are Multichrome Energy, Blue Energy, Crackling Ruby, Topaz and Jade as Epic, and Gilt
  Scale, Dark Cloud and Venom as Legendary.
  - Burnished, Sterling, Gilded and Seaglass go from Rare to Common, and Shard and Prism go from Epic to Rare. Mike
    never set these, so they follow Kevin's folders.
  - Blue Energy stays Epic. Kevin had moved `BlueEnergy.png` into Rare/, so it was **moved back** to `Epic/`. That is
    the one file move in this batch. Mike's other seven frames were already in his folders.
- **Owned frames stay owned.** `player_cosmetics` is keyed by `(user_id, cosmetic_id)` and has no rarity column.
  `sync_cosmetic_catalog` only upserts `cosmetic_catalog` rows and never deletes one. A rarity change moves the crate
  odds and the shown rarity, and nothing else. Skins work the same way (R-PROG-SKINS-11).
- **Counts:** 39 frames (10 Common, 8 Rare, 13 Epic, 8 Legendary). The crate pool is 38 / 39 / 39 / 38, so the
  per-item odds are Common 1.316%, Rare 0.769%, Epic 0.385% and Legendary 0.132%. Frames are 25.4% of a crate, and
  the Collection total is 190.
- **Also updated:** oracle R-PROG-FRAME-01 and -04, GAME-RULES, the SQL comment, the art budget (1399) and the
  2026-10-02 patch note. The Edge catalog was regenerated.

## Not wired: the same two duplicates as batch 5

`Epic/DragonGem.png` is still byte-identical to `CracklingRuby.png`, and `Epic/ElectricBlue.png` to `BlueEnergy.png`.
The disk check's "every master is wired" case still fails on those two files and nothing else. The owner still has to
choose one of these:
- move or delete the two extra copies; or
- re-export them if they were meant to be different art.

## Deploy

Redeploy `progression-inventory`. The catalog sync adds Cherry Blossom and updates the six rarities. No SQL needs to
run.
