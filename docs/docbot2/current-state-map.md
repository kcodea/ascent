# Doc Bot 2.0 — Current-State Architecture Map (WP A deliverable 1)

> Snapshot: 2026-08-27, `origin/main` @ `5a1143ca` (#1261). PRs #1262 (THIS TURN rule +
> R-TURN-01), #1263 (multiplier folding + family-matrix pins), #1264 (rune duplicate stacking —
> drains the 80-item swallow queue to 0) were **in flight** at writing; rows below note where they
> move a number. Blueprint: `Documents/Codex/2026-06-29/files-mentioned-by-the-user-codex/`
> `DOCBOT_2_DEFINITIVE_QA_PLATFORM_HANDOFF.md` (§5 asks for exactly this map).

Migration actions: **keep** (unchanged, already canonical) · **extend** (canonical, grows optional
fields/paths) · **replace** (superseded by a platform component once equivalent coverage exists) ·
**retire** (delete/tombstone after replacement proves out). Per §5: nothing is renamed or moved for
neatness — only where a row removes actual duplication.

## 1. Entry points and report

| Capability | Implementation path(s) | Schema(s) | Producers | Consumers | Action | Blueprint § |
|---|---|---|---|---|---|---|
| Doc Bot report / narrator | `packages/tools/src/docbot.ts` (182 lines; runs live only runeSwallowScan, playScan, combatScan, a local ratchetScan, a factory×phase walk, the @game/rules query; the other 18 lanes are an `existsSync` inventory) | `DocbotFinding[]` under `--json` (4 queue lanes) | npm run docbot | humans; CI indirectly via the vitest lanes it inventories | **extend** — becomes the findings aggregator; the existsSync inventory is replaced by lanes emitting findings (see §6 below) | §12, §15 |
| Scenario CLI | `packages/tools/src/qa-scenario-run.ts` | QaScenarioV1 | npm run docbot:scenario | devs, repro commands | **keep** | §8 |
| Corpus CLI | `packages/tools/src/qa-corpus-build.ts` | QaScenarioV1 + manifest | npm run docbot:corpus | coverageCorpus.test.ts | **extend** — coverage identity grows semantic-combination keys (§10.5) | §10 |
| Nightly CLI + workflow | `packages/tools/src/docbot-nightly.ts`, `.github/workflows/nightly.yml` | nightly-report.json, findings.json, minimized QaScenarioV1 | cron 17 9 * * * | artifacts, humans | **extend** — grows the §17.2 nightly lane content; weekly/deep lane added beside it | §17 |
| Fixture generator | `packages/tools/src/qa-scenario-gen.ts` (npx tsx, deliberately un-scripted) | QaScenarioV1 | manual | 2 of the 4 checked-in fixtures | **keep** | §8 |

## 2. Scenario + reproduction system

