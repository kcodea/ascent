# 2026-09-29 — Crates: every item of the rolled rarity is equally likely

Owner, asked whether each item within a rarity should have an equal chance (so the 8 Legendary hero attacks are not
outweighed by the 2 Legendary minion skins' category weight): "yeah equal chance". Follows
`2026-09-29-crate-fixed-rarity-odds.md` (#1820). Rules: `docs/GAME-RULES.md` "Account Level" (Opening); oracle
**R-PROG-CRATE-03** (reworded, third owner quote added).

## What changed

- **Inside the rolled rarity, every eligible item has the same chance.** The draw's place inside the rarity's band
  indexes that rarity's items in id order (`pickCrateReward`, `progression_crate_pick`). Was: weighted by category
  weight (roll version 2).
- **Unchanged:** the fixed 50 / 30 / 15 / 5 rarity roll, one `random()` per opening, the nearest-rarity fallback (ties
  toward the more common rarity), no duplicates, the locks, `already_opened`, `admin_off`, `pool_exhausted`.
- **Roll version 3** (`CRATE_ROLL_VERSION` / `c_roll_version`).
- **Category weights stay in the catalog** (`COSMETIC_CATEGORY_DEFS[*].weight`, `cosmetic_categories.weight`, and
  `progression_crate_pool` still returns them) but the roll no longer reads them. Kept for later. The TS helpers
  `crateWeightOf` / `crateTotalWeight` were removed (only the roll used them).
- **SQL:** `supabase/migrations/2026-09-29-crate-uniform-within-rarity.sql` (also appended to `schema.sql`) replaces
  `progression_crate_pick` and `open_crate` and re-grants them (service role only). The pool is unchanged.
- **Patch note:** the existing 2026-09-29 odds note gains "Every item of the rolled rarity is equally likely."

## First-crate odds (2026-09-29 catalog, 42 crate items)

| Rarity | Items | Each item |
|---|---|---|
| Common 50% | 8 (7 titles, 1 minion skin) | 6.25% |
| Rare 30% | 13 (5 titles, 8 minion skins) | 2.31% |
| Epic 15% | 10 (2 titles, 6 minion skins, 2 hero skins) | 1.5% |
| Legendary 5% | 11 (1 title, 2 minion skins, 8 hero attacks) | 0.45% |

By category: titles 58.7%, minion skins 34.6%, hero attacks 3.6%, hero skins 3.0%.

## Verification

- `cosmetics.test.ts`: each item's chance = its rarity's odds / the rarity's item count; a sweep of draws matches;
  per-item chances pinned; the fallback, never-owned and exhausted cases unchanged.
- `sqlParity.test.ts`: roll version 3; the pick never reads `pool_weight`; the SQL index re-implemented from the SQL
  text equals `pickCrateReward` over 4001 draws x 6 collections.
- `crateOdds.db.test.ts`: all seven progression migrations in order on PGlite; SQL pick = TS pick draw for draw; an
  even sweep of the Legendary band hits every Legendary exactly equally; roll version 3; idempotent re-run.

## Owner runbook

1. If not done yet, run `supabase/migrations/2026-09-29-crate-fixed-rarity-odds.sql` first. Then paste
   `supabase/migrations/2026-09-29-crate-uniform-within-rarity.sql` into the Supabase SQL Editor and Run
   (idempotent, writes no rows).
2. From an up-to-date `main`: `npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza`.
3. Read-only check:

   ```sql
   select position('c_roll_version constant int := 3' in pg_get_functiondef('public.open_crate(uuid, uuid)'::regprocedure)) > 0 as roll_v3,
          position('offset v_idx limit 1' in pg_get_functiondef('public.progression_crate_pick(uuid, double precision)'::regprocedure)) > 0 as equal_chance,
          has_function_privilege('authenticated', 'public.progression_crate_pick(uuid, double precision)', 'execute') as client_can_call;
   -- expect true, true, false
   ```
