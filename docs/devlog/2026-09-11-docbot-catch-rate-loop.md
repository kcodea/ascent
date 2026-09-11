# 2026-09-11 — Doc Bot's forward catch rate becomes a measured, scheduled loop

Doc Bot's only honest effectiveness metric is its **forward catch rate**: of the bugs players and Mike
actually report, what fraction would a GENERIC lane have caught? Until today that number came from an
attended Python script (`packages/tools/retro/reinject.py`) that mutated tracked source, and its "14 of 14"
was dated 2026-08-27. The four real engine fixes of Bug Board round 2 (PR #1374) were not in the catalog, and
nobody had measured them.

## What shipped

- **The catalog is data** — `packages/sim/src/docbot/retroCatalog.ts`. Each entry: id, fix commit(s), Bug
  Board report ids + the REPORT date, a minimal `{ file, find, replace }` patch anchored on today's source,
  the generic lanes expected red, the bug's own regression pin (listed, never run), scope (generic /
  out-of-scope with a reason), and `verifiedBy` = the measured verdict + date. All 14 Python entries migrated
  with their ids; `reinject.py` / `reinject.sh` are deleted.
- **The runner in TypeScript** — `npm run docbot:retro` (`packages/tools/src/retro-reinject.ts` +
  `.lib.ts`). It `git worktree add --detach`es a throwaway under `.local/retro-worktree`, patches one entry
  at a time, runs the cited lanes + the whole docbot directory through vitest's JSON reporter, classifies
  CAUGHT / MISSED / UNPATCHABLE / UNMEASURABLE, and removes the worktree on every exit path (SIGINT included).
  The launching tree is never touched. Output: a table, `findings.json` in the shared `DocbotFinding` shape
  (byte-stable, structural fingerprints) and `results.json`. `--check` exits 1 on a REGRESSION only.
- **The PR gate** — `retroCatalog.test.ts`: every patch still anchors (exactly once unless `all: true`),
  no CAUGHT without a red generic lane, no pin credited, ISO dates, catch-rate math. `retroMapErrors()`
  (the citation ledger in `retroInteractionMap.ts`) now reads the catalog directly and refuses a map row that
  claims `reinject-run` for an entry the catalog measured MISSED.
- **The weekly** — `.github/workflows/docbot-retro.yml` (Sundays 05:17 UTC + dispatch): runs the harness,
  uploads the artifacts, fails only when a ledger CAUGHT now misses. New MISSED entries are the build order.
- **The number** — `npm run docbot:report` prints the forward catch rate, overall and for the trailing 30
  days of report dates, derived from the catalog. `docs/docbot2/final-report.md` §5 was rewritten around it.
- **The on-ramp** — `npm run bugs:catalog -- <report-id>` appends a `pending` stub from a CLOSED local Bug
  Board report (no Supabase key; refuses open or duplicate reports) and prints the map row to add.

## The honest verdicts (measured 2026-09-11)

```
9852e16f-gifts-no-target            generic       MISSED   Gifts belong to no set — no differential enumerates them
7e04222d-free-rally-watchers        generic       MISSED   the combat differential stages real swings only
bb5195d5-nested-scope-double-emit   out-of-scope  MISSED   presentation-beat emission; state was always right
cb45dc41-skybound-tier-clamp        out-of-scope  MISSED   an owner ruling moved the ceiling
+ all 14 earlier entries CAUGHT (caughtBy lanes recorded per entry)

forward catch rate: 14/16 in scope · trailing 30 days by report date: 2/4
```

The two in-scope misses are exactly the classes the entry-path and fire-path lanes
(`feat/docbot-entry-and-fire-paths`, another session) are being built for. This PR does not build them; it
makes their arrival measurable — when they land, the weekly's "ledger drift" block says MISSED → CAUGHT and
a human pastes it.

## Instrument lesson worth keeping

The first full run read **18/18**. HEAD now contained `retroCatalog.test.ts`, whose "every patch anchors on
clean source" assertion is false inside the throwaway the moment a patch is applied — so the harness's own
gate lane went red for every entry and credited itself. It is now excluded from the throwaway run and
filtered from classification, with a sabotage test pinning both. A harness that can vote for itself is not
a measurement.

Also: the throwaway lives INSIDE the repo so node resolution walks up to the launching tree's
`node_modules` (no second install), but that means `node_modules/@game/sim` symlinks back to the UNPATCHED
tree — the generated `vitest.retro.config.ts` re-aliases every `@game/*` entrypoint into the throwaway. Without
it every verdict reads MISSED (the `docs/concurrency.md` trap, in a new coat).

## Follow-ups

- When the entry-path / fire-path lanes merge: `npm run docbot:retro -- --only
  9852e16f-gifts-no-target,7e04222d-free-rally-watchers`, paste the verdicts, upgrade the two map rows.
- Every future Bug Board fix: `npm run bugs:catalog -- <id>` in the fix PR, patch from the diff, measure,
  paste. A fix without a catalog entry is a bug the loop cannot learn from.
