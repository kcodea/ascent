# Coverage-guided corpus + nightly lifecycle lane (Docbot PR 8)

Workstream F of the Docbot handoff (§9 + §12 + §13.3): the coverage-guided corpus, the nightly
full-lifecycle lane, seed minimization, and structured findings.

## What shipped

- **Semantic coverage keys** (`packages/sim/src/docbot/coverageKeys.ts`) — `coverageKeysFor()` derives the
  §9.1 key set (effect factory executed, trigger family, guard branches, combat-mod consumed, hero-power
  family, rune reward kind, copy mode, snapshot boundary, target arity, chain-depth bucket) from one
  executed step's artifacts.
- **Coverage-guided corpus** (`corpusBuilder.ts` + `npm run docbot:corpus`) — a deterministic fuzz sweep
  (24 seeds × ≤200 steps, heroes/sets cycled) retains the smallest one-action `QaScenarioV1` that first
  reaches each key, checked in under `docbot/corpus/` (56 fixtures, 82 keys at time of writing) with a
  manifest carrying the per-fixture new-key report. Tests: byte-for-byte determinism, a doctored-seed
  digest alarm (sabotage), every fixture validates + runs green against current content.
- **Nightly lane** (`nightlyLane.ts`, `npm run docbot:nightly`, `.github/workflows/nightly.yml`) — full
  deterministic runs to elimination with serialize→deserialize checkpoints (diff, then ADOPT the restored
  state so the rest of the run proves restore-equivalence), periodic replay reconstruction from the
  recorded trace, invariant/explosion/combat-event budgets each step, and an 8-seat bot-lobby law sweep.
  Scheduled + `workflow_dispatch`; **not** a required check — it can never block a PR. Artifacts (report,
  findings JSON, minimized scenarios, original traces) upload on every run.
- **Seed minimization** (`seedMinimize.ts`) — greedy drop-one to a *proven* 1-minimal fixpoint through the
  same `driveTrajectory` checks that flagged the failure, folded into a `QaScenarioV1` + exact
  `npm run docbot:scenario --` repro line, original trace preserved as secondary evidence.
- **Structured findings** (`findings.ts`) — the §12.1 `DocbotFinding` model with §12.2 STRUCTURAL
  fingerprints (lane + content ids + rule ids + expectation kind + normalized mismatch; never message
  prose). Only the nightly emits findings so far — converting the PR-gate lanes is a later integration
  pass, on purpose.

## Judgement calls a future session should know

- **Zero engine change.** The handoff suggested a `setAvengeWindowObserver`-style tap, but the engine
  already stamps `factory:<do>:<on>` + `srcCard` on combat events (the Choreographer's `withEffect`) and
  `policyKey`/`trigger`/`parentId` on recruit beats — so coverage keys are derived from emitted artifacts,
  which is observational by construction.
- **The fuzz action policy was extended with tavern-spell buys** (`nextFuzzAction` in `trajectory.ts` —
  the invariant-fuzz policy never bought `s.spell`, leaving the entire spell-cast surface out of any
  sweep). The invariant-fuzz test keeps its own local copy untouched.
- **The corpus test does NOT golden-match the checked-in corpus against a fresh build** — any content
  change shifts shop rolls and would force regeneration on nearly every content PR. Fixtures stay valid
  as long as they validate + run green; regenerate when the test names a stale one.
- **ExplosionGuard is instantiated fresh per step** in the trajectory driver: its repeated-signature lane
  is scoped to one action loop, and across free-play steps a repeated material state is legal
  (freeze→unfreeze, reposition-and-back).
- **The §8.1 covering array is deliberately not used by the corpus** — its dimensions are reachability
  *inputs* (the recruit covering-array lane drives those directly); the corpus retains by *outputs*
  (which semantics fired).
- Every trajectory pins each unserved wave's opponent to `null` (the `runQaScenario` hermetic pin), so
  corpus fixtures and nightly traces replay identically with no session-global pool reads.

Nightly smoke on this machine: `--runs 2 --lobbies 1` → GREEN in 44s (the bot lobby dominates; the
lifecycle runs are milliseconds). Default config (6 runs, 4 lobbies) is a few minutes — nightly-sized.
