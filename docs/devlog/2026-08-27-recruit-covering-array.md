# Recruit boundary covering array + loop/explosion guard (Docbot PR 6)

**Date:** 2026-08-27 · **Scope:** `packages/sim/src/docbot/` (tests only — no engine/content changes)

Docbot handoff §8.1 + §8.4. Three new files:

- **`coveringArray.ts`** — a generic, fully deterministic pairwise (strength-2) covering-array generator.
  No randomness at all (not even seeded): while any dimension-level pair is uncovered, seed a row with the
  first uncovered pair in canonical order, then fill the remaining dimensions greedily. Every row covers at
  least its seed pair (which no earlier row covers), so termination and the "drop the last row → the
  all-pairs check must fail" sabotage property hold by construction. `uncoveredPairs` is the independent
  verifier.
- **`explosionGuard.ts`** — §8.4 test-level instrumentation over `reduce` dispatches: per-action budgets
  (uidSeq delta = generated cards, `recruitBuffFx` volume, hand growth; high-but-terminating → warning,
  budget exhaustion → failure) plus a repeated normalized-state-signature check (uids/rng/FX scratch
  stripped so the material projection — Gold, zones, tier — is what must not repeat; a repeat inside one
  action loop = a Gold/card cycle = failure with the chain trace). Rejected no-ops are excluded.
- **`recruitCoveringArray.test.ts`** — the §8.1 dimensions verbatim (board {0,6,full}, hand {0,near-cap,
  full}, shop {empty,partial,full}, Gold {0,exact,high}, tier {min,content,max}, srcPos, tgtPos
  {self,adjacent,edge,invalid}, plain/gilded, first/repeated, ±multiplier). **20 rows cover all 351
  dimension-level pairs against a 23,328-row Cartesian product.** Each row runs through the REAL `reduce`
  for 8 representative actions (buy / untargeted BC = Hoard Cleric / targeted BC = Twilight Emissary /
  aimed spell = Spirit Fire / untargeted spell = Growth / sell / reroll / tier-up), asserting invariants,
  not exact outcomes: no throw, rejected ⇒ identical state object, invalid-target ⇒ clean rejection,
  embers ≥ 0, board/hand within caps, uids unique, accepted Gold delta = the UI's own cost helper
  (`minionCostOf`/`refreshCostOf`/`upgradeCostOf`/`sellValueWithBonus`).

Conventions worth knowing (documented in the test header): a zone that must hold the acted card reads its
size level as the total *including* it; dimensions an action can't express (tgtPos on a reroll) are inert
for that action — coverage is a property of the array, executed across all actions. Multipliers arm through
the real engine: `q_ancient_runes` (spells ×2), `q_hoardwake_ritual` (Shouts ×2), the Tradesman price sheet
for economy rows, per-instance `sellBonus` for sells.

Sweep result at landing: **105 accepted / 120 cleanly rejected dispatches, zero invariant violations, zero
guard failures/warnings** — no real anomalies surfaced, so no excuses were registered. A vacuity floor
asserts ≥30% of dispatches actually resolve. Sabotage tests (§3.5): dropping the last row breaks all-pairs
coverage; doctored states (negative embers, board over cap, dup uids, wrong Gold delta, violated
must-reject) alarm the invariant checker; an artificial repeated signature and a uid burst alarm the guard.
A deliberately trigger-heavy loop (both ×2 multipliers + full Dragon bench + golden plays + sells/buys/
rolls) terminates clean. Whole file runs in well under a second.
