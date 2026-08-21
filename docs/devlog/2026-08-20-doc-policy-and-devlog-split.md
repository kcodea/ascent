# 2026-08-20 — documentation policy is event-driven, and the devlog stops causing merge conflicts

The old rule in `CLAUDE.md` was *"every commit must update devlog + roadmap + README."* It cost more than it
bought, and the cost was measurable rather than theoretical.

**The structural problem.** Every devlog entry was prepended to the top of a single 46,553-line file. Two
sessions working the same day therefore inserted at *the same line*, which is a guaranteed merge conflict —
not occasionally, but every time. On 2026-08-20 a content PR lost three full CI cycles re-merging `main` while
another session landed UI PRs hourly, and every one of those re-merges conflicted on nothing but the devlog
header. "Update the docs less often" would have reduced the symptom; it would not have fixed the cause.

**The fix.** New entries are one file each under [`devlog/`](./) (`YYYY-MM-DD-slug.md`, this file being the
first). Two sessions adding two entries now add two different files, which git never has to reconcile.
`docs/devlog.md` becomes the archive through 2026-08-20 — still the place to read history, no longer a place
to write it.

**The policy**, replacing the every-commit rule:

- **Devlog** — meaningful shipped work, migrations, owner decisions, non-obvious fixes. Not typos, lint, or
  dependency bumps.
- **Roadmap** — only when priority or status actually moves.
- **README** — setup, product identity, major user-facing capabilities. Explicitly *not* a changelog.
- **Rules / architecture docs** — whenever behaviour or a contract changes. This is the one that must never
  lag, because a stale rules doc makes agents wrong rather than merely uninformed.

**`docs/CONTENT.md` is now generated-only.** It previously claimed **30 basic / 31 epic runes** against actual
**141 / 138**, and described a flat `cards/` layout that has been set-scoped for months. It now carries no
counts at all — just the commands (`dump-cards`, `audit`, `text:audit`, `beats:audit`, `report:export`) and a
verified one-liner for ad-hoc queries, plus an accurate map of where content lives. A number in a document is
a number nobody re-verifies.

**README** also shed 197 changelog bullets (~500 lines on the repo's front page) down to eight real headlines,
and its "game in one screen" section stopped describing 17 rounds, the Line, and Set 1's six tribes — it now
describes the lobby and Set 2's five.

Docs only. Gates: typecheck ✅ · lint 0 errors ✅ · 6294 tests / 385 files ✅ · build:web ✅
