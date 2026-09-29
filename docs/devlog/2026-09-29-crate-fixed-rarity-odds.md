# 2026-09-29 — Crates roll at fixed rarity odds (50 / 30 / 15 / 5)

Owner: "go to C", then "make it 50/30/15/5 though". Rules: `docs/GAME-RULES.md` "Account Level" (Opening);
oracle **R-PROG-CRATE-03** (new) and R-PROG-CRATE-02 (reworded: the roll now defers to CRATE-03).

## What changed

- **The roll.** One server draw `u` in [0, 1) rolls a rarity at fixed odds, Common 50 / Rare 30 / Epic 15 /
  Legendary 5 (`CRATE_RARITY_ODDS`, the ONE TS copy, `packages/progression/src/cosmetics.ts`). Where `u` landed inside
  that rarity's band then picks an eligible item of that rarity, weighted by its **category** weight, walked in id
  order (`pickCrateReward`). Was: one draw weighted rarity x category over everything that remained (roll version 1).
- **Fallback.** A rolled rarity with nothing eligible goes to the NEAREST rarity with something left, ties toward the
  more common one (`crateRarityFallback`: Epic -> Rare -> Legendary -> Common). Nothing anywhere = `pool_exhausted`,
  crate stays sealed, as before.
- **Roll version** 2 (`CRATE_ROLL_VERSION` / `c_roll_version`), stamped on every crate opened from now on.
- **SQL**: `supabase/migrations/2026-09-29-crate-fixed-rarity-odds.sql` (also appended to `schema.sql`) replaces
  `progression_crate_pool` (same signature; `pool_weight` is now the category weight only) and `open_crate` (same
  locks, guards and statuses; one `random()` through the pick), and adds `progression_crate_pick(user, draw)`, which
  carries the odds as constants. All three are service-role only.
- **Collection**: the crate bay prints "Crate odds: Common 50%, Rare 30%, Epic 15%, Legendary 5%" whenever crates
  are on (`crateOddsLine`). Plain text, no hover.
- **Patch note** (Systems, 2026-09-29).

## Builder's calls (the owner did not specify; flagged for review)

1. **Within a rarity, items are weighted by category weight** (minion skin 35, hero skin 20, hero attack 15, title
   10), not uniform. So inside Epic a minion skin is 3.5x as likely as a title.
2. **Fallback ties go to the MORE COMMON rarity** (Epic empty -> Rare before Legendary).

## The odds of a first crate (2026-09-29 catalog, 42 crate items)

| Rarity (share) | Items | Per item |
|---|---|---|
| Common 50% | 1 minion skin, 7 titles (weight 105) | minion skin 16.67%, title 4.76% each |
| Rare 30% | 8 minion skins, 5 titles (330) | minion skin 3.18%, title 0.91% |
| Epic 15% | 6 minion skins, 2 hero skins, 2 titles (270) | minion skin 1.94%, hero skin 1.11%, title 0.56% |
| Legendary 5% | 8 hero attacks, 2 minion skins, 1 title (200) | hero attack 0.375%, minion skin 0.875%, title 0.25% |

By category: minion skins 55.5%, titles 39.2%, hero attacks 3.0%, hero skins 2.2%. Adding an item only re-splits
its own rarity; the four rarity numbers never move.

## Verification

- `cosmetics.test.ts`: the rarity bands, an even sweep of draws landing exactly 50/30/15/5, per-item chances, the
  fallback, never-owned, exhausted, clamping.
- `sqlParity.test.ts`: the SQL odds constants, rarity order, fallback ordering and walk re-implemented from the SQL
  text and matched against `pickCrateReward` over 4001 draws x 6 collections; roll version 2; one `random()`.
- `crateOdds.db.test.ts` (new): every progression migration in order on PGlite, then `progression_crate_pick` equals
  `pickCrateReward` draw for draw (fresh, no Commons, no Epics, only Legendaries, one item left) including the band
  edges; `open_crate` stamps roll version 2, already_opened, pool_exhausted keeps the crate sealed, `admin_off` keeps an
  item out of every draw, re-running the file changes nothing, clients cannot call any of the three functions.
- The older `crates.db.test.ts` still runs the 2026-09-28 file on its own (the version-1 roll) and is unchanged.

## Owner runbook

1. Supabase SQL Editor: paste `supabase/migrations/2026-09-29-crate-fixed-rarity-odds.sql` and Run (idempotent; it
   writes no rows). If the crates or skins file is ever re-run, run this one again after it.
2. From an up-to-date `main` checkout: `npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza`
   (it carries the regenerated TS copy, `supabase/functions/_shared/progressionCosmetics.ts`).
3. Read-only check (SQL Editor):

   ```sql
   select p.proname, pg_get_function_identity_arguments(p.oid) as args,
          has_function_privilege('authenticated', p.oid, 'execute') as client_can_call
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('progression_crate_pick', 'progression_crate_pool', 'open_crate');
   -- expect 3 rows, client_can_call = false on all

   select position('c_roll_version constant int := 2' in pg_get_functiondef('public.open_crate(uuid, uuid)'::regprocedure)) > 0 as roll_v2,
          position('c_odds_legendary constant int := 5' in pg_get_functiondef('public.progression_crate_pick(uuid, double precision)'::regprocedure)) > 0 as odds_5;
   -- expect true, true

   select roll_version, count(*) from public.loot_crates where state = 'opened' group by 1 order by 1;
   -- crates opened after the paste show roll_version 2
   ```
