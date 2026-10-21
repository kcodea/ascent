# 2026-10-21: Cosmetics batch (skins batch 10)

The owner said "i added various skins/collections items. can you find them and wire them up?". An inventory of every
cosmetic art folder against the catalog found fourteen new skins and nothing else new.

## Inventory

| Type | Where on disk | Result |
| --- | --- | --- |
| Hero skins | `Skins/Hero Skins/<Rarity>/` | 7 unwired, all wired now |
| Minion skins | `Skins/Minion Skins/<Rarity>/` | 7 unwired, all wired now |
| Spell skins | `Skins/Spell Skins/` | empty |
| Portrait frames | `Skins/Portraits/<Rarity>/` | nothing new. `Epic/DragonGem.png` and `Epic/ElectricBlue.png` are still byte-identical to `CracklingRuby.png` and `BlueEnergy.png` (skipped since 2026-10-01) |
| Emotes | `Emotes/` | every file is in the catalog (`EmoteTemplate.png` aside; Sad Wrangler stays retired) |
| Card plates | not on this machine (Mike's `Reference Art/Card Backplates`) | not checked |
| Chests | `Collection Stuff/` | the 2026-09-28 Standard chest, already in |
| Rank frames, avatars, boards | `Ranked Rewards/`, `Player Avatars/`, `Game Boards/` | nothing newer than what shipped |

## What changed

Rarity = the folder each master sits in (R-PROG-SKINS-11). Names are the filenames, humanized. Art via
`npm run art:wire -- --only=skins --apply` (512px WebP in `packages/ui/src/art/skins/`). The job also re-encodes every
existing skin and leaves gitignored PNG copies; the re-encodes were reverted and the PNGs deleted, so only the 14 new
webps ship.

| Id | Name | Rarity | Target | Master |
| --- | --- | --- | --- | --- |
| skin_midas_2 | Golf Midas | Rare | Midas (hero) | Hero Skins/Rare/GolfMidas.png |
| skin_midas_3 | Morning Midas | Rare | Midas (hero) | Hero Skins/Rare/MorningMidas.png |
| skin_midas_4 | Amputee Midas | Epic | Midas (hero) | Hero Skins/Epic/AmputeeMidas.png |
| skin_midas_5 | Mac and Melon Midas | Epic | Midas (hero) | Hero Skins/Epic/MacandMelonMidas.png |
| skin_runesmith_1 | Birthday Runesmith | Epic | Runesmith (hero) | Hero Skins/Epic/BirthdayRunesmith.png |
| skin_robin_3 | Gambling Robin | Epic | Robin (hero) | Hero Skins/Epic/GamblingRobin.png |
| skin_membrance_1 | Memory Membrance | Epic | Membrance (hero) | Hero Skins/Epic/MemoryMembrance.png |
| skin_anvilshade_1 | Anvilshade | Rare | Anvilshade (dw_anvilshade) | Minion Skins/Rare/Anvilshade.png |
| skin_bellringer_2 | Liberty Voss | Rare | Bellringer Voss (n2_bellringer) | Minion Skins/Rare/LibertyVoss.png |
| skin_radrachel_1 | Metal Rachel | Rare | Rad Rachel (dm_radrachel) | Minion Skins/Rare/MetalRachel.png |
| skin_scalefeather_1 | Mushy Pee | Rare | Mushy (d2_scalefeather) | Minion Skins/Rare/MushyPee.png |
| skin_scalefeather_2 | Cosmic Mushy | Epic | Mushy (d2_scalefeather) | Minion Skins/Epic/CosmicMushy.png |
| skin_kennel_1 | Gilded Kennelmaster | Epic | Kennelmaster (kennel) | Minion Skins/Epic/GoldenKennelmaster.png |
| skin_jenkins_2 | Jensen & Fi Sky | Epic | Jensen & Fi (jenkins) | Minion Skins/Epic/JensenFiSky.png |

- **Mac and Melon Midas is new art**, not a re-export of Midas and Melon (Legendary): this one is Midas on a couch
  with a cat and a dog, the old one is Midas mowing the lawn.
- **Gilded Kennelmaster** is a placeholder. The filename says Golden, but item names may not use the ranked medal
  words (the player-text test in `cosmetics.test.ts`), and "golden" is also the tripled-card word. Owner to rename.
- **Portrait frame disk check.** `portraitFrameRarityFolders.test.ts` failed on this machine since 2026-10-01 because of
  the two byte-identical frame copies. It now skips a file whose bytes equal a wired master, so it passes, and it
  still fails the moment either is re-exported as different art.

## Counts

- Crate pool: Common 38, Rare 74, Epic 78, Legendary 70, Ancient 28. Per item: Rare 0.419% (was 0.456%), Epic
  0.282% (was 0.314%).
- Category shares: titles 9.2%, minion skins 30.2%, hero skins 14%, hero attacks 4.2%, frames 21.5%, announcers 0.4%,
  card plates 14.5%, emotes 6%.
- 108 skins. Collection total 332 (Heroes tab 41, Minions tab 67). Art budget re-pinned to < 1483 (measured 1482).
- Oracle: new R-PROG-SKINS-18. Patch note. Edge catalog regenerated (`npm run progression:shared`).

## Deploy

After merge, deploy `progression-inventory` from an up-to-date `main`. The catalog sync adds the fourteen skins on
its first request. No SQL needs to run:

```
npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza
```
