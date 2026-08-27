# Scene Builder ↔ QaScenarioV1 bridge (Docbot handoff §4.5, PR 2)

The Scene Builder can now speak the keystone scenario format from PR 1 (#1246). A dev-only **QA scenario**
section in the panel adds five controls:

- **Export** — serializes the CURRENT live run into a `QaScenarioV1` (`source: 'scene-builder'`,
  `state` via `serializeForScenario`), downloads the JSON and copies it to the clipboard. A recruit-phase run
  with a pinned served opponent for the current wave exports as `mode: 'combat'` carrying that exact
  `BoardSnapshot` (the point of authoring an enemy board is the fight); anything else exports as a
  `mode: 'recruit'` state-assertion scenario with no action.
- **Run headless** — executes the current export through `runQaScenario` right in the browser (it is pure
  `@game/sim` code) and renders the runner's summary + expectation verdicts in the panel.
- **Copy repro command** — puts `npm run docbot:scenario -- <id>` on the clipboard (bare ids resolve in
  `packages/sim/src/docbot/scenarios/`).
- **Save as regression fixture** — POSTs the export to the new dev-server endpoint `/__qa-scenario/save`
  (`apps/web/qaScenarioPlugin.ts`, `apply: 'serve'` like every other write plugin), which writes it into the
  checked-in fixture directory. The filename derives server-side from a strictly-slugged scenario id (no
  client paths); an existing fixture is refused without an explicit `overwrite: true`.
- **Import** — file picker + paste-JSON, routed through the store's new `loadQaScenario`:
  `parseQaScenario` validation (a stale/doctored content id fails with the offending id named and a
  "regenerate the scenario" pointer), then hydration through the SAME suppression-guarded sandbox door as
  `loadBugScenario` — `sandbox: true` is the write barrier, verified against every write path: `writeSave` /
  `flushSave` / the dispatch autosave, `runRecordsDraft`, `bugReportAvailability`, the fight-result upload
  gate, and the run-end capture/rating/telemetry block. A combat scenario's authored opponent is re-pinned
  into `servedBoards` on entry so the fight the player watches is the one the headless runner resolves.

Pure logic lives in `packages/ui/src/qaScenarioBridge.ts` (envelope assembly, ids, filenames, repro command)
so it unit-tests without a browser; the panel is DOM plumbing only.

## §4.6 acceptance proof (`qaScenarioBridge.test.ts`)

- Export → headless run → re-import: the hydrated state normalizes byte-equal (`normalizeRunState`) to the
  exported run.
- Combat agreement: an export with a pinned opponent resolves headlessly to the same combat result, event
  sequence, and byte-identical normalized after-state as the direct `reduce(state, faceOmen)` path — and
  byte-equivalent across two runs.
- Sabotage (§3.5): a doctored board card id and a doctored opponent card id both fail import naming the id.
- `qaScenarioLoad.test.ts` proves the store door: invalid/stale files never touch the store, a valid import
  enters flagged `sandbox` with `savedRun` untouched, and the opponent re-pin lands.
- `qaScenarioPlugin.test.ts` covers the save planner: slug/traversal guard, overwrite refusal, size cap.

No production code path loads scenario files: the Scene Builder mounts only under `import.meta.env.DEV`, and
the save endpoint is `apply: 'serve'`. No patch notes (dev tooling).
