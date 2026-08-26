# Doc Bot blind-spot class 6 — economy differentials + lobby property tests

**Date:** 2026-08-26 · **Scope:** test-only (no engine changes) · **Files:**
`packages/sim/src/docbot/economyScan.test.ts`, `packages/sim/src/docbot/lobbyProperties.test.ts`

## What

Two new Doc Bot suites close the economy & lobby blind spot:

- **Economy differentials** (`economyScan.test.ts`, 21 tests): every economy action is pinned as an EXACT
  embers delta through the real reducer, against the same helpers the UI reads — the "price shown is the
  price paid" contract. The buy sweep covers every distinct pricing rule in the reducer's priority order
  (`offer.cost` > `heroOfferPrice` (Flint's Company Rate) > `minionCostOverride` (Merchant's Mark, armed via
  the real reward engine) > `minionCostOf` (default + Tradesman)), plus the spell slot's
  `max(0, cost − spellCostReduction)` with its 0-floor and Fi's free-first-buy. Sell pins `sellValueOf` /
  `sellValueWithBonus` (vanilla, Hoarder flat 2/4, per-instance `sellBonus`, `sellOverride` 0, Quick Sale
  spent-once). Reroll/tier-up pin `refreshCostOf` / `upgradeCostOf` including free rolls, Ayse's Ace
  (floored, spent), the config re-base after an upgrade, and the per-wave `upgradeDiscountPerWave` tick
  through a REAL `resolveCombat` wave advance. Triples pin: three copies → exactly ONE golden at the
  two-best-copies stat rule (2× base fresh; base×2 + best buff otherwise), `triplesMade` once, and playing
  the golden grants exactly one `discoverspell`.
- **Quest reward magnitudes**: every quest in `QUEST_DEFS` is armed through `devGrant` →
  `applyQuestReward` (the real engine) and each leaf reward's MAGNITUDE is asserted against its def params —
  ~40 reward kinds have checkers. The excuse registry (`QUEST_SCAN_EXCUSED`, stale-checked + ratcheted at
  **0**, the `phaseRegistry.ts` discipline) landed EMPTY: every recruit-side reward kind checked out
  headlessly. Random grants are armed at tier 6 because filtered draws (`Rally`) have no tier-1 member.
- **Lobby properties** (`lobbyProperties.test.ts`, 8 tests, 30 seeds through the real
  `createLobby`/`resolveRound`/`runLobby` loop over `recordedSeat` drivers):
  - Rating: `LOBBY_PLACEMENT_DELTAS` strictly decreasing across the 8 placements; `resolveLobbyRating`
    monotone in placement at any starting rating (0-floor included); out-of-range placements clamp.
  - Pairing: every living seat fights exactly once per round or takes the recorded bye (a=b, 0 damage,
    `fought: false`); an eliminated seat is never paired; no seat fights itself.
  - Elimination: exactly-once and sticky (the wipeout-guard resurrection is allowed only to crown the single
    winner); placements are competition-ranked (simultaneous knockouts share, the next skips) and single-
    winner lobbies place a unique 1st; `standings()` agrees; same-seed determinism.
  - Stalemate backstop: eight 0-attack walls draw forever and the round-counter hard stop terminates the
    lobby with every survivor placed 1st (tested at `maxRounds: 12` for speed; the shipped default is
    pinned at 60).

## Why

Same rationale as the factory×phase tripwire: these contracts were previously held by comments and one-off
examples. A pricing rule, a sell-value branch, a triple merge rule, a quest reward magnitude, or a pairing
invariant could drift silently. Now each is data a test re-derives every run.

## Findings

No real discrepancies: every economy path and every recruit-side quest reward magnitude matched its def.
Two notes for future readers: (1) the stalemate case legitimately produces MULTIPLE placement-1 seats — a
"placements are a permutation of 1..8" assertion is wrong for the backstop and for shared knockouts, which
is why the suite asserts competition ranking instead; (2) no card pool has zero-effect minions at every
tier, so the economy probes use combat-only-effect minions as "vanilla".
