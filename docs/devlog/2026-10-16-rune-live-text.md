# 2026-10-16 — Self-improving runes print their current value (R-RUNE-LIVE-TEXT-01)

**Owner report:** Rune of the Wild Hunt's tooltip read "give it **+2 Attack** and improve this by **2** permanently"
long after it had grown. "this rune should show the current value in real time."

**Root cause.** No rune surface ever applied live text: every tooltip rendered the authored `rune.text`. The live-value
rule was met for runes only by the separate `runeTally` pill on the rack badge (and Wild Hunt had none). The engine
side was already right: `simulate` grows `wildHuntGrown` by the step per Beast attack and settle writes it back to
`runeWildHuntGrown`, so the gain is permanent and the next fight resumes from it.

**Fix.**
- `packages/sim/src/runeLiveState.ts` — the one reader of each self-improving rune's current value, from the run
  (`runeLiveStateOfRun`), a captured board (`runeLiveStateOfSnapshot`, untrusted-safe), a fight-only record
  (`runeLiveStateOfCarries`, Versus match stats) and mid-fight (`runeLiveStateInCombat`). Values are PER COPY.
- `packages/ui/src/runeText.ts` `liveRuneText` rewrites the printed number in place; wired into the rack badge, the
  hero-slot rune (StatusBar), the Runeforge `RuneCard`, `CombatOpponent`, `OpponentFrame`, the scout card
  (`SeatIntel.runeLive`), `RuneEmblem` (Career, match details, Versus stats), and `LbRunes` (Recent Games, Leaderboard).
- Mid-fight: `runeProgress` (choreo/triggerCounts.ts) folds each side's `questTrigger`s **by flag** plus its friendly
  deaths; Recruit publishes `combatPlayerRuneProgress` (cleared at settle, when the run banks the growth) and
  `combatEnemyRuneProgress` (held to the end screen).
- `MatchBoard.runeLive` stores the value in match details (older records print the base).

**Also fixed (same stale-base problem):** Packcraft, Beastial Swarm, Seasoned Ledger, Compounding Wages, the Wheel, the
Baller (its next sale's amount AND stat).

**Found, not fixed here:** `badgeIdForCombatFlag` maps only BASIC rune + quest flags, so 55 Epic combat runes never
bounce/burst their badge in combat. That is why the live fold counts by flag. Split out as its own task.

Not covered: the Gauntlet's shop-phase foe card (`GauntletFoe`) prints authored stage runes at base; its combat badge
(CombatOpponent) is live. `RunTrophies` is unused.
