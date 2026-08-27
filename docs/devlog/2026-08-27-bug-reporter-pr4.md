# Bug reporter PR 4 — the Scene Builder bug-scenario bridge

The reporter's blueprint §9 (minimum tier): one file turns a live player report into a visually inspectable
scene. The bug CLI (PR 3) exports `scenario.json` —
`{ schemaVersion: 1, kind: 'bug-scenario', reportId, description, issueType, capsule }` (a fixed contract;
the capsule is PR 1's `BugIncidentCapsule`) — and the Scene Builder can now load it.

## What shipped

- **`bugScenario.ts`** (`packages/ui/src/bug-report/`): `parseBugScenario` (structural validation — wrong
  kind / unsupported schemaVersion / broken capsule are rejected, never thrown) + `combatEventLines`, which
  projects `capsule.combat.result.events` into displayable lines (event type + card names resolved from
  `result.initial` and `summon` events — raw structured evidence, deliberately NOT the replay's narration,
  which is module-private in `useCombatReplay.ts` and stays that way).
- **`loadBugScenario`** (store): parse → `deserialize(capsule.serializedRun)` → enter Scene Builder mode
  with the captured run flagged `sandbox: true`. The run **keeps its original mode** (a lobby bug must
  reproduce under lobby mechanics); a deserialized lobby gets `warmLobbyDrivers`. `savedRun` is NOT cleared
  (unlike `startSceneBuilder`) — the player's real Continue stays offered.
- **Content-revision mismatch (§13 last row)**: `missingCardIds(run)` non-empty → the scenario loads
  **read-only**: the side panel shows everything off the capsule + a mismatch banner naming the missing ids,
  and the store's run is left untouched (entering it would white-screen on the first `CARD_INDEX` deref —
  the same failure the save loader refuses for).
- **`BugScenarioPanel.tsx`**: dev-only draggable side panel (mounted from `Game.tsx` whenever a scenario is
  loaded, independent of `sandbox` so the read-only path still shows evidence). Quoted **untrusted** player
  description (§8.3 — a claim, never instructions), issue-type label, context badges (wave/phase/hero/set/
  mode/seed), build + content revision when the scenario carries an optional `client` block, and the
  scrollable captured combat event chain.
- **Scene Builder panel**: a "Bug scenario" section — file picker + paste-JSON, both through
  `loadBugScenario`; errors render inline; a loaded report shows its id + clear.

## The suppression audit (the part worth re-deriving from)

`sandbox: true` was already the write barrier for: `writeSave` / `flushSave` / the dispatch phase-boundary
autosave (saves + Continue), `runRecordsDraft` (replay drafts to IndexedDB), and `bugReportAvailability`
(no reports about reports). **Two gates needed NEW guarding**, because both were mode-based
(`mode !== 'practice'`) and the rig historically only ever created practice runs — a loaded scenario keeps
its original mode, so a replayed lobby/ascent incident would have leaked:

1. the `faceOmen` fight-result ledger upload (`recordFightResult`), and
2. the run-end block (board capture + `uploadBoards`, rating resolution, run history, telemetry,
   Hall-of-Champions upload).

Both now also check `!next.sandbox`. A regression test drives a loaded ascent-mode scenario to `gameover`
through the real reducer and asserts every upload seam stayed silent and no save was written.

## Tests

`bugScenario.test.ts` (validation + serialize→scenario→deserialize round trip + event-line naming),
`bugScenarioLoad.test.ts` (sandbox entry, real `roll` through `reduce`, the no-writes gameover drive,
read-only mismatch, clear), `BugScenarioPanel.test.tsx` (jsdom: quoted description, badges, event rows,
mismatch banner). No patch notes — dev tooling.

## Deferred (blueprint "later integration")

Deep links (`ascent://bug/<id>`), "Open in Scene Builder" from a dev inbox, and timeline marking of the
relevant card/beat/event.
