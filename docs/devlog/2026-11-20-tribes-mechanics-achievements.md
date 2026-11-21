# 2026-11-20 Tribes and mechanics achievements (100 visible, XP only)

Owner ask: "come up with another 100 achievements to add as well across tribes and mechanics."

Stacked on #2815 (secret titles v2), which rewrites the same three files.

## What shipped

- `ACHIEVEMENTS_TRIBES_MECHANICS` (packages/progression/src/achievements.ts): 100 visible defs, XP only (100 to 600,
  33,000 XP in all), no titles or cosmetics.
- A new **Tribes** category (`tribes`, groups in `TRIBE_GROUPS`: Dwarf, Demon, Spirit, Dragon, Beast, Undead, Kobold,
  Celestial; no Mech). 50 defs: per tribe a lifetime "Play 1,000" and a "500 Attack" minion, plus 4 or 5 signature feats
  (Ales and Gold, Imps and consume, summons from hand and Revelers, Shouts / spell power / Dragonflame, Beast Echoes and
  King Oona, Rise and Skeletons, Rubies / Golem / Kobebes, Starform and Shop spells). `setId` is null, like the secret
  titles: a tribe's feats count in whichever set it is played. Spirit and Undead need Set 3, Celestials Set 4; neither is
  live, so those tiles show but cannot move yet (owner call flagged in the review list).
- 50 mechanic feats in their existing categories: Mechanics (Echo, Rally, Shout, Ward, Execute, Pummel, Start of Combat,
  End of Turn, Discover, Choose One, spells), Economy and Build (Gilding, Freeze, Refresh, selling, Gold, Shop Tiers),
  Runes, Heroes "All heroes" (hero power), Combat (Health, knockouts, big hits) and Career (a final-2 Ranked ladder,
  server-known `game` with `placementMax: 2`).
- 24 new RUN metrics (the TRIBES AND MECHANICS block of `RUN_METRICS`), counted in achievementMetrics.ts:
  - `observeMoreAction`: accepted actions only (the reducer returns the same state for a refused one; combat previews
    skipped): `refreshes`, `discovers`, `chooseOnes`, `freezes` (once per turn), `eotFires` (`lastEotFires` is zeroed at
    the top of every action), and the per-turn tallies summed within a turn (`shouts`, `sells`).
  - `observeMoreCombat` plus the existing combat loop: `echoTriggers`, `rallies`, `wardBlocks`, `executeKills`,
    `beastSummons`, `handSummons` (game sums), `pummels` / `pummelsCombatMax` (the `pummelTrigger` log),
    `openingKillsCombatMax` (enemy deaths before the first `attack` event: Start of Combat kills).
  - Shop board: `demonPlays`, `beastPlays`, `undeadPlays` (the tribe-plays loop), `dwarfAttackMax`, `beastAttackMax`
    (added to `TRIBE_ATTACK_METRIC`). Final board: `finalSpirits`, `finalUndead`, `finalCelestials`.
- A test pins that no def in the catalog shares a predicate (metric, agg, target, mode, placement, set, hero) with a new one.
- No SQL: `settle_progression` reads any run-metric key and the category column has no check. Supabase shared copies
  regenerated (`npm run progression:shared`); nothing deployed.

## Not built

- Henchmen: only the Scene Builder placeholder Henchman exists, so there is no real signal.
- Tier 7: only the Summit rift and two hero quests open it.

Review list for the owner: `.claude/new-achievements-review.md` (outside the repo), generated from the code.
