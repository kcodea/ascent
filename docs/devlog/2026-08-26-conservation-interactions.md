# 2026-08-26 — Conservation-law invariants + the trigger-family interaction matrix

Blind-spot class 3 (interaction bugs) gets two complementary instruments — test-only, no engine changes.

## Part A — conservation laws (`packages/sim/src/docbot/conservationLaws.test.ts`, tripwire 15)

Transition-level laws that catch two effects composing badly without enumerating pairs, each at the
strongest PROVABLE grain, each with a sabotage check proving it can alarm:

- **Gold ledger.** Audit result: `embers` has exactly three writers — `spendGold` (books into `goldSpent`),
  `gainGold` (positive only), and the start-of-turn refill. The state keeps no income journal, so the fuzz
  law is: `goldSpent` monotone + within a non-turn-advancing recruit action, `Δembers + ΔgoldSpent ≥ 0`
  (every ember lost is booked) + embers a non-negative finite integer. Exact reconciliation lives in
  targeted probes: buy/sell/roll/upgrade move gold by exactly `minionCostOf` / `sellValueWithBonus` /
  `refreshCostOf` / `upgradeCostOf`; freeze/reposition move nothing.
- **Combat event-log reconstruction.** A minimal reducer replays the log over `result.initial`:
  survivor sets from summon/death/reborn/ascend must reconcile with the outcome and with the loss-damage
  formula (`enemy tier + Σ tier(survivors)`). The test documents which event types are presentation-only
  and which carry deltas outside the tracked dimensions. 30 seeded random-board combats.
- **Stat provenance (shop).** Every `recruitBuffFx` record must describe a real, correctly-sized stat
  change (no phantom/overstated fx). The converse is deliberately NOT asserted — self-buffs, direct
  reducer buffs, run-wide enchants and triple merges are legitimately unrecorded channels.

## Part B — trigger-family matrix (`packages/sim/src/docbot/interactionFamilyMatrix.test.ts`, tripwire 16)

Family-PAIR compositions, pinned only where a ruling already exists (8 fixtures), with a coverage table in
the test header so gaps are inspectable. Pinned: shop Shout replays honour Drakko but not the play-only
extras; same-card non-stacking best-of + golden ×2; Echo multipliers additive (Sylus stacks, Sylus+Zyff
sum+best); forced Echoes (Deathsayer) = `(1 + echo extras) × firer gild`, multiplicative ACROSS families
with the rally fold; rally doublers all additive (card multiplier + Rallying Offensive); Ruby bounces never
re-bounce (exact counts).

Four compositions had NO establishable ruling and looked genuinely debatable — documented verbatim in
**`docs/rulebook/interaction-ambiguities.md`** (owner triage-card format), not guessed, not seeded:

1. Different non-stacking multipliers of one family collapse to best-of (Drakko+Zyff, Uron+Chronos) while
   each text promises "+1 additional" — and Zyff's own def comment says it "stacks with Drakko".
2. Combat Shout re-fires (`replayCombatBattlecry`) ignore Battlecry multipliers entirely, while the shop
   replay folds them in — the one family the 2026-08-20 "multipliers follow the trigger" principle was
   never applied to.
3. Empty Graves' forced Echo fires flat once; every other forced-Echo path multiplies.
4. Forced no-death Echoes consume the once-per-combat first-Echo bonus (Grave Contract etc.).

Items 2 and 3 smell like real bugs rather than design; they are on the board for the owner either way.
