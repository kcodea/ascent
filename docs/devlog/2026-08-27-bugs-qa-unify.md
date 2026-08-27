# Bug reports speak QaScenarioV1 — one scenario format (PR 9)

The bugs:* pipeline (built this week) emitted its own bespoke scenario shape (`scenario.json`, the
`BugScenarioFile`). The Docbot handoff's §3.3 rule is that Scene Builder, Docbot, regression tests and the
bug reporter converge on ONE serializable scenario envelope — `QaScenarioV1` (PR #1246). This PR is that
unification, applied to the bug side:

## What changed

- **`bugs:repro` now emits `qa-scenario.json`** — a valid `QaScenarioV1` with `source: 'bug-report'` —
  alongside the legacy `scenario.json` (kept for one release of overlap). New module
  `packages/tools/src/bug-qa-scenario.lib.ts` (pure, tested):
  - a **recruit/lobby report** becomes a state-only scenario (the captured `serializedRun` verbatim, no
    action) — hydrating it through the real engine IS the reproduction;
  - a **combat report that carries the fight** (phase `combat`, `lastCombat` captured, trailing accepted
    action `faceOmen`) becomes a **combat-mode scenario**: the pre-combat state is rebuilt by replaying the
    capsule's accepted-action log through the real reducer (all but the trailing `faceOmen`), and the
    captured run's own `servedBoards` pin supplies the exact opponent. `runQaScenario` then re-executes the
    real hand-off (combat rng is `mixSeed(seed, wave, TAG.COMBAT)` — cursor-independent, so the re-sim is
    exact). Falls back to a state-only scenario (with a note) when the replay diverges or the wave fought
    the procedural threat (a null pin — combat mode needs a `BoardSnapshot`).
  - **Expectations policy (§11.4 — reproduction first, assertion after triage):** a plain report's scenario
    carries ONE expectation, `needs-ruling`, wrapping the player's claim clearly marked UNTRUSTED. Triage
    upgrades it to real expectations; we never invent an expected value from player prose.
  - **Drift comparison + classification (§11.2):** repro runs the scenario through the REAL `runQaScenario`
    and compares the captured combat outcome/event log with the re-simulated one — itemized (outcome, event
    count, first differing event), never hidden. Classification: `reproduced` / `drifted` /
    `insufficient-evidence` / `menu-no-evidence` (menu reports still decline gracefully, exit 0).
- **Scene Builder reads both formats through one door**: `parseBugScenario` (ui) now sniffs a `QaScenarioV1`
  (`schemaVersion: 1` + string `source` + serialized `state`, no `kind`) with `source: 'bug-report'` and
  projects it into the same `BugScenarioFile` shape the store loads — synthetic capsule from the envelope +
  its state's own fields (`state` IS a `serialize(run)` string), `metadata.reportId` as the identity, the
  needs-ruling question as the (untrusted) description, `state.lastCombat` as the combat context when
  present. Legacy `scenario.json` parses unchanged. Content-id validation deliberately stays in
  `loadBugScenario` (`missingCardIds`), so a newer-content capture still loads READ-ONLY rather than being
  refused at parse.
- **Starter regression fixture graduates into the scenario contract (§11.4):** the generated
  `repro.test.ts.txt` now loads `qa-scenario.json` via `parseQaScenario` and executes `runQaScenario` — a
  graduated bug is a scenario fixture plus an expectation upgrade, not a bespoke test.
- **bugs:pull / bugs:list untouched** (the inbox layout, work order, summary.md safety block all unchanged);
  repro's output lists the new artifact and the `npm run docbot:scenario` re-run command.

## Sabotage coverage (§3.5)

- A doctored emitted scenario (seed mismatch; a from-the-future card id in the state) fails
  `validateQaScenario` loudly.
- A doctored captured combat outcome / event classifies as `drifted` with the first differing event index —
  never silence.
- Menu reports emit no scenario and classify `menu-no-evidence`.

Tests: `packages/tools/src/bug-repro.lib.test.ts` (new PR-9 blocks: recruit round-trip through
`runQaScenario`, combat reconciliation against a real pinned `BoardSnapshot`, both sabotages, menu),
`packages/ui/src/bug-report/bugScenario.test.ts` + `bugScenarioLoad.test.ts` (both formats through the one
parser; QA scenario loads into the sandbox run).
