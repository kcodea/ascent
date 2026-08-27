# Doc Bot 2.0 — Canonical Schemas (WP A deliverable 2)

> The §18-A exit gate: **one** scenario schema, **one** rule registry, **one** finding format,
> **one** trace envelope. This document names each canonical schema, gives the rationale, and
> specifies the compatible extension path toward the blueprint's target shapes. Every extension
> here is **optional fields only** — nothing existing breaks, no migration of checked-in fixtures
> or registries is required on day one.

## 1. Scenario schema: `QaScenarioV1` (extend; **no V2**)

**Decision.** `QaScenarioV1` (`packages/sim/src/qaScenario.ts`) is the one scenario schema. The
blueprint's `QaReproductionCapsule` (§8.1) is realized as **optional additions to V1**, not a
wrapper type and not a `schemaVersion: 2`. Rationale: §8.1 says extend compatibly unless migration
cannot be represented through optional versioned extensions — it can; every producer (Scene
Builder, bugs:repro, corpus builder, minimizer) and consumer (runner, CLI, parity test, store
import, bug parser) already speaks V1; and the validator's loud literal-1 gate stays as the
tamper-proofing it was designed to be.

**Exact missing fields vs §8.1, added as OPTIONAL:**

```ts
interface QaScenarioV1 {
  // …existing fields unchanged (schemaVersion: 1, id, title, source, seed, setId, mode,
  //  state, action?, combat?, expectations?, ruleIds?, contentIds?, metadata?)…

  /** §16 identity of the environment this scenario was captured/evaluated under. */
  semanticRevision?: string;              // see §5 below — replaces the never-written metadata.commit

  /** §8.2 exact shop/recruit reproduction: a bounded ACTION TRAIL replacing the single-action
   *  limitation for reports that need sequencing. `state` remains the checkpoint; `actions`
   *  replays from it. `action` (singular) stays for the entire existing corpus. Validator rule:
   *  `action` and `actions` are mutually exclusive. */
  actions?: RecordedActionWindow[];

  /** §8.1 expected/observed semantic outcomes — the contract-oracle handshake (WP C/D). */
  expectedSemantic?: ExpectedSemanticOutcome[];   // expectation over the trace, not the state
  observedSemantic?: SemanticEvent[];             // captured trace fragment (evidence, never an oracle)

  /** §8.2 "allow the player/developer to choose an earlier timeline point". */
  reportMoment?: { actionIndex?: number; combatEventStep?: number; note?: string };

  /** §8.1 BuildIdentity — the coarse components behind semanticRevision, kept readable. */
  environment?: { appVersion?: string; buildSha?: string; contentRevision?: string;
                  rulesRevision?: string; rngAlgorithm?: string };

  /** §8.1 provenance — who made this and from what. Existing metadata.reportId stays; this adds
   *  the machine-usable chain for graduation (§14). */
  provenance?: { kind: QaScenarioV1['source']; reportId?: string; findingFingerprint?: string;
                 parentScenarioId?: string; minimizedFrom?: string };
}

interface RecordedActionWindow {
  action: Action;
  /** §8.2 per-action RNG window: cursor before the action + the observational roll records the
   *  WP C tap emits. Presence is optional per action — old capsules stay valid. */
  rngCursorBefore?: number;
  rngRecords?: RngDecisionRecord[];       // see §4.4 — observational, never re-consumed
  /** Decisions/targets supplied (battlecryTarget, discover, chooseOne payloads are already in
   *  the Action union; this field is for derived target RESOLUTION evidence). */
  resolvedTargets?: EntityRef[];
  /** Post-action state hash (FNV-1a over the normalized serialized state) — the drift rail. */
  stateHashAfter?: string;
}
```

Notes:
- `metadata.commit` (declared, zero writers today) is **superseded by `semanticRevision` +
  `environment.buildSha`** — delete the field once nothing round-trips it (doc-fix D-9j).
- `rng` as a whole-stream recording (§8.1 `RecordedRngStream`) is deliberately NOT adopted: the
  seed + `rngCursor` inside `state` already reproduce the stream exactly (mulberry32 is the
  algorithm identity, stamped in `environment.rngAlgorithm`). What §8.1 actually needs beyond that
  is per-decision *observability*, which `rngRecords` provides.
