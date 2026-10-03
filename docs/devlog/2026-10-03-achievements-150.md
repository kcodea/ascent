# 2026-10-03: 150 more achievements (446 total, +61,375 XP)

Owner asks 2026-10-03: "add 150 more achievements"; themes chosen: Tribes & cards, Heroes deeper, Combat feats,
Long-term grind; and "make longer term / more difficult achievements grant significantly more xp. some of the larger
longer term ones should easily be 500+ xp". Oracle R-ACH-05.

## Owner runbook

1. **No SQL.** The catalog is code-owned: `submit-progression` pushes `achievementCatalogPayload()` into
   `achievement_catalog` on its next cold start (hash short-circuit), and `settle_progression` already reads any metric
   key from the facts document, so the new run metrics need no database change.
2. Deploy the `submit-progression` Edge Function (its `_shared/progressionAchievements.ts` was regenerated with
   `npm run progression:shared`). Until it is deployed, the old function drops the new metric keys (harmless) and the
   new definitions are simply not in the catalog yet.
3. Ship the web build as usual (the client counts the new metrics and shows the new categories).

## What changed

| Theme | Count | XP | Where |
|---|---|---|---|
| Tribes & cards | 38 | 15,950 | Set 2, by tribe |
| Heroes deeper | 42 | 10,150 | Heroes (a Devoted tier per hero + an "All heroes" group) |
| Combat feats | 36 | 13,175 | new Combat category |
| Long-term grind | 34 | 22,100 | new Milestones category |
| **Total** | **150** | **61,375** | registry now 446 / 105,950 XP (after the re-tune below) |

XP bands for the 150: 25 to 100 (10), 101 to 300 (77), 301 to 499 (13), 500 to 749 (24), 750 to 1,500 (26).

New RUN metrics (trust O, like every run metric; counted in `packages/sim/src/achievementMetrics.ts`):
`heroPowerUses`, `flawlessWins`, `lastStandWins`, `combatWinStreakMax`, `undefeated`, `knockouts`,
`heroDamageCombatMax`, `heroDamageDealt` (both from the lobby encounter records), `enemyKillsCombatMax`,
`enemyKills`, `brink` (Health fell to 5 or less while alive). A knockout = an opponent who was eliminated in the
round your own fight dealt them damage (a ghost stand-in never counts).

UI: Combat (sword) and Milestones (clock) categories; the Heroes category leads with an "All heroes" group. Only the
current category mounts, tiles stay memoized, and each `.ach-group` now has `content-visibility: auto` so off-screen
groups skip layout and paint (Heroes is 222 tiles in 37 groups).

## Deliberately NOT built

- Account Level and cosmetics-collected achievements: each needs a new SERVER metric, which means replacing
  `settle_progression` again. PR #1925 (placement XP) also replaces it, so this should follow once that lands.
- Per-tribe triples: the Gild counter has no tribe.
- An Ancient pairing per hero: Ancients are Scene Builder / Set 3 only, not live in Ranked or Practice.
- "100+ damage in one fight": hero damage tops out near 50, so the single-fight tiers are 10 / 15 / 20 / 30.

## The batch 1 long-term re-tune (owner: "yes apply these achievement changes")

career.games.100 100 -> 300, career.top_four.50 100 -> 300, career.firsts.25 200 -> 500, career.comebacks.10 100 -> 250,
career.heroes_played.15 100 -> 250, career.hero_wins.15 200 -> 600, career.achievements.25 100 -> 200,
s2.kobold.rubies_life_500 100 -> 200, hero.<id>.mastery 250 -> 400 (x36). +7,000 XP; the registry is 105,950 XP.

Retroactivity: NOT retroactive. The XP lives in code; `sync_achievement_catalog` copies it into
`achievement_catalog.xp`, and `settle_progression` pays `d.xp` at completion, recording it in
`achievement_completions.xp_awarded` and the ledger row. A completed achievement never progresses or pays again, so
players who already completed one keep what they were paid; only completions after the deploy pay the new amount. No
backfill was added. One side effect: if a client RETRIES a settlement that completed a re-tuned achievement before
the deploy, the server returns the original result (old XP) and the Edge Function's `parity` check (which re-derives
from the new code values) logs `parity: false` for that one dedupe. It is a log flag only; nothing is re-paid.

## Verification

`achievements.test.ts` pins the counts, XP per category, the band table, name uniqueness against achievements and
the cosmetic catalog, and the new metrics' trust. `achievementMetrics.test.ts` drives the new counters (combat log,
reducer-shaped actions, a hand-built lobby). `AchievementsTab.test.tsx` covers the new categories and groups and the
stylesheet's `content-visibility` tripwire.
