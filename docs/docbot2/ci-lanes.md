# Doc Bot 2.0 — CI execution lanes (WP G · blueprint §17)

> What runs where, why it runs there, and what a red run means. Three lanes, one rule each:
> **the PR gate must be fast and deterministic**, **the nightly may be slow**, **the weekly may be
> expensive**. Only the PR gate can block a merge.

## The three lanes at a glance

| | PR gate (`verify`) | Nightly | Weekly / deep |
|---|---|---|---|
| Workflow | `.github/workflows/ci.yml` | `.github/workflows/nightly.yml` | `.github/workflows/weekly.yml` |
| Trigger | every PR into `main`, push to `main` | cron 09:17 UTC daily + dispatch | cron 04:23 UTC Sundays + dispatch |
| Blocking | **YES** — required check | no | no |
| Budget | whole job in CI minutes; Doc Bot's share **< 30 s** | 60 min | 120 min |
| Red means | *do not merge* | *a lane found something overnight — triage it* | *a deep probe found something — triage it* |

Nothing in the nightly or weekly lane can fail a PR. That is deliberate and is the §17.4 rule in practice:
a gate you cannot trust is a gate people learn to ignore.

## §17.1 — the pull-request gate

`npm run typecheck && npm run lint && npm test && npm run build:web`, exactly as CLAUDE.md describes. Doc
Bot's contribution to that gate is **vitest lanes only** — no sweep CLI runs on a PR, because a full sweep
is minutes and the gate's whole Doc Bot budget is under 30 seconds.

What Doc Bot contributes to `npm test` on every PR:

