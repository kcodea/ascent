# 2026-09-22 — every bug fix becomes a rule, and the ten that were missing

The owner asked whether the recent fixes were in the oracle. They were not: the newest approved rule was
`R-TARGET-03` (2026-09-18), while four days of bug fixes had shipped behind it. The ruling that followed is
now a standing contract, not a habit: *"every single bug fix we find and solve gets written into the oracle
so that docbot always catches issues."*

## The ten rules

Added to `packages/rules/src/registry/approved.ts`, each with the owner's own words as `owner-chat` evidence,
the merged PR as `fix-pr`, and the regression test that shipped with the fix as its `enforcement.refs`.

| id | rule | domain |
|---|---|---|
| `R-PUMMEL-01` | a Pummel tally is per instance and lifetime; pays at most once per combat; readouts print progress to the next payout | keywords |
| `R-MULT-04` | a Start-of-Combat multiplier repeats RUNE Start-of-Combat effects too, in base-pass order | multipliers |
| `R-AVWIN-12` | late entry starts at zero on every placement path (the Reclaim insert included) and the printed counter shows that same window | triggers |
| `R-HOLD-01` | a displaced minion keeps the Shop buffs it accrues on the offer, through every restore path | persistence |
| `R-TEXT-04` | a stat spell folds spell power and prints it live, in every Choose One branch | text |
| `R-SNAP-01` | the recorded final board is the post-settle board | persistence |
| `R-RANK-01` | a won promotion lands at 10 points, never 0 | foundation |
| `R-RANK-02` | no instant demotions; hitting 0 arms a demotion game | foundation |
| `R-TEXT-05` | player-facing text never uses an em dash or a double hyphen | text |
| `R-LOBBY-01` | a ghost fight is never a rematch | foundation |

Two read **PARTIAL** on purpose. `R-AVWIN-12` and `R-TEXT-04` state intent the engine does not fully meet yet
because their fix PRs (#1618, #1619) were still in flight; each `currentBehaviour` names the open half and the
pin to append on merge. That is the registry working as designed: a rule is a statement of intent, and the
implementation conforms to it or is recorded as not yet conforming. It never approves itself.

The ladder rules file under `foundation` rather than `economy`: the ladder is a structural contract of the
lobby, while `economy` covers Gold, embers and the shop inside a run.

Ranked, Kobe's Ruby nerf (#1597) was left out on purpose. It is a balance tune, not a correctness ruling, and
balance is not an oracle.

## The standing rule, in four places

A bug fix is not done until its rule is in the registry, in the same PR:

- `CLAUDE.md` — a new section, **"Bug fixes become rules — every single one, in the same PR"**, with the
  five-step recipe (id scheme, statement, evidence, current behaviour, enforcement ref).
- `.claude/skills/ascent-gameplay/SKILL.md` — a new step 7 in the Workflow.
- `.claude/skills/ascent-content/SKILL.md` — a new Verification line.
- `docs/bug-reports.md` — in the Triage output section, so a report worked from the Bug Board ends in a rule.

## Totals

Recomputed from the registry rather than added by hand: **159** live rules, **73** hand-authored approved,
145 effectively approved once decisions fold in, 12 revised, 2 needs-ruling, plus 55 hand-retired rulings and
1 auto tombstone. `docs/docbot2/final-report.md` carried two stale numbers (a 149/63 headline and a long-dead
"114 rules total: 31 approved" line); both now derive from the generator, which `npm run docbot:report --
--check` gates.

The approved-but-unenforced ratchet did not move: `R-PLAY-01` and `R-AURA-01` remain the only two honest gaps,
and all ten new rules are enforced.
