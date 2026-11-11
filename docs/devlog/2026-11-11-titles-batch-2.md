# 2026-11-11: Titles batch 2 (one Ancient, seven Legendary)

Owner ask: "Add the following Ancient title: Banana. add the following legendary titles: Beastmaster, Dwarven Warlord,
Leader of the Pack, Doom, Gem-stoned, Dragonborn, Re-Blarted."

## What shipped

Eight new crate titles in `packages/progression/src/cosmetics.ts`, right after the launch fifteen:

| id | name | rarity |
|---|---|---|
| `title_banana` | Banana | Ancient |
| `title_beastmaster` | Beastmaster | Legendary |
| `title_dwarven_warlord` | Dwarven Warlord | Legendary |
| `title_leader_of_the_pack` | Leader of the Pack | Legendary |
| `title_doom` | Doom | Legendary |
| `title_gem_stoned` | Gem-stoned | Legendary |
| `title_dragonborn` | Dragonborn | Legendary |
| `title_re_blarted` | Re-Blarted | Legendary |

They are plain crate drops (`acquisition: { type: 'crate' }`), like the launch titles. They paint in their rarity
colour through the shared `.r-legendary` / `.r-ancient` tokens, so no UI code changed.

## What moved because of it

- **Crate odds.** Legendary items went 89 to 96 (each 9 / 96 = 0.094%, was 0.101%) and Ancient 31 to 32 (each
  3 / 32 = 0.094%, was 0.097%). Titles are now 7.4% of a first crate (was 6.7%).
- **Banana is the first Ancient title.** Titles can now be focused on an Ancient chest in the Chest Shop; before this
  the Titles row read "None left" there. The tests that used Titles as the "nothing at the Ancient floor" example now
  use Emotes, which still has no Ancient item.
- **The Collection.** The Titles album leads with Banana (rarest first), then the eight Legendaries. The header total
  is 431 (was 423).

## Server side

The new rows reach `cosmetic_catalog` through the catalog sync, not a migration. The crates file's first seed
(`2026-09-28-progression-crates.sql`) still holds only the launch fifteen, so `sqlParity.test.ts` and
`crates.db.test.ts` exclude the batch 2 ids when they compare against that seed. The generated Deno copy
(`supabase/functions/_shared/progressionCosmetics.ts`) was regenerated with `npm run progression:shared`.
