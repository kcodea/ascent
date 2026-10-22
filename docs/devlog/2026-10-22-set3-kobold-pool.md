# 2026-10-22: Set 3 Kobold pool (Kobe + Blazer out, Shardluck + Delver + Cavern Fiend back, Dealski + Prismatic Pick reworks)

Owner content changes for the Set 3 Kobolds.

| Card | Old | New |
| --- | --- | --- |
| Kobe | Set 2 + Set 3 | out of Set 3, still Set 2 |
| Blazer | Set 2 + Set 3 | out of Set 3, still Set 2 |
| Shardluck (`k3_facetbound`) | archived 2026-10-13 | buyable Set 3 T6 8/5, unchanged |
| Delver (`k3_veinchant`) | archived 2026-10-13 | buyable Set 3 T2 4/3, unchanged |
| Cavern Fiend (`k_gemgorge`, the old Gemgorge Fiend) | archived from every set 2026-10-10 | buyable Set 3 T6 6/6 Kobold/Demon, unchanged; Set 2 does not regain it |
| Dealski | Choose One played: get 2 Rubies (Gilded 4) | get a random Ruby (Gilded 2) |
| Prismatic Pick | Discover a Ruby (Gilded twice) or Both charge | Discover 2 Rubies (Gilded 4) or Both charge |

## How

- "Archive" = leave Set 3 (the #2201 convention): Kobe and Blazer drop from `SET2_KOBOLDS_IN_SET3`; Set 2 keeps both.
- The three restored defs moved verbatim from `cards/archive.ts` to the END of `cards/set3/kobolds.ts` (appended, so
  every earlier Set 3 Kobold keeps its position). Cavern Fiend is now a Set 3 card only. Its Demon second tribe is
  kept; Set 3 fields no Demon tribe, so it plays as a Kobold. Delver and Shardluck name Veinstorm, which left the Set 3
  shop on 2026-10-13; they grant or cast it by id through `CARD_INDEX`, which works in any set (not re-added to the shop).
- Dealski: `getRubies` (count 2) to `getRandomRubies` (count 1), the Ruby Shipment body (all six types, run cursor).
  Policy `factory:getRubies:chooseOnePlayed` replaced by `factory:getRandomRubies:chooseOnePlayed`.
- Prismatic Pick: Ruby branch `discoverRuby` count 1 to 2 (Gilded 2 to 4): two queued Discovers. The pool is
  `SPECIAL_RUBY_IDS` (owner ruling the same day: a Ruby Discover never offers the plain Ruby; it already did not, now
  pinned across seeds). The Both branch is unchanged: the shared `chooseBothCharges` channel, spent through
  `spendChooseBothCharge`, so the both-effects presentation (being remade on `fx/choose-both-remake`) fires through the
  same path. "this turn" stays printed because the charge still clears at the turn boundary.
- Live text: `equipmentText` takes `chooseBothCharges` and appends `(N armed)` for an Equipment whose Choose One can arm
  a charge; the Status Bar slot passes the run's count.
- Oracle: R-KOBOLD-1022-01 (triggers), R-RAND-RUBY-DISCOVER-01 (randomness). Patch note in the 2026-10-22 block.
  `docbot:sync` regenerated; final-report contract total 1123 to 1126; balance aggregate snapshot regenerated. The text-parse unresolved pin moves 152 to 153 for Shardluck (its Choose One has no grammar rule yet).

## Verification

`packages/sim/src/set3KoboldPool1022.test.ts` (pool membership, old Set 3 save with Kobe + Blazer through a sale,
snapshot and a deterministic combat replay, Delver's Echo in a Set 3 fight, Cavern Fiend consuming in a Set 3 run,
Dealski seeded random across six types, Pick two Discovers with no plain Ruby across 40 seeds, Gilded four, the Both
charge resolving Jewel's two branches and being spent, the armed text). Re-pinned: prismaticPick, rubyTypes,
radRachel, koboldCelestialDwarf0924, set3Scaffold, set3Batch1013.
