# QaScenarioV1 — the shared QA scenario contract + pure runner (Docbot next-iteration PR 1)

**Date:** 2026-08-27 · **Scope:** dev tooling only (no gameplay change, no patch notes)

The keystone of the Docbot next-iteration handoff (§4, Workstream A): ONE serializable scenario envelope
that Scene Builder exports, Docbot scans emit, bug-report repro converts into, and regression tests check
in — so every new source of QA evidence strengthens the same system instead of growing another bespoke
fixture format.

## What shipped

- **`packages/sim/src/qaScenario.ts`** — the engine-neutral schema (`QaScenarioV1`), the closed expectation
  vocabulary (`state-delta`, `event-count`, `card-delta`, `summon-count`, `no-op`, `needs-ruling`,
  `invariant`), hand-rolled validation (sim deliberately gains no zod dep), the `QA_INVARIANTS` registry
  (embers-non-negative, board-within-cap, stats-finite), and the pure runner `runQaScenario(scenario)`.
- **Execution is the REAL engine only** (§3.1): recruit actions dispatch through `reduceWithPresentation`
  (so emitted presentation events are part of the observable result); combat mode pins
  `scenario.combat.opponent` into `servedBoards` and dispatches the real `faceOmen` hand-off — never a side
  path around the reducer.
- **Determinism is a tested contract**: the runner pins the wave's opponent before dispatch (the scenario's
  own board in combat mode, a procedural `null` pin otherwise) so the session-global opponent pool can never
  leak in; results carry no wall-clock; `stableStringify` (the docbot `stable()` pattern) normalizes states;
  running the same scenario twice is asserted byte-equal.
- **CLI**: `npm run docbot:scenario -- <path-or-id>` (`packages/tools/src/qa-scenario-run.ts`) — bare ids
  resolve in `packages/sim/src/docbot/scenarios/`; exit code = verdict.
- **Two converted fixtures** (checked-in, `packages/sim/src/docbot/scenarios/`): `recruit-cleric-buff`
  (the playScan differential shape — Hoard Cleric's printed +3/+3 to other Dragons) and
  `combat-generic-wave1` (the combatScan shape — a seeded fight, golden outcome/event-count pinned from the
  engine). `packages/tools/src/qa-scenario-gen.ts` regenerates them (rare, deliberate — read the diff).
- **Tests** (§15 + §3.5): JSON round-trip stability, byte-equal double-run, unknown-content-id loud
  failures, a schema-migration guard (any version ≠ 1 fails naming the version), no-op/needs-ruling
  semantics, SABOTAGE checks (a doctored card-delta / event-count fails naming expected vs observed), and a
  parity suite (`docbot/qaScenarioParity.test.ts`) proving the runner and the original direct
  `reduce`/`faceOmen` paths produce byte-identical normalized after-states.

## Contract notes for the follow-up PRs (Scene Builder bridge, temporal oracle, bug repro)

- `expectations` is PLURAL (an array) — the handoff sketch's singular `expectation` was widened because one
  scenario routinely asserts a delta AND an invariant AND an event count; `needs-ruling` entries pass while
  surfacing in `result.needsRuling`.
- The envelope carries ONE action. A targeted Battlecry pauses in `pendingTarget` for a follow-up
  `battlecryTarget` — a two-action sequence V1 cannot express. Multi-action scenarios are an explicit future
  schema bump, not a bolt-on.
- `state` is the opaque `serialize()` string, healed by `deserialize` on hydration — so run-state field churn
  does not bump the schema; card REMOVAL is what invalidates a fixture (validation names the id).
- Scene Builder (PR 2) should export via `serializeForScenario` + this validator, and import through
  `runQaScenario`'s hydration door, never production save data.
