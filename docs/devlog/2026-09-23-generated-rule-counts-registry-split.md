# 2026-09-23 — Generated rule counts + the approved registry split per domain

Two owner-flagged tooling items on the rules oracle, both aimed at the same pain: three same-day PRs
(#1646, #1647, #1648) each added one approved rule, and each conflicted with the others on exactly two
things — the tail of `packages/rules/src/registry/approved.ts` and the two rule-count lines of
`docs/docbot2/final-report.md`.

## 1. The report's rule counts are generated, never bumped

`docs/docbot2/final-report.md` now writes `{{rules.total}}` and `{{rules.approved}}` where it used to
carry `180` / `94`. `resolveHeadlinePlaceholders()` (in `packages/tools/src/docbot-report.lib.ts`) fills
any `{{<headline key>}}` from `headlineNumbers()` at READ time — in `docClaimErrors()` (so the drift-rail
test `docbot-report.test.ts`, which is what `npm test` and the CI `verify` check run, and
`npm run docbot:report -- --check` both see the live number) and in the new
`npm run docbot:report -- --render [path]`, which prints the filled-in copy for a human.

Why placeholders rather than a `--write` step: a write step still puts a literal in the file, so two PRs
that each add a rule both rewrite the same line (to the same value) and the second to merge is stale the
moment the first lands. A placeholder has nothing to bump and nothing to conflict on.

The check is now three-sided:
- a literal headline number that drifts still fails (unchanged);
- a `{{key}}` the generator does not derive fails by name (a typo cannot pass as generated);
- `PLACEHOLDER_ONLY_HEADLINES` (`rules.total`, `rules.approved`) MUST appear as placeholders — writing the
  number back as a literal fails with "must be written as the placeholder".
All three are sabotage-measured in `docbot-report.test.ts`. Any other headline key can be migrated to a
placeholder the same way when it starts costing conflicts; nothing forces it.

Pre-existing, untouched: the report's §6 line also says "**145** read approved" — that number is not a
headline (the generator does not derive an effective-approved count) and is already stale (166 today).

## 2. `approved.ts` → one file per domain

`scripts/split-registry.mjs` walked the monolith's array at its top level (one `  {` … `  },` object per
rule, with any comment lines directly above it) and wrote each rule's source text UNCHANGED into
`packages/rules/src/registry/approved/<domain>.ts`, one file per `RuleDomain` (20 files; `categories`
and `heroes` are empty arrays waiting for their first rule). The two shared locator constants went to
`approved/shared.ts`; each domain file imports only the ones it cites. `approved/index.ts` holds
`APPROVED_BY_DOMAIN: Record<RuleDomain, …>` (a new domain is a type error until it is listed) and
`APPROVED_DOMAIN_ORDER` (the `RuleDomain` union's order), and exports `APPROVED_RULES` as the fixed-order
concatenation — so `import { APPROVED_RULES } from './registry/approved'` and every `@game/rules` consumer
is unchanged.

**The proof.** Before the split: 94 rules, sha256 of the sorted canonical form (keys sorted at every
depth, `undefined` stripped — the `registryHash.ts` primitive) =
`940ce4d2d1c6e56cdaf1376d4dc48b583909a8b33090f4e151a75b8284209a14`. After: 94 rules, the same hash,
0 rules whose canonical form differs, ids equal as sets. The script additionally proved its walk lossless
by reassembling the chunks and comparing them to the original array body (sha256
`91d5592b…`, identical). The one thing that changed is ORDER — chronological → domain — and nothing in the
repo depended on it (the enforcement ratchet sorts, `rulesRevision()` sorts by id, `releaseBlockers` is
sorted). The chronological section-header comments of the monolith ("THE 2026-09-21/22 BUG-FIX SWEEP", …)
travelled with the rule that followed each of them.

`packages/rules/src/registry/approved/approved.test.ts` keeps the structure honest forever: the
concatenation equals the domain files in order with no duplicate id; every rule is filed under the domain
it declares (the failure names the move); every one of the 94 ids live at the split is still live or
explicitly retired (ids never vanish). Sabotage: pointing the record's `combat` slot at `COPYING_RULES`
reddened three of the four cases.

**The script stays** as the merge tool. A branch opened before this change that still appends to the
monolith takes `main`, keeps ITS `approved.ts` in the "deleted by them / modified by us" conflict, runs
`node scripts/split-registry.mjs --rm`, and every rule the domain files do not yet hold is appended to the
right file byte-for-byte (an id already filed with different text stops the run and names the rule). That
is exactly how this PR took the three rules #1646/#1647/#1648 landed on `main` after the split was cut.

## What an agent does now to add a rule

1. Append the `GameRule` to the END of the array in `packages/rules/src/registry/approved/<domain>.ts`
   (its `domain` must match the file — `approved.test.ts` says so if not). Grep `registry/approved/` for
   the highest `NN` on the topic; a topic can span files.
2. `npx vitest run packages/rules` and `npm run docbot:report -- --check`.
3. Do NOT touch `docs/docbot2/final-report.md`; do NOT touch `approved/index.ts` unless introducing a new
   `RuleDomain`.

Instruction texts updated: CLAUDE.md ("Bug fixes become rules"), `docs/docbot.md` §2 + §5,
`.claude/skills/ascent-content` + `ascent-gameplay`, `docs/bug-reports.md`, the header comments in
`enforcement.ts`, `registry/retired.ts`, `registry/pendingManual.ts`, `temporalWindow.test.ts` and
`@game/rules`' index. Left alone on purpose: the two evidence refs that read `(registry/approved.ts)` in
`conventionQuestions.ts` / `languageGuide.ts` — they are historical locators inside rule evidence, and
changing them would move `rulesRevision()` and regenerate `pendingConventions.generated.ts` for no
behavioural reason.
