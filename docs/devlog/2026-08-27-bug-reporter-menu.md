# Bug reports from the main menu (owner ask 2026-08-27)

The owner: "id like to be able to log bugs in the main menu too so i can log them without being in a game,
so if i see something and go to log it later etc i can do it from the menu and explain it."

## What shipped

- **Menu capsule** (`captureMenuCapsule` in `packages/ui/src/bug-report/bugReportCapture.ts`): a reduced
  incident capsule for reports opened on the title screen, where no run exists. NO run evidence —
  `serializedRun: null` (the field is now explicitly nullable in `BugIncidentCapsule`), empty
  actions/frames, `combat: null` — the player's typed description IS the payload. Full client context
  (build, platform, session) still rides along; `setId` reads the LIVE registry (`activeSet()` — a
  sanctioned pre-run read, same as the title Compendium).
- **Intake sentinels**: the deployed `submit-bug-report` Edge Function requires heroId/seed/wave/phase/patch
  and was deliberately NOT changed. A menu capsule stamps `heroId: 'none'`, `seed: 0`, `wave: 0`,
  `phase: 'menu'`, `mode: 'menu'` — satisfying the intake as-is.
- **Surfaces**: `bugReportAvailability` gained a `'menu'` outcome. Ctrl+B now opens on the title screen; the
  title check runs FIRST so leftover run flags (tutorial/sandbox/gameover from the previous game) can't veto
  a menu report. Hero select, practice setup, the replay viewer, Scene Builder, tutorial runs, and
  presentationTx stay excluded exactly as before. A visible low-key **"Report a Problem"** entry joined the
  title's secondary link row (beside Patch Notes), routing through the same `openBugReport()` authority.
- **Modal copy** in menu context: a `MENU` badge (no round), the auto-context line reads
  "No run active — this report carries your description and build info.", the summary row shows
  "Main menu" instead of round/phase/hero, and Technical details prints "menu report · no run evidence".
- **Queue/upload**: unchanged — menu envelopes flow through the same IndexedDB queue + Edge Function;
  `validateBugReportEnvelope` accepts the reduced capsule (and rejects a menu capsule that smuggles a
  `serializedRun`, or a run capsule missing one).
- **Bug Board**: a `phase: 'menu'` row renders "— · menu · set" instead of the run-identity line.

## Contract for evidence consumers

Any consumer of run evidence (bugs:repro, the Scene Builder bridge) must treat `phase: 'menu'` /
`serializedRun: null` as "menu report — no run evidence" and decline gracefully — never as a corrupt run.
