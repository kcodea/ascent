# 2026-10-19 — Card plate rarity pass

Owner (2026-10-19): *"make the following card plates rare: all of the hand drawn plates, all of the smooth plates, beach
magma and bamboo and aquarium rocks, amethyst. make the following card plates epic: iridescent and smooth iridescent,
galaxy, chrome, topaz, crackling gemstone, carved aetherstone, honey, goop, white magic, runic. make the following card
plates ancient: Frozen aurora, the howl, nano"*.

Smooth Iridescent is in both "all of the smooth plates" and the Epic list; the explicit Epic wins.

## OWNER RUNBOOK (after this PR merges)

1. **Deploy the function from `main`** and send it one request so the live catalog takes the new rarities:
   `npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza`
2. A web zip (the Collection shows each plate's rarity from the bundled catalog).

## Result

| Rarity | Plates | Crate items in the rarity | Each item |
|---|---|---|---|
| Rare | 15 | 68 | 0.456% |
| Epic | 15 | 70 | 0.314% |
| Legendary | 25 | 70 | 0.129% |
| Ancient | 7 | 28 | 0.107% |

Card Plates rise from 11.4% to 15.5% of all crate drops, mostly from the fifteen Rare plates. `cardPlates.db.test.ts`
now pins every active plate's rarity from one `PLATE_RARITY` table instead of three nested lists.
