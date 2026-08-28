# Doc Bot 2.0 — WP G: the learning loop and the workbench

**Date:** 2026-08-28 · **PR:** feat(docbot2): WP G — bugs:graduate, findings ledger, QA workbench, CI lanes

WP G closes the loop the whole program was building toward: a player report now travels **capture →
reproduction → ruling → graduation → permanent regression** through real commands, with no hand-authored
parallel harness anywhere on the path. Three deliverables plus the CI lanes that run them.

## 1. `npm run bugs:graduate -- <report-id>` (blueprint §14)

The decision procedure lives in `packages/tools/src/bug-graduate.lib.ts` (pure, injectable); the CLI is IO
and a refusal printer. The checklist, in order — each step refuses loudly and writes nothing:

1. **Deterministic reproduction.** The repro runs **twice** and the two *semantic* results must be
   identical (`semanticSignature` deliberately ignores prose and compares classification, after-state,
   combat log, events, expectation verdicts, divergence, drift).
2. **Actually reproduced.** `drifted` / `insufficient-evidence` / `menu-no-evidence` are refusals — a
   drifted capsule proves the *game* changed, which is a different finding.
3. **Expected behaviour resolved.** At least one **APPROVED** rule (`--rule`), **APPROVED** contract
   (`--contract`), or recorded owner decision (`--decision`). An `extracted`/`corroborated` contract or a
   pending rule is refused by name: a machine verdict is not a ruling (owner-review-pipeline.md §2).
4. **A concrete assertion.** The bug scenario's single `needs-ruling` expectation (the player's untrusted
   claim) is *replaced*, never kept — by explicit `--expect` expectations, or by expectations DERIVED from
   the observed run when `--verdict correct` says the ruling blesses current behaviour. Neither ⇒ refusal.
5. **Provenance + taxonomy.** Report id, finding fingerprint, semantic revision, parent scenario, `--pr`,
   all recorded; the class is looked up in `BUG_TAXONOMY` and its graduation appended to
   `bugTaxonomy.graduated.json`.

**Curated ≠ generated (§4.6).** The fixture lands in the NEW `packages/sim/src/docbot/scenarios/regressions/`
— curated space with its own retention, never touched by a generator (README in the directory states the
contract). `regressionScenarios.test.ts` **enumerates** that directory rather than naming ids, so a
graduated fixture is protected on the PR gate the moment it lands.

**Siblings are named, never fabricated.** `BUG_TAXONOMY` (modelled on `retroInteractionMap`'s pattern,
with the same `xErrors()` cross-check discipline) marks each class `generalized` or `single-pin`; a
single-pin class must state its outstanding sibling work, and the command prints it verbatim. Inventing
sibling fixtures nobody derived is exactly the silent uncertainty §4.3 bans.

## 2. `npm run docbot:ledger` — the findings ledger (§12.3)

Every lane already emitted a byte-stable `findings.json`; nothing folded them **across time**. `ledger.ts`
does, keyed by fingerprint, into the gitignored `.local/docbot/ledger.json`: first/last seen (date +
semanticRevision), occurrence count, status-transition history, and the links a finding accumulates
(owner decisions, report ids, regression scenarios). §15.1's five buckets — new · acknowledged · ruled ·
fixed · regression-protected — are a *derived view* over (status, links), so a graduation moves an entry
without anyone editing the ledger.

Three properties, sabotage-proven both directions in `ledger.test.ts`: identity is the fingerprint and
never prose (a reworded repeat folds to one entry; a different `observed` does not); the fold is
order-insensitive and byte-stable; and re-folding is a **no-op** — `foldedBatches` records every
`<date>::<source>` so re-reading an artifact directory is one sighting, not two. The honest trade: a
genuine second run of the same lane on the same day also counts once.

## 3. The QA Workbench (§15)

DevMenu → **🔬 QA Workbench**, following BugBoard/RulebookTriage exactly (inline styles, no bare
`cursor: pointer`, pure helpers exported for the test, `{ onClose }`), fed by a new read-only
`apps/web/workbenchPlugin.ts` (`apply: 'serve'`, closed key set, server-decided paths, strict slug regex
for scenario ids). Five tabs:

