# Rolling Opponent Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new lobby is seated only from the newest 250 eligible recorded runs of its card set; older runs stay stored but are never seated.

**Architecture:** One additive SQL migration. `pool_runs` gains a stored `live` flag, recomputed by the once-a-minute refresh job; every function that seats a table or feeds the hub mirror filters `eligible and live`, and run strength is ranked among live runs. No client, Worker or draw-port change: the hub mirror only ever holds what `pool_mirror_index` returns.

**Tech Stack:** Postgres (Supabase), plpgsql, PGlite + Vitest for database tests.

**Spec:** `docs/superpowers/specs/2026-11-15-pool-rolling-window-design.md`

## Global Constraints

- The limit is **250**, per `set_id`, in one place: `public.pool_live_limit()`.
- "Newest" = highest `pool_runs.id` (upload order) among `eligible` runs of the set.
- Nothing is deleted. `eligible` keeps its meaning (structurally servable); `live` is the window.
- `pool_runs_sample` and `pool_runs__pick` must keep an IDENTICAL picking block (text-compared), and `pool_runs_sample` must keep `set work_mem = '16MB'`.
- Every `create or replace` copies the function's CURRENT body (the file named in the task) and changes only what the task says. Re-issue the grants / revokes the source file and `2026-11-09-security-reads-need-session.sql` give that function.
- The migration is idempotent (`if not exists`, `create or replace`) and wrapped in `begin; … commit;` like its neighbours, with a ROLLBACK block in its header comment.
- Do not touch `workers/versus/src/core/poolPick.ts`, `god_board_sample`, `duo_runs_sample`, or any client code.
- Engine-side files are Kevin's: keep the diff to the files listed.

## Review Focus

- A set with fewer than 250 eligible runs: every eligible run is live (Task 1 test `small set`).
- A newest run that is NOT eligible must not take a slot or push an eligible run out (Task 1 test `ineligible newest`).
- An old run whose boards are re-uploaded or re-scored must not come back (its `id` is unchanged; Task 1 test `touch old run`).
- Two sets in one database each keep their own 250 (Task 1 test `per set`).
- A run that leaves the window keeps its last `strength`; live runs are re-ranked without it (Task 1 test `strength among live`).

---

### Task 1: The migration and its database test

