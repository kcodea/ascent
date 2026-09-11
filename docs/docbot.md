# Doc Bot — the contract

Doc Bot is the standing correctness auditor. It never decides what is *good*; it decides whether what the game
says it does, what the engine does, and what the text prints **agree**. Balance is out of scope, permanently.

This page is the two-page contract: what gates a PR, what runs on a schedule, what is dormant, and how to read
a failure. **It contains no counts.** Every number is derived by a command below, and the one document that
carries numbers — [`docbot2/final-report.md`](docbot2/final-report.md) — is drift-gated against its generator.
The narrative of how each lane came to exist is archived in [`docbot-history.md`](docbot-history.md).

## 1. What gates every PR (`npm test`, the required `verify` check)

Every lane file under `packages/sim/src/docbot/` (plus `packages/ui/src/docbotLiveText.test.ts`,
`packages/ui/src/renderedText.test.tsx`, and the two tools lanes `docbot-report.test.ts` /
`bug-graduate.test.ts`). **The authoritative roll-call is printed by `npm run docbot`** — each row is
`existsSync`-checked, so the list cannot describe a lane that no longer exists. The lanes fall into four kinds:

| Kind | What it proves | Representative lanes |
|---|---|---|
| **Wiring** | every (trigger, factory) pair is implemented in every phase that dispatches it; ids resolve; per-turn fields reset; rune rewards act; live text keeps both halves; tribe predicates go through the shared helpers | `factoryPhase`, `refIntegrity`, `turnScopedReset`, `runeRewardDifferential`, `tribePredicates`, `docbotLiveText` |
| **Behaviour** | through the real `reduce` / real `simulate()`, every effect ACTS against a vanilla control; every card is driven in through its REAL entry path; every synthetic trigger fire reaches the watchers the natural fire reaches; hero powers act; invariants and conservation laws hold under fuzz; the beat stream's claims equal the state diff | `playDifferential`, `combatDifferential`, `entryPaths`, `firePaths`, `heroPowerLane`, `invariantFuzz`, `conservationLaws`, `beatConservation` |
| **Correctness** | the MAGNITUDE and TARGET equal the contract: family drivers execute the §10.1 case templates per contract; the text oracles reconcile printed numbers with measured deltas; the text parser classifies every object and compares it to its contract; temporal windows obey the R-AVWIN rulings; interaction families compose as ruled | `contractOracle` + `drivers/*`, `textOracle*`, `textParse`, `magnitudeOracle`, `temporalWindow`, `interactionMatrix` |
| **Meta** | the instrument audits itself: combat emits agree with the phase registry; the retro catalog still anchors; the final report matches its generator; every graduated regression replays | `combatEmitAgreement`, `retroCatalog`, `docbot-report`, `regressionScenarios` |

Two rules make the gate trustworthy:

- **Ratchets only shrink.** Every tolerated backlog (`needs-triage` phase gaps, scenario-conditional combat
  cards, the unresolved-parse queue, `KNOWN_UNATTRIBUTED` beat sites, `KNOWN_VIOLATIONS`) is pinned at its
  current size and may only go down. The unresolved-parse queue additionally has a HARD ceiling (a share of
  active objects) that a content PR cannot raise past.
- **Every lane is sabotage-proofed before it ships.** Reintroduce the bug shape it exists for and demand the
  alarm. A lane that cannot fail its own sabotage check does not get to call anything verified. The proof is
  recorded in the lane's header; `npm run docbot:report` counts the lanes that carry one.

## 2. What a content PR must do

New content **fails the gate** until its registries are regenerated. Run ONE command and commit what it writes:

```bash
npm run docbot:sync
```

It chains `contracts:extract` (the contract registry), `docbot:text` (classification + the wording deck),
`rules:seed` (the owner triage queue; decisions survive) and `docbot:report -- --check` (tells you which
headline line of the final report drifted, if any — that prose is edited by hand, then re-checked).
**Never hand-edit a `*.generated.ts` file.**

A content PR may also have to *classify* new things — a new trigger's phases (`phaseRegistry.ts`), a new
entry site or synthetic fire site (`entryPaths.ts` / `firePaths.ts`), a new per-instance field's snapshot
fate (`snapshotRegistry.ts`). Each is a completeness check that names exactly what it wants. **Adding an
EXCUSE (a `*_EXCUSED` entry, a `needs-triage`, a `KNOWN_*` pin) is a named review item, not line noise**:
say why in the PR body, with a verifiable reason.