| Lane | File | Guards |
|---|---|---|
| Schema + registry integrity | `rules.test.ts`, `refIntegrity.test.ts`, `contractExtract.test.ts` | every rule/contract id resolves; no approved rule loses its enforcement pin |
| **Curated regressions** | `regressionScenarios.test.ts` | **enumerates** `scenarios/regressions/` — every graduated player report, validated + replayed. This is §14's "CI protects the behavior forever" |
| Bug taxonomy integrity | `bugTaxonomy.test.ts` | every graduation record names a real class and a fixture that is actually on disk; no fixture squats curated space without a record |
| Findings ledger | `ledger.test.ts` | the fold is deterministic, order-insensitive, and idempotent |
| Graduation refusals | `bug-graduate.test.ts` | a flaky repro, an unruled expectation, or an unapproved citation each REFUSE |
| Scenario parity | `qaScenarioParity.test.ts` | the hand-authored fixtures still pass |
| Isolated/interaction floors | `interactionMatrix.test.ts`, `interactionFamilyMatrix.test.ts`, `temporalWindow.test.ts`, … | the hand-pinned interaction floor WP F's generator must subsume |
| Text + live-value tripwires | `textNumbers.test.ts`, `textOracle*.test.ts` | printed values match live values (CLAUDE.md's hard rule) |

**Measured cost of the WP G additions** (2026-08-28, this checkout): `regressionScenarios` +
`bugTaxonomy` + `ledger` + `bug-graduate` + `QaWorkbench` + `workbenchPlugin` = **6 files, 66 tests, well
under a second of test time**. The regression lane grows with the number of graduated reports; when it
approaches the budget, split it by mode (recruit vs combat) before slowing the gate.

**Deliberately NOT on the PR gate**, and why:
- the full contract sweep (`docbot:contracts`) — minutes; the nightly runs it whole, and the PR gate's
  `contractOracle` sampling already covers changed surfaces;
- the full interaction sweep (`docbot:interactions`) — same reason;
- `docbot:text` — it REGENERATES `pendingWording.generated.ts`, and a CI job that rewrites a checked-in
  registry would either fail on dirt or commit behind the author's back;
- anything reading Supabase (`bugs:*`) — the gate has no service-role key and must never have one.

## §17.2 — nightly

`Docbot Nightly` (`nightly.yml`), 09:17 UTC. Three steps, each writing into its own artifact directory,
all uploaded with `if: always()` so a green run is as inspectable as a red one:

1. `npm run docbot:nightly -- --runs 6 --out artifacts/docbot-nightly` — full deterministic lifecycle runs
   + the lobby sweep + failure minimization + coverage-guided corpus.
2. `npm run docbot:contracts -- --out artifacts/docbot-contracts` — the FULL contract sweep (the PR gate
   only samples).
3. `npm run docbot:interactions -- --out artifacts/docbot-interactions` — the full pairwise interaction
   matrix + the anomaly oracle.

Steps 2 and 3 are `continue-on-error: true`. That is not laxity: a red sweep is a *finding*, and the
findings must still be uploaded. The upload step is what the reviewer actually wants.

One side effect worth knowing: `docbot:interactions` also **reseeds** `pendingInteractions.generated.ts`
(and `retired.generated.ts`) as part of its Sitting-2 deck hygiene. On a throwaway CI runner that write is
inert — nothing commits it — but it is why this command is a *nightly/weekly* one and not a gate one: a
blocking job that rewrites a checked-in registry would either fail on a dirty tree or commit behind the
author's back.

Each step writes a `findings.json` — the same byte-stable array of `DocbotFinding` — so the whole night's
output folds into the ledger with one command:

```
npm run docbot:ledger -- --in artifacts --print 20
```

That is the intended morning routine: download the artifact bundle, fold it, open the QA Workbench
(DevMenu → 🔬 QA Workbench) and work the inbox.

**Not in the nightly:** `docbot:text` (registry regeneration, as above) — it is a local command, and its
`--out artifacts/docbot-text` feeds the workbench's text queue when a developer runs it.

## §17.3 — weekly / deep

`Docbot Weekly` (`weekly.yml`), 04:23 UTC Sundays, additive and non-blocking. It runs what is too
expensive for a nightly:

- a **long-horizon lifecycle exploration** — `docbot:nightly --runs 24`, four times the nightly's seed
  budget. This is §17.3's greybox fuzzing and longer lifecycle exploration; the explosion guards and
  combat budgets inside `driveTrajectory` do its event-explosion half.
- the **full contract sweep** (unsampled) and the **full interaction sweep**. `docbot:interactions`
  already runs every candidate pair *and* the §10.4 triples in one pass — there is no separate
  "triples" flag to turn on, so the weekly's deep-set difference from the nightly is the lifecycle
  budget, not a different sweep invocation. Running them here too means a week never passes without a
  full sweep even if every nightly failed to start.
- the **ledger fold** over everything the run produced, uploaded so the trend is visible week to week.

**The retro reinject harness is NOT wired into this workflow, deliberately.** `packages/tools/retro/`
is a **Python** mutation harness (`reinject.py`) that rewrites engine source in place, runs the cited
lane, expects red, and reverts. Three things make it unfit for an unattended runner today:

1. it needs a Python toolchain the repo's CI image does not install, so wiring it means adding a second
   language runtime to a lane nobody watches;
2. it mutates tracked source files and relies on a clean revert — a run killed by a CI timeout leaves a
   sabotaged checkout, which is harmless on a throwaway runner but produces a confusing red;
3. its verdicts are *citations* (`verifiedBy: 'reinject-run'` with a measured date in
   `retroInteractionMap.ts`), and a citation that a machine refreshes unattended is worth less than one a
   human ran and dated.

So it stays a **manual, attended run** — `python packages/tools/retro/reinject.py` — performed when the
retro map changes or a lane it cites is renamed, with the date recorded in the map. `retroMapErrors()`
already fails the PR gate when a catalog entry loses its mapping, which is the part that genuinely needs
automating. Revisit this if the CI image grows Python for another reason.

## §17.4 — no flaky probability gates

Every correctness run is seeded. The anomaly oracle (§9.7) ships with a confidence floor and caps its
findings at `questionable-interaction` — it can raise a question on any lane, but it can never fail the PR
gate. `bugs:graduate` enforces the same principle at the other end: a report whose repro is not identical
twice is REFUSED, so a flake can never become a permanent regression.

## The learning loop, end to end

```
player presses Ctrl+B
  → capsule captured (rolling action window + rails)      packages/sim/src/bugReport.ts
  → npm run bugs:pull                                     .local/bug-reports/<id>/
  → npm run bugs:repro -- <id>                            classification + qa-scenario.json
  → the question goes to the owner                        RulebookTriage fly-through → decisions.json
  → npm run bugs:graduate -- <id> --rule <approved>       refuses unless deterministic AND ruled
  → curated fixture                                       scenarios/regressions/<id>.json
  → taxonomy record                                       bugTaxonomy.graduated.json
  → PR gate runs it forever                               regressionScenarios.test.ts
  → the finding's ledger entry moves to regression-protected
```

Every hop is a real command, and no step needs a hand-authored parallel harness.

## Reproducing the walkthrough locally

```
npx tsx packages/tools/src/bugs-synthetic.ts          # a synthetic report, into the gitignored inbox
npm run bugs:repro -- 00000000                        # → classification: reproduced
npm run bugs:graduate -- 00000000 --verdict correct   # → REFUSED: needs ruling first
npm run bugs:graduate -- 00000000 --rule R-CEL-01     # → REFUSED: no concrete assertion
npm run bugs:graduate -- 00000000 --rule R-CEL-01 --verdict correct --class resolution-order --no-close
```

The last line graduates it. **The synthetic graduation is not committed**: its rule citation is a stand-in
chosen to exercise the approval predicate, and shipping a curated regression whose citation nobody ruled
is exactly what the taxonomy validator exists to prevent. Run it, watch the regression lane go from 2
tests to 6, then `git checkout` the two files back.