| Capability | Implementation path(s) | Schema(s) | Producers | Consumers | Action | Blueprint § |
|---|---|---|---|---|---|---|
| Scenario schema + runner | `packages/sim/src/qaScenario.ts` (537 lines: types + validator + normalizer + `runQaScenario`) | **QaScenarioV1** (schemaVersion 1; 7-kind QaExpectation; 3 QA_INVARIANTS) | Scene Builder, bugs:repro, corpus builder, seedMinimize.specToScenario, qa-scenario-gen | CLI, parity test, corpus test, store.loadQaScenario, parseBugScenario | **extend** — THE canonical scenario schema; optional capsule fields added per `canonical-schemas.md` §1; never a V2 | §8.1 |
| Curated fixtures | `packages/sim/src/docbot/scenarios/` (4) | QaScenarioV1 | mixed (2 gen, 2 temporal-PR regression) | bare-id CLI resolution, dev-server save target | **keep** — becomes the curated-regression store seed (§14); stays separate from generated corpus per §4.6 | §14 |
| Generated corpus | `packages/sim/src/docbot/corpus/` (56 + manifest, digest 76c17806) | QaScenarioV1 + manifest | docbot:corpus | coverageCorpus.test.ts | **keep** (regenerable; never mingled with curated) | §10 |
| Headless drive | `packages/sim/src/docbot/trajectory.ts` (driveTrajectory, DriveOutcome, DriveViolation) | TrajectorySpec | lanes, nightly, minimizer | same | **extend** — grows semantic-trace collection when WP C lands | §8 |
| Minimization | `packages/sim/src/docbot/seedMinimize.ts` (greedy drop-one, 1-minimal, structural predicate) | TrajectorySpec → QaScenarioV1 | nightly | nightly artifacts | **extend** — grows the §13 ladder (entities, stats, runes, RNG simplification); action-only today | §13 |
| Scene Builder QA bridge | `packages/ui/src/…/qaScenarioBridge.ts` + panel; `apps/web/qaScenarioPlugin.ts` | QaScenarioV1 | export/save/import UI | dev server, fixtures | **extend** — grows §8.4 (load capsule, step semantic events, first-divergence highlight, graduate) | §8.4, §15 |
| Bug report capture (Ctrl+B) | `packages/sim/src/bugReport.ts` (types), ui capture on open | BugIncidentCapsule v1 (full uncapped action log; combat.result IS the raw event log) | client | Edge Function, IndexedDB queue, .local inbox | **extend** — grows rolling per-action RNG/target windows + reportMoment (§8.2); the capsule is already the exact-repro substrate | §8.2 |
| Bug→QA conversion | `packages/tools/src/bug-qa-scenario.lib.ts`, `bug-repro.lib.ts` | QaScenarioV1 (`bug-<id8>`), repro classifications ('reproduced'/'drifted'/'insufficient-evidence'/'menu-no-evidence') | bugs:repro | .local inbox, devs | **extend** — classification vocabulary widens to the §8.3 seven-way enum; graduation command added (§14) | §8.3, §14 |
| Bug Board + bugs:* CLI | `packages/ui/src/BugBoard.tsx`, `apps/web/bugBoardPlugin.ts`, `packages/tools/src/bug-inbox.lib.ts` | BugIndexEntry, BugWorkOrder | bugs:pull, Supabase | owner triage | **extend** — becomes the §15.1 findings inbox for the report-shaped half | §15 |
| Replay V2 | `packages/sim/src/replayV2.ts` (frames are ground truth; playback never re-simulates) | ReplayV2 v2 | live recording | replay UI, bug capsule (2-wave window) | **keep** — presentation replay; QA repro is re-simulation + drift rail, a deliberate second mechanism, not duplication | §8 |
| Opponent pinning | `packages/sim/src/snapshot.ts` servedBoards | BoardSnapshot v1 | run recording | simulate, QA runner hermetic pin | **keep** | §8 |

## 3. Rules registry + owner workflow

