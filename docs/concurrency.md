# Working concurrently on ASCENT

This repo is worked by **several sessions at once** — Kevin, Mike, and multiple Claude Code agents. That
parallelism only pays off if sessions stay out of each other's way. Almost every concurrency failure here
traces to **one root cause: multiple sessions sharing a single working directory + one git index.** When one
session runs `git switch` or tears down a worktree, it moves the branch and deletes files *under* another
session mid-task. Fix that structurally and the rest gets easy.

> **The one rule that prevents most pain:** your session works in **its own checkout** and touches **nothing
> else's** — never another session's worktree, branch, or the shared primary checkout.

> 📋 **Want the step-by-step moves** (START → WORK → FINISH per session)? See the human runbook:
> [`multi-session-playbook.md`](multi-session-playbook.md). This doc is the *why*; that one is the *how*.

---

## 1. One isolated checkout per active session (highest leverage)

Never do feature work as two live sessions in the same folder.

- **Preferred — a dedicated worktree per task**, owned by exactly one session. There's a helper for this:
  ```sh
  npm run task -- fix/my-thing        # isolated worktree off latest origin/main (--install to also npm install)
  npm run task:list                   # every worktree
  npm run task:done -- fix/my-thing   # tear it down after the PR merges
  ```
  It fetches origin, branches off `origin/main`, and drops the tree under `.claude/worktrees/<slug>` (gitignored;
  NOT a Desktop sibling — Windows leaves hollow husks when siblings are torn down). Under the hood it's just
  `git fetch origin && git worktree add .claude/worktrees/<slug> -b <branch> origin/main` — do that by hand if
  you prefer. **Work only in that tree.**
- **Or a separate clone** per person if worktrees keep colliding.
- Treat the **primary `Desktop/ascent` checkout as a shared reference**, not a place anyone does feature edits
  or branch switches.
- **Never `git worktree remove` / `prune` a tree you didn't create.** Remove only your own, when you're done.

## 2. Commit + push early — origin is the only durable copy

A worktree in a shared repo is one stray `prune` away from gone; local-only work goes with it. So:

- Push within minutes of starting; open the PR early (**draft is fine**).
- If your worktree disappears, don't panic — recreate it from `origin/<branch>`; the code is safe on origin.

## 3. Keep branches tiny; take `main` in constantly

`main` can move **7+ commits in a single session**. A branch that lives a day conflicts badly.

- Scope work to hours, not days.
- `git fetch` + merge/rebase `origin/main` **before every push** and **before opening/merging** a PR.
- Land fast. The longer a branch lives, the worse the merge.

## 4. Split by ownership seam — two sessions never edit the same file

Parallelism pays **only along clean seams**. The expensive conflicts live in these chokepoints — coordinate
before touching them, and don't have two sessions in one at once:

- `packages/sim/src/state.ts` + `reducer.ts` (run state)
- `packages/core/src/types.ts` (shared types / combat event vocab)
- `packages/ui/src/store.ts` (Zustand)
- `packages/ui/src/styles.css` (big, touched by lots of UI work)
- `packages/content/src/opponentPool.data.ts` (generated — never hand-edit; re-run `npm run pool`)

Ownership map (update as work shifts):
- **Kevin** — engine + content + run loop: `packages/core/**`, `packages/content/**`, `packages/sim/**`, `packages/tools/**`
- **Mike** — presentation: `packages/ui/**`, `apps/web/**`

If two tasks must touch the same file, run them **sequentially**, not concurrently.

## 5. Look before you start (avoid duplicate work)

Thirty seconds here saves an hour of a duplicated or conflicting change:

```sh
gh pr list                       # is someone already doing this?
git branch -a                    # in-flight branches
git log --oneline origin/main -10   # what just landed
```

## 6. Shared-resource hygiene

- **Dev-server ports:** give each session its own port. For a throwaway preview to eyeball, serve a
  self-contained page from scratch with a standalone server (`python -m http.server <port> --directory <dir>`)
  — it survives the git churn a worktree dev server won't.
- **Verify the branch** right before any commit/merge: `git branch --show-current` (assume a neighbor may have
  switched the shared checkout).
- **Never push to `main` directly** (see the main collaboration rules); every change lands via PR + green CI.

---

### TL;DR

Own your checkout, push early, keep branches short, take `main` in often, split by ownership seam, and look
before you leap. If you do only one thing: **give every concurrent session its own worktree off latest
`origin/main` and never touch anyone else's.**