- The three-rules docblock (one engine / no executable expectations / deterministic results)
  remains binding: `expectedSemantic` is data compared by the runner, never code.
- Validator changes ride the same PR as each field (ACTION_TYPES exhaustiveness pattern is kept).

## 2. Rule registry: `@game/rules` (extend toward §6.2 `RuleContract`)

**Decision.** The existing `packages/rules` registry is the one rule registry. The blueprint's
`RuleContract` is realized by optional fields on `GameRule`; the blueprint's 5-state `RuleStatus`
enum is a **derived view**, not a stored migration — `effectiveStatus` and the orthogonal
enforcement field already encode it losslessly, and changing the stored 4-value enum would
invalidate 47 decisions.json entries and every registry file for zero information gain.

**Status mapping (derived, both directions):**

| Blueprint 5-state | Existing encoding |
|---|---|
| `draft` | pending queue entry (`q-…` id) not yet surfaced to the board, or a generated rule with `status: 'needs-ruling'` and no decision |
| `needs-owner-ruling` | `effectiveStatus === 'needs-ruling'` (undecided board card) |
| `approved-unenforced` | `effective ∈ {approved, revised}` AND `enforcementOf(rule) == null` — exactly today's ratcheted queue (`[R-PLAY-01, R-AURA-01]`) |
| `approved-enforced` | `effective ∈ {approved, revised}` AND `enforcementOf(rule) != null` (with `enforcementErrors` empty) |
| `deprecated` | tombstone in `retired.ts` / `retired.generated.ts`, or `effective === 'rejected'` |

A tiny pure helper `blueprintStatus(rule, decisions): FiveState` ships in `schema.ts`; report
surfaces (docbot line, workbench) print the 5-state view. `effectiveStatus` is untouched.

**Field diff — optional additions to `GameRule`:**

```ts
interface GameRule {
  // …existing: id, title, statement, domain, status, evidence[], currentBehaviour?,
  //  recommendation?, cardText?, example?, sourceQueue?, contentIds?, enforcement?…

  /** §6.2 applicabilityTags — feeds the §10.1 case generator and the interaction graph (WP F).
   *  Vocabulary = SemanticTag, seeded from the existing 28 presentation families + keyword ids. */
  applicabilityTags?: string[];

  /** §6.2 examples/counterexamples — concrete boards/actions. `example` (prose) stays;
   *  these are structured and may name a scenario id. Also what the rapid-fire questionnaire
   *  renders (owner-review-pipeline.md — one statement + ONE concrete example per screen). */
  examples?: RuleExample[];
  counterexamples?: RuleExample[];

  /** §6.2 regressionScenarioIds — curated QaScenarioV1 fixtures pinning this rule. Complements
   *  (does not replace) enforcement.refs: oracle lanes stay in RuleEnforcement, scenario pins
   *  get first-class ids the graduation command (WP G) can append to. */
  regressionScenarioIds?: string[];

  /** §6.2 revision — bumps when statement/examples change; folds into the registry hash (§5). */
  revision?: number;
}
interface RuleExample { setup: string; expect: string; scenarioId?: string; contentIds?: string[] }
```

**`oracleIds` mapping:** the blueprint's `oracleIds` IS the existing enforcement mechanism —
`enforcement.refs` resolved through `ENFORCEMENT_LANES` (16 lanes today). No new field; the
enforcement loop's refs-must-exist-on-disk check and the approved-but-unenforced ratchet are the
§6.2 approval gate already, extended with "positive fixtures + sabotage fixtures per lane" as WP D
tightens each lane. `ownerRuling` maps onto the existing `RuleDecision` in decisions.json (id-keyed;
already durable, already git-tracked).

## 3. Finding format: `DocbotFinding` (extend, V2-compatible)

**Decision.** `packages/sim/src/docbot/findings.ts` `DocbotFinding` is the one finding format.
The blueprint's `DocbotFindingV2` fields land as optional additions; the fingerprint function is
unchanged (it deliberately hashes only `{lane, contentIds, ruleIds, expectationKind, expected,
observed}` — none of the new fields perturb identity, so existing dedup and byte-stable emission
survive).