| Capability | Implementation path(s) | Schema(s) | Producers | Consumers | Action | Blueprint § |
|---|---|---|---|---|---|---|
| Rules registry | `packages/rules/src/` (schema, index, registries: approved 28 (+R-TURN-01 with #1262), pending.generated 3, pendingManual 0, retired 43+1, decisions.json 47) | GameRule (4-value RuleStatus + orthogonal RuleEnforcement; effectiveStatus derived) | rules:seed, hand-authoring, owner clicks | enforcement.test.ts, docbot, triage UI, rules:impact | **extend** — THE canonical rule registry; optional RuleContract fields added per `canonical-schemas.md` §2; blueprint's 5-state enum is a *view*, not a migration | §6.2 |
| Enforcement loop | `packages/rules/src/enforcement.ts` (16 lanes, refs-must-exist-on-disk, approved-but-unenforced ratchet = [R-PLAY-01, R-AURA-01]) | RuleEnforcement | hand-wiring per rule | enforcement.test.ts, docbot line + `--json` lane | **extend** — grows regressionScenarioIds + per-rule coverage reporting (§6.2 approval gate) | §6.2 |
| Owner triage UI | `packages/ui/src/RulebookTriage.tsx` (160 lines; **zero keyboard support today**) + `apps/web/rulebookPlugin.ts` (a click = a git-tracked decisions.json write) | RuleDecision | owner clicks | decisions.json | **extend** — rapid-fire questionnaire mode per `owner-review-pipeline.md` §4 | §15.3, owner bar |
| rules:impact | `packages/tools/src/rules-impact.ts` + `packages/rules/src/ruleImpact.ts` | touchedRules | CLI over git diff | devs; docbot aggregate later | **extend** — wired into the PR gate (§17.1) | §17.1 |

## 4. Trace / event substrate

| Capability | Implementation path(s) | Schema(s) | Producers | Consumers | Action | Blueprint § |
|---|---|---|---|---|---|---|
| Combat event log | `packages/core/src/types.ts` CombatEvent union (26 types; shared tail step?/avenge?/key?/srcCard?/wave?; **no eventId/parent/cause/rng**) | CombatEvent | simulate() single emit chokepoint | UI choreo, conservation law 2, coverageKeys, bug capsule | **extend** — adapted into SemanticEvent by a thin trace adapter (§7.4 "existing stamps may be adapted"); the union itself is untouched (shared-boundary file) | §7 |
| Recruit presentation envelope | `packages/core/src/presentation/events.ts` (259 lines: SourceTriggerEvent with parentId/dependencyIds/phase, 13 ConsequenceEvent variants with permanent, PresentationBatch.actionId) + collector.ts | GamePresentationEvent | ~62 emit sites in recruit.ts/reducer.ts | beats/choreo (DEV + EoT only) | **extend** — **this is ~70% of SemanticEvent already**; the canonical trace envelope grows from here, not from a new format | §7.3 |
| Policy registry | `packages/core/src/presentation/policies.ts` (856 entries, 28 families, mandatory reason on intentionallySilent) | presentation policy | hand-authored | choreo, beats:audit | **keep** — also the seed for convention clustering (`owner-review-pipeline.md` §3) and suppressionReason source | §7, §15.5 |
| Capture flag | `reduceWithPresentation(state, action, capture)`; `store.ts` captureBeats = `import.meta.env.DEV`; EoT always true | — | — | — | **replace** — the DEV-only gate is the production trace gap; replaced by lightweight always-on bounded capture (`canonical-schemas.md` §4.5) | §7.4, §8.2 |
| RNG | `packages/core/src/rng.ts` (mulberry32; `fork()` unlabelled and unused in prod; mixSeed + 9 TAGs; RunState.rngCursor) | — | everywhere | everywhere | **extend** — WP C adds an *observational* roll tap (no new consumption, no signature change); today there is **zero decision-trace substrate** | §7.3 rng, §23 |
| Coverage keys | `packages/sim/src/docbot/coverageKeys.ts` (post-hoc semantic keys from existing stamps, zero engine change) | key families | corpus builder | corpus tests | **extend** — the proven precedent + first consumer for the trace adapter | §10.5 |
| Telemetry | `packages/sim/src/runTelemetry.ts` (one aggregate row/run) | run_telemetry | live fold + reconstruction | backend | **keep** — analytics, not QA; out of platform scope | §22 |

## 5. Oracle lanes (all vitest-gated in `npm test` unless noted)

| Capability | Implementation path(s) | Action | Blueprint § |
|---|---|---|---|
| Temporal trigger-window oracle | `packages/sim/src/docbot/temporalWindow.test.ts` (setAvengeWindowObserver chokepoint; enforces R-AVWIN-01…11; KNOWN_VIOLATIONS shrink-only) | **keep** — already the §9.5 temporal oracle for its families; grows siblings under WP D | §9.5 |
| Text oracle tranches T1–T3 | `textOracle.ts` / `textOracleSummons.ts` / `textOracleEconomy.ts` + gates | **extend** — grows into the §11 parser/contract comparison; grammars become ParsedTextContract seeds | §9.6, §11 |
| Rendered-text | `packages/ui/src/renderedText.test.tsx` + mount/registry | **keep** | §11 |
| Live-text tripwires | `packages/ui/src/docbotLiveText.test.ts`, `liveTextAudit.test.ts` | **keep** | §11 |
| Target/cardinality | `packages/sim/src/docbot/targetCardinality.ts` + gate (shares fixtures with textOracle by import — a designed self-agreement) | **extend** — grows into contract-oracle target checks | §9.1 |
| Hero-power lanes | `heroPowerLane.test.ts`, `heroPowerStagers.test.ts` + `heroScan.ts`, `heroPowerFamilies.ts` | **keep** | §9 |
| Recruit covering array + explosion guard | `coveringArray.ts`, `explosionGuard.ts`, `recruitCoveringArray.test.ts` | **keep** | §10.3 |
| Coverage corpus gate | `coverageCorpus.test.ts` | **extend** (semantic-combination identity) | §10.5 |
| Nightly lifecycle + lobby | `nightlyLane.ts` + test | **extend** | §17.2 |
| carryOver scan | `carryOverScan.ts` + gate (regexes reducer.ts reset block — mitigated self-agreement) | **keep** | §9.4 |
| Snapshot fidelity | `snapshotFidelity.test.ts` + `snapshotRegistry.ts` | **keep** | §9.4 |
| Conservation laws | `conservationLaws.test.ts` (gold ledger, event-log reconstruction, stat provenance) | **keep** — already the §9.4 invariant-oracle core | §9.4 |
| Interaction matrices (two siblings) | `interactionMatrix.test.ts` (multiplier worklist) + `interactionFamilyMatrix.test.ts` (ruled family pairs, ambiguity outlet) | **extend** — WP F's interaction graph generalizes them; retire only after §10.2–10.4 supersede (per §21 "retire superseded probes only after equivalent or stronger coverage") | §10.2 |
| Economy scan | `economyScan.test.ts` | **keep** | §9.4 |
| Lobby properties | `lobbyProperties.test.ts` | **keep** | §9.4 |
| Guard reachability | `guardReachability.test.ts` (21/21 armed) | **keep** | §9.1 |
| Order goldens | `orderGoldens.test.ts` (+ `docs/rulebook/order-ambiguities.md`) | **keep** — already the §9.5 order oracle for its fixtures | §9.5 |
| Rune-duplicate scan | `runeSwallowScan.ts` (shared gate+CLI) + `runeRewardDifferential.test.ts` (queue 80 → 0 with #1264) | **keep** — the enforcement pin for R-RUNEDUP-01…08 | §9.2 |
| this-turn lane | `turnScopedReset.test.ts`; with #1262: `thisTurnRegistry.ts` + `thisTurnRule.test.ts` (28 printed-text-derived subjects) | **keep** | §9.5 |
| 4 original tripwires | `factoryPhase.test.ts`+`phaseRegistry.ts`, `tribePredicates.test.ts`+`tribeRatchet.ts`, `derivations.test.ts`, `refIntegrity.test.ts`, `spellPowerFolding.test.ts` | **keep** | §9 |
| Behavioural differential scans | `playScan.ts`/`playDifferential.test.ts`, `combatScan.ts`/`combatDifferential.test.ts`, `combatModScan.ts`/`combatModLane.test.ts`, `textNumbers`, `invariantFuzz`, `magnitudeOracle`, `missDrivenOracles(2)`, `qaScenarioParity` | **extend** — the §9.2 differential-oracle foundation; variants grow (plain/gilded, rune on/off, multiplier counts) | §9.2, §9.3 |
| Retro catalog | `packages/tools/retro/` (reinject.py — 14 entries, 14/14 caught; verdicts in roadmap prose only) | **extend** — grows a verdict field + a CI (weekly-lane) run; README is stale (see D-7) | §4.5, §17.3 |
| Structured findings | `packages/sim/src/docbot/findings.ts` (DocbotFinding + FNV-1a fingerprint; only 7 files touch it — **18 of ~22 lanes have no machine-readable output**) | **extend** — THE canonical finding format; V2-compatible optional fields per `canonical-schemas.md` §3; lane conversion staged in WP D/G | §12 |

## 6. Duplications and forks queued for RECONCILIATION

These are the genuine duplicate/obsolete paths §18-A asks us to identify. Each row names the
canonical survivor and the disposal plan.

| # | Duplication | Canonical | Plan |
|---|---|---|---|
| D-1 | **Tripwire numbering fork** — `interactionMatrix.test.ts` and `textOracle.ts` both self-label "tripwire 14"; `interactionFamilyMatrix.test.ts`, `combatModLane.test.ts`, `combatModScan.ts` all claim "16" | File paths | Retire the numbers: strip "TRIPWIRE N" headers to named lane ids (the `ENFORCEMENT_LANES` key is the natural id). Doc-fix + comment-only PR; `docs/docbot.md`'s "eight tripwires" line goes with it (D-9a). |
| D-2 | **ratchetScan second implementation** — docbot.ts re-implements the tribe-ratchet fs scan locally because the registry is pure data riding the public sim entrypoint into the web bundle | The vitest lane | DELIBERATE (bundle hygiene), but converges anyway: when the lane emits DocbotFinding (WP D), docbot.ts consumes the finding stream instead of re-scanning. Keep until then; comment both sites now. |
| D-3 | **Three QaScenario validators** — `validateQaScenario` (full, hand-written), `planScenarioSave` (shallow server-side), `parseQaScenarioFile` (bug-report-only) | `validateQaScenario` | Layered by design (full / transport / source-gate), but the server and bug-report paths should each *call* the canonical validator after their own gate; today only the schema stem is shared. Also fold the duplicated id regex (QA_SCENARIO_ID_RE vs SCENARIO_ID_RE) into one exported const. |
| D-4 | **Two BugScenarioFile declarations** — `sim/bugReport.ts:208` vs `ui/bugScenario.ts:26` (ui copy adds a `client?` field the sim copy lacks; dead for CLI-produced files) | sim copy | Delete the ui declaration, import from `@game/sim`; move `client?` onto the sim type as optional if the Scene Builder path ever writes it, else drop. Falls out for free with D-8 retirement. |
| D-5 | **Two fingerprint systems** — findings FNV-1a 8-hex (`fingerprintFinding`) vs server SHA-256 64-hex (`submit-bug-report/index.ts:42` → bug_reports.fingerprint/duplicate_of) | Both, scoped | NOT unified: they fingerprint different things (semantic finding identity vs raw player-report dedup) in different trust domains (repo vs Edge Function). Document the boundary; the graduation command (WP G) records the *pair* so a report links to its finding. Third `fingerprint(v)` in productionBots/visibleState.ts is unrelated — rename in passing to avoid grep collisions. |
| D-6 | **Two `combatEventLines` renderers** — `ui/bugScenario.ts` vs `tools/bug-repro.lib.ts` | tools copy | Move to a shared sim/tools lib (or `@game/sim` export) and import from the UI; they render the same CombatEvent log and will drift. |
| D-7 | **Retro catalog verdict drift** — verdicts in `docs/docbot-roadmap.md` prose, no verdict field, README says "0 of 7" | reinject.py catalog | Add a verdict field per entry; fix README counts; wire a weekly-lane CI run (WP G). |
| D-8 | **Legacy `scenario.json` vs `qa-scenario.json`** — both written per report, "one release of overlap" by design; parseBugScenario projects QA→legacy lossily | qa-scenario.json | RETIREMENT PLAN: (1) point every Scene Builder import path at the QA door (already sniffs both); (2) stop writing scenario.json from writeInbox + bugs:repro; (3) delete BugScenarioFile projection + the legacy parser branch after one release with no consumer; (4) D-4 dies with it. Blocked only on the menu-report case (qa-scenario.json is non-menu-only — menu reports keep the raw capsule, no scenario at all). |
| D-9 | **Stale docs (10 items)** — recorded as doc-fix actions, one docs PR: (a) `docs/docbot.md` "eight tripwires" count; (b) same file's PR-8 module list omits explosionGuard/coveringArray/targetCardinality/heroPowerFamilies; (c) same file never states the corpus digest/count — add the *command* to print it, not a hand count (CONTENT.md doctrine); (d) same file's "graduate into" claim vs the TODO-only path in buildStarterTest (bug-repro.lib.ts:208) — reword until WP G ships graduation; (e) same file omits pending.generated/retired.generated/pendingManual/approved registries; (f) `docs/bug-reports.md` local-layout + bugs:repro summary omit qa-scenario.json and the classification output; (g) same file implies scenario.json is THE Scene Builder input; (h) `retro/README.md` stale counts (0-of-7; 13-of-18); (i) no `docs/qa*.md` exists — the THREE RULES (one engine / no executable expectations / deterministic results) live only in the qaScenario.ts docblock → `docs/docbot2/README.md` (this program) + a future docs/qa-platform.md become the home; (j) QaScenarioV1 `metadata.commit` declared but never written — give it a writer (semanticRevision work) or delete the field. |
| D-10 | **Inventory label drift** — docbot.ts:147 labels all 18 NEW_LANES "landed 2026-08-27 … (each gates in npm test)" but two rows aren't that wave's (qaScenario.test.ts lives outside the docbot dir; rendered text lives in ui) | — | One-line comment fix riding any docbot.ts touch. |

Also noted (not duplications, but §5 gaps the maps surfaced): the existsSync inventory only
resolves from repo root (cwd-sensitive); `findings.ts` header is stale (says only nightly is wired;
#1255 added the four `--json` queues); `fork()` is unlabelled and unused in production (the RNG
trace substrate is genuinely absent, not hidden).

## 7. Migration-action tally

| Action | Rows |
|---|---|
| keep | 22 |
| extend | 24 |
| replace | 1 (the DEV-only capture gate) |
| retire | 2 (legacy scenario.json path incl. dup BugScenarioFile; tripwire numbering) |
| reconcile/doc-fix | 10 D-rows (D-9 bundles 10 doc fixes) |

The dominant verb is **extend**: the platform grows out of what exists. Nothing is replaced until
its successor demonstrably covers it (§21), and generated vs curated assets stay in separate
directories with separate retention (§4.6).
