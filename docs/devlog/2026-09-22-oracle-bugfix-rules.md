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

Three read **PARTIAL** on purpose. `R-AVWIN-12` and `R-TEXT-04` state intent the engine does not fully meet
yet because their fix PRs (#1618, #1619) were still in flight; `R-TEXT-05` states the owner's writing rule for
every surface a player reads, and card text does not obey it yet. Each `currentBehaviour` names the open half.
That is the registry working as designed: a rule is a statement of intent, and the implementation conforms to
it or is recorded as not yet conforming. It never approves itself.

## What the review changed: three real pins instead of three comfortable claims

A review of the first pass found the failure mode this whole exercise exists to prevent — a rule that reads as
enforced while its ref pins something else:

- **`R-TEXT-05` claimed conformance on card text, and nothing scanned card text.** The tripwire from #1606
  covers the glossary, the patch notes, screen labels and the run-time helpers, but never `def.text`. A sweep
  of live content found **29 cards** carrying an em dash (Gryphon, Mama Bear, Taragosa Heir, most of the Set 3
  Celestials). `noEmDashPlayerText.test.ts` now sweeps every card and every rune against a frozen debt list:
  a card that is not on the list fails CI, and a card on the list that has been rewritten must come off it, so
  the debt can only shrink. Runes were already clean. Clearing the 29 is a content pass with its own patch
  note, not a registry edit.
- **`R-TEXT-04` said a stat spell folds spell power, and `flat: true` was a silent way out.** Both sweeps skip
  an effect carrying `flat: true`, so a spell could opt out of spell power with no owner ruling and no alarm.
  `spellPowerText.test.ts` now pins the exemption list itself to an exact set (`FLAT_EXEMPT`: Crest of the
  Climb, open on #1619, and the Tower Shield on the owner ruling of 2026-09-09).
- **`R-AVWIN-12`'s one ref pins the ordinary summon path**, which is already `R-AVWIN-01` ground — so neither
  half the new rule adds was machine-checked, and a note in a PR body would not have caught it. The new
  `OPEN_PINS` list in `packages/rules/src/enforcement.test.ts` reddens CI the moment
  `packages/ui/src/avengeSummonReadout.test.ts` lands on disk without being cited by the rule. A PARTIAL rule
  can no longer quietly stay unpinned.

`R-SNAP-01` and `R-LOBBY-01` also had their statements trimmed to what their pins actually carry: `R-SNAP-01`
no longer enumerates carried state its test never asserts, and `R-LOBBY-01` now names the deliberate floor its
own test pins (with no non-rematch ghost available the selector still returns the most recent fallen seat,
because a fight beats a free round) so a future agent does not "fix" it.

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

The approved-but-unenforced ratchet did not move: `R-PLAY-01` and `R-AURA-01` remain the only two honest gaps.
All ten new rules carry a pin, and the three PARTIAL ones say in `currentBehaviour` exactly which half of the
rule that pin covers.
