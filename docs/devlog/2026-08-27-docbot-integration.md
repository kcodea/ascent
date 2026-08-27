# 2026-08-27 — Doc Bot integration: one report for the whole system

The final pass of the next-iteration handoff (PR 0's closing clause + §12.4): `npm run docbot` now presents
every landed lane as one picture. Changes:

- **Self-verifying lane inventory**: the 18 lanes landed 2026-08-27 print with their gate files
  `existsSync`-checked — a renamed/deleted gate shows `✗ MISSING` instead of silently rotting (the check
  caught two wrong filenames during its own authoring).
- **Rulebook picture**: total rules, pending owner questions, and the approved-but-unenforced queue inline.
- **Command surface**: docbot:scenario / docbot:corpus / docbot:nightly / rules:seed / rules:impact / bugs:*.
- **`--json`** (§12.4): the open queues (phase triage, rune-duplicate swallows, scenario-conditional combat,
  unenforced rules) emitted as fingerprinted `DocbotFinding`s via the PR 8 findings module.
- Stale narration fixed: the hero-power line now reflects the drained passive queue (stagers, needs-stager 0).
- docs/docbot.md gained the one-QA-system section: QaScenarioV1 as the keystone, 14/14 measured retro,
  KNOWN_VIOLATIONS as the honest remainder.
