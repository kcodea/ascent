# 2026-09-15 — Balance bot: symmetric combat carry-backs (the enemy seat keeps what it earned)

Closes B1's largest finding (`2026-09-15-balance-b1-seat-runner.md`, discrepancy #1). Branch
`feat/balance-symmetric-carry` onto `feat/balance-b1-runner`. Engine (core, shared boundary) + the seat runner's
mirror; no player-facing change (no patch note). Additive: every `player*` field is byte-identical.

## What shipped

- **`CombatResult.enemyCarry?: CombatCarryBacks`** (core `types.ts`) — the enemy side's settle-time carry-backs,
  the SAME shape as the `player*` family minus the prefix (`deathrattles`, `permaBuffs`, `handGrants`,
  `questTally`, `summonBonus`, `tavernBuyGain`, … 50 fields, plus `foeDeaths` = the mirror of `enemyDeaths`).
- **`simulate.ts`** — every carry-back tracker became a `Record<Side, …>`; one `carryBacksFor(side)` helper
  builds both halves. The player's half is spread onto the legacy fields (same keys, same values, same
  `undefined`-ness). The enemy's Deathrattles are now really counted (`enemyCarry.deathrattles`); the legacy
  `deathrattleTally('enemy')` live read still returns the frozen snapshot value (see "kept asymmetries").
- **The enemy half only accumulates.** No new event, no draw from the fight's RNG, no live-read change. Where an
  enemy grant needs a random pick (Badgington / Carrion Coin / Wayfinder, Last Call, Salvage, Returning Pack)
  it draws from a **side stream** seeded off the fight RNG's opening `state()` (a read, not a draw) — the main
  stream is untouched, the pick is still a pure function of the seed.
- **`runeAvenge(…, economy = true)`** — the five economy runes (Appraisal, Last Call, Cinder Ledger, Soul Taxes,
  Deep Hunger) now fire for the enemy too, silently (no badge pulse, no event), paying into `enemyCarry`.
- **`mirrorForEnemySeat`** (`packages/sim/src/balance/seatRunner.ts`) lifts `enemyCarry` onto the `player*`
  fields, explicitly field by field; the leak contract is now "every `player*` field on the mirrored view is
  exactly what `enemyCarry` says". A result without `enemyCarry` (hand-built fixture) mirrors damage / outcome /
  deaths / survivors only, deathrattles recorded as 0 — never estimated.

## Gate classification (74 `side === 'player'` + 22 `side !== 'player'` sites)

- **A — symmetric now (≈70 sites):** deathrattle / rally / imp / summon / kill tallies, quest tallies +
  timelines, `statGainByTribe`, every `ctx.grant*` / `gain*` / `queue*` channel (hand grants, hand buffs, Rubies,
  mints, spell power, card buffs, Fodder, deferred Battlecries, max Gold, bonus Gold, free rolls, guaranteed
  Attachments, Imp / Undead / Fodder / Magnetic / rightmost-slot / board buffs, next-shop buff, Discover casts,
  next-turn spell copies), Old Hunt aura gains, Wild Hunt, Hoard, Beastial Swarm, Rune of Overflow / Remains /
  Reinvestment / Blood and Coin / Trophy / Herding Horn / Returning Pack / Salvage, Flash (first + last), the five
  economy Avenges, Echoing Coop / Bone Throne / Rise / re-fire Echo counts, `deaths` / `foeDeaths` /
  first-last kill, per-instance `summonBonus` / `hpGrantBonus` / `spellProgress` / `ascendCount` / `permaBuffs`.
- **B — per-side selectors, fine as-is (≈20):** `modsFor`, `spellPowerFor`, `rubyBonusFor`, `tierFor`, `poolCards`,
  `handMinionsFor`, `beastsPlayedFor`, the foe-side lookups, the tutorial's forced first target, `spellhide`.
- **C — kept asymmetric, documented in code (`KNOWN ASYMMETRY`):**
  1. `deathrattleTally('enemy')` reads the FROZEN snapshot tally (an enemy Grim does not grow mid-fight) —
     resolution-bearing; the fired count is still carried back.
  2. Enemy spell power / Imp aura (Cinder Ledger half) / per-card stacks (`applyCombatGains`) stay static THIS
     fight even though their gains carry back — same rule: no live-read change.
  3. Pack Mentality's live growth + `beastScaleProgress` (player-side machinery; absent for the enemy).
  4. Mid-combat quest completion (`pendingQuests` → `checkPendingQuests`) is player-only; the enemy's tallies
     carry back and complete at settle.
  5. Blood Trail (its Start-of-Combat mark exists only on the player board), Sable's Soulbind (forged in the
     player's shop), Echo Warden (a player reward), Rallying Offensive (`CombatConfig` is player-only — B1 #4),
     Rune of the Herald's enemy pass not folding Echo extras (`rside === 'player' ? playerEchoExtras : 0`).
  6. Enemy hand buffs (`buffHand`) are carried back but the served snapshot entry is not grown mid-fight.

## Verification

- **Byte-identity proof:** a frozen fixture of 1,278 `simulate()` inputs captured from greedy-pilot lobbies on
  the base commit (set2 + set3, 6 lobbies each, 14 rounds, both `corrected` and `shipped` sides; 378 fights with
  enemy `questMods`, 430 with an enemy hand) hashed over events + every shipped result field: total sha256
  `da2565c0…2369e` before and after — identical, all 1,278 per-fight hashes equal.
- `packages/core/src/combat/symmetricCarry.test.ts` (5): the earning board (3 Sporelings + Engraved Tara +
  Totality) reports the same ledger as player and as enemy; kill/death mirrors agree with the legacy fields;
  an enemy Soul Taxes leaves the event log + every shipped field unchanged while landing on `enemyCarry`; an
  enemy Last Call grants off the side stream (events byte-identical, picks deterministic); the kept
  asymmetries read as absent.
- `seatRunner.test.ts` (8): the leak contract rewritten as "every `player*` field on the mirror comes from
  `enemyCarry`"; NEW positive test — the enemy seat's next recruit phase holds Tara +3/+3 (`ascendProgress`
  3), the Star Crash in hand and `deathrattlesTriggered` +3, through the real `resolveCombat`.
- `selfPlayLobby.test.ts`: the ranking helper asserted the 1-2-2-4 scheme; the shipped `closeRunLobbyRound`
  gives simultaneous knockouts the WORST vacated rank (1-3-3-4). B1's seeds never had a double knockout; the
  corrected enemy settlement changed the lobby trajectories and surfaced it. Helper fixed to the shipped rule.
- `docbot/combatScan.ts`: `enemyCarry.firstKill/lastKill` name PLAYER bodies (a bare id string `maskDeep` cannot
  catch) and would have marked the three pinned inert cards active by name — masked like the player-side
  telemetry.
- `npm run typecheck && npm run lint && npm test && npm run harness && npm run build:web` green
  (636 files / 8,972 tests; 0 lint errors; harness prints determinism ✓).
