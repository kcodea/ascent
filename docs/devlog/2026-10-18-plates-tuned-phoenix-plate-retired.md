# 2026-10-18 — The owner's plate tuning ships; Phoenix Plate retired

Owner (2026-10-18): *"ok i went through and edited all the plates and frames. i couldnt make phoenix plate work, so lets
remove that card plate for now. lets save the changes and merge them for the remaining ones"*.

## OWNER RUNBOOK (after this PR merges)

1. **Deploy the function from `main`**, then send it one request so the catalog syncs:
   `npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza`.
   Until then the SERVER still has Phoenix Plate active and can drop it from crates.
2. A new web zip (`npm run release:web`) to put the tuned plates in players' hands.

## What shipped

- **Sixteen plates tuned in the Card Plate Editor** (`packages/ui/src/cardPlate/plate-tuning.json`): Astral Relic, Blood
  Omen, Blossom, Emerald, Ethereal, Gilt Etched, Goop, Honey, Mooncloud, Mystic Obsidian, Porcelain, Round Magic, Smooth
  Aqua, Spirit Carving, Stonevines, Verdant Magic. Their Collection pictures were rebuilt by the editor's Save.
- **Phoenix Plate retired**, not deleted: it had reached the live catalog (verified: active), so a player may own it. It is
  an `active: false` row like Sad Wrangler: never drops again, owners keep the row, the Collection hides it, and a
  snapshot wearing it falls back to the standard plates. Its art and look stay in the client for when it returns.
- Pins: Legendary 65 crate items (0.138% each), Card Plates 9.9% of a crate, Collection totals -1. The editor's live-edit
  test moved from Porcelain (now tuned) to Topaz (untuned, drawn at 1x).