## 3. What runs on a schedule (never blocks a PR)

| Workflow | Cadence | What it does | Where a red run goes |
|---|---|---|---|
| `nightly.yml` — `npm run docbot:nightly` | daily 09:17 UTC | full lifecycle runs to elimination with serialize/restore checkpoints, an 8-seat lobby law sweep, then the FULL contract sweep and FULL interaction sweep the PR gate only samples; folds everything into the findings ledger | **the pinned "Doc Bot nightly status" issue** (created/updated by `scripts/nightly-issue.mjs`) with a two-line summary per finding and its `npm run docbot:scenario -- <id>` repro. A finding stays red until it is FIXED or ACKNOWLEDGED with a reason and date in `packages/sim/src/docbot/nightlyAck.ts`. `npm run docbot` prints the last nightly status when it can. |
| `docbot-retro.yml` — `npm run docbot:retro` | weekly | reinjects every catalogued historical bug in a throwaway worktree and re-measures which generic lane goes red; **this is the forward catch rate** | fails only on a REGRESSION (a ledger CAUGHT that now misses). A new MISSED never fails — it is the build order for the next generic oracle. |

**A red nightly that nobody answers is not an alarm.** The morning routine is: open the status issue, fix or
acknowledge, done. (It was red for its first fifteen nights before this rule existed — see the audit.)

## 4. The number Doc Bot is scored on

```bash
npm run docbot:report        # → "forward catch rate": overall, and trailing 30 days by report date
```

It is derived from `packages/sim/src/docbot/retroCatalog.ts`: one entry per shipped bug, a minimal source
patch anchored on today's code, and the verdict of the last dated reinjection run. **A MISS is the build
signal**: the miss-driven loop is (1) a player or Mike reports a bug → (2) it is fixed with a pin →
(3) `npm run bugs:catalog -- <report-id>` (or a hand entry) puts its reinjection in the catalog →
(4) the weekly run measures it → (5) a MISSED entry gets a generic lane, which flips it to CAUGHT.
Nothing is CAUGHT by argument; only by a run.

## 5. How to read a failure

- **A lane names a card id and two values** ("claims +16/+16, changed by +8/+8"). That is a bug or a stale
  text — both are defects by owner ruling. Fix the engine or the text; never the assertion.
- **A completeness check says "classify me"** (an entry site, a fire site, a trigger, a field). Classify it in
  the named registry with a verifiable reason. The registry is derived from source so it cannot rot; only
  your classification is hand-written.
- **A ratchet says a queue grew.** Either the new content is genuinely conditional in a way no stager covers
  (add the stager, or the excuse with its condition) or the lane found the bug it exists for.
- **`docbot:report -- --check` says a headline number drifted.** Edit that one line of the final report to
  the generator's value; the check names it.
- **The nightly is red.** See §3 — fix or acknowledge, never ignore.
- **An anomaly / interaction question.** Unruled composition is a QUESTION, never a verdict. It lands in the
  owner decks (`npm run docbot` prints their sizes) and is decided in DEV MENU → Rulebook Triage; every
  ruling becomes an approved rule with a backing lane.

## 6. What Doc Bot cannot see (the honest ceiling)

The full, counted blind-spot list is §10 of the final report. The structural ones: combat causality is
inferred from ordering, not stamped; the RNG tap attributes no decision site; the visual half of presentation
(pixels, FX timing) needs eyes — Doc Bot checks only that beats CLAIM what the state DID; and behaviour with
no approved rule can only be reported as a question. Balance is not, and will not be, an oracle.

## 7. Commands

Printed live by `npm run docbot` (the command list at the bottom is authoritative). The ones you will use:

```bash
npm run docbot                  # the roll-call + every tolerated-but-tracked queue + nightly status
npm run docbot:sync             # a content PR's one regen step
npm run docbot:report           # coverage, blind spots, the forward catch rate (-- --check / -- --json)
npm run docbot:retro            # re-measure the catalog (-- --only <id>) — the number, not an estimate
npm run docbot:scenario -- <id> # replay a QaScenarioV1 (corpus fixture, nightly finding, regression)
npm run bugs:pull|list|repro|close|graduate|catalog   # the player-report loop
```

Doctrine, in one line: **worklists are derived from content and source; excuses carry verifiable reasons;
every lane proves it can fail; every failure is a minimal, deterministic, named reproduction; everything
unverified is a visible queue entry, never silence.**
