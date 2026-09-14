# 2026-09-14 — port 5173 follows the working branch

**Owner report:** "5173 is usually checked out on the working branch so I can see/test changes — why has that
changed? It's always on random stale branches or sometimes main."

**Cause.** The desktop app's `web` launch config ran `npm run dev` from a FIXED cwd — the directory the
session opened in — and respawned it there whenever it died. Since every task now lives in its own worktree
(`npm run task`), the port kept serving whichever tree the session happened to start in.

**Fix.** A one-line pointer, `.claude/active-worktree` in the primary checkout (gitignored, per machine):

- `scripts/dev-active.mjs` (`npm run dev:active`, now what the `web` launch config runs) resolves the tree
  to serve at start-up: the pointer's path if it holds a real tree, else the primary checkout. Prints
  `▶ 5173 → <branch> @ <sha>` so the served branch is never a mystery.
- `npm run task -- <branch>` writes the pointer (after `--install`, so vite has deps) and bounces 5173: kills
  the listener (IPv6-aware — `netstat -p tcp` is IPv4-only on Windows and vite listens on `[::1]`), waits
  2.5 s for a managed server to respawn, and starts a detached one if nothing did. `--no-serve` opts out.
- `npm run task:serve -- <branch>` re-points at an existing tree; `task:done` clears the pointer when it
  names the tree being removed.

Rule recorded in `docs/concurrency.md` §6.
