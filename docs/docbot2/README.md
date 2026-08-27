# Doc Bot 2.0 — Program Overview

**Source document:** the definitive blueprint at
`C:\Users\kevin\Documents\Codex\2026-06-29\files-mentioned-by-the-user-codex\DOCBOT_2_DEFINITIVE_QA_PLATFORM_HANDOFF.md`.
This directory is Work Package A of that program: the architecture reconciliation that everything
else builds on. When this directory and the blueprint disagree, the blueprint's principles win and
these docs get fixed.

## Mission (blueprint §1)

Rebuild Doc Bot as one coherent QA platform producing four separated outputs — **verified
mechanical bugs** (deterministic, minimized repros), **verified text defects**, **wording
recommendations**, and **questionable interactions** — by connecting design intent (contracts +
rules), runtime evidence (semantic traces), and displayed text into one comparable triangle.

## The four WP A documents

1. **[current-state-map.md](current-state-map.md)** — every existing capability mapped to the
   blueprint: paths, schemas, producers, consumers, and a migration action
   (keep 22 · extend 24 · replace 1 · retire 2), plus the 10 reconciliation items (D-1…D-10):
   the tripwire-numbering fork, the deliberate ratchetScan second implementation, three scenario
   validators, two BugScenarioFile declarations, two fingerprint systems, two combatEventLines
   renderers, the legacy scenario.json retirement plan, and the 10 stale-doc fixes.
2. **[canonical-schemas.md](canonical-schemas.md)** — the §18-A exit-gate decisions: **one**
   scenario schema (QaScenarioV1, extended with optional capsule fields — no V2), **one** rule
   registry (@game/rules, extended toward RuleContract; the 5-state status is a derived view),
   **one** finding format (DocbotFinding, V2-compatible optional fields + the 18-lane emission
   plan), **one** trace envelope (SemanticEvent grown from the existing recruit presentation
   envelope, combat joining via a thin adapter), and the semantic-revision identity built on the
   existing `contentRevision()` hash.
3. **[work-package-plan.md](work-package-plan.md)** — agent-executable briefs for the vertical
   slice (§19) and WP B–H: scope, files, dependencies, exit gates, wave estimates, and risks —
   WP C's RNG-neutral instrumentation carries the heaviest proof obligations.
4. **[owner-review-pipeline.md](owner-review-pipeline.md)** — the review-burden design around the
   owner's 2–5-seconds-per-answer bar: triangle auto-corroboration (a `corroborated` status
   distinct from `approved`; nothing blocks on owner review), convention clustering (the
   rune-family precedent: one click rules a family), the rapid-fire keyboard questionnaire for
   RulebookTriage, and a ~200-click / three-sitting budget for the whole program.

## Non-negotiables (blueprint §4 — binding on every PR)

One gameplay engine, ever (§4.1). Intent stays independent of implementation — extracted guesses
are visibly unreviewed (§4.2). No silent uncertainty (§4.3). No "verified" without deterministic
double reproduction (§4.4). Every oracle is sabotage-tested (§4.5). Generated and curated
knowledge never mix (§4.6). This program supersedes isolated Doc Bot expansion — no parallel
registries, schemas, trace formats, or finding formats (§4.7). Plus the §23 safety floor: no
auto-approved contracts, no auto-rewritten production text, no extra RNG consumption, no touching
Mike's FX timing or Beat Lab, no deleting regressions in regeneration, deterministic replay
preserved.

## Non-goals (blueprint §22)

Doc Bot 2.0 does not decide whether a working card is too strong, whether FX look right, whether
timing feels good, whether a design is fun, or what unapproved intent "should" be. It may flag
performance anomalies, event explosions, or outlier resource generation as separate signals —
never as mechanical bugs.

## Definition of Done (blueprint §21 — the only end gate)

The program is complete when, among the full §21 list: every active content object has a semantic
contract; every approved rule has an executable oracle; all meaningful effects appear in a causal
semantic trace; shop AND combat reports replay exact action sequences; verified findings are
deterministic, minimized, reproducible from Scene Builder and CLI; text is checked against
approved mechanics with wording advice separated; unruled behavior reports as questionable, never
broken; confirmed player reports graduate into permanent regressions; CI blocks contract-less new
content; every oracle family carries mutation/sabotage evidence; superseded probes are retired
only after stronger coverage exists; and a final generated coverage/precision/blind-spot report
ships. **Not the vertical slice, not any single work package — §21, every line.**
