# 2026-11-11: the Void becomes a cosmetic (attack_void, Legendary)

The Void attack merged dev-only (#2667) and shipped inside v0.2.9, where no player could see it: there was nothing to
equip. Mike on being told the catalog is Kevin's side: "doesnt need his go ahed. i can do it". He picked **Legendary**
and the name **Void**.

## What changed

- `packages/progression/src/cosmetics.ts`: `heroAttack('attack_void', 'Void', 'legendary', 'void')`, from crates like
  every other hero attack. The generated Supabase copy (`supabase/functions/_shared/progressionCosmetics.ts`) was
  regenerated with `npm run progression:shared`.
- The dev labels stopped saying "in progress, no cosmetic yet".
- Patch note, `GAME-RULES.md` and the oracle rule **R-PROG-ATTACK-38**.
- Tests: the Void's own cosmetic test, a Collection tile test (tile, preview, Equip sends `attack_void`), and the
  numbers the new item moves: Legendary count 102 to 103, each Legendary 0.088% to 0.087% of a first crate, hero
  attacks 2.8% to 2.9% of drops, the Attack Animations tab 24 to 25, the Collection total 544 to 545.

## Things to know

- **It reaches players in two steps.** The client needs a release (Ship Ascent). The database gets the item on the
  next deploy of `progression-inventory` (the catalog sync), same as Golazo and Charge the Mound. Until both happen
  nobody can drop or equip it.
- **Every other Legendary gets very slightly rarer** (9 / 102 to 9 / 103 of a first crate each). That is how every
  catalog addition works.
- **No Knockout variant.** It is a Legendary, so a knockout plays tier IV like the other Legendaries. The inherited
  "Tier V" code in `heroVoid/` is still dormant.
- **Still not profiled** on a prod build, and the look was never seen by the builder; Mike tuned it by eye.
- **Sound is still the placeholder** (Arcana's cues pitched down).
- `skinRarityFolders.test.ts` fails on Mike's machine and did before this change: it reads
  `C:/Game Assets/Ascent Art/Skins`, finds five images not wired as skins, and is skipped in CI where that folder does
  not exist. Not touched here.
