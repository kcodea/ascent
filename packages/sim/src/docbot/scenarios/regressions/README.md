# Curated regressions (Doc Bot 2.0 WP G · blueprint §14)

Every file here was written by **`npm run bugs:graduate -- <report-id>`** from a player report that was
reproduced deterministically twice AND whose expected behaviour was resolved by an approved rule, an
approved contract, or a recorded owner decision. Nothing else may write here.

**This is CURATED space (§4.6).** It has different rules from the generated corpus one directory up:

| | `scenarios/regressions/` (here) | `docbot/corpus/` |
|---|---|---|
| Written by | `bugs:graduate`, one file per graduation | `npm run docbot:corpus`, wholesale |
| Regenerated | **never** — a regeneration would erase a confirmed regression | every corpus rebuild |
| Retention | permanent; removal needs the same scrutiny as deleting a test | until the next rebuild |
| Deleted when | the behaviour it pins is deliberately changed, in the PR that changes it | freely |

**Do not hand-drop files here.** `bugTaxonomy.test.ts` fails on any fixture without a matching record in
`bugTaxonomy.graduated.json`, and `regressionScenarios.test.ts` requires `source: 'regression'` plus a
provenance chain back to a report id and the bug scenario it was graduated from.

## What runs them

`regressionScenarios.test.ts` **enumerates this directory** (it does not name ids), so a graduated fixture
is protected the moment it lands — no second edit to remember. Each one must validate against the current
checkout, carry at least one concrete expectation, carry **no** `needs-ruling` question, and pass.

A fixture that starts failing means one of two things, and the PR that caused it owes an answer to which:
the behaviour regressed, or the behaviour was deliberately changed and this pin should move with it.

## Re-running one by hand

```
npm run docbot:scenario -- regression-<short report id>-<class>
```