**Files:**
- Create: `supabase/migrations/2026-11-22-pool-rolling-window.sql` (must sort after `2026-11-21-ops-health-checks.sql`)
- Create: `packages/sim/src/lobby/poolRollingWindow.db.test.ts`
- Read for current bodies: `2026-10-17-pool-empty-boards.sql` (`pool_runs_sample`), `2026-11-08-pool-runs-delta.sql` (`pool_runs__pick`), `2026-10-06-early-late-strength.sql` (`pool_strength_refresh`), `2026-11-07-pool-refresh-off-upload.sql` (`pool_refresh_dirty`, `pool_strength_hist_refresh`), `2026-11-20-game-session-cf.sql` (`pool_mirror_version`, `pool_mirror_index`), `2026-11-21-ops-health-checks.sql` (the mirror check's `where r.eligible` id list)

**Interfaces (produced):**
- `pool_runs.live boolean not null default false`
- `public.pool_live_limit() returns int` — immutable, returns `250`
- `public.pool_live_refresh() returns int` — sets `live = (eligible and id in the newest pool_live_limit() eligible ids of its set_id)`, updating only rows whose value changes; returns the number of rows changed. Revoked from `public, anon, authenticated`.
- Index `pool_runs_live_idx on public.pool_runs (set_id, id) where eligible and live`

- [ ] **Step 1: Write the failing test.** Model the harness on `poolRefreshJob.db.test.ts` (same STUB, same CHAIN, then the 11-07 job file, the 11-08 delta file, then the new file; add the 11-20 and 11-21 files with the stubs `workers/versus/test/sessionCf.db.test.ts` / `opsHealth.db.test.ts` use if the mirror assertions need them, otherwise assert the mirror functions' source text contains `r.eligible and r.live`). Drain uploads with `select public.pool_refresh_dirty()`. Tests, with a helper that temporarily shrinks the limit (`create or replace function public.pool_live_limit() returns int language sql immutable as 'select 10'`) so fixtures stay small:
  - `window`: 12 eligible set2 runs → `count(*) filter (where live) = 10`, the two lowest ids are not live; a seeded `pool_runs_sample(p_limit => 300, p_set => 'set2', p_seed => 's')` returns exactly the 10 live run keys.
  - `rolls`: upload a 13th run and drain → the third-lowest id is no longer live, the new run is.
  - `small set`: 4 runs → all 4 live.
  - `ineligible newest`: newest run uploaded with too few waves (ineligible) → not live, and still 10 live.
  - `touch old run`: `update public.boards set power = power + 1` on a non-live run, drain → still not live.
  - `per set`: 12 set2 + 3 set1 runs → 10 and 3 live.
  - `strength among live`: give runs strengths (see how `boardStrength.db.test.ts` stamps `strength_raw`), then `select public.pool_strength_refresh(null,null,null)` → a non-live run's `strength` is unchanged from before it left the window; the live runs' `strength` equals `board_strength_pct` computed over the 10 live averages only; `run_strength_histogram('set2')` sums to the number of live scored runs.
  - `parity`: the picking block of `pool_runs_sample` and the body of `pool_runs__pick` in the NEW file are identical (reuse the extraction in `poolRunsDelta.db.test.ts`), and for seeds `a`,`b`,`c` `pool_runs_sample_keys` returns the same run keys in the same order as `pool_runs_sample`.
  - `work_mem`: `pool_runs_sample`'s `proconfig` contains `work_mem=16MB`.
  - `default limit`: with the real file freshly applied, `select public.pool_live_limit()` = 250.
  - `re-run`: executing the migration file twice succeeds.

- [ ] **Step 2: Run it, confirm it fails.** `npx vitest run packages/sim/src/lobby/poolRollingWindow.db.test.ts` → fails reading the missing migration file.

- [ ] **Step 3: Write the migration**, in this order:
  1. Header comment: why (owner 2026-11-15, quoted in the spec), what, rule `R-POOL-ROLLING-01`, ROLLBACK (drop the column + the two functions, re-apply the five source files' definitions).
  2. `alter table … add column if not exists live boolean not null default false`; the index.
  3. `pool_live_limit()`, `pool_live_refresh()`.
  4. `pool_runs_sample` and `pool_runs__pick`: in the picking block replace each of the three `r.eligible` with `r.eligible and r.live`. Nothing else.
  5. `pool_strength_refresh`: in each of the three `ranked` CTEs add `and r.live` to the `where`, and in each of the three outer `from (select p.id, rk.s from public.pool_runs p left join ranked rk on rk.id = p.id) x` add `where p.live` (so only live rows are written).
  6. `pool_strength_hist_refresh`: add `and r.live` to the `run_strength_hist` insert's `where`. The board histogram is unchanged.
  7. `pool_refresh_dirty`: after step 1's upsert loop add `changed := public.pool_live_refresh();`; run the FULL `pool_strength_refresh(null, null, null)` when `changed > 0` (in addition to the existing scored / stale rule, never twice in one run).
  8. `pool_mirror_version`, `pool_mirror_index`: `where r.eligible` → `where r.eligible and r.live`.
  9. The ops mirror check in `2026-11-21-ops-health-checks.sql`: its `where r.eligible` id list → `where r.eligible and r.live`.
  10. Backfill: `select public.pool_live_refresh(); select public.pool_strength_refresh(null, null, null); select public.pool_strength_hist_refresh();`

- [ ] **Step 4: Run the new test until green**, then the neighbours that execute these functions: `npx vitest run packages/sim/src/lobby workers/versus/test/sessionCf.db.test.ts workers/versus/test/opsHealth.db.test.ts packages/ui/src/securityGrants.db.test.ts`. If a neighbour builds its database from a fixed migration list that should now include the new file (grants or drift pins), add the file to that list; do not weaken an assertion.

- [ ] **Step 5: Check the repo's SQL bookkeeping.** Read `scripts/supabase/drift.mjs`; if `schema.sql` or a ledger file must carry new objects, update it the way the last migration PR did (`git log -3 --stat -- supabase/migrations schema.sql`).

- [ ] **Step 6: Commit.** `feat(pool): seat lobbies from the newest 250 recorded runs`

### Task 2: The rule and the documents

**Files:**
- Modify: `packages/rules/src/registry/approved/foundation.ts` (append at the END of the array)
- Modify: `docs/GAME-RULES.md` (the pool bullets near "The pool is made of WHOLE RUNS")
- Modify: `.claude/skills/ascent-lobby/SKILL.md` (the "shared pool is WHOLE RUNS" invariant: one sentence on `live`)
- Modify: `packages/ui/src/patchNotes.ts` (prepend)
- Modify: `docs/superpowers/specs/2026-11-15-pool-rolling-window-design.md` (Ranked Duos line, below)
- Create: `docs/devlog/2026-11-15-pool-rolling-window.md`

- [ ] **Step 1: Add rule `R-POOL-ROLLING-01`** (domain `foundation`, status `approved`), following the shape of `R-POOL-ANY-VERSION-01`:
  - statement: "A new lobby is seated only from the newest 250 eligible recorded runs of its card set, by upload order. An older run is kept but never seated in a new game; a game already seated keeps its table. Run strength and the rank bands are ranked among those runs only."
  - evidence: owner-chat, ref `Claude Code session, 2026-11-15`, quote `its tough facing strong boards that are now weakened due to balancing changes`; a second owner-chat quote `lets do newest 250 runs`; a `code` entry naming the migration file.
  - currentBehaviour: conforms once the migration is applied to production; before, every eligible run of every age was drawn (551 runs back to 2026-08-17).
  - enforcement: scenario, ref `packages/sim/src/lobby/poolRollingWindow.db.test.ts`, lastVerifiedAt `2026-11-15`.
- [ ] **Step 2: GAME-RULES.** One bullet stating the rule in player terms with the owner quotes, and amend the sentence that says the draw has "no recency" so it reads: uniform among the newest 250.
- [ ] **Step 3: Spec correction.** Ranked Duos: bot seats filled from solo runs follow the window (they call `pool_runs_sample`); recorded duo TEAMS (`duo_runs`) are a separate, small pool and are not windowed in this change.
- [ ] **Step 4: Patch note**, plain English, no internals: "Opponents are now drawn from the 250 most recently played games, so you stop meeting boards built before recent balance changes."
- [ ] **Step 5: Devlog** — what, why, the live numbers measured 2026-11-15 (551 eligible runs, 11 players, 225 older than five weeks), how to change the limit (one function), and that it needs `npm run db:apply`.
- [ ] **Step 6: Run** `npx vitest run packages/rules` and `npm run docbot:report -- --check`.
- [ ] **Step 7: Commit.** `docs(pool): rule R-POOL-ROLLING-01, rules doc, devlog, patch note`

### Task 3: Gates and PR

- [ ] **Step 1:** `npm install` in the worktree (first time), then `npm run typecheck && npm run lint && npm test && npm run build:web`. Report the real result.
- [ ] **Step 2:** `git diff --stat origin/main` — only the files named above.
- [ ] **Step 3:** Push `feat/pool-rolling-window`, open a PR that says plainly: SQL must be applied by a developer (`npm run db:apply`), nothing changes for players until then, and no app release is needed. Request Kevin's eyes. Do not merge without the owner's word.