```ts
interface DocbotFinding {
  // …existing: id, lane, severity, confidence, status, title, summary, contentIds, ruleIds,
  //  scenarioId?, reproduction?, expected?, observed?, fingerprint…

  /** §12.1 five-way class. Absent = legacy lane finding, treated as 'questionable-interaction'
   *  unless the lane declares a default (differential lanes default to it; ratchet lanes to
   *  'coverage-gap'; text lanes to 'verified-text-defect'). */
  class?: 'verified-mechanical-bug' | 'verified-text-defect' | 'wording-recommendation'
        | 'questionable-interaction' | 'coverage-gap';
  competingInterpretations?: { interpretation: string; evidence: string[] }[];  // §12.1 questionable
  firstDivergence?: { step: number; expected: unknown; observed: unknown };      // trace-aware (WP C+)
  minimizationStatus?: 'not-needed' | 'pending' | 'complete' | 'failed';
  provenance?: { lane: string; generatedAt?: string; reportId?: string; scenarioIds?: string[] };
  semanticRevision?: string;                                                     // §16
  contractIds?: string[];                                                        // WP B contracts
  suggestedText?: string;                                                        // §11 rewrite advisor
}
```

**The 18-lanes-without-machine-output plan.** Only 7 files touch DocbotFinding today; ~18 of ~22
lanes emit nothing but vitest prose. Conversion plan (staged, WP D + WP G):
1. Ship a tiny shared helper `laneFindings.ts`: lanes push findings into a per-lane collector that
   (a) still throws the same vitest assertion (the gate is unchanged) and (b) when
   `DOCBOT_FINDINGS_DIR` is set, writes `<lane>.findings.json` via the existing
   `emitFindingsJson`. No behavior change when the env var is absent — `npm test` output identical.
2. Convert lanes in the same order WP D touches them (temporal, differential, text, invariant…);
   each conversion is mechanical: the lane already computes expected/observed to assert them.
3. `npm run docbot` grows a `--findings <dir>` aggregation mode that merges lane files with its own
   four live queues — replacing the existsSync inventory row-by-row (current-state-map D-2 fold-in).
   Ratchet queues (needs-triage lists, excuse registries) emit as `class: 'coverage-gap'`.

## 4. Trace envelope: `SemanticEvent` = the recruit presentation envelope, grown

**Decision.** The §7.3 `SemanticEvent` envelope is built by **extending
`packages/core/src/presentation/events.ts`** — the existing recruit-side
`SourceTriggerEvent`/`ConsequenceEvent` system — not by inventing a new format. The events map's
finding: that envelope already carries ~70% of §7.3 (id, sequence, step, phase, source ref,
parentId, dependencyIds, simultaneousGroupId, `PresentationBatch.actionId` ≈ rootActionId,
`statsChanged.permanent` ≈ persistence, policy registry's mandatory silent-reason ≈
suppressionReason). Combat joins via a **thin trace adapter over the CombatEvent log** (§7.4
"existing stamps may be adapted") — the 26-type union itself, a shared-boundary file, is untouched.

### 4.1 Field-by-field: §7.3 vs existing

