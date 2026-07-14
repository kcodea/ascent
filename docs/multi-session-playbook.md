# Multi-session playbook (the human runbook)

This is the **step-by-step system you follow** when running several sessions (Kevin, Mike, or multiple Claude
agents) at once. It's the operational companion to [`concurrency.md`](concurrency.md): that doc explains the
*principles* and *why*; this one is the *exact moves* — START → WORK → FINISH — for each session.

Tailored to this repo: Windows, an npm-workspace monorepo, and the `.claude/worktrees/` convention that keeps
worktrees off your Desktop.

---

## The mental model (this is the whole thing)

> **One session = one task = one branch = one isolated worktree = one PR.**
> Sessions meet **only on `origin`**, never on disk. No two sessions ever share a working directory or a git index.

Every rule below serves that sentence. Nearly every concurrency failure here — switched branches, leftover
folders, duplicated work — traces to sessions sharing the primary `Desktop/ascent` checkout.

---

## One-time setup (once per machine)

```powershell
# Keep every worktree in ONE predictable, gitignored place (.claude/ is already ignored),
# so worktrees never pollute git or clutter your Desktop.
mkdir C:\Users\micha\Desktop\ascent\.claude\worktrees   # if it doesn't exist
```

Baked-in rule: **worktrees live under `.claude\worktrees\`, never as `Desktop\ascent-*` siblings.** That one
choice is what prevents the husk-folder mess (removed worktrees on Windows can leave hollow `node_modules`
shells; keeping them inside the gitignored `.claude/` tree keeps them contained and off your Desktop).

---

## Per-session lifecycle

Each session runs this three-phase cycle. `<task>` is a short kebab name reused everywhere (branch, worktree,
PR) so the work is traceable end to end — e.g. `taunt-frame`.

### START — carve out an isolated workspace

```powershell
cd C:\Users\micha\Desktop\ascent
git fetch origin                              # get latest; do NOT switch the shared checkout
git worktree add .claude\worktrees\<task> -b feat/<task> origin/main
cd .claude\worktrees\<task>
npm install                                   # workspace deps for this tree
git push -u origin feat/<task>                # claim the branch on origin immediately
```

Then, before writing a line — **30 seconds that saves an hour:**

```powershell
gh pr list                          # is another session already on this?
git branch -a                       # what's in flight
git log --oneline origin/main -10   # what just landed
```

### WORK — stay in your lane

- **Touch only your task's files.** Pick a task that lives in **one ownership seam** so two sessions never edit
  the same file. Serialize the chokepoints (never two sessions in one at once):
  - `packages/sim/src/state.ts` + `reducer.ts` (run state)
  - `packages/core/src/types.ts` (shared types / combat event vocab)
  - `packages/ui/src/store.ts` (Zustand), `packages/ui/src/styles.css` (big, UI-wide)
  - `packages/content/src/opponentPool.data.ts` (**generated** — never hand-edit; re-run `npm run pool`)
- **Push within minutes, and keep pushing.** A worktree is one stray command from gone; `origin` is your only
  durable copy. Open the PR early — **draft is fine.**
- **Own port per session** for dev servers (`npm run dev -- --port 5174`, `5175`, …) so previews don't collide.
- **Verify the branch before every commit:** `git branch --show-current` — assume a neighbor may have moved the
  shared checkout.

### FINISH — land it and tear down cleanly

```powershell
# from inside your worktree
git fetch origin && git rebase origin/main    # take main in BEFORE the PR
npm run typecheck && npm run lint && npm test && npm run build:web   # prove green
git push --force-with-lease                    # after the rebase
gh pr create --fill                            # or mark the draft ready
# … CI green + a quick review from the other person → squash-merge …
```

Then **destroy the workspace** — the step that prevents husks:

```powershell
cd C:\Users\micha\Desktop\ascent
git worktree remove .claude\worktrees\<task>            # add --force if it complains
# Windows sometimes can't delete a locked node_modules; if a husk lingers:
Remove-Item -Recurse -Force .claude\worktrees\<task>    # only if the remove left a shell
git worktree prune                                       # clear stale registrations
git branch -d feat/<task>                                # local branch (now merged)
```

---

## Launching several sessions at once (the orchestration)

1. **Slice by seam first, on paper.** Before opening any session, list the tasks and confirm each lives in a
   different area (engine vs UI vs content vs tools). If two must touch `types.ts` or `styles.css`, run them
   **sequentially, not in parallel.**
2. **One session, one task name.** Branch, worktree, and PR share the name so it's traceable everywhere.
3. **Spin each up with the START block**, each in its own worktree. You now have N terminals, N worktrees under
   `.claude\worktrees\`, N branches, N draft PRs — fully isolated.
4. **The primary `Desktop\ascent` checkout is a read-only reference** while sessions are live. Never do feature
   edits or `git switch` there — that's the move that yanks the floor out from another session.
5. **Never `git worktree remove` / `prune` a tree you didn't create.** Tear down only your own, only when done.

---

## Weekly hygiene (5 minutes)

```powershell
cd C:\Users\micha\Desktop\ascent
git worktree list        # should show only ACTIVE sessions + the primary
git worktree prune       # drop stale registrations
git branch --merged main # candidates to delete
gh pr list               # anything stuck open?
```

If `git worktree list` shows trees you don't recognize, that's leftover debris — `git worktree remove` them.

---

## Pocket cheat-sheet

| Phase | Command |
|---|---|
| **Start** | `git fetch origin` → `git worktree add .claude\worktrees\<task> -b feat/<task> origin/main` → `npm i` → `git push -u origin feat/<task>` |
| **Before coding** | `gh pr list` · `git branch -a` · `git log --oneline origin/main -10` |
| **Before PR** | `git rebase origin/main` → `typecheck && lint && test && build:web` |
| **Finish** | `gh pr create --fill` → merge → `git worktree remove` → `git worktree prune` → `git branch -d` |
| **Golden rule** | Own your worktree, push early, keep branches tiny, take `main` in often, never touch another session's tree or the primary checkout |

---

### The three habits that prevent 90% of the pain

1. **Worktrees under `.claude\worktrees\`, never `Desktop\ascent-*` siblings.**
2. **Tear down with `git worktree remove` + `git worktree prune`, never drag-to-trash.**
3. **The primary checkout is read-only while sessions are live.**

> `gh` not on PATH? On Mike's machine call it by full path: `"/c/Program Files/GitHub CLI/gh.exe"`.
