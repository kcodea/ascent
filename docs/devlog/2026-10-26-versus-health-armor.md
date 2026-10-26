# 2026-10-26 — Versus plays on Health and Armor (hearts retired), Summit +10 again, Duos team pool

Owner (2026-10-26): "I want to move the normal lobby mode health/damage system to versus so the experience is the
same." Rules: R-VERSUS-HEALTH-01, R-DUOS-HEALTH-01, R-VERSUS-SUMMIT-01 (reversed), R-VERSUS-HEARTS-01 (rewritten as the
retirement note), R-DUOS-VIEW-04 (the teammate-view haze bug).

## What changed

- **Every Versus mode (1v1, Group, Duos)** plays on Health + Armor. A seat starts on its hero's own pools (Summit adds
  +10 Armor again); the loser of a fight takes the lobby formula (striking tier + survivors' tiers) off the ONE
  `simulate()` result, capped by the lobby's `lossDamageCap`, Armor first; a draw costs nobody; 0 Health is out.
- **Duos**: one shared team pool, 30 Health + both heroes' Armor (+10 per hero with Summit). The losing team takes the
  damage of the winning side's board that ENDED the fight: `simulate()` already swaps the side's run context on
  `stepIn`, so `playerDamage` / `enemyDamage` is that board's tier + its survivors (a fallen first board's tier never
  counts). The old "2 hearts for a stomp" has no Health equivalent and is gone. This reading is a builder proposal,
  flagged in the PR.
- **The server owns the numbers.** `packages/sim/src/versus/vitals.ts` is the bundle-safe core: starting pools,
  `versusVitalsBefore` (stored pools, raised by a FRESH lock's reported Armor up to the highest Armor any card sets, i.e.
  Mend's 5; never Health), `hitVitals`, `stampVersusDamage` (each perspective stamped exactly as the lobby run loop stamps
  a fight: `playerDamageUncapped`, `damageCap`, capped `playerDamage` / `enemyDamage`, and `versusVitals` = the seat's
  pools after the round). The resolvers take `vitals`, return `damage` / `vitals` / `loser`; the finalize handlers read
  stored pools + heroes + options; the Edge Function drops a stale (auto / empty) side's report (`versusFreshSide`).
- **The client** lands the stamped `versusVitals` on the run at `settleCombat` (the lobby's own timing), and each locked
  side reports `vitals` (Mend). The display lobbies carry Health / Armor (+ `startArmor` for the bar) with the lobby's
  cap table; every hearts surface now shows the lobby's Health box / rail values: the hero plate, the opponent block
  (with Max dmg beside Round), the rail, the scout log (Dmg), FightRecap, the damage formation, spectator plates,
  room seats, the teammate dock, Previous match stats (Match details' heart + shield spans), Hero Select pills, the dev
  tuner (Set Health / Armor). Announcer Health / Armor / damage lines now speak in Versus.
- `lossDamageCap` moved to the dependency-free `packages/sim/src/lossCap.ts` (re-exported by the reducer) so the server
  bundle shares the lobby's cap. The bundle may now include `config.ts`, `heroes.ts`, `lossCap.ts` (pure data; the
  bundle-leak test allows exactly those).
- **SQL** `supabase/migrations/2026-10-28-versus-health.sql`: per-seat / per-team / per-round Health, Armor, damage
  columns; new commit signatures (`p_vitals`, `p_loser`); group wipeout tiebreak by Health + Armor going in; the hearts
  columns stay readable (NOT NULL dropped on the round tables); knockout reason keeps the legacy id `'hearts'`;
  `versus_dev_set_hearts` → `versus_dev_set_vitals`. **Protocol 2**: a room made by an older client is never joined.
- **Haze bug (R-DUOS-VIEW-04)**: the teammate-view vignette moved from z70 to z39, under `.statusbar` (40) and
  `.duosdock` (41) and the hand pop (70), still over the board (`.app` 1).

## Verification

Engine + PGlite tests for all three modes (damage, Armor, cap, knockouts, draws, Duos pool, Summit, stale-side
reports, SQL validation), `npm run versus:bundle && npm run versus:parity -- bundle`: 98/98 byte-identical (the
13 fixture duels, 18 group and 18 duos rounds, each twice: as recorded, and with pools incl. lethal ones).

## Deploy (lead)

Apply `2026-10-28-versus-health.sql`, then at once `npm run versus:bundle` + deploy `versus-resolve`
(`--no-verify-jwt`) and `npm run versus:parity -- remote <url>` (expect 98/98).
