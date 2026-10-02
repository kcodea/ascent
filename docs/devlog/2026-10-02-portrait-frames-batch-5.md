# 2026-10-02 — Portrait frames batch 5: Kevin's folders brought in line with batch 4, two new Rare frames

Kevin said "added more skins". The local disk check `portraitFrameRarityFolders.test.ts` failed: his rarity folders
disagreed with Mike's batch 4 (#1898), and nine PNGs were unwired. Owner ruling: where the two disagree, **Mike's
rarities win**. No #1898 rarity changed; the folders were made to match the catalog instead.

## What changed

- **Kevin's copies of the five batch 4 frames.** `Multichrome.png`, `BlueEnergy.png`, `CracklingRuby.png`, `Topaz.png`
  and `Jade.png` are Mike's frames under Kevin's filenames. Each one, re-encoded the way `art:frames` does, is
  byte-identical to the shipped webp. The three that sat elsewhere (Multichrome in Legendary/, BlueEnergy and
  CracklingRuby in Rare/) moved into Epic/. All five `assets.master` paths now point at Kevin's filenames.
  Re-wiring from Mike's loose files ("Blue Energy Frame.png") would now need them renamed to match.
- **The three batch 4 rarity moves on disk.** `GoldenDragonscale.png` (from Common/), `DarkCloudPortrait.png` and
  `VenomPortrait.png` (from Epic/) moved into Legendary/, where the catalog already pointed.
- **Two new Rare frames**, with bare names: Simple Ring (`frame_simple_ring`) and Void (`frame_void`). Void is also
  the name of an archived hero. Simple Ring is a gold ring with a diamond on top, so its hole sits low and is small
  (centre y 0.563, diameter 0.596). The centring check now allows it by name, like Wedding.
- Counts: 38 frames (6 Common, 10 Rare, 14 Epic, 8 Legendary). The crate pool is 34 / 41 / 40 / 38 (Rare now 0.732%
  per item; the others are unchanged). Collection total 189. Oracle R-PROG-FRAME-01 and -04, GAME-RULES, the SQL
  comment, the art budget and a patch note were updated. The skins disk check found no unwired skins.

## Not wired: two duplicates (owner call)

`Epic/DragonGem.png` is byte-identical (same md5) to `CracklingRuby.png`, and `Epic/ElectricBlue.png` to
`BlueEnergy.png`. Wiring them would sell the same art twice under two names, so they were left unwired, and the disk
check's "every master is wired" case still fails on those two files. The owner picks one:
- move or delete the two extra copies out of the rarity folders; or
- if DragonGem and ElectricBlue were meant to be different art, re-export them and they wire as new Epic frames.

## Deploy

Redeploy `progression-inventory`. The catalog sync adds the two frames. No SQL needs to run.