- **§15.1 Findings inbox** — the ledger, filtered by class · severity · confidence · lane · bucket · text.
- **§15.2 Content detail** — printed text, the ContentContract with its review status and unparsed spans,
  the text parser's verdict, open findings, and the interaction rows that cover the id.
- **§15.4 Trace comparison** — runs the finding's scenario **in the browser** through the real
  `runQaScenario` and renders the semantic trace with `firstDivergence` highlighted. Nothing rendered
  `firstDivergence` before this.
- **§15.5 Interaction matrix** — WP F's family coverage table, click-through from a row's members.
- **§15.6 Text review queue** — verified mismatches first, then advisor recommendations with current text
  / issue / suggestion. **Accept writes an owner decision through the existing `/__rulebook/decide`
  plugin — it never edits a content file** (§23). That is the surface's only write.

§15.3 rule review is **not duplicated** — the header points at RulebookTriage's fly-through board.

`docbot:text` grew an additive `--out` so §15.6 has data on disk (`findings.json` + `text-review.json`);
without the flag its behaviour is unchanged.

## 4. CI lanes (§17)

`docs/docbot2/ci-lanes.md` states what runs where and what red means. `nightly.yml` grew the full contract
and interaction sweeps (`continue-on-error` — a red sweep is a finding whose artifacts must still upload)
plus a ledger fold; a new additive, non-blocking `weekly.yml` (Sundays 04:23 UTC) runs a 4× lifecycle
budget plus both full sweeps and folds the week.

**The retro reinject harness stays MANUAL, documented rather than wired.** `packages/tools/retro/reinject.py`
is a Python mutation harness that rewrites engine source in place and depends on a clean revert: the CI
image has no Python, a timed-out run leaves a sabotaged checkout, and its verdicts are dated citations
worth more when a human ran them. The part that genuinely needs automating — a catalog entry losing its
mapping — is already on the PR gate via `retroMapErrors()`.

## The walkthrough, on a synthetic report

`packages/tools/src/bugs-synthetic.ts` builds a deterministic combat capsule (a real fuzz-walked shop
phase, then a pinned re-fight) with a sentinel id `00000000-…`, into the gitignored inbox. Observed:

| Command | Result |
|---|---|
| `bugs:repro -- 00000000` | `classification: reproduced` — captured vs re-simulated combat identical |
| `bugs:graduate -- 00000000 --verdict correct` | **REFUSED** — "NEEDS RULING FIRST" |
| `bugs:graduate -- 00000000 --rule q-9999 --verdict correct` | **REFUSED** — "rule 'q-9999' is not APPROVED" |
| `bugs:graduate -- 00000000 --rule R-CEL-01` | **REFUSED** — "NO CONCRETE ASSERTION" |
| `bugs:graduate -- … --rule R-CEL-01 --verdict correct --class resolution-order --no-close` | **GRADUATED** — fixture + taxonomy record written, 4 derived `event-count` expectations |
| `vitest regressionScenarios bugTaxonomy` | 2 tests → **6 tests**, all green, 17 ms |

**The synthetic graduation is deliberately not committed.** Its `R-CEL-01` citation is a stand-in chosen
to exercise the approval predicate — shipping a curated regression whose citation nobody actually ruled is
precisely what the taxonomy validator exists to prevent. The transcript is the evidence; the fixture and
the record were reverted. `docs/docbot2/ci-lanes.md` carries the five commands to reproduce it.

The owner's four real reports were **not** graduated (they are still open and unruled).

## Judgement calls worth flagging

- **`--verdict correct` vs `--expect`.** A derived pin asserts the behaviour the run *currently* produces.
  That is only legitimate when the ruling says current behaviour is right, so the flag is named for that
  claim and the alternative (`--expect`) exists for everything else. Without one of them the command
  refuses rather than silently enshrining a bug.
- **Contracts are keyed by `contentId`**, so `--contract kennel` names the card whose approved contract
  carries the ruling — there is no separate contract id.
- **`--no-close`** exists because closing a report needs Supabase. Without it a close failure exits 2 with
  the fixture already written and the exact `bugs:close` line to run by hand — loud, never silent.
- **Ledger idempotence** chose safety-to-re-run over counting two same-day runs of one lane separately.
