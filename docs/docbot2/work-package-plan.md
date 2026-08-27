# Doc Bot 2.0 — Work-Package Plan (WP A deliverable 3)

> Agent-executable briefs for the §18 migration program. One program, one end-state gate (§21);
> each package ships as small PRs that all advance the same architecture (§25). "Agent-wave" = one
> concurrent batch of worktree sessions, each producing one PR (typical repo cadence: 2–4 parallel
> sessions per wave, split by ownership seam per docs/concurrency.md). Every PR: full gate
> (`typecheck && lint && test && build:web`), sabotage evidence for any new oracle (§4.5), and no
> merge without the owner's explicit go-ahead.
>
> Package order: A ✔ (this PR) → **VS vertical slice** → B → C → D → E/F (parallel) → G → H.
> D depends on B (contracts) and C (traces); E depends on B; F depends on B+D; G depends on C+D;
> H is the closing audit.

## Stage VS: First Vertical Slice (§19) — between A and B

**Purpose.** Prove the whole triangle (intent contract ↔ runtime trace ↔ displayed text) on a
deliberately interaction-heavy sliver before building any registry at scale. Architecture proof
only — not completion (§19 last line).

**Recommended content set** (interaction-heavy, all live in set2, per §19's shape):
Echo source + an Echo multiplier; an Avenge source under simultaneous deaths (the R-AVWIN family
already has the observer + 11 rules — reuse); a Rise minion; plain + exact copy (the two corpus
`avenge-window-*-copy` fixtures seed this); one Shout with a Gilded delta (R-SHOUT-01 territory);
one Shop Consume Demon; one Shop-spell copier; one behavior-altering rune (a RUNEDUP family
member — enforcement pin exists); one active hero power (heroPowerLane already drives these); one
real player bug report reproduced from the shop (pick from the Bug Board inbox).

**Deliverables.** Hand-written (not tooled) ContentContract drafts for the ~10 objects using the
§6.3 shape; a prototype trace adapter over CombatEvent for ONE fight; one scenario extended with
`expectedSemantic`; the four §19 output classes each demonstrated once (verified mechanical bug,
verified text defect, wording recommendation, questionable interaction — mine the existing
KNOWN_VIOLATIONS/ambiguity queues for real ones); one minimization + one hand-run graduation of the
bug report into `scenarios/`.

**Files.** `packages/sim/src/docbot/slice/` (throwaway-marked prototypes), one new curated fixture,
`docs/docbot2/vertical-slice-report.md`. **Exit gate:** all four output classes produced from the
slice; the contract drafts survive owner review via the questionnaire prototype (first real test of
owner-review-pipeline.md); a written list of every place the §6.3 schema didn't fit — that list
feeds WP B before the schema is frozen. **Waves: 2** (1 build, 1 report+review). **Risk:** low —
prototypes are quarantined; the danger is *skipping* the schema-friction report and freezing a bad
contract shape.

## WP B: Knowledge foundation

**Scope (§18-B).** The ContentContract schema + extraction tooling + review queue + language-guide
schema. Extend, never parallel: contracts live beside the rules registry, extracted drafts are
visibly `reviewStatus: 'extracted'` (§4.2 — extracted guesses marked unreviewed; §23 — never
auto-approved).

**Files.** `packages/rules/src/contracts/` (schema.ts with §6.3 ContentContract + SemanticTag
vocabulary seeded from the 28 presentation families + 16 keywords + 9 tribes; registries split
generated/curated exactly like rules: `extracted.generated.ts` vs `approved/`);
`packages/tools/src/contracts-extract.ts` (walks CARD_INDEX/RUNES/QUEST_DEFS/HEROES + factory
params + phaseRegistry + the policy registry — the same substrate coverageKeys reads — emitting
draft contracts); review queue = contract questions flow through the SAME rulebook board +
decisions.json plugin (no second triage surface — owner-review-pipeline.md §2); language guide
schema `packages/rules/src/languageGuide.ts` (§11.3 topics, versioned, content only in WP E).

**Exit gate (§18-B).** Every active content object (483 cards incl. tokens in play, 281 runes,
117 quests, 59 heroes) appears in the inventory; every active object has at least an extracted
contract; every approved rule has enforcement metadata (already true — the ratchet holds at 2
approved-but-unenforced, driven to 0 or explicitly pinned here). **Waves: 3** (schema+extractor ·
extraction sweep+inventory gate · review-queue wiring + first convention sittings).
**Risks:** extractor over-claiming (mitigate: extraction confidence field; anything the extractor
can't parse is `needs-review`, never silently complete — §4.3); schema churn (mitigated by the VS
friction report); review-burden explosion (mitigated by clustering — the click budget in
owner-review-pipeline.md §5 is the control).

## WP C: Trace and exact reproduction — **HIGHEST RISK**

**Scope (§18-C).** The SemanticEvent adapter + combat causal ids + the RNG tap + rolling shop
action capture + exact report replay + Scene Builder timeline. Everything per
canonical-schemas.md §4.

**Files.** `packages/core/src/presentation/` (envelope extensions, new consequence variants,
combat trace adapter), `packages/core/src/simulate.ts` (trigger-window instrumentation at the
single emit chokepoint, generalizing setAvengeWindowObserver), `packages/core/src/rng.ts` +
`packages/sim/src/state.ts` (observational tap), `packages/sim/src/bugReport.ts` (ring-buffer
window fields), `packages/sim/src/qaScenario.ts` (RecordedActionWindow + observedSemantic),
store.ts capture arming, Scene Builder stepper. **`packages/core/src/types.ts` is the shared
boundary — coordinate with Mike before any touch; prefer zero touches (the adapter lives beside,
not inside, the union).**

**Exit gate (§18-C).** Combat AND shop reports replay exact action sequences; the same capsule
produces an identical semantic trace twice; instrumentation changes no RNG or gameplay result.

**Proof obligations (spelled out — these gate every WP C PR, not just the last):**
1. **Determinism suites green and unchanged** — the full vitest determinism + golden set passes
   with byte-identical goldens (no golden updates allowed in a WP C PR).
2. **Harness proof** — `npm run harness` prints the same narrated log + determinism proof
   before/after, diffed in the PR's Verification section.
3. **Zero RNG consumption** — a paired-run test: identical seed/actions with capture ON vs OFF
   ⇒ identical final serialized state INCLUDING `rngCursor` and `uidSeq`, identical CombatResult
   bytes. Shipped as a permanent lane (`traceNeutrality.test.ts`), sabotage-proven (a deliberate
   extra rng draw in the tap must fail it).
4. **FX timing untouched** — zero diffs under `packages/ui/src/fx|choreo|choreographer` and
   `presentation/policies.ts`; beats:audit output unchanged; Mike sign-off on any
   presentation-adjacent file. Doc Bot never depends on animation completion (§23).
5. **Replay compatibility preserved** — ReplayV2 playback of a pre-change recording is unaffected
   (frames are ground truth; capture is additive).
6. **Performance measured** — `npm run perf` + prod-build profile with the ring armed; budget: no
   measurable regression (CLAUDE.md north star). Ring size is the tuning knob, not the emit path.

**Waves: 4** (recruit envelope extensions + neutrality lane · combat adapter + causal ids · RNG
tap + capsule window + capture arming · Scene Builder stepper + exact-replay classification).
**Risks:** the neutrality proof failing late (mitigate: the lane ships in wave 1, everything else
lands behind it); hot-path cost in production (mitigate: NOOP default + ring + perf gate);
simulate.ts instrumentation perturbing event order (mitigate: goldens frozen, conservation law 2's
log reconstruction is a standing detector); shared-types collisions with presentation work
(mitigate: serialize on types.ts per CLAUDE.md ownership map).

## WP D: Contract verification

**Scope (§18-D).** The contract oracle (trace vs approved contract), temporal/order oracle
generalization, invariant oracle consolidation, differential/metamorphic foundations, generated
isolated scenarios (§10.1's 17 case templates driven by applicabilityTags), and the staged
DocbotFinding conversion of the no-machine-output lanes (canonical-schemas.md §3).

**Files.** `packages/sim/src/docbot/contractOracle.ts` + gate; case generator
`packages/sim/src/docbot/isolatedCases.ts` (emits QaScenarioV1 into a generated dir, corpus-style
manifest+digest); `laneFindings.ts` helper + per-lane emission retrofits; extensions to the
existing differential scanners (plain/gilded, rune on/off, multiplier-count variants — §9.2 list).

**Exit gate (§18-D).** Every approved contract has an executable direct suite; every approved
global rule enforced (queue = 0 or pinned release blockers); known approved-rule violations fixed
or pinned. **Waves: 4–5** (contract oracle · case generator · differential variants · lane-findings
retrofit ×2). **Risks:** case-generator explosion (mitigate: applicability tags gate generation;
explosionGuard budgets reused); oracle self-agreement (contracts must be the *approved* branch,
never re-derived from the factory params being tested — §4.2; the existing
params-as-oracle lanes stay but are labeled extracted-confidence).

## WP E: Text intelligence

**Scope (§18-E).** ParsedTextContract parser (grown from the three tranche grammars + the
target-language grammar), semantic comparison vs contracts, the language guide content (§11.3),
rewrite advisor, Gilded-text verification. §11.2's mismatch taxonomy is the checklist.

**Files.** `packages/sim/src/docbot/textParse/` (parser + taxonomy), language guide content in
`packages/rules/src/languageGuide.ts`, advisor emitting `class:'wording-recommendation'` findings
with `suggestedText` (never auto-applied — §23). **Exit gate (§18-E).** Every active object
classified parsed-equivalent / verified-mismatch / approved-exception / unresolved-parse; no
unresolved parse reported as a clean pass (§11.1). **Waves: 3–4.** **Risks:** parser overreach on
bespoke prose (mitigate: conservative partial parsing + unresolvedPhrases; the ambiguous-prose
queue pattern from targetCardinality is the model); wording churn burden on the owner (mitigate:
recommendations batch through the questionnaire's text sitting, one-click accept/edit/dismiss).

## WP F: Interaction intelligence

**Scope (§18-F).** Interaction graph from contracts (§10.2 nodes/edges), applicability engine,
pairwise generator (§10.3 priority list), high-risk triple generator (§10.4 — seeded by the retro
catalog's 14 historical bug shapes), semantic-combination coverage identity (§10.5 — extends
coverageKeys to key *tuples*), anomaly oracle (§9.7 — findings capped at
`questionable-interaction`, never verified, per §9.7/§4.3).

**Files.** `packages/sim/src/docbot/interactionGraph.ts`, generators beside the corpus builder,
coverage-identity extension in coverageKeys.ts; the two existing interaction matrices become the
hand-pinned floor the generator must subsume before any retirement (current-state-map §5).
**Exit gate (§18-F).** Every applicable high-risk pair covered or visibly blocked; historical
multi-system bugs detected by generalized scenarios (retro reinject run proves it). **Waves: 4.**
**Risks:** combinatorial blow-up (applicability tags + the covering-array precedent);
false-anomaly noise drowning the inbox (anomaly oracle ships with a confidence floor and dedup by
fingerprint before it ships at all).

## WP G: Learning loop and operations

**Scope (§18-G).** `npm run bugs:graduate -- <report-id>` (§14's checklist verbatim: validate
deterministic repro, attach rule/contract ids, write curated fixture, record provenance, update
taxonomy, generate siblings, refuse when expectation unresolved); curated regression store
(scenarios/ split `regressions/` vs generated corpus, separate retention — §4.6); findings
inbox/workbench (§15 — grow the Bug Board + docbot `--findings` aggregation into one surface;
Rule review = the questionnaire board); CI lane split (§17.1 PR gate incl. rules:impact +
changed-content contracts; §17.2 nightly grows the full suites; NEW §17.3 weekly workflow incl.
the retro mutation run and greybox fuzz); no flaky gates (§17.4 — all correctness seeded; the
repo already bans Math.random).

**Exit gate (§18-G).** A new player report travels capture → classification → ruling →
minimization → permanent regression with no hand-authored parallel harness. **Waves: 3–4.**
**Risks:** graduation writing into curated space unsupervised (refusal paths + owner-visible PR
per graduation); CI time creep on the PR gate (changed-surface selection via rules:impact keeps
the gate fast — §17.1).

## WP H: Full migration and retirement

**Scope (§18-H).** Sweep all active set1/set2 + shared content (runes, heroes, spells, tokens,
generated cards, gifts, henchman) to approved-contract status; retire superseded probes ONLY
where WP D–F coverage is proven equal-or-stronger (each retirement PR cites the superseding lane +
a sabotage run); execute the D-8 legacy scenario.json retirement; publish the final coverage,
precision, and blind-spot report (§20 metrics + §21 DoD checklist, generated not hand-counted per
CONTENT.md doctrine). **Exit gate:** §21 Definition of Done, every line. **Waves: 3–5**
(content sweeps parallelize well by set/tribe). **Risks:** declaring done early (§18 preamble —
the DoD checklist is the only exit); owner-review long tail (the sitting schedule in
owner-review-pipeline.md spreads it).

## Cross-package rules

- **Non-negotiables ride every PR:** one gameplay engine (§4.1); intent independent of
  implementation (§4.2); no silent uncertainty (§4.3); determinism before "verified" (§4.4);
  sabotage-test every oracle (§4.5); generated ≠ curated (§4.6); no parallel schemas (§4.7).
- **Non-goals stay non-goals (§22):** no balance verdicts, no FX-look/animation-feel/fun
  judgments, no inventing intent that was never approved. Signals in those areas emit as separate
  info findings at most.
- **Serialization seams:** types.ts and the presentation dirs are Mike's; sim/docbot and rules are
  the QA program's home turf; every wave splits sessions so no two touch a chokepoint file.
