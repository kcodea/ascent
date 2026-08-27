# In-game bug reporter — PR 1/5: Ctrl+B incident capture + modal

The first slice of the bug-reporter blueprint (Codex, `ascent-bug-report-feature-blueprint.md`): a player
presses **Ctrl+B** mid-run and gets a glass modal with an **immutable incident capsule** already captured —
serialized run, full action log, this wave's + last wave's Replay V2 frames, the authoritative `lastCombat`
event log, UI diagnostics, and build provenance. PR 1 stops at a **DEV-build JSON export** on submit; the
IndexedDB queue + Supabase intake are PR 2, the Claude inbox/repro tools PR 3.

## Shape

- `packages/ui/src/bug-report/` — `bugReportTypes.ts` (schema v1), `bugReportValidation.ts` (hand-rolled,
  no zod: UI diagnostic payload, not engine content), `bugReportCapture.ts` (pure capture over a structural
  store slice + `bugReportAvailability` policy), `bugReportHotkey.ts` (one thin window listener),
  `BugReportModal.tsx`, plus three test files (37 tests).
- Store (`store.ts`): `bugReportOpen` / `bugReportDraft` / `bugReportToast` / `bugReportFocusSeq` +
  `openBugReport` / `updateBugReportDraft` / `cancelBugReport` / `submitBugReport`. **Capture happens
  synchronously in `openBugReport`, before the modal opens**, and the capsule is deep-frozen (`structuredClone`
  of everything shared, so freezing can never bite live state). The PR 2 queue seam is marked in
  `submitBugReport`.
- Pause: ONE line in `Recruit.tsx` — `s.bugReportOpen` folded into the existing `overlayOpen` expression —
  pauses BOTH the recruit clock and combat playback (`paused: overlayOpen`). Deliberately NOT in the
  clock-reset effect's deps, so open/close resumes from the exact displayed second. A source-contract test
  pins all three facts.
- Hotkey mounted in `Game.tsx` (root shell). All policy lives in `openBugReport`; the modal claims Esc/Tab
  with a capture-phase listener so the shell's EscMenu/Minion-Book listeners can't fire underneath it.

## Owner decisions honored

- Enabled in live/lobby AND Practice (`mode` stamps the capsule); silently disabled on title, hero select
  (+ practice setup), tutorial runs, replay viewer, Scene Builder, game over. During `presentationTx` it
  shows the §4.3 toast ("Finish the current effect…") and never touches the held transaction.
- The capsule stays out of `RunState`, `replayActions`, saves, and replay frames.
- No patch-notes entry — the player-facing loop completes in PR 2.

## Adaptations from the blueprint sketch (flagged for review)

- `combat.rawEvents` folded into `combat.result.events` — `lastCombat` IS the `CombatResult`; duplicating the
  event array would double the payload. `visibleMomentIndex`/`visibleEventStep` ship as `null` (§4.2 sanctions
  this; the combat hooks don't expose the moment cheaply).
- `contentRevision` = `<setId>+<build sha>` (no dedicated content-revision stamp exists).
- `runId` = `<seed>:<heroId>`; `ui.selectedCardUid`/`draggingCardUid` are `null` in v1 (inspect view carries
  no uid; drag state is Recruit-local and ends when the modal opens).
- `contextTruncated: []` exists now so PR 2's §3.5 trimming has a stable home.

## Test infra note

Mirrors the rendered-text branch's jsdom setup **verbatim** (same `vitest.config.ts` include line, same
`jsdom` devDep line, same per-file `@vitest-environment jsdom` + tiny createRoot/act mount) so the two
in-flight PRs merge without conflict whichever lands first.
