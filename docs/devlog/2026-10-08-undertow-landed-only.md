# 2026-10-08 — Undertow + Food Chain: overflowed summons no longer spend them

**Owner report:** "rune of the undertow needs to work every round, i think it's only working for 4 total uses"

## Root cause

The suspected cause (a budget on persistent run state, or a shared `questMods` object being spent across fights)
was **not** it. `undertowUsed` has always been a local inside `simulate()`, so every fight on both sides already
started with a fresh allowance, and `questMods.runeUndertow` is never mutated (#1969's per-fight `questMods` copy
is unrelated). A reducer-driven repro over consecutive lobby rounds pulsed the rune in every round.

The real defect: the Ward was granted in `applyCombatSummonGrants`, which `summonMinion` runs **before**
`placeSummon` checks the 7-slot board cap. A summon onto a full board is lost (`summonOverflow`), but it had
already taken a Ward, spent one of the 4 and pulsed the rune. On a wide token board (Nanon, golden Twilight
Whelps, any multi-summon Echo into one freed slot) the overflowed bodies burned the whole allowance and the bodies
that actually landed arrived bare, fight after fight. That reads exactly as "it only worked 4 times".

## Fix (`packages/core/src/combat/simulate.ts`)

- Inline summons: the Undertow block skips a body when the board is full right now (`overflowsNow`). Nothing
  between the grant and `placeSummon` changes occupancy on that path, so this is the same cap check.
- Deferred summons (the attack-on-summon queue, judged at land time): they still take the Ward at queue time,
  as before, and `placeSummon`'s overflow branch refunds it (`undertowWarded` WeakSet → `undertowUsed -= 1`).
  The pulse already emitted for a deferred body that later overflows is left in place (cosmetic only).
- Rise / Rebirth returns pass `capJudgedElsewhere`: the returning body still occupies its own slot, so it would
  otherwise read as a full board on a 7-wide line. Returns always land.

Fights where nothing overflows produce byte-identical event logs (same grant site, same order).

## Same pattern: the owner's rulings (2026-10-08)

These also run in `applyCombatSummonGrants` before the cap check. The owner ruled on each:

- **Rune of the Food Chain: FIXED** ("this should only work on first actual summon on board, not an overflow";
  R-FOODCHAIN-LANDED-01). It uses the same `overflowsNow` gate as Undertow, now computed once above both blocks.
  A deferred body that took the chance and then overflows hands it back (`foodChainTaken` WeakSet in the
  `placeSummon` overflow branch). Known edge: if an inline summon lands while a chance-holding deferred body is still
  queued, and that body later overflows, the chance goes to the NEXT landed body rather than back to the inline one.
  Fixing that would mean feeding deferred bodies at land time, which changes non-overflow replays.
- **Rune of the Spare Chair:** archived 2026-09-23 and not in the game. Left alone.
- **Rune of Packcraft:** "this is fine". An overflowed summon still grows the level. No change.
- **Rune of the Hatchery:** "this is fine". An overflowed summon still pulses. No change.

## Verification

- `packages/core/src/combat/undertowEveryCombat.test.ts` (7) and `packages/sim/src/undertowEveryRound.test.ts`
  (4): overflow board, deferred-Whelp refund, three consecutive fights per side, served-snapshot enemy, 2-copy
  stacking (budget 8), determinism. The overflow, refund and enemy cases fail on the old `simulate.ts`.
- `packages/core/src/combat/foodChainLanded.test.ts` (4): full-board Rally overflow, deferred Whelp refund, one
  chance per combat, determinism. 3 fail on the Undertow-only `simulate.ts`.
- Oracle: `R-FOODCHAIN-LANDED-01` and `R-UNDERTOW-LANDED-01` in `packages/rules/src/registry/approved/summoning.ts`.
