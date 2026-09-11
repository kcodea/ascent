# Doc Bot retro-validation harness — `npm run docbot:retro`

Measures Doc Bot's **forward catch rate** against real shipped bugs: of the bugs players and Mike report,
what fraction would a GENERIC lane have caught? Each catalog entry reintroduces one bug's core defect as a
minimal source patch anchored on today's code; the runner applies it in a throwaway worktree, runs the cited
lanes plus the whole docbot directory, and classifies CAUGHT / MISSED / UNPATCHABLE.

```bash
npm run docbot:retro                     # every entry — table + artifacts/docbot-retro/{findings,results}.json
npm run docbot:retro -- --only <id,id>   # a subset
npm run docbot:retro -- --check          # CI mode: exit 1 on a REGRESSION (a ledger CAUGHT that now misses)
npm run docbot:retro -- --cited-only     # only the entry's cited lanes (a fast local probe)
npm run docbot:retro -- --keep           # leave .local/retro-worktree behind for inspection
```

The Python `reinject.py` / `reinject.sh` that used to live here were retired on 2026-09-11 (devlog:
`docs/devlog/2026-09-11-docbot-catch-rate-loop.md`). Everything moved to TypeScript:

| Piece | Where |
|---|---|
| **The catalog** — id, fix commit(s), report date, patch, lanes, scope, measured verdict | `packages/sim/src/docbot/retroCatalog.ts` |
| **The PR-gate lane** — every patch still anchors, no CAUGHT without a red generic lane | `packages/sim/src/docbot/retroCatalog.test.ts` |
| **The citation ledger** — which family/lane owns each bug CLASS and why (`retroMapErrors()` reads the catalog) | `packages/sim/src/docbot/retroInteractionMap.ts` |
| **The runner** | `packages/tools/src/retro-reinject.ts` (+ `.lib.ts`, tested) |
| **The weekly measurement** | `.github/workflows/docbot-retro.yml` (Sundays + `workflow_dispatch`) |
| **The on-ramp** — a closed Bug Board report becomes a catalog stub | `npm run bugs:catalog -- <report-id>` |
| **The number** | `npm run docbot:report` → "forward catch rate", overall and trailing 30 days by report date |

## How the runner stays honest

- **It never touches your tree.** `git worktree add --detach .local/retro-worktree HEAD`, patched per entry,
  `git checkout -- packages` between entries, `git worktree remove --force` on every exit path (including
  SIGINT). The throwaway is HEAD, so commit before you measure — it warns when `packages/` is dirty.
- **The throwaway loads its OWN packages.** A generated `vitest.retro.config.ts` re-aliases every `@game/*`
  entrypoint into the throwaway; without it `node_modules/@game/sim` would symlink back to the launching
  tree and every verdict would read MISSED (the `docs/concurrency.md` trap).
- **Only generic lanes vote.** An entry's `regressionLanes` (the pin its fix shipped with) are never run. The
  harness's own gate lane (`retroCatalog.test.ts`) is excluded too — it is red for every applied patch by
  construction, and the first full run measured a fake 18/18 before that exclusion existed.
- **Verdicts are pasted from a run, never typed.** The table ends with "ledger drift to paste"; the weekly
  fails on a CAUGHT→MISSED regression and tolerates a new MISSED (that is the build order).

**Do not hand-maintain a count in this file.** Run the report.