| §7.3 field | Recruit envelope today | Combat log today | Plan |
|---|---|---|---|
| eventId | ✅ `id` (`event:<actionId>:<seq>`, deterministic, batch-local) | ❌ none | adapter synthesizes `combat:<wave>:<step>:<seq>` — deterministic under a seeded run (§7.4) |
| eventType | ✅ variant discriminant (13) | ✅ discriminant (26) | mapping table below |
| tick / phase | ✅ `step` + `phase` (5 phases) | ⚠️ `step?` only (the log IS the combat phase) | adapter stamps `phase: 'combat'` |
| source | ✅ TriggerSourceRef on the parent trigger | ⚠️ 8/26 carry a source uid | adapter lifts `srcCard`/`key`; absent stays absent (no fabrication) |
| targets[] | ✅ ZoneTargetRef (singular per consequence) | ⚠️ singular target fields | envelope keeps singular-per-event; arrays via simultaneousGroupId (matches today's wave/step grouping) |
| cause / parentEventId | ✅ `parentId` + `dependencyIds` (trigger stack) | ❌ inferable only (key/srcCard/avenge/step) | recruit: done. Combat: adapter groups by step + key; TRUE causal parenting needs the narrowest-boundary instrumentation (WP C) at the single emit chokepoint (`simulate.ts:149`) |
| rootActionId | ✅ `PresentationBatch.actionId` | n/a (faceOmen is the root) | adapter stamps the faceOmen action id |
| ruleIds / contentContractIds | ❌ | ❌ | derived, not emitted: a post-hoc join from `policyKey`/`key` (`factory:<do>:<on>`) + srcCard → contract → relatedRuleIds. The engine never learns about rules (keeps the boundary clean); the coverageKeys precedent proves post-hoc derivation works with zero engine change |
| before/after snapshots | ⚠️ deltas per variant | ⚠️ dmg.remainingHp, reborn base | optional `before?/after?` on the adapter output, filled by the QA driver (which owns both states), NEVER by the engine |
| amount | ✅ per variant | ✅ where meaningful | keep |
| persistence | ✅ `statsChanged.permanent` | settled elsewhere (persist*/EG) | adapter maps CombatResult.persist* into `persistence` on the closing events |
| rng | ❌ (no substrate anywhere) | ❌ | §4.4 below — new observational tap, WP C |
| suppressionReason | registry-level (`intentionallySilent` reason) | ❌ | new `TriggerSuppressed` consequence variant carrying the reason at emit time (guards already compute it — spellFizzle NO_OP table) |

### 4.2 §7.2 event families: adapt vs instrument

**Adapt from existing emissions (no new engine wiring):**
- From CombatEvent: MinionAttacked (`attack`), MinionDamaged (`dmg`), MinionDied (`death`),
  MinionRose (`reborn`/`rise`), MinionSummoned (`summon`), SpellCast (`sc`/`spellcast`),
  StatsGranted (`buff`/`improve`/`hpGrant`), AuraChanged (`tribeAura`/keyword events),
  CounterAdvanced (`spellProgress`/`questTrigger`), EffectMultiplied (partially — multiplier
  stamps land with #1263's folding work).
- From ConsequenceEvent: StatsGranted/StatsSet (`statsChanged`), AuraChanged, CardCreated
  (`cardSummoned`/`cardGranted`), CardTransformed, CardMoved (zone refs), SpellCast
  (`spellResolved`), GoldChanged (`resourceChanged`), ShopRefreshed/ShopSlotFilled
  (`shopChanged`), CounterAdvanced/CounterReset (`counterChanged`), CardBought/Sold/Played
  (reducer actions + `fodderEaten`/`rubyPlayed`).
- From the reducer action layer: ActionAccepted/ActionRejected (accept/reject is already computed;
  needs only an envelope emission), PhaseStarted/PhaseEnded (phase field exists),
  DecisionRequested/DecisionResolved (discover/chooseOne/battlecryTarget actions).

**Need NEW instrumentation (WP C, narrowest shared boundary):**
- TriggerWindowOpened/TriggerQueued/TriggerStarted/TriggerResolved in **combat** (recruit has the
  trigger stack already; combat has only the flat log — this is the causal-parenting work at the
  simulate() chokepoint, generalizing the setAvengeWindowObserver pattern which proved the shape).
- TriggerSuppressed (both phases — guards/fizzles/silent policies emit the reason).
- TargetRequested/TargetSelected (targeting logic resolves silently today).
- SummonOverflowed (board-cap drops are silent).
- StatePersisted (recruit→combat and combat→shop boundary crossings; snapshotFidelity's dropped-
  fields registry enumerates exactly what crosses).
- RNG record (§4.4).

### 4.3 Safety constraints (§7.4 + §23, binding verbatim-in-spirit)

1. **Zero RNG consumption.** Instrumentation must not call the rng, fork it, or reorder any call
   that does. Proof obligation (WP C exit): a full determinism sweep where every seeded suite,
   the harness, and golden replays produce byte-identical outcomes and identical final `rngCursor`
   with capture on vs off.
2. **Never alter Mike's FX timing or Beat Lab behavior.** The trace layer *reads* the presentation
   envelope; it never writes policies, families, beat timing, or choreo compilation. The policy
   registry (856 entries, 28 families) is consumed as data. Any change under `packages/ui/src/fx`,
   `choreo/`, `choreographer/`, or `presentation/policies.ts` in a WP C PR is a review-reject.
3. **Observational and lightweight in production** — §4.5.
4. **Deterministic event ids under a seeded run** — batch-local counters, no time, no uuid
   (the collector already does this; the combat adapter follows).
5. **Never the user-facing combat-log strings** — the adapter reads the structured union only.
6. **No reducer-order, identity-generation (uidSeq), or timing changes.** explosionGuard's uidSeq
   budget and the roundtrip rails are the standing detectors.

### 4.4 RNG decision records (the one field with zero substrate)

`fork()` is unlabelled and unused in production; nothing traces a roll. Plan: an **observational
tap on `makeRng`/`mixSeed`** — when capture is armed, each roll appends
`{stream: TAG|label, cursorBefore, raw, resolved?}` to the active batch. The tap wraps the
*existing* generator call; it never draws an extra value (constraint 1). Labels come from the
existing 9-member TAG enum + the 19 mixSeed sites; `fork(label)` gains its label parameter only if
WP C finds call sites that need it (it is currently test-only, so this is free). Ships dark
(NOOP by default, like NOOP_COLLECTOR).

### 4.5 The capture=DEV-only gap and always-on lightweight capture

Today `reduceWithPresentation(state, action, capture)` is `capture = import.meta.env.DEV` in the
store (EoT always true) — **in production nothing but End of Turn is captured**, so a player bug
report carries no trace. Plan (WP C):
- Keep the zero-alloc NOOP path as the OFF state; nothing changes for the hot loop when disarmed.
- Production default becomes a **bounded ring buffer**: the last N action batches (N ≈ the bug
  capsule's existing two-wave frame window), retained in memory only, structured-cloned into the
  capsule at Ctrl+B exactly like frames are today. Never serialized into saves/replays
  (the "batches are ephemeral, never part of a run save" contract stands — blueprint §7.5 note in
  events.ts).
- Combat needs no ring: `CombatResult.events` is already durable and complete; the adapter
  translates on demand.
- Perf gate before shipping (CLAUDE.md north star): `npm run perf` + a prod-build manual profile;
  budget = no measurable frame cost with the ring armed. If the recruit envelope's ~62 emit sites
  measure hot, per-batch capture degrades to sampling the *current* action only — still enough for
  the §8.2 report window since the capsule replays actions to rebuild the rest.

## 5. Semantic revision identity (§16)

**Decision.** One string, computed from existing-or-cheap parts, stamped everywhere a finding or
scenario is written. Built on **`packages/content/src/revisions.ts` `contentRevision()`** — the
real per-card/run-level FNV-1a content hash that already exists, is pure and dependency-free by
design, and which the QA subsystem currently does not use at all (the bug capsule's
`contentRevision` is a `${setId}+${buildSha}` stopgap whose own header admits it).

```
semanticRevision = <buildSha>.<contentRev>.<rulesRev>.<schemaRev>
  buildSha    = __BUILD_SHA__ (client) / git rev-parse --short HEAD (tools)  — build commit
  contentRev  = contentRevision()                                            — content hash
  rulesRev    = fnv1a(stableStringify({rules: allRules() sorted by id incl. revision,
                                       decisions: decisions.json}))          — rulebook hash
  schemaRev   = qa1.b1.r2.m32   — scenario schemaVersion 1 · BUG_REPORT_SCHEMA_VERSION 1 ·
                                  ReplayV2 version 2 · rng algorithm mulberry32
                                  (contract-registry rev appended when WP B lands;
                                   language-guide rev when WP E lands)
```

**Where computed:** a new pure `semanticRevision()` in `packages/sim/src/semanticRevision.ts`
(sim sees content + rules + its own schema versions; core stays dependency-free). The rules hash
half lives beside the registry (`packages/rules/src/registryHash.ts`) so `rules:impact` and the
enforcement suite can reuse it.

**Where stamped:** QaScenarioV1.semanticRevision (writer: buildQaScenario, specToScenario,
bugs:repro conversion); DocbotFinding.semanticRevision (writer: makeFinding when the caller
supplies it; nightly always does); nightly-report.json header; the bug capsule (replacing the
stopgap `contentRevision` field's derivation, field name kept); the corpus manifest.
**Where checked:** the scenario runner and `bugs:repro` compare stamped vs current and report
component-wise drift (content moved / rules moved / build moved) instead of a bare
id-still-resolves check — and per §16, a rules-hash change marks affected curated regressions for
review rather than silently reinterpreting them (`rules:impact` already computes the blast radius).
