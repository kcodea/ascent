# 2026-10-03: Bullet Time renamed Timebreak

Owner decision: the Ancient of Time hero attack (#1912) takes the name "Timebreak" (picked from Timebreak,
Chronoweave and Sands of Eternity). "Bullet Time" was a placeholder.

## What changed (display name only)

- Catalog: `packages/progression/src/cosmetics.ts` names `attack_bullet_time` "Timebreak"; the Edge Function copy
  (`supabase/functions/_shared/progressionCosmetics.ts`) was regenerated with `npm run progression:shared`.
- Tuner title "Hero Attack: Timebreak (Ancient)", the DevMenu label + hint, the dev attack-style label
  "Timebreak (Ancient of Time)", code comments, GAME-RULES, the oracle rule R-PROG-ATTACK-35 (owner decision added
  as evidence) and the knockout-variant rule R-PROG-ATTACK-20, the tests (Collection tile, catalog name).
- Patch notes: the existing 2026-10-02 entry now says Timebreak (edited in place, not a new line).
- The 2026-10-02 devlog entry now uses the final name; owner quotes are kept verbatim.

## Kept on purpose

- The id `attack_bullet_time`, the style key `bullettime`, the tuner id `herobullettime` (localStorage), and the
  code identifiers (`playHeroBulletTime`, `heroBulletTime/`). Ids are permanent; renaming code symbols is churn.

## Owner step

Deploy the `progression-inventory` Edge Function so the catalog name in the database updates.
