# Dev log — one file per entry

**New entries go HERE, as their own file. Do not prepend to [`../devlog.md`](../devlog.md).**

## Why this directory exists

Every devlog entry used to be prepended to the top of a single 46,000-line `devlog.md`. That meant **every
concurrent PR inserted at the same line**, so any two sessions working the same day produced a guaranteed
merge conflict — every time, forever. On 2026-08-20 that cost the better part of an afternoon: a content PR
lost three full CI cycles re-merging `main` while another session landed UI PRs hourly, and each re-merge
conflicted on nothing but the devlog header.

One file per entry makes concurrent entries **structurally unable to conflict** — two sessions add two
different files. Git never has to reconcile them.

## The convention

Create `docs/devlog/YYYY-MM-DD-short-slug.md`:

```markdown
# 2026-08-21 — Rune of X pays out on purchase

What changed and why (engine / content / UI / balance), how it was verified (tests, harness, live checks),
and any follow-ups worth the next session's attention.
```

- **One file per shipped change or tight group.** Same content and depth as before — only the location moves.
- **Name the file for the day it shipped**, so the directory sorts chronologically. Several entries on one
  day just get distinct slugs.
- If two sessions somehow pick the same filename, rename yours — that is a filename collision, not a content
  conflict, and it takes seconds.

## Reading history

- **[`../devlog.md`](../devlog.md)** is the ARCHIVE: everything through 2026-08-20, newest first. It is not
  frozen for reading, only for writing — leave it alone unless you are correcting an existing entry.
- This directory holds everything after that. `ls docs/devlog/` is the index; the filenames are the timeline.

To read both in order, the archive's top entry and this directory's newest file meet at 2026-08-20.

## When to write one at all

Per `CLAUDE.md`'s documentation policy, a devlog entry is for **meaningful shipped work, migrations, owner
decisions, and non-obvious fixes** — the things a future session would otherwise have to re-derive. A typo
fix, a lint tweak, or a dependency bump does not need one.
