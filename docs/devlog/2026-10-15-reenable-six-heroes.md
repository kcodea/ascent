# Six heroes re-enabled (2026-10-15)

Owner: "re-enable gorun, foreman flint, underdweller, pete, and membrance" and "re-enable emissary as well".

## What changed

- `wip: true` (the 2026-09-24 archive) removed from `gorun`, `flint`, `underdweller`, `pete`, `membrance`, `vale`
  (Emissary) in `packages/sim/src/heroes.ts`. They are back in Play, Practice, rival seats, Practice bot portraits,
  synthesized pool boards, the Compendium and the Mimic / Void / Power Shifter Discovers (all read `playableHeroes`
  / `isArchivedHero`). Foreman Flint keeps his Dwarf tribe gate, so he is offered only when Dwarves are in the run.
- Progression: the six join `ACHIEVEMENT_HEROES` in `playableHeroes()` order (42 heroes) and get the six hero tiers
  each (+36 achievements, +5,700 XP; the "150" batch is 156 with their Devoted tiers) and a title pair
  (`HERO_TITLE_NAMES`). No titles existed for them before (titles shipped 2026-09-29, after the archive), so the
  names are PLACEHOLDERS for the owner: Pete "Top Banana", Foreman Flint "Company Man", Emissary "Ambassador",
  Underdweller "Soulkeeper", Membrance "Total Recall", Gorun "Bladesworn".
- The 12 title rows were appended to the hero titles seed (`supabase/migrations/2026-09-29-hero-titles.sql` and
  `schema.sql`, 84 rows), following the Rayse precedent. The Supabase `_shared` copies were regenerated
  (`npm run progression:shared`) and the Doc Bot contracts re-extracted (`npm run docbot:sync`).
- Oracle R-HERO-01 and GAME-RULES "Heroes: archived" updated.

## Deploy

Run the 12 new `insert ... on conflict do nothing` title rows (or re-run the seed block of the hero titles file),
then redeploy `submit-progression` (pushes the achievement catalog) and `progression-inventory` (syncs the cosmetic
catalog). No `packages/content` or combat code changed.
