# 2026-10-16: every rune's badge flashes in combat (R-RUNE-COMBAT-FLASH-01)

Found while fixing #2128: Epic runes (Rune of the Wild Hunt and ~50 more) fired in combat with no badge bounce.

## Root cause

`packages/content/src/questFlags.ts` built the flag -> badge-id map (`badgeIdForCombatFlag`) from `RUNES` (Basic) and
`QUEST_DEFS` only. The engine already logged a side-tagged `questTrigger` on the right step for every Epic rune, but
`triggerCounts` resolved the flag to `null`, so the badge key never changed. `combatFlagOwner` (the beat registry)
already scanned `EPIC_RUNES`; the two lists had drifted. Separately, the foe's rune badges (`CombatOpponent`) had no
pulse wiring at all.

## Fix

- `badgeIdsForCombatFlag(flag)` scans quests + Basic + Epic runes and returns EVERY owner (Crowded Crypt and Overflow
  share `runeOverflow`). Explicit entries for runes whose reward kind is its own primitive yet logs a flag: Five
  Banners, Enchantment, Held Strength, Last Tool, Ancestral Roar.
- Engine: three runes paid out live but logged nothing. Grim Toast (live Aura rise reaching Dwarves), Soul Furnace (the
  live Health re-derive) and Zoo (a scaled Beardsley grant) now log a `questTrigger` marker. Marker events only: a
  1,200-fight fuzz A/B (results, damage and every other event) hashes identically with and without them.
- Foe badges bounce off `combatEnemyRuneProgress` (`badgePulsesFromProgress`), re-rendering only when a foe rune moves.
- Coalescing: the CSS bounce remounts per bump, so a repeat restarts it. The Pixi badge burst is booked per badge
  (`bookBurst`): at most one queued behind the one playing, so a rune firing every beat cannot stack bursts.
- `questbounce` no longer animates `filter` (brightness + drop-shadow repainted every frame of every bounce). The
  flash is a static white wash on `::after` with animated opacity; the glow is the existing `.questbadge-pulse` ring.

## Not flashed (by design)

- Granted-ability runes (Aggressive Golems' Rally on Gemheart Golems): the minion is the visible source.
- Open Grave: Shop-only. Passive/Shop-only Epics (tribe drips, thresholds, End of Turn) have no combat fire.

## Perf (prod bench builds, `VITE_PERF_BENCH=1`, headless Chrome at a 240 Hz cadence, CDP-driven)

Stress fight: 7v7 Beasts (Pack Leaders + Pennycats), both sides holding Wild Hunt, Attacking Gems, Savagery and Jungle
(78 rune fires in the first 24 attacks), 45 s windows, 5 runs per build, alternated. Baseline = d3677a1ba.

| | frames | badge bounces | frames over 6.25 ms | interval p95 / p99 | rAF-to-paint p50 / p95 / p99 |
|---|---|---|---|---|---|
| main | 52,785 | 0 | 818 (1.55%) | 4.3 / 8.3 ms | 1.2 / 2.4 / 3.5 ms |
| branch | 52,969 | 280 | 739 (1.40%) | 4.3 / 8.3 ms | 1.4 / 2.6 / 3.9 ms |

No added frames over budget (within run-to-run noise: 80-306 per run on main, 122-202 on the branch).
