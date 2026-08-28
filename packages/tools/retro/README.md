# Doc Bot retro-validation harness

Measures Doc Bot's GENERIC detection against real historical bugs: each entry in `reinject.py` reintroduces
one shipped bug's core defect as a minimal source patch (anchored on today's code), `reinject.sh` runs the
Doc Bot suite against it and classifies CAUGHT / MISSED / UNPATCHABLE. Run from a THROWAWAY worktree — the
script hard-resets `packages/` between bugs:

```bash
git worktree add --detach ../ascent-retro HEAD && cd ../ascent-retro && npm install
bash packages/tools/retro/reinject.sh
```

Full `git revert` was tried first and is not viable on churned files (13 of 18 conflicts). The catalog grows
one entry per interesting historical fix; a MISS is the signal to build a generic oracle — the
`combatModLane` and `missDrivenOracles` lanes were both born from this harness's FIRST run, which measured
**0 of 7** out-of-sample catches and replaced an estimated 65–75% coverage claim with a measured one.

## Where the current verdicts live (this is the part that used to go stale)

- **`packages/sim/src/docbot/retroInteractionMap.ts`** — the machine-checked citation ledger: one row per
  catalog id naming the generalized interaction family and/or the npm-test lane that catches that bug
  CLASS, plus `verifiedBy` (`reinject-run` with a measured date, or `class-analysis` — a standing claim).
  `retroMapErrors()` fails the PR gate when a catalog entry loses its mapping or a cited lane is renamed,
  so this file cannot silently drift from `reinject.py`.
- **`npm run docbot:report`** — prints the current catch rate derived from that ledger (as of 2026-08-27:
  **14 of 14** catalog entries mapped, all 14 established by a recorded reinject run).
- `docs/docbot-roadmap.md` carries the narrative history of each measurement wave.

**Do not hand-maintain a count in this file.** Run the report.

The harness itself is deliberately NOT wired into CI — it is Python, it mutates tracked source in place, and
a machine-refreshed citation is worth less than a human-run, dated one. See `docs/docbot2/ci-lanes.md`
(§17.3) for the full reasoning. Run it attended when the catalog changes or a cited lane is renamed.
