# Doc Bot 2.0 — WP F: interaction graph, pairwise coverage, anomaly oracle (Sitting-2 material)

Blueprint §10.2–§10.5 + §9.7 + §18-F (docs/docbot2/work-package-plan.md WP F; canonical-schemas.md binding).

## What shipped

- **Interaction graph** (`packages/sim/src/docbot/interactionGraph.ts`, §10.2): pure derivation from the
  901-contract registry — **1,552 nodes / 4,693 edges** (content 901, trigger-family 62, effect-family 541,
  keyword, persistence, copy-mode, counter, multiplier, zone, phase-boundary — plus the `channel` join
  node, see judgement calls). Edge vocabulary: produces/consumes (the two halves of produces-consumed-by),
  multiplies, copies, shares-counter, moves-zones, changes-target-pool, changes-category, `has`
  (membership); `suppresses`/`replaces` are reserved with zero derivable substrate — reported as 0, never
  invented. Derivation is deterministic (twice → byte-identical, pinned) and structurally validated
  (`graphErrors`, sabotage-proven against a doctored edge).
- **Applicability engine** (`candidatePairs`): producer → channel → consumer join ONLY — **93,144
  candidate pairs vs 405,450 naive all-pairs (23%)**, per-channel breakdown in the report. Unmapped
  triggers are confined to the `hero:`/`objective:` namespaces by a gate test — a new ordinary trigger with
  no channel mapping fails CI.
- **Pairwise coverage** (`interactionSweep.ts`, §10.3): all 15 priority pair families staged; **9 with
  real-engine generic drivers** (trigger×multiplier, summon×watcher, death×Avenge, death×Echo, Echo×Rise,
  copy×counter, gilding×progress, rune×minion, spell×improvement, overflow×summon) and 5 **visibly
  blocked** with typed reasons + citations (hero-power×rune, shop-spell×copier, consume×buffs,
  granted-effect×snapshot, type-aura×plain-copy). Every row lands in the §15.5 table
  (covered/failed/inapplicable/blocked-with-why); full sweep = **144 rows, 83 covered, 0 failed** in ~0.1s.
  PR gate (`interactionSweep.test.ts`, oracle lane `interactionSweep`) runs a deterministic 3-candidate
  sample; full sweep + §10.4 triples behind `npm run docbot:interactions` and folded into
  `docbot:nightly` (red on a failed pair diff).
- **Targeted triples** (§10.4): all 8 high-risk triples staged nightly-only — 3 executable
  (summon+overflow+payoff, gilding+progress+duplicate-effect, and the avenge stacked-multiplier probe),
  5 blocked with citations (temporalWindow / interactionFamilyMatrix own several legs already).
- **Combination coverage identity** (§10.5): `combinationKey()`/`combinationParts()` in coverageKeys.ts —
  `combo:<part>+<part>[+…]`, sorted-part identity. The sweep records **12 combination keys** today
  (combo:echo+rise, combo:multiplier:deathrattle+trigger:onDeath, combo:copy:exact+counter:per-instance+gild,
  …). Corpus single keys untouched.
- **Historical generalization** (`retroInteractionMap.ts`): every reinject.py catalog entry (parsed live by
  the gate, so the map can never lag) mapped to the generalized interaction family and/or the lane that
  catches its class; all 14 verified by the measured 2026-08-27 reinject runs (docs/docbot-roadmap.md:
  14/14 caught). Multi-system entries must name a live interaction family — enforced.
- **Anomaly oracle** (`anomalyOracle.ts`, §9.7): 7 detectors over the sweep's traces + contracts
  (multiplier-factor-divergence, irrelevant-change-sensitivity, copied-source-unexpected-state,
  event-without-contract-consequence, extreme-resource-outlier, unruled-multiplier-composition,
  silently-swallowed-trigger). Every finding is `class: 'questionable-interaction'` with ≥2 competing
  interpretations — the constructor hardcodes it, nothing can promote to verified (§4.3). Confidence floor
  ('strong' default) + fingerprint dedup: **3 anomalies emitted, 24 suppressed below floor** (visible
  counts).
- **Sitting-2 deck (dormant)**: the 3 anomalies ship as pending question cards at the fly-through bar
  (≤30-word statement, verbatim card text, ✓/✕/✎ micro-tail) in
  `packages/rules/src/registry/pendingInteractions.generated.ts`, written by `npm run docbot:interactions`
  through the shared seed hygiene, decided through the same board + decisions.json, enforced by the new
  `interactionSweep` oracle lane. **Nothing schedules a sitting — the main session does.**

## The 3 anomalies (owner Sitting-2 material)

1. `q-interact2-*` **Kennelmaster copy carries unstated gilding** — Xerox's exact copy carries `golden`
   which kennel's contract does not state as riding (its rides list covers the improve counters only).
   Over-carry bug vs incomplete contract.
2. **Uron, Oathbringer** — multiplies endOfTurn + startOfCombat with no ruled composition law (the
   interactionFamilyMatrix Q1 class; battlecry/deathrattle/rally/avenge are ruled, these are not).
3. **Chronos** — same class, endOfTurn.

## Judgement calls

- **`channel` node kind added beyond §10.2's list**: the "produces event consumed by" edge is realized as
  the join through a channel node — that is what makes candidate generation O(channels) instead of the
  all-pairs brute force §10.3 forbids. Documented in the module header.
- **summon×watcher measures a state DIFFERENTIAL** (watcher present vs absent), with the envelope's
  sourceTrigger as corroboration — several watcher factories act without an attributable emission today
  (the WP C instrumentation gap). A no-delta staging is `blocked: no-observable-emission`, never a guessed
  'failed'.
- **`avenge` counted as a ruled multiplier family** (R-AVWIN-07 + the multiplier-resolution-only law) so
  rune_fury doesn't false-flag in detector F.
- The two hand-pinned matrices stay the floor; nothing retired (current-state-map §5).

Gate: typecheck + lint + full vitest (515 files / 7,445 tests) + build:web + harness all green; PR-gate
additions run in well under a second.
