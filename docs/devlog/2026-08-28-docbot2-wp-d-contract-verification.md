# Doc Bot 2.0 — WP D: contract verification at scale (901 contracts, applicability-driven)

**Date:** 2026-08-28 · **Package:** WP D (blueprint §9 oracle engine, §10.1 isolated contract suite,
§18-D) · **Depends on:** WP B (contracts, PR #1271), WP C (trace adapter, PR #1273)

## What shipped

The vertical slice's 13 hand probes became a **derived verification sweep over the whole contract
registry** (901 today: 13 curated + 888 extracted), with honest authority labels at every step.

- **`packages/sim/src/docbot/isolatedCases.ts`** — the §10.1 case PLANNER. Pure: per contract it decides
  which case templates apply (minimum activation, plain/gilded, trigger multiplier, once-per-X, target
  cardinalities), which driver executes each, and a TYPED skip reason for everything applicable-but-unrun.
  Nine skip reasons; the sweep ledger balances (`applicable = executed + skipped`, per template).
- **`packages/sim/src/docbot/contractOracle.ts`** — the sweep. Four drivers, all through the real engine
  (§4.1): `combat-death-summon` (onDeath token counts off the event log, plain + gilded + Sylus-multiplier
  variants), `avenge-threshold` (first avenge-stamped emission ordinal vs the declared threshold — the
  temporalWindow measurement, derived, with a rune_fury resolution-only invariance check per R-AVWIN-07),
  `shop-battlecry-summon` (real reducer), `copy-policy` (the xerox reducer probe + the checked-in
  QaScenarioV1 copy fixtures, incl. the once-per-game latch used/unused pair). The frozen comparator
  (`checkContract`) judges; drivers only record.
- **`packages/sim/src/docbot/variantDiff.ts`** — the §9.2/§9.3 harness pair: `runVariantDiff(base,
  variant, relation)` plus the metamorphic laws as generic checks (irrelevant-reorder invariance,
  non-applicable-rune no-op, gilded-delta satisfaction, multiplier-resolution-only). All injectable, so
  sabotage doctors a measurement without consulting the engine twice.
- **Aspect table** — each contract row joins the WP B corroboration aspects (reused, not re-implemented),
  the new `direct-suite` aspect, and **lane citations** (temporalWindow, orderGoldens, conservationLaws +
  invariantFuzz, magnitudeOracle, economyScan, runeRewardDifferential, heroPowerLane) keyed by
  applicability. Citations are listed evidence and deliberately **excluded from the derived-status fold** —
  a family-level lane must never blanket-"corroborate" 888 drafts.
- **Findings (§6.1 drives the class)** — a mismatch against an APPROVED contract emits
  `verified-mechanical-bug` (error); against an extracted draft it emits `questionable-interaction`
  (question) — a disagreement between two machine readings, queueing review, never convicting the engine.
- **Release blockers** — `releaseBlockerFindings(allRules())` derives, from the registry itself (approved
  rules whose `currentBehaviour` records a live violation), the pinned blockers: **R-AVWIN-02 and
  R-AVWIN-10**, severity `critical` (new severity member), class verified-mechanical-bug, status `known`.
  They print in every nightly and in `npm run docbot:contracts`; the gate test pins the set so drift is loud.
- **Lanes** — the PR gate (`contractOracle.test.ts`) runs a deterministic sample (rotation by content-id
  hash of the executable-id list — clock-free, moves when content moves; approved contracts are NEVER
  sampled out). `npm run docbot:contracts` runs the full sweep (~0.2 s today); `docbot:nightly` gained a
  `contracts` lane running the full sweep and merging its findings + the blockers into `findings.json`.

## Sweep results on main (first full run)

- 901 contracts planned; 36 driver-executed (81 isolated cases), 90 path observations, **0 mismatches** —
  every executed case agreed with its contract. All 57 metamorphic checks held (reorder invariance, rune
  no-op, gilded ×2, Sylus ×2, rune_fury ordinal-invariance). The xerox once-per-game latch holds.
- Honest skip histogram: 402 no-driver-for-shape (the WP D→H burn-down list), 398 covered-by-cited-lane
  (runes/quests via their gating lanes), 58 hero-power-behaviour-unextracted, 15 gilded-not-declared
  (authored goldenText → reshape), 5 runtime-unobserved (avenge effects that fire without an attributable
  emission: solaris/b2_solaris/bonetaxer/pitsupplier/steadfast — recorded, not passed), 2 board-cap clips.
- Derived statuses: 367 corroborated · 533 extracted · 1 approved. No real mismatches found — expected at
  this stage: extracted contracts and the engine share provenance, so agreement is corroboration-grade
  until Sitting 1 approves intent.

## Judgement calls (flagging per CLAUDE.md)

- The approved-but-unenforced queue (R-PLAY-01, R-AURA-01) is **pinned shrink-only** in the gate test,
  satisfying the "0 or pinned" exit clause — enforcement lanes for those two are their own work.
- Lane citations report `agree` meaning "the cited lane gates this family green in npm test" — a family
  claim, which is why they never fold into per-contract derived status.
- Generated per-case QaScenarioV1 emission (the plan's corpus-style generated dir) was NOT built: the
  combat drivers run `simulate()` with a tier-6/all-tribes side so tribe-gated effects work, which a
  faceOmen replay would not reproduce faithfully. Findings attach the checked-in fixture ids where one
  exists (copy fixtures) and a one-line fixture description otherwise. Revisit when WP F's generators land.
- The staged `laneFindings.ts` per-lane emission retrofit (canonical-schemas §3 step 1) is deferred to its
  own wave — this PR's findings ride the nightly + docbot:contracts artifacts.
