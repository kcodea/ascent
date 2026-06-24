# ASCENT — onboarding (for Mike + Mike's Claude Code)

**Who this is for:** Mike, the second developer on ASCENT, and the Claude Code instance helping him. ASCENT is
a single-player roguelike auto-battler (Battlegrounds-style shop → build a board → fight a rising curve of
threat-typed enemy boards). It's a TypeScript monorepo. **Read [`CLAUDE.md`](CLAUDE.md) in full first** — it is
the shared brain (rules, architecture, what's locked). This file is just the first-15-minutes setup.

> Claude: run the numbered steps below. Anything marked **[Mike]** is a human action (auth, GitHub UI) you
> should pause and ask Mike to do — don't try to do it for him.

---

## 1. Prerequisites

- **Node 20+** and **npm** (`node -v` → should be ≥ 20). The repo pins Node 20 in CI.
- **git**, and ideally the **GitHub CLI** (`gh`) for auth + PRs.
- **[Mike]** Accept the GitHub collaborator invite to `kcodea/ascent` (check your email or
  https://github.com/kcodea/ascent/invitations). You can't clone a private repo until you've accepted.
- **[Mike]** Make sure git/gh is authenticated as your GitHub account: `gh auth login` (or have a credential
  helper set up). Verify with `gh auth status`.

## 2. Clone

```bash
gh repo clone kcodea/ascent      # or: git clone https://github.com/kcodea/ascent.git
cd ascent
```

## 3. Install + verify the setup

```bash
npm install                 # installs all workspace deps (monorepo)
npm run typecheck           # tsc --noEmit across all packages — should be clean
npm run lint                # eslint — should be clean
npm test                    # vitest: determinism + golden + effect tests — all green
npm run build:web           # vite build — must succeed (this is what CI gates on)
```

If all four are green, the environment is good. Then run the game:

```bash
npm run dev                 # Vite dev server → open http://localhost:5173
```

Headless tools (no browser): `npm run bot` (greedy bot plays a run), `npm run harness` (narrated combat +
determinism proof). The full command list is in `CLAUDE.md` → Commands.

## 4. Read the rules (do not skip)

- **[`CLAUDE.md`](CLAUDE.md)** — architecture (deterministic sim decoupled from UI; one seeded RNG;
  `Math.random` is banned in `core`/`content`/`sim`), what's locked vs open, **and the `Collaboration (2 devs)`
  section** — the PR flow, hot-file coordination, and the ownership map. This is the source of truth; if this
  onboarding doc ever disagrees with `CLAUDE.md`, `CLAUDE.md` wins.
- **Performance is the north star** — the game must feel snappy at all times. See `CLAUDE.md` →
  Performance and [`docs/performance.md`](docs/performance.md). Run `npm run perf` before/after engine or
  render-loop changes.
- **History + queue:** [`docs/devlog.md`](docs/devlog.md) (what's been done, newest first) and
  [`docs/roadmap.md`](docs/roadmap.md) (what's next). Keep both current on every commit.

## 5. Your lane (the ownership map)

Work is split along the **simulation ↔ presentation** seam so the two of you rarely touch the same files:

- **Mike → presentation:** `packages/ui/**` (React + Zustand, GSAP animation, styles, audio) and
  `apps/web/**` (the Vite app).
- **Kevin → engine + content + run loop:** `packages/core/**`, `packages/content/**`, `packages/sim/**`,
  balance tools in `packages/tools/**`.
- **Shared boundary — coordinate before changing:** `packages/core/src/types.ts` (the combat event vocabulary,
  `CombatEvent` / `CombatResult`), the package public entrypoints, and any new card-data ↔ UI contract.

**Hot files — never edit casually; ping Kevin first and rebase often:** `packages/sim/src/state.ts` +
`reducer.ts`, `packages/core/src/types.ts`, `packages/ui/src/store.ts`, and
`packages/sim/src/opponentPool.data.ts` (generated — never hand-edit; re-run `npm run pool`).

## 6. Daily flow (GitHub Flow — `main` is protected + always playable)

```bash
git checkout main && git pull           # start from latest main
git checkout -b feat/your-thing         # one feature = one short-lived branch (feat/ fix/ chore/ refactor/)
# …work…  read every diff before committing; stay in scope
npm run typecheck && npm run lint && npm test && npm run build:web   # all green before you push
git push -u origin feat/your-thing
gh pr create --fill                     # open a PR to main
```

- **Never commit to `main`.** It's protected — open a PR. CI (typecheck + lint + test + build) must pass and
  **Kevin reviews** before merge. **Squash and merge** (one clean commit per feature).
- Keep PRs small (< ~400 lines of real change) and rebase on `origin/main` daily so you don't drift.
- Don't do "while I was in there" refactors — propose those as their own PR.
- Update `docs/devlog.md` + `docs/roadmap.md` + the README summary in the same PR as the change.

## 7. When in doubt

Ask Kevin (especially before touching a hot file or the shared `core/types.ts` boundary). The cheapest
collision-avoidance is a one-line "taking `store.ts` for an hour" before you start.

Welcome aboard. 🎮
